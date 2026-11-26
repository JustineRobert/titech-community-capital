#!/usr/bin/env node
/**
 * Browser-level smoke E2E for TITech's public institutional website.
 * Uses the system Chrome/Chromium binary so the repository gains no new
 * runtime dependency. CI must provide Chrome/Chromium and install frontend
 * dependencies before executing this command.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_PAGE_CASES, validatePublicPageHtml } from './lib/publicHomepageE2eContract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = path.join(ROOT, 'frontend');
const IS_WINDOWS = process.platform === 'win32';
const npmCommand = IS_WINDOWS ? 'npm.cmd' : 'npm';
const browserCandidates = IS_WINDOWS
  ? ['chrome.exe', 'chromium.exe', 'msedge.exe']
  : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

function locateBrowser() {
  const configured = String(process.env.CHROME_BIN || process.env.CHROMIUM_BIN || '').trim();
  if (configured) {
    const result = spawnSync(configured, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return configured;
    throw new Error(`Configured browser CHROME_BIN/CHROMIUM_BIN is not executable: ${configured}`);
  }

  for (const candidate of browserCandidates) {
    const result = spawnSync(IS_WINDOWS ? 'where.exe' : 'which', [candidate], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const executable = result.status === 0 ? result.stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean) : null;
    if (!executable) continue;
    const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (version.status === 0) return executable;
  }
  throw new Error('Chrome/Chromium was not found. Install Chrome/Chromium or set CHROME_BIN to its executable path.');
}

async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate an ephemeral Vite port.');
  return address.port;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer(url, child, output) {
  const deadline = Date.now() + 45_000;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before becoming ready (code ${child.exitCode}).\n${output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(250);
  }
  throw new Error(`Vite did not become ready within 45 seconds (${lastError}).\n${output()}`);
}

function runBrowserPage(browser, baseUrl, pageCase, profileDirectory) {
  const url = new URL(pageCase.path, baseUrl).toString();
  const result = spawnSync(browser, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${pageCase.viewport}`,
    '--virtual-time-budget=6000',
    `--user-data-dir=${profileDirectory}`,
    '--dump-dom',
    url,
  ], {
    encoding: 'utf8',
    timeout: 40_000,
    maxBuffer: 12 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) throw new Error(`Browser execution failed for ${pageCase.path}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Browser exited with code ${result.status} for ${pageCase.path}.\n${result.stderr || ''}`);
  }

  const failures = validatePublicPageHtml(pageCase, result.stdout);
  if (failures.length) {
    throw new Error(`Browser E2E assertions failed for ${pageCase.path}:\n- ${failures.join('\n- ')}\nBrowser stderr:\n${result.stderr || '(none)'}`);
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  if (!IS_WINDOWS && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) {
    if (!IS_WINDOWS && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    } else child.kill('SIGKILL');
  }
}

async function main() {
  const browser = locateBrowser();
  const port = Number(process.env.TITECH_E2E_PORT) || await allocatePort();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('TITECH_E2E_PORT must be a valid TCP port.');

  let serverOutput = '';
  const server = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, NODE_ENV: 'test', CI: 'true', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !IS_WINDOWS,
    windowsHide: true,
    shell: IS_WINDOWS,
  });
  const retainOutput = (chunk) => { serverOutput = `${serverOutput}${chunk}`.slice(-16_000); };
  server.stdout.on('data', retainOutput);
  server.stderr.on('data', retainOutput);

  const profiles = [];
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(`${baseUrl}/`, server, () => serverOutput);
    console.log(`Browser: ${browser}`);
    console.log(`Vite: ${baseUrl}`);

    for (const [index, pageCase] of PUBLIC_PAGE_CASES.entries()) {
      const profileDirectory = await mkdtemp(path.join(os.tmpdir(), `titech-e2e-${index}-`));
      profiles.push(profileDirectory);
      runBrowserPage(browser, baseUrl, pageCase, profileDirectory);
      console.log(`PASS browser E2E ${pageCase.path} (${pageCase.viewport})`);
    }

    console.log(`PASS public-site browser E2E (${PUBLIC_PAGE_CASES.length} routes)`);
  } finally {
    await stopServer(server);
    await Promise.all(profiles.map((directory) => rm(directory, { recursive: true, force: true })));
  }
}

main().catch((error) => {
  console.error('FAIL public-site browser E2E');
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

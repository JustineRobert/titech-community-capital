import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE_URL = process.env.TITECH_E2E_BASE_URL;
const START_SERVER = !BASE_URL;
const CHROMIUM = process.env.TITECH_CHROMIUM_PATH || process.env.CHROME_PATH || detectChromium();
const TIMEOUT_MS = Number(process.env.TITECH_E2E_TIMEOUT_MS || 45_000);

function detectChromium() {
  const candidates = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'chromium', 'google-chrome']
      : ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const candidate of candidates) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [candidate], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim().split(/\r?\n/)[0];
    if (path.isAbsolute(candidate)) {
      const check = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
      if (check.status === 0) return candidate;
    }
  }
  return null;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(url, processRef, outputRef) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    if (processRef?.exitCode !== null && processRef?.exitCode !== undefined) {
      throw new Error(`Vite exited (${processRef.exitCode}) before becoming ready.\n${outputRef.value}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}\n${outputRef.value}`);
}

async function waitForJson(url) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await delay(200);
  }
  throw new Error(`Chromium remote-debugging endpoint did not become ready: ${lastError?.message || url}`);
}

class DevToolsPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.errors = [];
    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.text || 'Uncaught browser exception');
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        this.errors.push((message.params.args || []).map((arg) => arg.value || arg.description || '').join(' '));
      }
      const handlers = this.events.get(message.method) || [];
      for (const handler of [...handlers]) handler(message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chromium DevTools socket closed.'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening Chromium DevTools WebSocket.')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not connect to Chromium DevTools WebSocket.')); }, { once: true });
    });
    return new DevToolsPage(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, 12_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeout = 20_000) {
    return new Promise((resolve, reject) => {
      const handlers = this.events.get(method) || [];
      const handler = (params) => {
        clearTimeout(timer);
        this.events.set(method, handlers.filter((item) => item !== handler));
        resolve(params);
      };
      const timer = setTimeout(() => {
        this.events.set(method, handlers.filter((item) => item !== handler));
        reject(new Error(`Timed out waiting for browser event ${method}`));
      }, timeout);
      handlers.push(handler);
      this.events.set(method, handlers);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser expression failed');
    return result.result?.value;
  }

  close() { try { this.socket.close(); } catch {} }
}

async function startChromium(artifactDir) {
  if (!CHROMIUM) throw new Error('Chromium/Chrome was not found. Set TITECH_CHROMIUM_PATH to its executable.');
  const debugPort = await availablePort();
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'titech-chromium-profile-'));
  const child = spawn(CHROMIUM, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', `--remote-debugging-port=${debugPort}`, 
    `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((item) => item.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error(`No Chromium page target found. ${stderr}`);
    const page = await DevToolsPage.connect(target.webSocketDebuggerUrl);
    await Promise.all([page.send('Page.enable'), page.send('Runtime.enable'), page.send('Network.enable')]);
    return {
      page,
      child,
      close: async () => {
        page.close();
        if (child.exitCode === null) child.kill('SIGTERM');
        await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)]);
        if (child.exitCode === null) child.kill('SIGKILL');
        await rm(profileDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(profileDir, { recursive: true, force: true });
    throw new Error(`${error.message}\nChromium stderr: ${stderr}`);
  }
}

async function navigate(page, url) {
  const loaded = page.waitFor('Page.loadEventFired', 25_000);
  await page.send('Page.navigate', { url });
  await loaded;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate('document.readyState');
    if (ready === 'complete') return;
    await delay(150);
  }
  throw new Error(`Page did not complete loading: ${url}`);
}

async function captureFailure(page, artifactDir, error) {
  if (!page) return;
  try {
    const result = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buffer = Buffer.from(result.data, 'base64');
    await writeFile(path.join(artifactDir, 'homepage-failure.png'), buffer);
    await writeFile(path.join(artifactDir, 'browser-errors.txt'), `${error.message}\n\n${page.errors.join('\n')}\n`);
  } catch { /* Preserve the original failure if the browser is already gone. */ }
}

test('public homepage renders official TITech identity and usable official contact links in Chromium', { timeout: TIMEOUT_MS + 30_000 }, async () => {
  const evidenceRoot = path.join(FRONTEND_ROOT, 'test-reports');
  await mkdir(evidenceRoot, { recursive: true });
  const artifactDir = await mkdtemp(path.join(evidenceRoot, 'e2e-'));
  let server;
  let serverOutput = { value: '' };
  let browser;
  let page;
  let failed = false;
  const baseUrl = BASE_URL || `http://127.0.0.1:${await availablePort()}`;

  try {
    if (START_SERVER) {
      const args = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', new URL(baseUrl).port, '--strictPort'];
      server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: FRONTEND_ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      server.stdout.on('data', (chunk) => { serverOutput.value += chunk.toString(); });
      server.stderr.on('data', (chunk) => { serverOutput.value += chunk.toString(); });
      await waitForHttp(baseUrl, server, serverOutput);
    }

    browser = await startChromium(artifactDir);
    page = browser.page;
    await navigate(page, `${baseUrl.replace(/\/$/, '')}/`);

    const documentInfo = await page.evaluate(`(() => ({
      title: document.title,
      text: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')].map((link) => ({ href: link.getAttribute('href'), text: link.innerText.trim() })),
      brokenImages: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src),
    }))()`);

    assert.match(documentInfo.text, /TITech Community Capital/);
    assert.match(documentInfo.text, /TITECH CAPITAL - SMC LTD/);
    assert.match(documentInfo.text, /Community Finance\. Stronger Together\./);
    assert.match(documentInfo.text, /80049233029029/);
    assert.match(documentInfo.text, /P\.O\. Box 601200/);
    assert.match(documentInfo.text, /titechcapital@gmail\.com/);
    for (const href of ['tel:+256782397907', 'tel:+256772123546', 'https://wa.me/256782397907', 'https://wa.me/256772123546', 'mailto:titechcapital@gmail.com']) {
      assert.ok(documentInfo.links.some((link) => link.href === href), `Expected official contact link ${href}`);
    }
    assert.deepEqual(documentInfo.brokenImages, [], 'homepage should not contain broken image assets');
    const homepageScreenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifactDir, 'homepage.png'), Buffer.from(homepageScreenshot.data, 'base64'));

    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileLayout = await page.evaluate('({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })');
    assert.ok(mobileLayout.document <= mobileLayout.viewport + 1, `mobile layout overflows horizontally: ${JSON.stringify(mobileLayout)}`);
    const mobileScreenshot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifactDir, 'homepage-mobile.png'), Buffer.from(mobileScreenshot.data, 'base64'));

    await navigate(page, `${baseUrl.replace(/\/$/, '')}/contact-us`);
    const contactRouteText = await page.evaluate('document.body.innerText');
    assert.match(contactRouteText, /Contact Us/);

    assert.deepEqual(page.errors, [], `browser console/runtime errors: ${page.errors.join('; ')}`);
    await writeFile(path.join(artifactDir, 'summary.json'), JSON.stringify({ status: 'PASS', baseUrl, checkedAt: new Date().toISOString(), documentTitle: documentInfo.title, mobileLayout, verifiedLinks: ['tel:+256782397907', 'tel:+256772123546', 'https://wa.me/256782397907', 'https://wa.me/256772123546', 'mailto:titechcapital@gmail.com'], browserErrors: page.errors }, null, 2) + '\n');
  } catch (error) {
    failed = true;
    await captureFailure(page, artifactDir, error);
    if (serverOutput.value) error.message += `\nVite output:\n${serverOutput.value}`;
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => server.once('exit', resolve)), delay(2000)]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    console.log(`TITech E2E evidence: ${artifactDir}`);
    if (failed) console.error(`TITech E2E failure evidence retained at ${artifactDir}`);
  }
});

#!/usr/bin/env node
/**
 * TITech supported runtime gate. Dependency-free by design so it runs before npm ci.
 * The repository's validated baseline is Node 24.15.0 and npm 11.0.0 or newer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = [24, 15, 0];
const MIN_NPM = [11, 0, 0];

export function parseVersion(value) {
  const match = String(value).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error(`Unsupported version string: ${value}`);
  return match.slice(1, 4).map(Number);
}

export function compareVersions(left, right) {
  const a = Array.isArray(left) ? left : parseVersion(left);
  const b = Array.isArray(right) ? right : parseVersion(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function readJson(relativePath, root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

export function evaluateRuntime({ nodeVersion = process.versions.node, npmVersion, root = ROOT } = {}) {
  const failures = [];
  const warnings = [];
  let actualNpm = npmVersion;
  if (!actualNpm) {
    try {
      actualNpm = execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim();
    } catch (error) {
      failures.push(`Unable to execute npm --version: ${error.message}`);
      actualNpm = '0.0.0';
    }
  }
  if (compareVersions(nodeVersion, MIN_NODE) < 0) failures.push(`Node ${nodeVersion} is below required >=24.15.0.`);
  if (compareVersions(actualNpm, MIN_NPM) < 0) failures.push(`npm ${actualNpm} is below required >=11.0.0.`);

  let rootPackage;
  try { rootPackage = readJson('package.json', root); } catch (error) { failures.push(`Unable to read root package.json: ${error.message}`); }
  const manifests = ['backend/package.json', 'frontend/package.json'];
  for (const relativePath of manifests) {
    try {
      const manifest = readJson(relativePath, root);
      if (manifest.engines?.node !== '>=24.15.0') failures.push(`${relativePath} must declare Node >=24.15.0.`);
      if (manifest.engines?.npm !== '>=11.0.0') failures.push(`${relativePath} must declare npm >=11.0.0.`);
    } catch (error) { failures.push(`Unable to validate ${relativePath}: ${error.message}`); }
  }
  if (rootPackage) {
    if (rootPackage.engines?.node !== '>=24.15.0') failures.push('Root package.json must declare Node >=24.15.0.');
    if (rootPackage.engines?.npm !== '>=11.0.0') failures.push('Root package.json must declare npm >=11.0.0.');
  }
  try {
    const pin = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
    if (pin !== '24.15.0') failures.push(`.nvmrc must pin 24.15.0 for reproducible CI; found ${pin || '(empty)'}.`);
  } catch { failures.push('.nvmrc is missing.'); }

  for (const relativePath of ['package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
    try {
      if (!fs.statSync(path.join(root, relativePath)).isFile() || fs.statSync(path.join(root, relativePath)).size === 0) failures.push(`${relativePath} is missing or empty.`);
    } catch { failures.push(`${relativePath} is missing.`); }
  }
  return { status: failures.length ? 'BLOCKED' : 'PASS', nodeVersion, npmVersion: actualNpm, minimumNode: '24.15.0', minimumNpm: '11.0.0', failures, warnings };
}

function main() {
  const result = evaluateRuntime();
  console.log(`TITech supported runtime gate: ${result.status}`);
  console.log(`Observed Node: ${result.nodeVersion}; observed npm: ${result.npmVersion}`);
  console.log(`Required Node: >=${result.minimumNode}; required npm: >=${result.minimumNpm}`);
  for (const failure of result.failures) console.error(`BLOCKER: ${failure}`);
  if (result.status !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

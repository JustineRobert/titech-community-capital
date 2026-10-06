#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Fail before spawning two child processes when the repository runtime
// contract is unsupported. This prevents a healthy-looking frontend from
// hiding a backend that exits immediately during bootstrap.
try {
  execFileSync(process.execPath, ['scripts/runtime-preflight.mjs'], { stdio: 'inherit' });
} catch (error) {
  process.exit(error?.status || 1);
}

const children = [
  spawn(npm, ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit' }),
  spawn(npm, ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit' }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('TITECH_DEV_CHILD_PROCESS_FAILED', error?.message || error);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal || (typeof code === 'number' && code !== 0)) shutdown(code || 1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

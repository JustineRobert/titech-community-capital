#!/usr/bin/env node
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Spawn backend and frontend dev servers
const children = [
  spawn(npm, ['--prefix', 'backend', 'run', 'dev'], {
    stdio: 'inherit',
    shell: true, // ensures Windows handles spaces in paths correctly
  }),
  spawn(npm, ['--prefix', 'frontend', 'run', 'dev'], {
    stdio: 'inherit',
    shell: true,
  }),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // fallback for Windows if SIGTERM unsupported
        child.kill();
      }
    }
  }

  // Allow children to exit gracefully before terminating
  setTimeout(() => process.exit(code), 500);
}

// Attach error and exit handlers
for (const child of children) {
  child.on('error', (err) => {
    console.error(`Child process error: ${err.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal || (typeof code === 'number' && code !== 0)) {
      shutdown(code || 1);
    }
  });
}

// Handle termination signals
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
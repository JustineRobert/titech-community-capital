#!/usr/bin/env node
/**
 * Compatibility wrapper for the canonical ESM platform-admin bootstrap CLI.
 * Credentials must be supplied through a protected environment/secret
 * manager, never command-line arguments.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cli = path.join(__dirname, 'seed-admin-cli.js');
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error('Unable to start canonical administrator bootstrap:', result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}

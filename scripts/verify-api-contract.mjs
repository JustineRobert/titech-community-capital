#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  api: 'frontend/src/services/api.js',
  config: 'frontend/src/services/apiConfiguration.js',
  connectivity: 'frontend/src/services/runtimeConnectivity.js',
  vite: 'frontend/vite.config.js',
};
const failures = [];
const read = (key) => fs.readFileSync(path.join(root, files[key]), 'utf8');

const api = read('api');
const config = read('config');
const connectivity = read('connectivity');
const vite = read('vite');

for (const endpoint of ['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/refresh', '/api/v1/health', '/api/v1/ready']) {
  if (!api.includes(endpoint) && !vite.includes(endpoint)) failures.push(`Missing endpoint reference: ${endpoint}`);
}
for (const marker of ['AUTH_API_UNAVAILABLE', 'AUTH_API_TIMEOUT', 'AUTH_INVALID_CREDENTIALS', 'AUTH_FORBIDDEN', 'AUTH_RATE_LIMITED', 'AUTH_SERVER_ERROR']) {
  if (!api.includes(marker)) failures.push(`Missing auth classification: ${marker}`);
}
for (const marker of ['API_REACHABLE', 'API_DEGRADED', 'API_UNAVAILABLE', 'OFFLINE', 'READY']) {
  if (!connectivity.includes(marker)) failures.push(`Missing connectivity state: ${marker}`);
}
if (!config.includes('resolveApiBaseUrl') || !config.includes('production')) failures.push('API origin resolver is not fail-closed for production.');

console.log(`TITech API contract: ${failures.length ? 'FAILED' : 'PASSED'}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

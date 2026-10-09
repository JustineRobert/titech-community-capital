#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'frontend/src/services/api.js',
  'frontend/src/services/apiConfiguration.js',
  'frontend/src/services/runtimeConnectivity.js',
  'frontend/src/context/AuthContext.jsx',
  'frontend/src/pages/Login.jsx',
  'backend/server.js',
  'backend/routes/index.js',
];

const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required runtime file: ${file}`);
}

const api = read('frontend/src/services/api.js');
const config = read('frontend/src/services/apiConfiguration.js');
const login = read('frontend/src/pages/Login.jsx');
const routes = read('backend/routes/index.js');
const server = read('backend/server.js');

for (const needle of ["'/api/auth/login'", "'/api/auth/refresh'", "'/api/auth/logout'"]) {
  if (!api.includes(needle)) failures.push(`Authentication endpoint contract missing: ${needle}`);
}
if (!routes.includes('`${API_PREFIX}/health`') || !routes.includes('`${API_PREFIX}/ready`')) failures.push('Health/readiness route contract is incomplete.');
if (!server.includes('TITECH_BACKEND_STARTUP_FAILED')) failures.push('Backend startup failure diagnostic contract is missing.');
if (!config.includes('TITECH_API_ORIGIN_MISSING')) failures.push('Production API-origin fail-closed contract is missing.');
if (!login.includes('Authentication service unavailable')) failures.push('Login transport failure UX is missing.');
if (api.includes("window.location.origin : ''")) failures.push('Unsafe production window.location.origin API fallback remains in api.js.');

const envDevelopmentPath = path.join(root, 'frontend/.env.development');
const envExamplePath = path.join(root, 'frontend/.env.example');
if (fs.existsSync(envDevelopmentPath)) {
  const env = read('frontend/.env.development');
  if (!env.includes('VITE_API_URL=http://localhost:5000')) {
    failures.push('frontend/.env.development exists but does not declare VITE_API_URL=http://localhost:5000.');
  }
} else if (fs.existsSync(envExamplePath)) {
  const envExample = read('frontend/.env.example');
  if (!envExample.includes('VITE_API_URL=http://localhost:5000')) {
    failures.push('Deterministic development API origin is missing from frontend/.env.example.');
  }
}

console.log(`TITech runtime contract: ${failures.length ? 'FAILED' : 'PASSED'}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

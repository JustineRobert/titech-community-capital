#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const api = fs.readFileSync(path.join(root, 'frontend/src/services/api.js'), 'utf8');
const login = fs.readFileSync(path.join(root, 'frontend/src/pages/Login.jsx'), 'utf8');
const authContext = fs.readFileSync(path.join(root, 'frontend/src/context/AuthContext.jsx'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'backend/controllers/authController.js'), 'utf8');

if (api.includes('localStorage.setItem(\'accessToken\'')) failures.push('Access token must not be persisted to localStorage.');
if (api.includes('sessionStorage.setItem(\'accessToken\'')) failures.push('Access token must not be persisted to sessionStorage.');
if (!api.includes('return null;') || !api.includes('getRefreshToken')) failures.push('Refresh token browser-read boundary is missing.');
if (!api.includes('withCredentials: true')) failures.push('Credentialed authentication transport is not configured.');
if (!api.includes('AUTH_INVALID_CREDENTIALS') || !api.includes('AUTH_API_UNAVAILABLE')) failures.push('Transport/authentication error separation is incomplete.');
if (!login.includes('credentialFailure')) failures.push('Login lockout is not scoped to credential failures.');
if (!authContext.includes('AUTH_API_UNAVAILABLE')) failures.push('AuthContext does not preserve transport failure classification.');
if (!controller.includes('/api/auth/login') && !fs.readFileSync(path.join(root, 'backend/routes/auth.js'), 'utf8').includes('/login')) failures.push('Canonical backend login route could not be proven.');

console.log(`TITech authentication contract: ${failures.length ? 'FAILED' : 'PASSED'}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

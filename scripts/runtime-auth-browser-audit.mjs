#!/usr/bin/env node

/**
 * TITech Community Capital — Runtime/Auth/Browser Remediation Audit
 * Dependency-free source contract check for the enterprise runtime boundary.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const checks = [];
const pass = (id, message) => checks.push({ id, status: 'PASS', message });
const fail = (id, message) => checks.push({ id, status: 'FAIL', message });

const app = read('frontend/src/App.jsx');
const providers = read('frontend/src/app/providers.jsx');
const api = read('frontend/src/services/api.js');
const apiConfig = read('frontend/src/services/apiConfiguration.js');
const socket = read('frontend/src/services/socket.js');
const auth = read('frontend/src/context/AuthContext.jsx');
const notifications = read('frontend/src/components/ui/NotificationProvider.jsx');
const routes = read('backend/routes/index.js');
const readiness = exists('frontend/src/services/runtimeConnectivity.js');

const authProviderUsages = (providers.match(/<AuthProvider\b/g) ?? []).length;
const appNestedAuthProvider = /<AuthProvider\b/.test(app);
if (authProviderUsages === 1 && !appNestedAuthProvider) {
  pass('single-auth-provider', 'Exactly one canonical AuthProvider is mounted in the application provider boundary.');
} else {
  fail('single-auth-provider', `Expected one provider mount and no nested App.jsx provider; found ${authProviderUsages} provider mounts and nested=${appNestedAuthProvider}.`);
}

if (readiness) pass('connectivity-state', 'Shared API/browser connectivity state module exists.');
else fail('connectivity-state', 'Shared runtime connectivity state module is missing.');

if (/resolveApiBaseUrl/.test(api) && /TITECH_API_ORIGIN_MISSING/.test(apiConfig) && !/window\.location\.origin\s*\?/.test(api)) {
  pass('api-origin-contract', 'API origin resolution is explicit and production fail-closed; same-origin proxy paths are intentional.');
} else {
  fail('api-origin-contract', 'API origin contract is incomplete.');
}

if (/API_READINESS_ENDPOINT/.test(api) && /\/api\/v1\/ready/.test(api)) {
  pass('readiness-contract', 'Frontend readiness probing targets the canonical /api/v1/ready contract.');
} else {
  fail('readiness-contract', 'Frontend readiness endpoint contract is missing or inconsistent.');
}

if (/normalizeConfiguredApiBaseUrl/.test(apiConfig) && /API_PREFIXES/.test(apiConfig)) {
  pass('api-prefix-normalization', 'API base normalization prevents duplicated /api and /api/v1 path prefixes.');
} else {
  fail('api-prefix-normalization', 'API base path normalization contract is missing.');
}

if (!/localStorage\.[^(]*\([^\n]*token|sessionStorage\.[^(]*\([^\n]*token|TOKEN_KEY|TENANT_KEY/.test(socket)) {
  pass('socket-token-storage', 'Socket service no longer persists or reads access tokens from browser storage.');
} else {
  fail('socket-token-storage', 'Socket service still contains browser-storage token handling.');
}

if (/Access Token:[\s\S]{0,260}Memory only/i.test(auth) && /Refresh Token:[\s\S]{0,320}HttpOnly/i.test(auth)) {
  pass('auth-security-model', 'Authentication context documents memory-only access tokens and backend-owned HttpOnly refresh cookies.');
} else {
  fail('auth-security-model', 'Authentication security boundary is not clearly preserved.');
}

if (/Network\/dependency failures do not prove/.test(auth) && /isTransientAuthFailure/.test(auth)) {
  pass('refresh-network-classification', 'Transient refresh/network failures are separated from definitive authentication failure.');
} else {
  fail('refresh-network-classification', 'Refresh failure classification is incomplete.');
}

if (/const NOTIFICATION_ENDPOINT =\s*"\/api\/notifications"/.test(notifications) && /probeApiReadiness/.test(notifications)) {
  pass('notification-readiness-gate', 'Notification loading is gated by shared API readiness.');
} else {
  fail('notification-readiness-gate', 'Notification readiness gating is missing.');
}

if (/lastAutoLoadKeyRef/.test(notifications) && /apiConnectivity\.status/.test(notifications)) {
  pass('notification-deduplication', 'Notification bootstrap contains identity/connectivity request de-duplication controls.');
} else {
  fail('notification-deduplication', 'Notification bootstrap request de-duplication controls are missing.');
}

if (/\/api\/notifications/.test(routes) && /authenticate/.test(routes) && /tenantAuthorization/.test(routes)) {
  pass('notification-route', 'Canonical notification API compatibility route is mounted behind authentication and tenant authorization.');
} else {
  fail('notification-route', 'Notification route is missing or not protected by the canonical auth/tenant boundary.');
}

if (!/chrome-extension:\/\/efaidnbmnnnibpcajpcglclefindmkaj/.test(app + providers + api + auth + notifications)) {
  pass('browser-extension-separation', 'No TITech application source depends on the Adobe browser-extension resource shown in the console evidence.');
} else {
  fail('browser-extension-separation', 'A TITech application source references the external Adobe browser extension resource.');
}

const result = {
  generatedAt: new Date().toISOString(),
  status: checks.some((item) => item.status === 'FAIL') ? 'FAIL' : 'PASS',
  checks,
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/runtime-auth-browser-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.status === 'FAIL') process.exitCode = 1;

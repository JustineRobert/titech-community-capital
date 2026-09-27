#!/usr/bin/env node
/**
 * TITech Community Capital — dependency-free security contract gate.
 *
 * Scope: source-level controls that can be proven without MongoDB, Redis,
 * provider credentials or a browser runtime.
 *
 * This gate intentionally does not claim SAST/DAST/provider certification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(ROOT, file));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'build', 'coverage', '.vite', '.vitest'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else out.push(absolute);
  }
  return out;
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

// ---------------------------------------------------------------------------
// Browser credential storage
// ---------------------------------------------------------------------------

const frontend = walk(path.join(ROOT, 'frontend', 'src')).filter((f) => /\.(js|jsx|mjs|cjs|ts|tsx)$/.test(f));
const directCredentialStorage = [];

for (const file of frontend) {
  const text = fs.readFileSync(file, 'utf8');
  const patterns = [
    /localStorage\.(?:setItem|getItem)\s*\(\s*['"](?:accessToken|refreshToken|token|jwt)['"]/i,
    /sessionStorage\.(?:setItem|getItem)\s*\(\s*['"](?:accessToken|refreshToken|token|jwt)['"]/i,
    /localStorage\.(?:setItem|getItem)\s*\([^\n]*\b(?:accessToken|refreshToken)\b/i,
    /sessionStorage\.(?:setItem|getItem)\s*\([^\n]*\b(?:accessToken|refreshToken)\b/i,
  ];
  if (patterns.some((pattern) => pattern.test(text))) {
    directCredentialStorage.push(rel(file));
  }
}

assert(
  directCredentialStorage.length === 0,
  `Reusable authentication credentials are still directly persisted/read from browser storage: ${directCredentialStorage.join(', ')}`,
);

assert(exists('frontend/src/app/store.js'), 'Missing Redux store security boundary.');
if (exists('frontend/src/app/store.js')) {
  const store = read('frontend/src/app/store.js');
  assert(store.includes('createTransform'), 'Redux persistence transform is missing.');
  assert(store.includes('authPersistenceTransform'), 'Auth persistence transform is not registered.');
  assert(/token:\s*null/.test(store), 'Persisted auth state is not explicitly stripped of tokens on rehydrate.');
}

assert(exists('frontend/src/context/AuthProvider.jsx'), 'Canonical AuthProvider is missing.');
if (exists('frontend/src/context/AuthProvider.jsx')) {
  const authProvider = read('frontend/src/context/AuthProvider.jsx');
  assert(authProvider.includes('getToken()'), 'AuthProvider does not use the canonical in-memory token accessor.');
  assert(!/localStorage\.(?:setItem|getItem)\s*\([^\n]*(?:accessToken|refreshToken)/i.test(authProvider), 'AuthProvider contains direct credential persistence.');
}

assert(exists('frontend/src/services/socket.js'), 'Socket service is missing.');
if (exists('frontend/src/services/socket.js')) {
  const socket = read('frontend/src/services/socket.js');
  assert(socket.includes('import {') && socket.includes('getToken'), 'Socket service does not import the canonical token accessor.');
  assert(!/localStorage\.(?:setItem|getItem|removeItem)\s*\([^\n]*(?:TOKEN_KEY|accessToken|refreshToken|token)/i.test(socket), 'Socket service contains browser credential storage.');
}

// ---------------------------------------------------------------------------
// Webhook security
// ---------------------------------------------------------------------------

assert(exists('backend/utils/webhookSecurity.cjs'), 'Canonical CJS webhook security module is missing.');
if (exists('backend/utils/webhookSecurity.cjs')) {
  const security = read('backend/utils/webhookSecurity.cjs');
  assert(security.includes('timingSafeEqual'), 'Webhook signatures must use constant-time comparison.');
  assert(security.includes('rawBody'), 'Webhook signature verification must accept raw-body bytes when available.');
  assert(security.includes('DEFAULT_REPLAY_WINDOW_MS'), 'Webhook replay window must be explicit and bounded.');
}

assert(exists('backend/middleware/mtnWebhookMiddleware.cjs'), 'Canonical CJS MTN webhook middleware is missing.');
if (exists('backend/middleware/mtnWebhookMiddleware.cjs')) {
  const middleware = read('backend/middleware/mtnWebhookMiddleware.cjs');
  assert(middleware.includes('req.rawBody'), 'MTN webhook middleware does not pass the captured raw body to signature verification.');
  assert(middleware.includes('WEBHOOK_SECURITY_NOT_CONFIGURED'), 'MTN webhook middleware does not fail closed when the webhook secret is missing.');
}

// ---------------------------------------------------------------------------
// Secrets hygiene and repository boundaries
// ---------------------------------------------------------------------------

if (exists('.gitignore')) {
  const gitignore = read('.gitignore');
  assert(/(^|\n)\.env(\.|$)/.test(gitignore), '.gitignore must exclude environment secret files.');
}

const backendProductionDirs = ['backend/controllers', 'backend/routes', 'backend/services'];
for (const dir of backendProductionDirs) {
  const files = walk(path.join(ROOT, dir)).filter((f) => /\.(js|mjs|cjs)$/.test(f));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/Authorization\s*[:=]\s*[^\n]*console\.(log|info|warn|error)/i.test(text)) {
      warnings.push(`${rel(file)} may log an authorization header; review manually.`);
    }
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'FAIL' : 'PASS',
  scope: 'dependency-free-source-contracts',
  failures,
  warnings,
  excludedClaims: [
    'SAST/DAST completion',
    'dependency-vulnerability clearance',
    'container/IaC scan clearance',
    'provider certification',
    'regulatory approval',
    'production approval',
  ],
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/security-static-gate.json'), `${JSON.stringify(result, null, 2)}\n`);

if (failures.length) {
  console.error('Security static gate: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Security static gate: PASS');
for (const warning of warnings) console.log(`WARNING: ${warning}`);

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const requireContains = (file, needles, label) => {
  const source = read(file);
  for (const needle of needles) {
    if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
  }
};
const requireNotContains = (file, needles, label) => {
  const source = read(file);
  for (const needle of needles) {
    if (source.includes(needle)) failures.push(`${label}: forbidden ${needle}`);
  }
};

const requiredFiles = [
  'backend/server.js',
  'backend/bootstrap/ApplicationBootstrap.js',
  'backend/bootstrap/server.js',
  'backend/bootstrap/infrastructure/index.js',
  'backend/bootstrap/database.cjs',
  'backend/bootstrap/readinessState.js',
  'backend/routes/index.js',
  'backend/controllers/authController.js',
  'backend/config/auth.config.js',
  'frontend/src/services/api.js',
  'frontend/src/services/apiConfiguration.js',
  'frontend/src/services/runtimeConnectivity.js',
  'frontend/src/context/AuthContext.jsx',
  'frontend/src/pages/Login.jsx',
];
for (const file of requiredFiles) {
  if (!exists(file)) failures.push(`Required file missing: ${file}`);
}

if (exists('backend/package.json')) {
  const pkg = JSON.parse(read('backend/package.json'));
  if (pkg.type !== 'module') failures.push('backend/package.json must remain ESM.');
  if (pkg.engines?.node !== '>=24.15.0') failures.push('backend Node engine contract changed unexpectedly.');
}

requireContains('backend/bootstrap/server.js', [
  "import * as hooksModuleNamespace from './hooks.js';",
  "import * as readinessModuleNamespace from './readinessState.js';",
  'SERVER_PRELISTEN_BOOTSTRAP_INCOMPLETE',
], 'HTTP server bootstrap');
requireNotContains('backend/bootstrap/server.js', [
  "require('./hooks')",
  "require('./readinessState')",
], 'HTTP server ESM boundary');

requireContains('backend/bootstrap/infrastructure/index.js', [
  'fileURLToPath(import.meta.url)',
  'bootstrap/database.cjs',
  'config/db.cjs',
  'services/redis.cjs',
  'registerDependencyReadinessCheck',
  'registerDatabaseCheck',
], 'Infrastructure composition root');
requireNotContains('backend/bootstrap/infrastructure/index.js', [
  'function logInfo(\n  context,\n  metadata,\n  message,\n  message,',
], 'Infrastructure syntax regression');

requireContains('backend/bootstrap/ApplicationBootstrap.js', [
  'application.locals.titechReadiness = async () =>',
  'BootstrapContext + database readiness',
  'database_not_ready',
], 'Application readiness contract');

requireContains('backend/routes/index.js', [
  'res\n                .status(isReady ? 200 : 503)',
  "status: isReady ? 'ready' : 'not_ready'",
], 'Readiness route');
requireNotContains('backend/routes/index.js', [
  'let isReady = true;',
], 'Readiness fail-closed behavior');

requireContains('backend/config/auth.config.js', [
  'env.JWT_ACCESS_SECRET',
  'env.JWT_REFRESH_SECRET',
], 'JWT secret contract');
requireContains('backend/controllers/authController.js', [
  'process.env.JWT_ACCESS_SECRET',
  'AUTH_STORE_UNAVAILABLE',
  'NODE_ENV !== \'production\'',
], 'Authentication persistence boundary');
requireNotContains('backend/controllers/authController.js', [
  "localStorage.setItem('accessToken'",
  "sessionStorage.setItem('accessToken'",
], 'Token persistence');

requireContains('frontend/src/services/api.js', [
  "'/api/auth/login'",
  "'/api/auth/refresh'",
  "'/api/auth/logout'",
  'withCredentials: true',
], 'Frontend authentication transport');
requireContains('frontend/src/services/runtimeConnectivity.js', [
  'probePromise',
  'API_UNAVAILABLE',
], 'Runtime connectivity');
requireContains('frontend/src/services/api.js', [
  'new AbortController()',
], 'API request cancellation');

requireContains('frontend/src/context/AuthContext.jsx', [
  'BroadcastChannel',
  'AUTH_API_UNAVAILABLE',
], 'Auth bootstrap/recovery');
requireContains('backend/middleware/auth.js', [
  'process.env.JWT_ACCESS_SECRET',
], 'Canonical JWT verification secret precedence');

for (const [active, archived] of [
  ['backend/PRODUCTION_IMPLEMENTATION_v2.js', '.titech-remediation/archive/2026-10-07-legacy-duplicates/PRODUCTION_IMPLEMENTATION_v2.js'],
  ['backend/app.cjs', '.titech-remediation/archive/2026-10-07-legacy-duplicates/app.cjs'],
]) {
  if (exists(active)) failures.push(`Legacy parallel runtime file remains active: ${active}`);
  if (!exists(archived)) failures.push(`Legacy runtime archive is missing: ${archived}`);
}

const officialTheme = JSON.parse(read('branding/TITECH_OFFICIAL_THEME.json'));
for (const [name, expected] of Object.entries({
  deepBlue: '#0030A0', electricBlue: '#0058D8', brightBlue: '#0066E8', cyan: '#00B8F8',
  africaGreen: '#008000', limeGreen: '#A8F000', goldYellow: '#F8D800', navyInk: '#082B67', white: '#FFFFFF',
})) {
  if (String(officialTheme.palette?.[name] || '').toUpperCase() !== expected) {
    failures.push(`Official TITech theme mismatch: ${name}`);
  }
}
if (!exists('branding/official/TITech_Official_Logo_Transparent_Provided_2026-10-08.png')) {
  failures.push('Provided official transparent logo provenance asset is missing.');
}

// Exact git-conflict markers, not decorative ===== comment separators.
const conflictPattern = /^(<<<<<<< .+|=======|>>>>>>> .+)$/m;
const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|mjs|cjs|jsx|tsx|css|json|yml|yaml|md|sh|txt)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);
for (const full of sourceFiles) {
  let source = '';
  try { source = fs.readFileSync(full, 'utf8'); } catch { continue; }
  if (conflictPattern.test(source)) failures.push(`Merge-conflict marker remains: ${path.relative(root, full)}`);
}

for (const file of ['frontend/.env.example', 'backend/.env.example']) {
  if (!exists(file)) failures.push(`Environment template missing: ${file}`);
}
if (exists('frontend/.env.example')) requireContains('frontend/.env.example', ['VITE_API_URL=http://localhost:5000'], 'Frontend development API contract');

console.log(`TITech login/readiness remediation contract: ${failures.length ? 'FAILED' : 'PASSED'}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

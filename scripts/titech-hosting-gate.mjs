import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}
function size(rel) {
  const p = path.join(ROOT, rel);
  return exists(rel) ? fs.statSync(p).size : 0;
}
function pass(id, message) {
  checks.push({ id, status: 'PASS', message });
}
function fail(id, message) {
  checks.push({ id, status: 'FAIL', message });
  failures.push(message);
}

const requiredFiles = [
  'docker/backend.Dockerfile',
  'docker/frontend.Dockerfile',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.dev.yml',
  'nginx/production.conf.template',
  'backend/Dockerfile',
  'frontend/Dockerfile',
  'frontend/nginx.conf',
  'frontend/public/manifest.webmanifest',
  'frontend/public/sw.js',
  'backend/.env.production.example',
  'frontend/.env.production.example',
  'docs/deployment/TITECH_WEB_MOBILE_HOSTING_IMPLEMENTATION_2026-09-29.md',
  'docs/brand/TITECH_OFFICIAL_THEME_2026-09-29.md',
];

for (const rel of requiredFiles) {
  if (!exists(rel) || size(rel) === 0) fail(`required:${rel}`, `${rel} is missing or zero-byte.`);
}
if (!failures.length) pass('required-artifacts', 'Hosting and theme implementation artifacts are present and non-zero.');

// Production examples are contracts, not deployable secrets. Keep them safe by
// requiring external database/cache endpoints, explicit hardening defaults and
// disabled high-risk capabilities until their independent gates pass.
const backendProductionEnvPath = path.join(ROOT, 'backend/.env.production.example');
const frontendProductionEnvPath = path.join(ROOT, 'frontend/.env.production.example');
if (fs.existsSync(backendProductionEnvPath) && fs.statSync(backendProductionEnvPath).size > 0) {
  const backendEnv = fs.readFileSync(backendProductionEnvPath, 'utf8');
  const requiredBackendLines = [
    'NODE_ENV=production',
    'PORT=5000',
    'HOST=0.0.0.0',
    'ALLOW_INSECURE_AUTH=false',
    'COOKIE_HTTP_ONLY=true',
    'COOKIE_SECURE=true',
    'AUDIT_ENABLED=true',
    'AUDIT_FAIL_CLOSED=true',
    'CACHE_KEY_PREFIX=titech:',
    'TITECH_REFUGEE_ONBOARDING_ENABLED=false',
    'TITECH_REFUGEE_PARTNER_ONBOARDING_ENABLED=false',
    'TITECH_INSURANCE_ONBOARDING_ENABLED=false',
    'TITECH_INSURANCE_OPERATIONS_ENABLED=false',
    'TITECH_INSURANCE_LIVE_PREMIUM_PROCESSING_ENABLED=false',
    'TITECH_UBUNTFLOAT_CORE_ENABLED=false',
    'TITECH_UBUNTFLOAT_ADVANCE_ENABLED=false',
    'TITECH_UBUNTFLOAT_SWAP_ENABLED=false',
    'TITECH_UBUNTFLOAT_LIVE_MONEY_MOVEMENT_ENABLED=false',
    'TITECH_PRIVATE_DOCUMENT_STORAGE_PATH=/var/lib/titech/private-documents',
    'TITECH_DOCUMENT_MALWARE_SCANNER_HOST=__SET_PRIVATE_CLAMD_HOST__',
    'TITECH_DOCUMENT_MALWARE_SCANNER_PORT=3310',
    'TITECH_USSD_ENABLED=false',
    'TITECH_OFFLINE_SYNC_ENABLED=false',
  ];
  const backendEnvLines = backendEnv.split(/\r?\n/).map((entry) => entry.trim());
  const missing = requiredBackendLines.filter((line) => !backendEnvLines.includes(line));
  const missingSecureEndpoints = ['MONGO_URI=mongodb+srv://', 'REDIS_URL=rediss://'].filter((prefix) => !backendEnvLines.some((line) => line.startsWith(prefix)));
  if (missing.length || missingSecureEndpoints.length) fail('backend-production-env', `backend/.env.production.example is missing required safe contract line(s): ${[...missing, ...missingSecureEndpoints].join(', ')}`);
  else if (/MONGO_URI=.*localhost|REDIS_URL=.*localhost/i.test(backendEnv)) fail('backend-production-env', 'Production backend template must not point MongoDB or Redis to localhost.');
  else if (!['JWT_SECRET=__SET_UNIQUE_JWT_SECRET_IN_SECRET_MANAGER__', 'JWT_REFRESH_SECRET=__SET_DISTINCT_REFRESH_SECRET_IN_SECRET_MANAGER__', 'SESSION_SECRET=__SET_UNIQUE_SESSION_SECRET_IN_SECRET_MANAGER__'].every((line) => backendEnv.includes(line))) fail('backend-production-env', 'Production backend template must use clearly unconfigured secret-manager placeholders.');
  else pass('backend-production-env', 'Production backend template uses external TLS endpoints, hardened defaults, placeholder secrets and fail-closed capability flags.');
}
if (fs.existsSync(frontendProductionEnvPath) && fs.statSync(frontendProductionEnvPath).size > 0) {
  const frontendEnv = fs.readFileSync(frontendProductionEnvPath, 'utf8');
  const requiredFrontendLines = ['VITE_API_URL=/api/v1', 'VITE_API_READINESS_PATH=/api/v1/ready', 'VITE_API_HEALTH_PATH=/api/v1/health', 'VITE_SOCKET_URL=/'];
  const missing = requiredFrontendLines.filter((line) => !frontendEnv.split(/\r?\n/).some((entry) => entry.trim() === line));
  if (missing.length) fail('frontend-production-env', `frontend/.env.production.example is missing required runtime contract line(s): ${missing.join(', ')}`);
  else if (/VITE_[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY)=/i.test(frontendEnv)) fail('frontend-production-env', 'Frontend build environment must not define public-bundle secrets or credentials.');
  else pass('frontend-production-env', 'Frontend production template routes through the same-origin edge and exposes no credentials.');
}

const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'branding/BRAND_MANIFEST.json'), 'utf8'));
const palette = Object.values(brand.visual_identity_reference ?? {}).map(String).map(x => x.toUpperCase());
const requiredColors = ['#0030A0','#0058D8','#0066E8','#00B8F8','#008000','#A8F000','#F8D800','#082B67','#FFFFFF'];
const missingColors = requiredColors.filter(color => !palette.includes(color));
if (missingColors.length) fail('brand-palette', `Official brand manifest is missing: ${missingColors.join(', ')}`);
else pass('brand-palette', 'Official TITech palette is complete in the canonical brand manifest.');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/public/manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone' || !manifest.icons?.length) fail('pwa-manifest', 'PWA manifest is not installable-ready.');
else pass('pwa-manifest', 'PWA manifest declares standalone display and app icons.');

const prodCompose = fs.readFileSync(path.join(ROOT, 'docker/docker-compose.prod.yml'), 'utf8');
for (const token of ['backend:', 'frontend:', 'edge:', 'TITECH_DOMAIN', 'TITECH_TLS_DIR', 'TITECH_PRIVATE_DOCUMENTS_DIR', '/var/lib/titech/private-documents']) {
  if (!prodCompose.includes(token)) fail(`compose:${token}`, `Production compose is missing ${token}`);
}
if (!failures.some(x => x.includes('Production compose'))) pass('production-compose', 'Production compose contains backend, frontend, edge, domain, TLS and persistent private-document storage contracts.');

const edge = fs.readFileSync(path.join(ROOT, 'nginx/production.conf.template'), 'utf8');
for (const token of ['Strict-Transport-Security', 'Content-Security-Policy', '/api/', '/socket.io/', 'return 301 https']) {
  if (!edge.includes(token)) fail(`nginx:${token}`, `Production edge configuration is missing ${token}`);
}
if (!failures.some(x => x.includes('Production edge'))) pass('edge-security', 'Production edge configuration contains HTTPS, API, websocket and browser security controls.');

const zeroCritical = [
  'docker/backend.Dockerfile',
  'docker/frontend.Dockerfile',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.dev.yml',
  'infrastructure/kubernetes/api-deployment.yaml',
  'infrastructure/kubernetes/web-deployment.yaml',
  'infrastructure/kubernetes/ingress.yaml',
];
for (const rel of zeroCritical) if (size(rel) === 0) fail(`zero-byte:${rel}`, `Hosting critical artifact remains zero-byte: ${rel}`);

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'BLOCKED' : 'PASS',
  failures,
  checks,
};
const reportsDir = path.join(ROOT, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'titech-hosting-gate.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;

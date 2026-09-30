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
for (const token of ['backend:', 'frontend:', 'edge:', 'TITECH_DOMAIN', 'TITECH_TLS_DIR']) {
  if (!prodCompose.includes(token)) fail(`compose:${token}`, `Production compose is missing ${token}`);
}
if (!failures.some(x => x.includes('Production compose'))) pass('production-compose', 'Production compose contains backend, frontend, edge, domain and TLS contracts.');

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

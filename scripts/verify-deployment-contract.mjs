#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const dockerFrontend = fs.readFileSync(path.join(root, 'docker/frontend.Dockerfile'), 'utf8');
const canonicalFrontend = fs.readFileSync(path.join(root, 'frontend/Dockerfile'), 'utf8');
const nginx = fs.readFileSync(path.join(root, 'frontend/nginx.conf'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker/docker-compose.dev.yml'), 'utf8');
const rootCompose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/security-assurance.yml'), 'utf8');
const vite = fs.readFileSync(path.join(root, 'frontend/vite.config.js'), 'utf8');

if (!dockerFrontend.includes('ARG VITE_API_URL')) failures.push('Root-context frontend container has no explicit API-origin build contract.');
if (!canonicalFrontend.includes('ARG VITE_API_URL=/api/v1')) failures.push('Canonical frontend container is missing its explicit same-origin proxy build contract.');
if (!compose.includes('VITE_API_URL: /api/v1')) failures.push('Container development build does not explicitly configure the same-origin API proxy.');
if (!nginx.includes('location /api/') || !nginx.includes('proxy_pass http://backend:5000')) failures.push('Same-origin container API proxy is incomplete.');
if (!nginx.includes('try_files $uri $uri/ /index.html')) failures.push('SPA fallback contract is missing.');
if (!rootCompose.includes('/healthz')) failures.push('Root compose healthcheck is stale and does not target /healthz.');
if (!workflow.includes('--build-arg VITE_API_URL=/api/v1')) failures.push('Security workflow does not pass the explicit container API-origin contract.');
if (!vite.includes('resolveApiBaseUrl(env, { production: true })')) failures.push('Production Vite build is not fail-closed for API configuration.');

console.log(`TITech deployment contract: ${failures.length ? 'FAILED' : 'PASSED'}`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

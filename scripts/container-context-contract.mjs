#!/usr/bin/env node
/**
 * TITech Community Capital — Container Context Contract Gate
 *
 * Verifies that the repository's two Docker build-context conventions remain
 * internally consistent:
 *   1. backend/Dockerfile and frontend/Dockerfile are built with their own
 *      application directory as context.
 *   2. docker/backend.Dockerfile and docker/frontend.Dockerfile are root-context
 *      wrappers used by Compose/security workflows.
 *
 * This is a static contract only. It does not claim that a Docker image has
 * actually been built, scanned, signed, or deployed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function requireContains(rel, fragment) {
  if (!exists(rel)) {
    failures.push(`${rel}: file is missing`);
    return;
  }
  const text = read(rel);
  if (!text.includes(fragment)) failures.push(`${rel}: missing required contract: ${fragment}`);
}

function requireNonEmpty(rel) {
  if (!exists(rel)) {
    failures.push(`${rel}: file is missing`);
    return;
  }
  if (fs.statSync(path.join(ROOT, rel)).size === 0) failures.push(`${rel}: file is empty`);
}

// Local-context Dockerfiles.
requireNonEmpty('backend/Dockerfile');
requireContains('backend/Dockerfile', 'COPY package.json package-lock.json ./');
requireContains('backend/Dockerfile', 'COPY . .');

requireNonEmpty('frontend/Dockerfile');
requireContains('frontend/Dockerfile', 'COPY package.json package-lock.json ./');
requireContains('frontend/Dockerfile', 'COPY . .');

// Root-context wrappers.
requireNonEmpty('docker/backend.Dockerfile');
requireContains('docker/backend.Dockerfile', 'COPY backend/package.json backend/package-lock.json ./');
requireContains('docker/backend.Dockerfile', 'COPY backend/ ./');

requireNonEmpty('docker/frontend.Dockerfile');
requireContains('docker/frontend.Dockerfile', 'COPY frontend/package.json frontend/package-lock.json ./');
requireContains('docker/frontend.Dockerfile', 'COPY frontend/ ./');
requireContains('docker/frontend.Dockerfile', 'COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf');

// Security workflow must use root-context wrappers because its build context is repository root.
requireContains('.github/workflows/security-assurance.yml', 'docker build -f docker/backend.Dockerfile');
requireContains('.github/workflows/security-assurance.yml', 'docker build -f docker/frontend.Dockerfile');

const result = {
  generatedAt: new Date().toISOString(),
  status: failures.length ? 'FAIL' : 'PASS',
  contract: {
    localContext: ['backend/Dockerfile', 'frontend/Dockerfile'],
    rootContextWrappers: ['docker/backend.Dockerfile', 'docker/frontend.Dockerfile'],
    securityWorkflow: '.github/workflows/security-assurance.yml',
  },
  failures,
};

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'reports/container-context-contract.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);

if (failures.length) {
  console.error('Container context contract: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Container context contract: PASS');
console.log('Local-context Dockerfiles, root-context wrappers, and security workflow are aligned.');

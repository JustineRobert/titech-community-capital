#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  'coverage',
  'dist',
  '.vite',
  '.vitest',
  'frontend/dist',
  'frontend/coverage',
  'backend/coverage',
];

for (const relative of targets) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  fs.rmSync(absolute, { recursive: true, force: true });
  console.log(`Removed ${relative}`);
}

console.log('TITech clean completed without removing source, dependency or release evidence directories.');

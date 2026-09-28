import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const generated = path.join(root, 'branding', 'generated');
const targets = [
  path.join(root, 'frontend', 'public', 'brand'),
  path.join(root, 'backend', 'shared', 'branding', 'assets'),
];

const files = [
  'titech-community-capital-full.png',
  'titech-community-capital-transparent.png',
  'titech-community-capital-monochrome.png',
  'titech-community-capital-app-icon.png',
  'titech-community-capital-icon-512.png',
  'titech-community-capital-icon-192.png',
  'titech-community-capital-icon-96.png',
  'titech-community-capital-icon-48.png',
  'titech-community-capital-favicon-32.png',
  'titech-community-capital-favicon-16.png',
  'favicon.ico',
];

for (const target of targets) {
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) {
    const source = path.join(generated, file);
    const destination = path.join(target, file);
    fs.copyFileSync(source, destination);
  }
}

console.log(`Synced ${files.length} official derived brand assets to ${targets.length} deployment targets.`);

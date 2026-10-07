import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = fs.readFileSync(path.join(ROOT, 'frontend/vite.config.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');

test('frontend runtime contract uses automatic JSX and React dedupe', () => {
  assert.match(config, /@vitejs\/plugin-react/);
  assert.match(config, /jsxRuntime\s*:\s*["']automatic["']/);
  assert.match(config, /dedupe\s*:\s*\[[^\]]*["']react["'][^\]]*["']react-dom["']/);
  assert.doesNotMatch(config, /external\s*:\s*[^\n]*(?:react|react-dom)/);
  assert.doesNotMatch(config, /globalThis\.React\s*=|window\.React\s*=/);
});

test('frontend entry is module-only and does not load React from a CDN', () => {
  assert.match(html, /<script[^>]+type=["']module["'][^>]+src=["']\/src\/main\.jsx["']/);
  assert.doesNotMatch(html, /(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^\n]*(?:react|react-dom)/i);
});

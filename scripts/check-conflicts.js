#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const excluded = new Set(['.git', 'node_modules', 'coverage', 'dist', 'build', '.vite', '.vitest', '.nyc_output']);
const hits = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

let files = [];
try {
  const output = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  files = output.split(/\r?\n/).filter(Boolean).map((f) => path.join(root, f));
} catch {
  files = walk(root);
}

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  let inConflict = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (/^<<<<<<<(?:\s|$)/.test(trimmed)) {
      hits.push({ file, line: i + 1, text: line.trim() });
      inConflict = true;
      continue;
    }
    if (inConflict && /^=======(?:\s|$)/.test(trimmed)) {
      hits.push({ file, line: i + 1, text: line.trim() });
      continue;
    }
    if (/^>>>>>>>(?:\s|$)/.test(trimmed)) {
      hits.push({ file, line: i + 1, text: line.trim() });
      inConflict = false;
    }
  }
}

if (hits.length) {
  console.error('Merge conflict markers detected:');
  for (const hit of hits) console.error(`- ${path.relative(root, hit.file).replaceAll(path.sep, '/')}:${hit.line}: ${hit.text}`);
  process.exit(1);
}

console.log(`No merge conflict markers found (${files.length} files scanned).`);

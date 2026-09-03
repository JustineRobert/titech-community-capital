#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const repoRoot = process.cwd();
const markerPatterns = [/^<<<<<<<(?:\s|$)/, /^=======(?:\s|$)/, /^>>>>>>>(?:\s|$)/];
const filesWithMarkers = [];

let trackedFiles;
try {
  trackedFiles = execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
} catch (error) {
  console.error('Unable to enumerate tracked files with git ls-files.');
  process.exit(1);
}

for (const file of trackedFiles) {
  if (!file || file.startsWith('node_modules/') || file.startsWith('coverage/') || file.startsWith('dist/') || file.startsWith('build/')) {
    continue;
  }

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (markerPatterns.some((pattern) => pattern.test(line))) {
      filesWithMarkers.push({ file, line: i + 1, text: line.trim() });
    }
  }
}

if (filesWithMarkers.length > 0) {
  console.error('Merge conflict markers detected:');
  for (const hit of filesWithMarkers) {
    console.error(`- ${hit.file}:${hit.line}: ${hit.text}`);
  }
  process.exit(1);
}

console.log('No merge conflict markers found in tracked source files.');

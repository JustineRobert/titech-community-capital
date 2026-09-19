#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'postman/Community-auth-tests.postman_collection.json',
  'postman/Group-env.postman_environment.json',
];
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error(`Missing Postman artifact: ${file}`);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error(`Invalid JSON object: ${file}`);
}
console.log('Postman artifact validation: PASS. Use postman:test:newman for an external Newman execution.');

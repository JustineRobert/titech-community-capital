import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectories = [
  path.join(root, 'backend/tests/unit/commercial/transactionRevenue'),
  path.join(root, 'backend/tests/unit/commercial'),
];
const discovered = new Set();
for (const directory of testDirectories) {
  if (!fs.existsSync(directory)) continue;
  for (const name of fs.readdirSync(directory).filter((entry) => entry.endsWith('.test.mjs') || entry === 'decimalMoney.test.js')) {
    discovered.add(path.join(directory, name));
  }
}
const tests = [...discovered].sort();
if (tests.length === 0) {
  console.error('No commercial billing core unit tests were discovered.');
  process.exit(1);
}
console.log(`Running ${tests.length} commercial billing test files.`);
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

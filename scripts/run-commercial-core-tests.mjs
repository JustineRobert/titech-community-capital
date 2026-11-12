import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = path.join(root, 'backend/tests/unit/commercial/transactionRevenue');
const tests = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => path.join(testDirectory, name));
if (tests.length === 0) {
  console.error('No commercial billing core unit tests were discovered.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

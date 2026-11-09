import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../../../modules/edufinance/eduFinance.service.js', import.meta.url), 'utf8');

test('EduFinance application and submission audit are committed in one transaction', () => {
  assert.match(service, /import mongoose from 'mongoose'/);
  assert.match(service, /const session = await mongoose\.startSession\(\)/);
  assert.match(service, /session\.withTransaction\(async\s*\(\)\s*=>/);
  assert.match(service, /EduFinanceApplication\.create\(\[\{/);
  assert.match(service, /\],\s*\{\s*session\s*\}\)/);
  assert.match(service, /'EDUFINANCE\.APPLICATION_SUBMITTED',[\s\S]*?\},\s*session\)/);
  assert.match(service, /finally\s*\{\s*await session\.endSession\(\);\s*\}/);
});

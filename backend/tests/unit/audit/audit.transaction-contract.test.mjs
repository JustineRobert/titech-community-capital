import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const auditService = await readFile(new URL('../../../modules/audit/audit.service.js', import.meta.url), 'utf8');
const ubuntuFloatService = await readFile(new URL('../../../modules/ubuntu-float/services/ubuntuFloatService.js', import.meta.url), 'utf8');

test('audit writer forwards an active MongoDB session to both chain lookup and append', () => {
  assert.match(auditService, /session\s*=\s*null/);
  assert.match(auditService, /previousQuery\.session\(session\)/);
  assert.match(auditService, /Audit\.create\(\[\{/);
  assert.match(auditService, /session\s*\?\s*\{\s*session\s*\}\s*:\s*\{\s*\}/);
});

test('existing Ubuntu Float audit transaction is connected to the audit session contract', () => {
  assert.match(ubuntuFloatService, /session\.withTransaction\(async\s*\(\)\s*=>/);
  assert.match(ubuntuFloatService, /session,\s*\n\s*\}\);/);
});

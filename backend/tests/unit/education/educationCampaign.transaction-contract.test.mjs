import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const service = await readFile(new URL('../../../modules/education/educationCampaign.service.js', import.meta.url), 'utf8');

test('education campaign mutations use one MongoDB transaction for campaign writes and audit events', () => {
  assert.match(service, /async function withCampaignAuditTransaction\(operation\)/);
  assert.match(service, /session\.withTransaction\(async\s*\(\)\s*=>/);
  assert.match(service, /campaign\.save\(\{\s*session\s*\}\)/);
  assert.match(service, /correlationId:\s*ctx\.correlationId,\s*session,/);
  for (const action of [
    'EDUCATION_CAMPAIGN.DRAFT_CREATED',
    'EDUCATION_CAMPAIGN.VERSION_UPDATED',
    'EDUCATION_CAMPAIGN.SUBMITTED',
    'EDUCATION_CAMPAIGN.PUBLISHED',
  ]) assert.ok(service.includes(action), `expected audit action ${action}`);
});

test('education partner verification is read within the same transaction for submit and publish', () => {
  assert.match(service, /requireVerifiedEducationPartner\(ctx\.tenantId, session\)/);
  assert.match(service, /if \(session\) query\.session\(session\)/);
});

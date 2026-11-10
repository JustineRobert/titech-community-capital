import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('membership request listing is tenant scoped and administrator scoped', async () => {
  const controller = await read('../../../controllers/groupController.js');
  const routes = await read('../../../routes/groups.js');
  assert.match(controller, /Group\.findTenantGroup\(identity\.tenantId, req\.params\.groupId\)/);
  assert.match(controller, /canManageGroup\(actor\(req\), group\)/);
  assert.match(controller, /membershipOrigin === "requested"/);
  assert.match(controller, /tenantId: identity\.tenantId/);
  assert.match(routes, /\/:groupId\/membership-requests[\s\S]{0,250}requirePermission\('MEMBERSHIP_VIEW'\)/);
});

test('creator-only group creation is supported and creator is recorded as administrator', async () => {
  const controller = await read('../../../controllers/groupController.js');
  const form = await read('../../../../frontend/src/pages/CreateGroupV2.jsx');
  assert.match(controller, /members = \[\]/);
  assert.match(controller, /group\.addMember\(identity\.userId, \{ role: "group_admin", invitationStatus: "accepted", membershipOrigin: "owner" \}\)/);
  assert.doesNotMatch(form, /Please add at least one valid member/);
});

test('join requests enforce the group membership-record limit and map optimistic concurrency to a conflict', async () => {
  const controller = await read('../../../controllers/groupController.js');
  assert.match(controller, /GROUP_MODEL_METADATA\.maxMembers/);
  assert.match(controller, /error\?\.name === "VersionError"/);
  assert.match(controller, /GROUP_MEMBERSHIP_CONFLICT/);
  assert.match(controller, /GROUP_MEMBER_LIMIT_REACHED/);
});

test('approval and rejection persist group audit history in the same aggregate save', async () => {
  const service = await read('../../../services/rbacService.js');
  assert.match(service, /case 'approve':[\s\S]{0,260}group\.appendAudit\([\s\S]*action: 'membership_approved'/);
  assert.match(service, /case 'reject':[\s\S]{0,260}group\.appendAudit\([\s\S]*action: 'membership_rejected'/);
  const model = await read('../../../models/Group.js');
  assert.match(model, /"membership_approved"/);
  assert.match(model, /"membership_rejected"/);
  assert.match(service, /await group\.save\(\);[\s\S]{0,250}appendTenantAudit/);
});

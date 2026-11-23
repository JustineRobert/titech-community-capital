import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('group API derives tenant membership from the authenticated persisted user and checks tenant state', async () => {
  const routes = await read('../../backend/routes/groups.js');
  const controller = await read('../../backend/controllers/groupController.js');
  const tenantGuard = routes.slice(routes.indexOf('async function requireTenantContext'), routes.indexOf('function requestMetadata'));

  assert.match(tenantGuard, /req\.user\?\.tenantId/);
  assert.match(tenantGuard, /Tenant\.findById\(tenantId\)/);
  assert.match(tenantGuard, /tenant\.status !== "ACTIVE"/);
  assert.match(tenantGuard, /isSuspended|isDeleted|deletedAt/);
  assert.doesNotMatch(tenantGuard, /req\.body|req\.headers|req\.query/);
  assert.match(routes, /router\.use\(authenticate\)/);
  assert.match(routes, /router\.use\(asyncHandler\(requireTenantContext\)\)/);
  assert.match(routes, /router\.post\('\/', writeLimiter, requirePermission\('GROUP_CREATE'\)/);
  assert.match(controller, /const tenantId = req\.user\?\.tenantId/);
  assert.match(controller, /new Set\(\["tenant_admin", "platform_admin"\]\)/);
});

test('group create request validates normalized invitees and persists one tenant-scoped aggregate idempotently', async () => {
  const controller = await read('../../backend/controllers/groupController.js');
  const create = controller.slice(controller.indexOf('export async function createGroup'), controller.indexOf('export async function requestJoinGroup'));

  assert.match(create, /GROUP_TENANT_CONTEXT_REQUIRED/);
  assert.match(create, /GROUP_CREATE_FORBIDDEN/);
  assert.match(create, /GROUP_INPUT_INVALID/);
  assert.match(create, /GROUP_MEMBER_INPUT_INVALID/);
  assert.match(create, /creationPayloadHash/);
  assert.match(create, /GROUP_IDEMPOTENCY_CONFLICT/);
  assert.match(create, /activeTenantUserQuery\(identity\.tenantId, uniqueEmails\)/);
  assert.match(create, /group\.addMember\(identity\.userId, \{ role: "group_admin"/);
  assert.match(create, /group\.addMember\(invitee\._id, \{ role: invite\.role, invitationStatus: "pending", membershipOrigin: "invited" \}\)/);
  assert.match(create, /group\.appendAudit\(\{ action: "invitation_created"/);
  assert.match(create, /await group\.save\(\)/);
  assert.match(controller, /externalNotificationsSent: 0/);
  assert.doesNotMatch(create, /sendMail|sendEmail|sendSms|sendSMS/);
});

test('group invitation lifecycle binds acceptance to authenticated user and enforces expiry and revocation', async () => {
  const controller = await read('../../backend/controllers/groupController.js');
  const model = await read('../../backend/models/Group.js');
  const invitationFlow = controller.slice(controller.indexOf('export async function requestJoinGroup'), controller.indexOf('export async function acceptInvitation'));

  assert.match(model, /invitationExpiresAt/);
  assert.match(model, /invitationRevokedAt/);
  assert.match(model, /invitationRevokedBy/);
  assert.match(model, /GROUP_INVITATION_VALIDITY_DAYS/);
  assert.match(model, /invitationStatus === "revoked"/);
  assert.match(model, /invitationStatus = "expired"/);
  assert.match(invitationFlow, /getIdentity\(req\)/);
  assert.match(invitationFlow, /GROUP_INVITATION_REVOKED/);
  assert.match(invitationFlow, /GROUP_INVITATION_EXPIRED/);
  assert.match(invitationFlow, /group\.acceptInvitation\(identity\.userId, invitationNow\)/);
  assert.match(invitationFlow, /await group\.save\(\)/);
});

test('tenant invitation redemption resolves tenant from a hashed invitation within a Mongo transaction', async () => {
  const controller = await read('../../backend/controllers/authController.js');
  const routes = await read('../../backend/routes/auth.js');
  const redeem = controller.slice(controller.indexOf('async function redeemTenantInvitation'), controller.indexOf('async function createTenantInvitation'));

  assert.match(redeem, /req\.user\?\._id \|\| req\.user\?\.id/);
  assert.match(redeem, /keys\.length !== 1 \|\| keys\[0\] !== 'code'/);
  assert.match(redeem, /session\.withTransaction/);
  assert.match(redeem, /codeHash: hashToken\(code\)/);
  assert.match(redeem, /Tenant\.findById\(invitation\.tenantId\)/);
  assert.match(redeem, /User\.findOneAndUpdate/);
  assert.match(redeem, /TENANT\.MEMBERSHIP_JOINED_BY_INVITATION/);
  assert.match(redeem, /createAuditLog\(/);
  assert.match(redeem, /TENANT_JOIN_TRANSACTION_UNAVAILABLE/);
  assert.match(routes, /'\/tenant-invitations\/redeem'[\s\S]{0,180}tenantInvitationRedeemLimiter[\s\S]{0,180}authenticate/);
});

test('Faith Giving manager guards duplicate initial effect fetches without removing the server capability gate', async () => {
  const manager = await read('../../frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx');
  const routes = await read('../../backend/modules/faith-community-giving/faithGiving.routes.js');
  const env = await read('../../backend/.env.example');
  assert.match(manager, /initialLoadStartedRef = useRef\(false\)/);
  assert.match(manager, /if \(initialLoadStartedRef\.current\) return/);
  assert.match(manager, /initialLoadStartedRef\.current = true/);
  assert.match(routes, /requireCapabilityFlag\('TITECH_FAITH_GIVING_ENABLED'\)/);
  assert.match(env, /TITECH_FAITH_GIVING_ENABLED=false/);
});

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'backend/modules/faith-community-giving/faithGiving.policy.js',
  'backend/modules/faith-community-giving/faithGiving.service.js',
  'backend/modules/faith-community-giving/faithGiving.controller.js',
  'backend/modules/faith-community-giving/faithGiving.routes.js',
  'backend/modules/faith-community-giving/faithGiving.public.routes.js',
  'backend/modules/faith-community-giving/models/FaithGivingCampaign.js',
  'backend/modules/faith-community-giving/models/FaithGivingPledge.js',
  'backend/modules/faith-community-giving/models/FaithGivingExpenseRequest.js',
];
const errors = [];
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) errors.push(`Missing required file: ${file}`);
}
const read = (file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '';
const service = read('backend/modules/faith-community-giving/faithGiving.service.js');
const routes = read('backend/modules/faith-community-giving/faithGiving.routes.js');
const publicRoutes = read('backend/modules/faith-community-giving/faithGiving.public.routes.js');
const campaignModel = read('backend/modules/faith-community-giving/models/FaithGivingCampaign.js');
const indexRoutes = read('backend/routes/index.js');
const permissions = read('backend/middleware/platformPermissions.js');
const policy = read('backend/modules/faith-community-giving/faithGiving.policy.js');
const frontPage = read('frontend/src/pages/faith-community-giving/FaithCommunityGivingPage.jsx');
const managerPage = read('frontend/src/pages/faith-community-giving/FaithGivingManagerPage.jsx');
const controller = read('backend/modules/faith-community-giving/faithGiving.controller.js');
const appRoutes = read('frontend/src/routes/AppRoutes.jsx');
const navigation = read('frontend/src/navigation/navigationRegistry.js');
const publicDto = policy.slice(policy.indexOf('export function toFaithGivingPublicDTO'));

const assertions = [
  [service.includes("from '../audit/audit.service.js'") && service.includes('createAuditLog'), 'Campaign/pledge/expense operations must write audit records.'],
  [service.includes('mongoose.startSession()') && service.includes('session.withTransaction'), 'Mutations must use the MongoDB transaction boundary.'],
  [service.includes('tenantId: ctx.tenantId') && service.includes('findOne({ tenantId: ctx.tenantId'), 'Campaign, pledge and expense reads must be tenant-scoped.'],
  [service.includes('campaign.createdBy === ctx.actorId') && service.includes('expense.requestedBy === ctx.actorId'), 'Campaign and expense self-approval must be blocked.'],
  [service.includes('FAITH_GIVING.CAMPAIGN_') && service.includes('FAITH_GIVING.EXPENSE_REQUEST_'), 'Campaign and expense transitions must be auditable.'],
  [service.includes('requireVerifiedPartnerForCommunityScope') && service.includes("verificationStatus: 'VERIFIED'") && service.includes('isVerifiedFaithGivingPartner(profile)'), 'Refugee/host-community campaigns must be backed by an existing verified institutional partner profile, including at public read time.'],
  [service.includes("applyFaithGivingBudgetReservation(campaign.budgetLines, input.category, input.amountMinor, 'RESERVE')") && service.includes("applyFaithGivingBudgetReservation(campaign.budgetLines, expense.category, expense.amountMinor, 'RELEASE')"), 'Expense request budgets must reserve and release headroom transactionally.'],
  [routes.includes("requireCapabilityFlag('TITECH_FAITH_GIVING_ENABLED')"), 'Authenticated routes must be feature-gated.'],
  [publicRoutes.includes("requireCapabilityFlag('TITECH_FAITH_GIVING_ENABLED')"), 'Public routes must be feature-gated.'],
  [routes.includes("requirePermission('faith-giving:campaign:review')") && routes.includes("requirePermission('faith-giving:expense:review')"), 'Review operations must require explicit server-side permissions.'],
  [routes.includes('requireIdempotencyKey') && controller.includes("req.get('idempotency-key')"), 'Pledge creation must require and pass an idempotency key.'],
  [campaignModel.includes("strict: 'throw'") && campaignModel.includes('optimisticConcurrency: true'), 'Campaign model must reject undeclared fields and use optimistic concurrency.'],
  [campaignModel.includes('immutable: true') && campaignModel.includes('tenantId'), 'Campaign tenant ownership must be immutable.'],
  [indexRoutes.includes('faithGivingRoutes') && indexRoutes.includes('faithGivingPublicRoutes'), 'Both public and protected routers must be registered in the canonical route registry.'],
  [permissions.includes('faith-giving:campaign:review') && permissions.includes('FAITH_GIVING_REVIEWER'), 'Role-permission mapping must include dedicated reviewer permissions.'],
  [policy.includes("collectionStatus: 'NOT_ENABLED'"), 'Public campaign DTO must not claim payment collection is enabled.'],
  [!publicDto.includes('committedAmountMinor') && !publicDto.includes('tenantId') && !publicDto.includes('receivingDestinationReference'), 'Public DTO must not expose tenant, destination or internal budget reservation data.'],
  [!service.includes('ledgerEntry.save') && !service.includes('LedgerEntry.create') && !service.includes('FinancialTransaction.create'), 'Faith Giving must not create a parallel ledger or financial transaction.'],
  [frontPage.includes('/api/v1/faith-giving/public') && frontPage.includes('NOT_ENABLED'), 'Public UI must use published campaign API and disclose that collection is disabled.'],
  [managerPage.includes('/api/v1/faith-giving') && appRoutes.includes('FAITH_GIVING_MANAGE'), 'Management UI must be routed through the canonical authenticated application routes.'],
  [navigation.includes('/faith-community-giving') && navigation.includes('faithGivingManage'), 'Public discovery and role-limited management navigation must be registered.'],
  [read('backend/.env.example').includes('TITECH_FAITH_GIVING_ENABLED=false'), 'Feature flag must default to disabled in the backend environment example.'],
];
for (const [condition, message] of assertions) if (!condition) errors.push(message);

if (errors.length) {
  console.error('Faith & Community Giving contract gate: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Faith & Community Giving contract gate: PASS (${assertions.length} contracts; ${files.length} required backend files present).`);
}

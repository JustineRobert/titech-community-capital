import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPermission } from '../../../middleware/platformPermissions.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const read = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');

test('EduFinance is mounted in the canonical authenticated tenant route registry', () => {
  const registry = read('routes/index.js');
  assert.match(registry, /import eduFinanceRoutes from '\.\.\/modules\/edufinance\/eduFinance\.routes\.js';/);
  assert.match(registry, /\/api\/v1|API_PREFIX/);
  assert.match(registry, /\$\{API_PREFIX\}\/edufinance[\s\S]{0,150}authenticate[\s\S]{0,150}tenantAuthorization[\s\S]{0,150}eduFinanceRoutes/);
});

test('EduFinance application routes require server feature flag and specific self-service permissions', () => {
  const routes = fs.readFileSync(path.join(backendRoot, 'modules/edufinance/eduFinance.routes.js'), 'utf8');
  assert.match(routes, /requireCapabilityFlag\('TITECH_EDUFINANCE_APPLICATIONS_ENABLED'\)/);
  assert.match(routes, /requirePermission\('edufinance:application:create:own'\)/);
  assert.match(routes, /requirePermission\('edufinance:application:read:own'\)/);
  assert.equal(hasPermission({ role: 'MEMBER' }, 'edufinance:application:create:own'), true);
  assert.equal(hasPermission({ role: 'MEMBER' }, 'edufinance:application:read:own'), true);
  assert.equal(hasPermission({ role: 'MEMBER' }, 'edufinance:credit:approve'), false);
});

test('EduFinance model is tenant- and applicant-scoped with private identifiers and unique idempotency controls', () => {
  const model = read('modules/edufinance/models/EduFinanceApplication.js');
  assert.match(model, /tenantId:[\s\S]{0,100}immutable: true/);
  assert.match(model, /applicantUserId:[\s\S]{0,100}immutable: true/);
  assert.match(model, /studentBeneficiaryReference:[\s\S]{0,160}select: false/);
  assert.match(model, /guardianAuthorityReference:[\s\S]{0,160}select: false/);
  assert.match(model, /uniq_edufinance_tenant_idempotency/);
  assert.match(model, /uniq_edufinance_duplicate_invoice_beneficiary/);
  assert.match(model, /strict: 'throw'/);
});

test('EduFinance applicant service does not create independent loan, payment or ledger records', () => {
  const service = read('modules/edufinance/eduFinance.service.js');
  assert.match(service, /EDUFINANCE\.APPLICATION_SUBMITTED/);
  assert.match(service, /assertIntakeEnabled/);
  assert.match(service, /initialEduFinanceReadiness\(\)/);
  assert.match(read('modules/edufinance/eduFinance.policy.js'), /lenderDecisionStatus: 'NOT_REQUESTED'/);
  assert.match(read('modules/edufinance/eduFinance.policy.js'), /loanAccountStatus: 'NOT_CREATED'/);
  assert.doesNotMatch(service, /FinancialTransaction\.create|LedgerEntry\.create|PaymentInstruction\.create|LoanAccount\.create/);
});

test('EduFinance activation switches are fail-closed in the provided environment template', () => {
  const env = fs.readFileSync(path.join(backendRoot, '.env.example'), 'utf8');
  for (const name of [
    'TITECH_EDUFINANCE_APPLICATIONS_ENABLED',
    'TITECH_EDUFINANCE_LIVE_DISBURSEMENT_ENABLED',
    'TITECH_EDUFINANCE_LIVE_REPAYMENTS_ENABLED',
    'TITECH_EDUFINANCE_AUTOMATED_CREDIT_DECISIONING_ENABLED',
    'TITECH_EDUFINANCE_LENDER_APPROVED',
    'TITECH_EDUFINANCE_REGULATORY_APPROVED',
    'TITECH_EDUFINANCE_PRODUCTION_APPROVED',
  ]) assert.match(env, new RegExp(`^${name}=false$`, 'm'));
});

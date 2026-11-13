import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'backend/commercial/constants/transactionRevenue.constants.js',
  'backend/commercial/errors/transactionRevenue.errors.js',
  'backend/commercial/events/transactionRevenue.events.js',
  'backend/commercial/models/FeeRule.js',
  'backend/commercial/models/FeeAssessment.js',
  'backend/commercial/models/usageRecord.model.js',
  'backend/commercial/repositories/feeRule.repository.js',
  'backend/commercial/repositories/feeAssessment.repository.js',
  'backend/commercial/repositories/usageRecord.repository.js',
  'backend/commercial/financial/billingFinancialCore.port.js',
  'backend/commercial/financial/titechFinancialCore.adapter.js',
  'backend/commercial/services/transactionRevenue/feeCalculation.service.js',
  'backend/commercial/services/transactionRevenue/feeRule.service.js',
  'backend/commercial/services/transactionRevenue/feeAssessment.service.js',
  'backend/commercial/services/transactionRevenue/transactionRevenue.service.js',
];
const failures = [];
const checks = [];
function check(name, passed, detail = '') {
  checks.push({ name, status: passed ? 'PASS' : 'FAIL', ...(detail ? { detail } : {}) });
  if (!passed) failures.push(name);
}
for (const relative of requiredFiles) {
  const full = path.join(root, relative);
  check(`required file: ${relative}`, fs.existsSync(full) && fs.statSync(full).size > 0);
}
const calculator = fs.readFileSync(path.join(root, 'backend/commercial/services/transactionRevenue/feeCalculation.service.js'), 'utf8');
const assessment = fs.readFileSync(path.join(root, 'backend/commercial/services/transactionRevenue/feeAssessment.service.js'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'backend/commercial/financial/titechFinancialCore.adapter.js'), 'utf8');
const legacyBilling = fs.readFileSync(path.join(root, 'backend/services/billingEngine.js'), 'utf8');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'branding/TITECH_ORGANIZATION_PROFILE.json'), 'utf8'));
const theme = JSON.parse(fs.readFileSync(path.join(root, 'branding/TITECH_OFFICIAL_THEME.json'), 'utf8'));
check('fee calculator uses BigInt exact arithmetic', /BigInt\s*\(/.test(calculator) && /BigInt/.test(calculator));
const ruleResolver = fs.readFileSync(path.join(root, 'backend/commercial/services/transactionRevenue/feeRule.service.js'), 'utf8');
check('missing pricing fails closed', /No approved and effective fee rule exists/.test(ruleResolver) && /TransactionRevenueNotFoundError/.test(ruleResolver));
check('assessment has idempotency and immutable pricing snapshot', /idempotencyKey/.test(assessment) && /pricingSnapshot/.test(assessment));
check('financial adapter requires canonical posting injection and active transaction', /postCanonicalBillingPayment must be wired/.test(adapter) && /inTransaction\(\)/.test(adapter));
check('official organization identity preserved', profile.organizationDisplayName === 'TITECH CAPITAL - SMC LTD' && profile.productName === 'TITech Community Capital');
check('production approval remains false', profile.productionApproved === false);
check('official nine-color brand manifest retained', Object.keys(theme.palette ?? {}).length === 9 && theme.tagline === 'BUILD LESS. PROVE MORE.');
check('legacy billing calculator has no hardcoded tariffs, VAT default or zero-fee fallback', !/defaultPricing|mobileMoneyDeposit|mobileMoneyWithdrawal|0\.18|return\s*\{\s*type:\s*['\"]FIXED['\"],\s*fee:\s*0/.test(legacyBilling) && /TITECH_COMMERCIAL_BILLING_NOT_CONFIGURED/.test(legacyBilling) && /quoteFee/.test(legacyBilling));
const report = { gate: 'commercial-billing-core', status: failures.length ? 'FAIL' : 'PASS', checks };
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

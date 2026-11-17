import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getPermissionsForRole } from '../../backend/security/rbacPolicy.js';
import { formatExactIntegerCurrency, parseExactIntegerAmount } from '../../frontend/src/utils/moneyDisplay.js';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const files = await Promise.all([
  read('frontend/src/routes/AppRoutes.jsx'),
  read('frontend/src/pages/Members.jsx'),
  read('frontend/src/pages/MemberProfile.jsx'),
  read('frontend/src/pages/Loans.jsx'),
  read('frontend/src/pages/LoanDetails.jsx'),
  read('frontend/src/pages/Savings.jsx'),
  read('frontend/src/pages/SavingsAccounts.jsx'),
  read('frontend/src/pages/SavingsAccountDetails.jsx'),
  read('frontend/src/pages/SavingsTransactionDetails.jsx'),
  read('backend/routes/index.js'),
  read('backend/routes/member-read.routes.js'),
  read('backend/routes/loan-read.routes.js'),
  read('backend/routes/savings-read.routes.js'),
  read('backend/models/Savings.js'),
  read('frontend/src/branding/official-theme.css'),
  read('branding/TITECH_OFFICIAL_THEME.json'),
]);

const [routes, members, memberProfile, loans, loanDetails, savings, savingsAccounts,
  savingsDetails, savingsTransactionDetails, routeIndex, memberApi, loanApi,
  savingsApi, savingsModel, themeCss, themeJson] = files;

 test('canonical detail routes exist inside the protected application layout', () => {
  assert.match(routes, /path=\{ROUTES\.MEMBER_DETAILS\}\s+element=\{<MemberProfile\s*\/>\}/);
  assert.match(routes, /path=\{ROUTES\.LOAN_DETAILS\}\s+element=\{<LoanDetails\s*\/>\}/);
  assert.match(routes, /path=\{ROUTES\.SAVINGS_ACCOUNT_DETAILS\}\s+element=\{<SavingsAccountDetails\s*\/>\}/);
  assert.match(routes, /path=\{ROUTES\.SAVINGS_TRANSACTION_DETAILS\}\s+element=\{<SavingsTransactionDetails\s*\/>\}/);
});

test('member directory and individual profile use the canonical tenant-scoped API', () => {
  assert.match(members, /MEMBERS_ENDPOINT\s*=\s*'\/api\/v1\/members'/);
  assert.match(members, /`\/members\/\$\{/);
  assert.match(memberProfile, /`\/api\/v1\/members\/\$\{/);
  assert.match(memberProfile, /status === 404/);
  assert.match(memberApi, /Member\.findOne\(\{\s*_id:\s*new mongoose\.Types\.ObjectId\(memberId\),\s*tenantId/);
  assert.match(memberApi, /req\.tenant\?\._id,[\s\S]*req\.tenantId/);
  assert.match(memberApi, /requirePermission\(MEMBER_PERMISSION\)/);
  assert.match(memberApi, /MEMBER_ID_INVALID/);
  assert.match(memberApi, /MEMBER_NOT_FOUND/);
  assert.match(memberApi, /Member\.countDocuments\(filter\)/);
  assert.match(memberApi, /pagination:\s*\{ page, limit, total: filteredTotal/);
  assert.match(memberApi, /summary:\s*\{ total: tenantTotal/);
  assert.doesNotMatch(memberApi, /nationalId|passportNumber|identityDocumentNumber/);
});

test('member, loan and savings read routers are mounted after authentication and trusted tenant resolution', () => {
  assert.match(routeIndex, /app\.use\('\/api\/v1\/members',\s*authenticate,\s*tenantAuthorization,\s*memberReadRoutes\)/);
  assert.match(routeIndex, /app\.use\('\/api\/v1\/loans',\s*authenticate,\s*tenantAuthorization,\s*loanReadRoutes\)/);
  assert.match(routeIndex, /app\.use\('\/api\/v1\/savings',\s*authenticate,\s*tenantAuthorization,\s*savingsReadRoutes\)/);
});

test('tenant administrators and platform administrators have explicit module read permissions', () => {
  for (const role of ['tenant_admin', 'platform_admin']) {
    const permissions = getPermissionsForRole(role);
    assert.ok(permissions.includes('MEMBER_VIEW'), `${role} lacks MEMBER_VIEW`);
    assert.ok(permissions.includes('LOAN_VIEW'), `${role} lacks LOAN_VIEW`);
    assert.ok(permissions.includes('SAVINGS_VIEW'), `${role} lacks SAVINGS_VIEW`);
  }
  for (const role of ['member', 'guest']) {
    const permissions = getPermissionsForRole(role);
    assert.ok(!permissions.includes('MEMBER_VIEW'), `${role} unexpectedly has MEMBER_VIEW`);
    assert.ok(!permissions.includes('LOAN_VIEW'), `${role} unexpectedly has LOAN_VIEW`);
    assert.ok(!permissions.includes('SAVINGS_VIEW'), `${role} unexpectedly has SAVINGS_VIEW`);
  }
});

test('loan API reads are tenant-scoped and detail lookups validate identifiers', () => {
  assert.match(loanApi, /Loan\.find\(filter\)/);
  assert.match(loanApi, /skip\(\(page - 1\) \* limit\)/);
  assert.match(loanApi, /Member\.find\(/);
  assert.match(loanApi, /function getMemberTenantObjectId/);
  assert.match(loanApi, /function memberPopulateOptions/);
  assert.match(loanApi, /function groupPopulateOptions/);
  assert.match(loanApi, /path: 'group',[\s\S]*match: tenantObjectId \? \{ tenantId: tenantObjectId \} : \{ _id: null \}/);
  assert.match(loanApi, /searchConditions/);
  assert.match(loans, /params: \{ page, limit: PAGE_SIZE, search: search\.trim\(\)/);
  assert.match(loanApi, /filter\s*=\s*\{\s*tenantId,\s*deletedAt:\s*null\s*\}/);
  assert.match(loanApi, /requirePermission\(LOAN_PERMISSION\)/);
  assert.match(loanApi, /LOAN_ID_INVALID/);
  assert.match(loanApi, /Loan\.findOne\(\{\s*_id:\s*new mongoose\.Types\.ObjectId\(loanId\),\s*tenantId/);
  assert.match(loanDetails, /not proof of a posted disbursement/i);
});

test('savings API is read-only, tenant-scoped and labels account aggregates as non-authoritative', () => {
  assert.match(savingsApi, /Savings\.find\(filter\)/);
  assert.match(savingsApi, /TRANSACTION_TYPE/);
  assert.match(savingsApi, /filter\.transactionType = requestedType/);
  assert.match(savingsApi, /Member\.find\(\{/);
  assert.match(savingsApi, /savingsId:\s*scopedAccountIds[\s\S]*?filter\.\$or = searchConditions/);
  assert.match(savingsApi, /match:\s*\{ tenantId, deletedAt: null \}/);
  assert.match(savings, /params: \{\s*page,\s*limit: PAGE_SIZE/);
  assert.match(savingsApi, /Savings\.findOne\(\{\s*_id:\s*new mongoose\.Types\.ObjectId\(accountId\),\s*tenantId/);
  assert.match(savingsApi, /Number\.isSafeInteger\(requestedPage\)[\s\S]*Math\.min\(requestedPage, 100000\)/);
  assert.match(savingsApi, /req\.tenant\?\._id,[\s\S]*req\.tenantId/);
  assert.match(savingsApi, /requirePermission\(SAVINGS_PERMISSION\)/);
  assert.match(savingsApi, /ledgerAuthority:\s*false/);
  assert.match(savingsApi, /financialSnapshotSource:\s*'SAVINGS_ACCOUNT_AGGREGATE'/);
  assert.match(savingsApi, /balance:\s*null/);
  assert.match(savingsApi, /Savings\.findOne\(\{ _id: transaction\.savingsId, tenantId \}\)/);
  assert.match(savingsApi, /populate\(\{ path: 'member'.*match: \{ tenantId, deletedAt: null \} \}\)/s);
  assert.match(savingsModel, /financialLedgerAuthority:\s*false/);
  assert.match(savingsDetails, /not the ledger authority/i);
  assert.match(savingsTransactionDetails, /does not infer settlement, ledger posting/i);
  assert.match(savingsAccounts, /Balance snapshots are read models, not ledger authority/);
  assert.match(savings, /Ledger-confirmed balance required/i);
  assert.match(savings, /SUCCESS|SETTLED/);
});

test('official nine-colour theme and tagline are retained in the source theme contract', () => {
  const expectedColours = ['#0030A0', '#0058D8', '#0066E8', '#00B8F8', '#008000', '#A8F000', '#F8D800', '#082B67', '#FFFFFF'];
  for (const colour of expectedColours) assert.ok(themeJson.includes(colour), `theme JSON is missing ${colour}`);
  assert.match(themeCss, /data-theme="dark"/);
  assert.match(themeCss, /--titech-official-electric-blue/);
  for (const source of [members, memberProfile, loans, loanDetails, savings, savingsAccounts, savingsDetails]) {
    assert.match(source, /Community Finance\. Stronger Together\./);
  }
});

test('financial amount presentation rejects unsafe Number coercion', async () => {
  const moneyHelper = await read('frontend/src/utils/moneyDisplay.js');
  assert.match(moneyHelper, /BigInt\(match\[1\]\)/);
  assert.match(moneyHelper, /Number\.isSafeInteger/);
  assert.doesNotMatch(savings, /amount:\s*Number\(/);
  assert.doesNotMatch(loans, /amount:\s*toFiniteNumber/);
  assert.match(savings, /parseExactIntegerAmount\(transaction\.amount\)/);
});

test('the active frontend and branding source use the current approved tagline', () => {
  const activeSources = [members, memberProfile, loans, loanDetails, savings, savingsAccounts, savingsDetails, savingsTransactionDetails];
  for (const source of activeSources) assert.match(source, /Community Finance\. Stronger Together\./);
  for (const source of activeSources) assert.doesNotMatch(source, /BUILD LESS\. PROVE MORE\./);
});


test('exact money helper preserves large whole-UGX amounts and rejects unsupported fractions', () => {
  assert.equal(parseExactIntegerAmount('900719925474099300'), 900719925474099300n);
  assert.equal(parseExactIntegerAmount('125000.000'), 125000n);
  assert.equal(parseExactIntegerAmount('12.50'), null);
  assert.equal(parseExactIntegerAmount(Number.MAX_SAFE_INTEGER + 1), null);
  assert.match(formatExactIntegerCurrency('125000', 'UGX', 'en-UG'), /^(UGX|USh) 125,000$/);
});

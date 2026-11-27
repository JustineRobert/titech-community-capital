import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const files = {
  routes: read('backend/commercial/api/billingRead.routes.js'),
  service: read('backend/commercial/services/billing/billingReadModel.service.js'),
  registry: read('backend/routes/index.js'),
  backendRbac: read('backend/security/rbacPolicy.js'),
  frontendRbac: read('frontend/src/security/rbacPolicy.js'),
  routeUi: read('frontend/src/routes/AppRoutes.jsx'),
  dashboard: read('frontend/src/pages/billing/BillingDashboardPage.jsx'),
  styles: read('frontend/src/pages/billing/BillingDashboardPage.css'),
  branding: read('frontend/src/branding/brand.js'),
};
const failures = [];
const requireText = (name, pattern, message) => {
  if (!pattern.test(files[name])) failures.push(message);
};

requireText('registry', /router\.use\(`\$\{API_PREFIX\}\/billing`,\s*billingReadRoutes\)/, 'Billing API is not mounted on the canonical API_PREFIX router.');
for (const route of ['/platform/overview', '/platform/subscriptions', '/platform/invoices', '/platform/payments', '/platform/collections', '/me/overview', '/me/subscriptions', '/me/invoices', '/me/payments']) {
  if (!files.routes.includes(`router.get('${route}'`)) failures.push(`Missing GET route ${route}.`);
}
if (/router\.(post|put|patch|delete)\(/i.test(files.routes)) failures.push('Billing read API exposes a mutation route.');
requireText('routes', /requireAuthenticatedTenant/, 'Tenant endpoints do not use canonical authenticated-tenant middleware.');
requireText('routes', /tenantId:\s*req\.user\.tenantId/, 'Tenant routes do not derive tenant ID from the authenticated user.');
requireText('service', /PAGE_SIZE_MAX\s*=\s*100/, 'Server pagination maximum is not 100.');
requireText('service', /providerPayload|rawResponse/, 'Sensitive provider response field names are not explicitly excluded.');
requireText('service', /productionApproved:\s*false/, 'Production approval is not explicitly false.');
requireText('service', /mrr:\s*'NOT_AVAILABLE'/, 'MRR is not explicitly labelled unavailable.');
requireText('backendRbac', /BILLING_SELF_VIEW/, 'Backend billing self permission is missing.');
requireText('backendRbac', /finance_officer:/, 'Finance officer role mapping is missing.');
requireText('backendRbac', /finance_auditor:/, 'Finance auditor role mapping is missing.');
requireText('frontendRbac', /FINANCE_OFFICER/, 'Frontend finance role mirror is missing.');
requireText('routeUi', /\/platform\/billing/, 'Platform billing route is missing.');
requireText('routeUi', /\/settings\/billing/, 'Institution billing route is missing.');
requireText('routeUi', /\/finance\/billing-operations/, 'Finance and collections route is missing.');
requireText('dashboard', /TITECH_BRAND\.tagline/, 'Dashboard does not render the official tagline from the brand contract.');
requireText('styles', /var\(--titech-brand-cyan\)/, 'Dashboard does not use the official cyan theme token.');
requireText('styles', /var\(--titech-brand-lime\)/, 'Dashboard does not use the official lime theme token.');
requireText('branding', /tagline:\s*'Community Finance\. Stronger Together\.'/,'Canonical brand tagline does not match the current requirement.');

if (failures.length) {
  console.error(`Billing read contract gate FAILED (${failures.length}):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Billing read contract gate PASS: mounted GET-only routes, authenticated tenant binding, RBAC, allowlisted read model, official identity/theme, and productionApproved=false.');
}

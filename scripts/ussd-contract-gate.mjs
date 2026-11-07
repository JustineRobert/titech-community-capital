#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail });

const route = read('backend/modules/ussd/ussd.routes.js');
const contract = read('backend/modules/ussd/ussd.contract.js');
const registry = read('backend/modules/ussd/ussd.provider-registry.js');
const routeIndex = read('backend/routes/index.js');
const unitTest = read('backend/modules/ussd/tests/ussd-contract.test.mjs');
const env = read('backend/.env.example');
const envProduction = read('backend/.env.production.example');
const organization = JSON.parse(read('branding/TITECH_ORGANIZATION_PROFILE.json'));

check('canonical versioned callback route', route.includes("const CALLBACK_PATH = '/providers/:providerCode/callback'") && routeIndex.includes("app.use('/api/v1/channels/ussd', ussdGatewayRoutes)"));
check('callback authentication before normalization and processing', route.indexOf('await adapter.verifyCallback(req)') < route.indexOf('await adapter.normalizeCallback(req)') && route.indexOf('await adapter.normalizeCallback(req)') < route.indexOf('channelService.handleCallback'));
check('tenant and member identifiers are not copied from callback payload', contract.includes('Unknown properties such as tenantId/memberId are discarded') && contract.includes('return Object.freeze({\n    providerCode'));
check('provider adapter contract requires verification, normalization and serialization', registry.includes("'verifyCallback'") && registry.includes("'normalizeCallback'") && registry.includes("'serializeResponse'"));
check('provider allowlist is explicit and empty by default', route.includes("TITECH_USSD_ENABLED_PROVIDERS") && env.includes('TITECH_USSD_ENABLED_PROVIDERS=') && envProduction.includes('TITECH_USSD_ENABLED_PROVIDERS='));
check('USSD and financial action flags remain disabled in templates', /TITECH_USSD_ENABLED=false/.test(env) && /TITECH_USSD_TRANSACTION_FEATURES_ENABLED=false/.test(env) && /TITECH_USSD_ENABLED=false/.test(envProduction) && /TITECH_USSD_TRANSACTION_FEATURES_ENABLED=false/.test(envProduction));
check('financial action enablement is passed as a separate server-side gate', route.includes('transactionFeaturesEnabled: process.env.TITECH_USSD_TRANSACTION_FEATURES_ENABLED === \'true\''));
check('menu is feature-filtered and defaults to reviewed English', read('backend/modules/ussd/ussd.menu.js').includes('Only the human-reviewed English USSD menu is enabled') && unitTest.includes('renders only institution-enabled main-menu features') && unitTest.includes('menu navigation distinguishes back, exit') && unitTest.includes('session lifecycle rejects terminal-state resurrection'));
check('provider network is normalized without prefix inference', contract.includes("'MTN',\n  'AIRTEL',\n  'OTHER',\n  'UNKNOWN'") && contract.includes("? requestedNetwork\n    : 'UNKNOWN'"));
check('organization production approval remains disabled', organization.organizationDisplayName === 'TITech Capital LTD' && organization.productionApproved === false);

const failures = checks.filter((item) => item.status === 'FAIL');
const result = {
  gate: 'titech-ussd-contract',
  status: failures.length ? 'FAIL' : 'PASS',
  capabilityStatus: 'IMPLEMENTED_CONTRACT_ONLY',
  providerVerified: false,
  networkVerified: false,
  productionApproved: false,
  checks,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;

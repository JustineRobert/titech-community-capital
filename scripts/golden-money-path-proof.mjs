#!/usr/bin/env node

/**
 * TITech Community Capital — Golden Money Path Reference Proof
 *
 * This is a deterministic CI proof harness. It does not claim external
 * provider, MongoDB, Redis, or production-environment verification. It proves
 * the core money-path invariants against a provider simulator while the real
 * payment/ledger/reconciliation modules remain the production authorities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runGoldenMoneyPathReferenceProof } = require('../backend/testing/goldenMoneyPath/goldenMoneyPathHarness.cjs');

const root = process.cwd();
const reportDir = path.join(root, 'reports', 'evidence');
fs.mkdirSync(reportDir, { recursive: true });

const evidence = await runGoldenMoneyPathReferenceProof();
const output = {
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  evidenceClass: 'TESTED',
  verificationScope: 'dependency-free-reference-harness',
  evidence,
  limitations: [
    'Does not contact MTN, Airtel, banks, Redis or MongoDB.',
    'Does not certify provider credentials, network SLAs, licensing or regulator approval.',
    'Must be supplemented by environment-backed integration and pilot evidence before Production-Approved.',
  ],
};

const file = path.join(reportDir, 'golden-money-path-proof.json');
fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Golden Money Path proof: ${evidence.status}`);
console.log(`Evidence: ${path.relative(root, file)}`);

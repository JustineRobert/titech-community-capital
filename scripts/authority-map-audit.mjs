#!/usr/bin/env node
/**
 * TITech Community Capital — canonical architecture authority map.
 *
 * The map is intentionally evidence-oriented: canonical paths are explicit;
 * legacy paths remain visible and are classified rather than silently deleted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDir = path.join(ROOT, 'reports');
const docsDir = path.join(ROOT, 'docs', 'production-readiness');
fs.mkdirSync(reportDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

const authorities = [
  {
    concept: 'Authentication',
    canonical: ['frontend/src/context/AuthProvider.jsx', 'backend/services/authService.js'],
    compatibility: ['frontend/src/context/AuthContext.jsx'],
    status: 'CANONICAL_WITH_COMPATIBILITY_BOUNDARY',
  },
  {
    concept: 'Tenancy',
    canonical: ['backend/tenancy/tenant.service.js', 'backend/middleware/tenancy/tenantResolver.js'],
    compatibility: ['backend/middleware/tenancy/tenantRepository.js'],
    status: 'CANONICAL_WITH_REPOSITORY_BOUNDARY',
  },
  {
    concept: 'Financial transaction',
    canonical: ['backend/services/financial/financialTransaction.service.js'],
    compatibility: ['backend/modules/finance/services/TransactionService.js'],
    status: 'CANONICAL_WITH_LEGACY_SERVICE_DEBT',
  },
  {
    concept: 'Ledger',
    canonical: ['backend/repositories/financial/ledger.repository.js', 'backend/models/FinancialLedgerEntry.js'],
    compatibility: ['backend/services/ledgerService.js', 'backend/modules/finance/services/ledgerService.js'],
    status: 'CANONICAL_WITH_LEGACY_SERVICE_DEBT',
  },
  {
    concept: 'Balance',
    canonical: ['backend/repositories/financial/balance.repository.js', 'backend/modules/finance/ledger/core/balanceService.js'],
    compatibility: ['backend/models/Account.js'],
    status: 'CANONICAL_REPOSITORY_PLUS_COMPATIBILITY_BRIDGE',
  },
  {
    concept: 'Payment orchestration',
    canonical: ['backend/modules/payment/paymentProcessingService.js', 'backend/modules/payment/providerInterface.js'],
    compatibility: ['backend/services/payment/providers'],
    status: 'PROVIDER_NEUTRAL_CANONICAL_WITH_ADAPTERS',
  },
  {
    concept: 'Idempotency',
    canonical: ['backend/services/idempotency/idempotency.service.js'],
    compatibility: ['backend/models/IdempotencyKey.js', 'backend/models/idempotencyRecord.model.js'],
    status: 'CANONICAL_SERVICE_WITH_PERSISTENCE_MODELS',
  },
  {
    concept: 'Outbox',
    canonical: ['backend/modules/transactions/TransactionOutboxRepository.js', 'backend/modules/transactions/workers/TransactionOutboxWorker.js'],
    compatibility: ['backend/modules/transactions/repositories/TransactionOutboxRepository.js'],
    status: 'CANONICAL_WITH_LEGACY_REPOSITORY_ALIAS',
  },
  {
    concept: 'Reconciliation',
    canonical: ['backend/modules/finance/services/reconciliationService.js'],
    compatibility: ['backend/modules/payment/airtel/reconciliation/reconciliationService.js', 'backend/modules/payment/callbacks/services/callbackReconciliationService.js'],
    status: 'CANONICAL_GENERIC_PLUS_PROVIDER_SPECIALIZATION',
  },
  {
    concept: 'Audit',
    canonical: ['backend/modules/audit', 'backend/models/LoanAudit.js'],
    compatibility: ['backend/modules/payment/callbacks/callbackAudit.js'],
    status: 'DOMAIN_AUDIT_WITH_SPECIALIZED_APPEND_ONLY_AUDITERS',
  },
];

const missing = [];
for (const entry of authorities) {
  for (const file of entry.canonical) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full) || (fs.statSync(full).isFile() && fs.statSync(full).size === 0)) {
      missing.push(`${entry.concept}: ${file}`);
    }
  }
}

const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  status: missing.length ? 'FAIL' : 'PASS_WITH_LEGACY_BOUNDARIES',
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  authorities,
  missing,
  rule: 'No new financial implementation may bypass the canonical authority without an explicit compatibility bridge and retirement record.',
};

fs.writeFileSync(path.join(reportDir, 'authority-map-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  '# TITech Community Capital — Architecture Authority Map',
  '',
  `Generated: ${report.generatedAt}`,
  '',
  `Status: **${report.status}**`,
  '',
  '| Concept | Canonical implementation | Compatibility / specialized implementation | Status |',
  '|---|---|---|---|',
];
for (const entry of authorities) {
  lines.push(`| ${entry.concept} | ${entry.canonical.join('<br>')} | ${entry.compatibility.join('<br>')} | ${entry.status} |`);
}
lines.push('', '## Authority rule', '', report.rule, '');
lines.push('## External verification boundary', '', 'The map proves repository ownership and explicit compatibility boundaries. It does not prove runtime behavior, MongoDB transaction semantics, provider certification, security-scan clearance, DR restoration or production approval.');
if (missing.length) {
  lines.push('', '## Missing canonical paths', '', ...missing.map((item) => `- ${item}`));
}
fs.writeFileSync(path.join(docsDir, '01-architecture-authority-map.md'), `${lines.join('\n')}\n`);

console.log(`Authority map audit: ${report.status}`);
if (missing.length) process.exitCode = 1;

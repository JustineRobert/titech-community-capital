
/**
 * scripts/source-contract-smoke.mjs
 *
 * Dependency-light smoke checks for hardened source and financial boundaries.
 * Windows-safe ESM imports and truthful per-check results.
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const failures = [];
const checks = {};
const details = {};
const services = {};

let WebhookSecurity;

const secret = 'source-contract-test-secret';
const rawBody = Buffer.from(
  '{"amount":"1000.00","currency":"UGX"}',
  'utf8'
);

const signature = crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');

const timestamp = Math.floor(Date.now() / 1000);

class BlockedCheckError extends Error {}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Convert filesystem paths to file: URLs before ESM imports.
 * This avoids ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows.
 */
async function importLocal(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  return import(pathToFileURL(absolutePath).href);
}

async function runCheck(name, action) {
  try {
    const result = await action();

    checks[name] = 'PASS';
    details[name] =
      typeof result === 'string' && result.length > 0
        ? result
        : 'Passed.';
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (error instanceof BlockedCheckError) {
      checks[name] = 'BLOCKED';
      details[name] = message;
      return;
    }

    checks[name] = 'FAIL';
    details[name] = message;
    failures.push(`${name}: ${message}`);
  }
}

// -----------------------------------------------------------------------------
// 1. Webhook signature security
// -----------------------------------------------------------------------------

await runCheck('webhookSignature', async () => {
  WebhookSecurity = require(
    path.resolve(ROOT, 'backend/utils/webhookSecurity.cjs')
  );

  ensure(
    WebhookSecurity &&
      typeof WebhookSecurity.validateSignature === 'function',
    'WebhookSecurity.validateSignature is missing.'
  );

  ensure(
    WebhookSecurity.validateSignature(
      { ignored: true },
      signature,
      secret,
      rawBody
    ),
    'WebhookSecurity rejected a valid raw-body signature.'
  );

  const changedFirstCharacter =
    signature[0] === '0' ? '1' : '0';

  const tamperedSignature =
    `${changedFirstCharacter}${signature.slice(1)}`;

  ensure(
    !WebhookSecurity.validateSignature(
      { ignored: true },
      tamperedSignature,
      secret,
      rawBody
    ),
    'WebhookSecurity accepted a tampered signature.'
  );

  return 'Valid raw-body signature accepted; tampered signature rejected.';
});

// -----------------------------------------------------------------------------
// 2. Webhook replay protection
// -----------------------------------------------------------------------------

await runCheck('webhookReplayWindow', async () => {
  if (
    !WebhookSecurity ||
    typeof WebhookSecurity.preventReplayAttack !== 'function'
  ) {
    throw new BlockedCheckError(
      'WebhookSecurity.preventReplayAttack could not be loaded.'
    );
  }

  ensure(
    WebhookSecurity.preventReplayAttack(timestamp),
    'WebhookSecurity rejected a current Unix-seconds timestamp.'
  );

  ensure(
    !WebhookSecurity.preventReplayAttack(timestamp - 10_000),
    'WebhookSecurity accepted an expired timestamp.'
  );

  return 'Current timestamp accepted; expired timestamp rejected.';
});

// -----------------------------------------------------------------------------
// 3. Balance compatibility surface
// -----------------------------------------------------------------------------

await runCheck('balanceCompatibilitySurface', async () => {
  const module = await importLocal(
    'backend/modules/finance/ledger/core/balanceService.js'
  );

  const balanceService = module.default;

  ensure(
    balanceService,
    'balanceService.js did not expose its expected default export.'
  );

  const methods = [
    'getForUpdate',
    'increment',
    'decrement',
    'decrementStrict',
    'getCurrentBalance',
    'getAccountState',
    'getBalance',
    'rebuildFromLedger',
    'verifyConsistency',
    'reconcile',
    'updateFromLedger',
  ];

  const missing = methods.filter(
    (method) => typeof balanceService[method] !== 'function'
  );

  ensure(
    missing.length === 0,
    `Balance compatibility bridge missing method(s): ${missing.join(', ')}.`
  );

  return `${methods.length} balance compatibility methods are present.`;
});

// -----------------------------------------------------------------------------
// 4. Canonical financial module imports
// -----------------------------------------------------------------------------

const serviceSpecs = [
  ['JournalService', 'backend/modules/finance/ledger/core/journalService.js'],
  ['SnapshotService', 'backend/modules/finance/ledger/core/snapshotService.js'],
  ['PeriodCloseService', 'backend/modules/finance/ledger/core/periodCloseService.js'],
  ['ReversalService', 'backend/modules/finance/ledger/core/reversalService.js'],
  ['PostingEngine', 'backend/modules/finance/ledger/core/postingEngine.js'],
  ['LedgerEngine', 'backend/modules/finance/ledger/core/ledgerEngine.js'],
];

await runCheck('canonicalFinancialConstructors', async () => {
  // Continue attempting all imports so independent failures are visible.
  const outcomes = await Promise.allSettled(
    serviceSpecs.map(async ([name, relativePath]) => {
      const module = await importLocal(relativePath);
      const Type = module.default;

      ensure(
        typeof Type === 'function',
        `${relativePath} does not expose a default constructor.`
      );

      return { name, Type };
    })
  );

  const importErrors = [];

  outcomes.forEach((outcome, index) => {
    const [name, relativePath] = serviceSpecs[index];

    if (outcome.status === 'fulfilled') {
      services[name] = outcome.value.Type;
    } else {
      const reason =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);

      importErrors.push(`${name} (${relativePath}): ${reason}`);
    }
  });

  ensure(
    importErrors.length === 0,
    `Canonical financial import failure(s): ${importErrors.join(' | ')}`
  );

  return `${serviceSpecs.length} canonical financial constructors imported successfully.`;
});

// -----------------------------------------------------------------------------
// 5. Journal construction and fingerprint determinism
// -----------------------------------------------------------------------------

await runCheck('journalBuilder', async () => {
  const JournalService = services.JournalService;

  if (typeof JournalService !== 'function') {
    throw new BlockedCheckError(
      'JournalService did not load successfully.'
    );
  }

  const journal = new JournalService();

  const makeOperation = () => ({
    tenantId: 'tenant-001',

    // Fingerprints include journalId. Use an explicit, stable identifier
    // so repeated calls exercise the determinism contract correctly.
    journalId: 'JNL-SOURCE-CONTRACT-001',

    operationType: 'CONTRIBUTION',
    currency: 'UGX',

    entries: [
      {
        accountId: 'cash',
        entryType: 'DEBIT',
        amount: '1000',
      },
      {
        accountId: 'member-funds',
        entryType: 'CREDIT',
        amount: '1000',
      },
    ],
  });

  const first = await journal.build({
    operation: makeOperation(),
  });

  const second = await journal.build({
    operation: makeOperation(),
  });

  ensure(
    first && first.fingerprint,
    'JournalService did not produce a fingerprint.'
  );

  ensure(
    Array.isArray(first.entries) && first.entries.length === 2,
    'JournalService did not produce a two-line journal command.'
  );

  ensure(
    second && second.fingerprint,
    'JournalService did not produce a repeat fingerprint.'
  );

  ensure(
    first.fingerprint === second.fingerprint,
    'JournalService fingerprint changed for identical logical input and journalId.'
  );

  return 'Balanced two-line journal built; fingerprint is stable with an explicit journalId.';
});


/**
 * 6. Snapshot creation and hash determinism
 *
 * A snapshot hash includes its asOf timestamp. Therefore, identical
 * logical input must use the same clock instant to produce the same hash.
 * A different timestamp should produce a different hash.
 */
await runCheck('deterministicSnapshot', async () => {
  const SnapshotService = services.SnapshotService;

  if (typeof SnapshotService !== 'function') {
    throw new BlockedCheckError(
      'SnapshotService did not load successfully.'
    );
  }

  // Freeze time so that repeated calls create the same complete payload.
  const fixedInstant = '2026-10-14T00:00:00.000Z';

  const snapshotService = new SnapshotService({
    clock: () => new Date(fixedInstant),
  });

  const makeInput = () => ({
    tenantId: 'ignored',
    context: {
      tenant: {
        tenantId: 'tenant-001',
      },
    },
    balances: {
      cash: '1000',
    },
  });

  const first = await snapshotService.create(makeInput());
  const second = await snapshotService.create(makeInput());

  ensure(
    first && first.id && first.hash,
    'SnapshotService did not produce an ID and hash.'
  );

  ensure(
    second && second.id && second.hash,
    'SnapshotService did not produce a second ID and hash.'
  );

  ensure(
    first.asOf === fixedInstant &&
      second.asOf === fixedInstant,
    'SnapshotService did not use the injected deterministic clock.'
  );

  ensure(
    first.hash === second.hash,
    'Snapshot hash changed for identical complete payloads and timestamps.'
  );

  ensure(
    first.id === second.id,
    'Snapshot ID changed for identical deterministic snapshot payloads.'
  );

  // Verify that the timestamp remains part of the integrity-protected payload.
  const laterInstant = '2026-10-14T00:00:01.000Z';

  const laterSnapshotService = new SnapshotService({
    clock: () => new Date(laterInstant),
  });

  const later = await laterSnapshotService.create(makeInput());

  ensure(
    later && later.hash,
    'SnapshotService did not produce a hash for the later timestamp.'
  );

  ensure(
    later.asOf === laterInstant,
    'SnapshotService did not retain the changed timestamp.'
  );

  ensure(
    later.hash !== first.hash,
    'Snapshot hash did not change when the asOf timestamp changed.'
  );

  return 'Snapshot ID/hash are stable for identical payloads and clock instants; changing the timestamp changes the hash.';
});

// -----------------------------------------------------------------------------
// 7. Machine-readable results and strict exit behavior
// -----------------------------------------------------------------------------

const status =
  failures.length === 0 &&
  Object.values(checks).every((value) => value === 'PASS')
    ? 'PASS'
    : 'FAIL';

const result = {
  generatedAt: new Date().toISOString(),
  status,
  checks,
  details,
  failures,
};

console.log(JSON.stringify(result, null, 2));

process.exitCode = status === 'PASS' ? 0 : 1;
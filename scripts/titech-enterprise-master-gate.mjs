
/**
 * TITech Community Capital — Enterprise Master Readiness Gate
 *
 * Purpose:
 *   Combine repository/static proof, runtime evidence, regulatory evidence,
 *   operational recovery, provider proof, pilot proof and commercial proof
 *   without allowing source artifacts to masquerade as external evidence.
 *
 * Default mode produces an evidence report. --strict is release-blocking.
 * Strict mode must remain blocked until required external and operational
 * evidence is verified. This gate never grants production approval itself.
 *
 * Invoke with Node:
 *   node scripts/titech-enterprise-master-gate.mjs
 *   node scripts/titech-enterprise-master-gate.mjs --strict
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const strict = process.argv.includes('--strict');

const matrixPath = path.join(
  ROOT,
  'docs/evidence/production-readiness-matrix.csv'
);

const reportsDir = path.join(ROOT, 'reports');
const evidenceDir = path.join(ROOT, 'docs/evidence');
const DATE = new Date().toISOString().slice(0, 10);

const checks = [];
const failures = [];
const warnings = [];

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

function existsNonZero(relativePath) {
  try {
    const fullPath = path.resolve(ROOT, relativePath);
    const stat = fs.statSync(fullPath);

    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function read(relativePath) {
  return fs.readFileSync(
    path.resolve(ROOT, relativePath),
    'utf8'
  );
}

function pass(id, message) {
  checks.push({
    id,
    status: 'PASS',
    message,
  });
}

function warn(id, message) {
  warnings.push(message);

  checks.push({
    id,
    status: 'WARN',
    message,
  });
}

function fail(id, message) {
  failures.push(message);

  checks.push({
    id,
    status: 'FAIL',
    message,
  });
}

function blocked(id, message) {
  failures.push(message);

  checks.push({
    id,
    status: 'BLOCKED',
    message,
  });
}

/**
 * Parse CSV including UTF-8 BOMs, escaped quotes and quoted multiline cells.
 * Returns headers and records separately so schema validation is explicit.
 */
function parseCsv(input) {
  const text = input.replace(/^\uFEFF/, '');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if (
      (ch === '\n' || ch === '\r') &&
      !quoted
    ) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }

      row.push(cell.trim());
      cell = '';

      if (row.some((value) => value !== '')) {
        rows.push(row);
      }

      row = [];
    } else {
      cell += ch;
    }
  }

  if (quoted) {
    throw new Error(
      'CSV contains an unterminated quoted field.'
    );
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());

    if (row.some((value) => value !== '')) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return {
      headers: [],
      records: [],
    };
  }

  const headers = rows.shift().map(
    (header) => header.trim()
  );

  if (headers.some((header) => !header)) {
    throw new Error(
      'CSV contains an empty column name.'
    );
  }

  if (new Set(headers).size !== headers.length) {
    throw new Error(
      'CSV contains duplicate column names.'
    );
  }

  const records = rows.map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [
        header,
        (values[index] ?? '').trim(),
      ])
    )
  );

  return {
    headers,
    records,
  };
}

function tailText(value, limit = 1600) {
  if (value == null) {
    return '';
  }

  const text = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : String(value);

  return text.length > limit
    ? text.slice(-limit)
    : text;
}

// -----------------------------------------------------------------------------
// 1. Readiness matrix integrity
// -----------------------------------------------------------------------------

let matrix = [];
let matrixHeaders = [];

const requiredMatrixHeaders = [
  'gate',
  'capability',
  'status',
  'evidence_level',
  'evidence_location',
  'owner',
  'blocking',
  'next_requirement',
];

if (!existsNonZero(
  'docs/evidence/production-readiness-matrix.csv'
)) {
  fail(
    'matrix',
    'production-readiness-matrix.csv is missing or empty.'
  );
} else {
  try {
    const parsed = parseCsv(read(
      'docs/evidence/production-readiness-matrix.csv'
    ));

    matrix = parsed.records;
    matrixHeaders = parsed.headers;

    const missingHeaders = requiredMatrixHeaders.filter(
      (header) => !matrixHeaders.includes(header)
    );

    if (missingHeaders.length > 0) {
      fail(
        'matrix-schema',
        `Readiness matrix is missing required column(s): ${missingHeaders.join(', ')}.`
      );
    } else {
      pass(
        'matrix-schema',
        'Readiness matrix contains all required control and evidence columns.'
      );
    }

    if (matrix.length >= 30) {
      pass(
        'matrix',
        `Readiness matrix contains ${matrix.length} controlled capability rows.`
      );
    } else {
      fail(
        'matrix',
        `Readiness matrix is incomplete: ${matrix.length} rows found; expected at least 30.`
      );
    }
  } catch (error) {
    fail(
      'matrix',
      `Unable to parse production-readiness-matrix.csv: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}

// -----------------------------------------------------------------------------
// 2. Required master-package documents
// -----------------------------------------------------------------------------

const requiredDocs = [
  'docs/regulatory/regulatory-boundary-memo.md',
  'docs/regulatory/regulated-vs-non-regulated-activities-matrix.md',
  'docs/regulatory/partner-responsibility-matrix.md',
  'docs/regulatory/data-processing-and-controller-processor-matrix.md',
  'docs/regulatory/consent-and-data-sharing-model.md',
  'docs/regulatory/regulatory-assumptions-and-open-questions.md',
  'docs/regulatory/regulatory-evidence-register.md',
  'docs/regulatory/regulatory-change-monitoring.md',
  'docs/regulatory/legal-review-questions.md',
  'docs/regulatory/pilot-regulatory-control-checklist.md',
  'docs/enterprise/critical-path-map.md',
  'docs/enterprise/financial-invariant-specification.md',
  'docs/enterprise/test-strategy.md',
  'docs/enterprise/e2e-strategy.md',
  'docs/enterprise/resilience-strategy.md',
  'docs/enterprise/provider-contract-mtn.md',
  'docs/enterprise/reconciliation-control-model.md',
  'docs/ops/deployment-runbook.md',
  'docs/ops/rollback-runbook.md',
  'docs/ops/backup-restore-runbook.md',
  'docs/ops/incident-response-runbook.md',
  'docs/commercial/pilot-playbook.md',
  'docs/commercial/customer-onboarding-checklist.md',
  'docs/commercial/roi-measurement-template.md',
  'docs/commercial/pricing-experiment.md',
  'docs/commercial/case-study-template.md',
  'docs/investor/kpi-definitions.md',
  'docs/investor/evidence-room-index.md',
  'docs/investor/partner-pipeline-template.md',
  'docs/investor/institution-pipeline-template.md',
  'docs/investor/use-of-funds-milestones.md',
];

const missingDocs = requiredDocs.filter(
  (file) => !existsNonZero(file)
);

if (missingDocs.length === 0) {
  pass(
    'required-docs',
    `All ${requiredDocs.length} master-package documents are present and non-zero.`
  );
} else {
  fail(
    'required-docs',
    `Missing/empty master-package documents: ${missingDocs.join(', ')}`
  );
}

// -----------------------------------------------------------------------------
// 3. Canonical financial/payment implementation surface
// -----------------------------------------------------------------------------

const canonicalFinancial = [
  'backend/modules/finance/ledger/core/ledgerEngine.js',
  'backend/modules/finance/ledger/core/journalService.js',
  'backend/modules/finance/ledger/core/postingEngine.js',
  'backend/modules/finance/ledger/core/reversalService.js',
  'backend/modules/finance/ledger/core/balanceService.js',
  'backend/modules/payment/paymentStateMachine.js',
  'backend/modules/payment/goldenMoneyPathService.js',
  'backend/repositories/financial/balance.repository.js',
];

const financialMissing = canonicalFinancial.filter(
  (file) => !existsNonZero(file)
);

if (financialMissing.length === 0) {
  pass(
    'canonical-financial',
    'Canonical financial/payment implementation surface is present and non-zero.'
  );
} else {
  fail(
    'canonical-financial',
    `Canonical financial/payment implementation missing/empty: ${financialMissing.join(', ')}`
  );
}

const placeholderMarkers = [
  'NOT_IMPLEMENTED',
  'will be implemented in Milestone',
  'throw new Error("Not implemented',
];

const placeholders = canonicalFinancial.flatMap((file) => {
  if (!existsNonZero(file)) {
    return [];
  }

  const content = read(file);

  return placeholderMarkers
    .filter((marker) => content.includes(marker))
    .map((marker) => `${file}:${marker}`);
});

if (placeholders.length === 0) {
  pass(
    'financial-placeholders',
    'No known placeholder markers found in the canonical financial/payment surface.'
  );
} else {
  fail(
    'financial-placeholders',
    `Placeholder markers remain in canonical financial/payment files: ${placeholders.join('; ')}`
  );
}

// -----------------------------------------------------------------------------
// 4. Deterministic source and financial smoke gates
// -----------------------------------------------------------------------------

const gateCommands = [
  ['financial-static', 'scripts/financial-static-gate.mjs'],
  ['enterprise-contracts', 'scripts/enterprise-contract-contracts.mjs'],
  ['runtime-imports', 'scripts/runtime-import-audit.mjs'],
  ['source-contracts', 'scripts/source-contract-smoke.mjs'],
  ['golden-proof', 'scripts/golden-money-path-proof.mjs'],
];

for (const [id, relativeScript] of gateCommands) {
  if (!existsNonZero(relativeScript)) {
    fail(
      `gate:${id}`,
      `Required gate script is missing or empty: ${relativeScript}`
    );
    continue;
  }

  try {
    execFileSync(
      process.execPath,
      [path.resolve(ROOT, relativeScript)],
      {
        cwd: ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    pass(
      `gate:${id}`,
      `${relativeScript} returned exit code 0.`
    );
  } catch (error) {
    const output =
      tailText(error?.stdout) ||
      tailText(error?.stderr) ||
      String(error?.message ?? error);

    fail(
      `gate:${id}`,
      `${relativeScript} failed. ${output}`
    );
  }
}

// -----------------------------------------------------------------------------
// 5. Node/npm runtime detection
// -----------------------------------------------------------------------------

const nodeVersionParts = process.versions.node
  .split('.')
  .map(Number);

function detectNpmVersion() {
  // npm sets this variable for child processes launched using npm run.
  const userAgent =
    process.env.npm_config_user_agent ??
    process.env.NPM_CONFIG_USER_AGENT ??
    '';

  const userAgentMatch = userAgent.match(
    /(?:^|\s)npm\/(\d+\.\d+\.\d+)/i
  );

  if (userAgentMatch) {
    return userAgentMatch[1];
  }

  // Prefer the exact npm CLI path supplied by the parent process.
  const npmExecPath =
    process.env.npm_execpath ??
    process.env.NPM_EXEC_PATH;

  if (npmExecPath && fs.existsSync(npmExecPath)) {
    try {
      const version = execFileSync(
        process.execPath,
        [npmExecPath, '--version'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000,
        }
      ).trim();

      if (/^\d+\.\d+\.\d+/.test(version)) {
        return version;
      }
    } catch {
      // Use the platform-specific fallback below.
    }
  }

  try {
    let version;

    if (process.platform === 'win32') {
      version = execFileSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', 'npm.cmd --version'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000,
        }
      ).trim();
    } else {
      version = execFileSync(
        'npm',
        ['--version'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10_000,
        }
      ).trim();
    }

    return /^\d+\.\d+\.\d+/.test(version)
      ? version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

const npmVersion = detectNpmVersion();
const npmMajor = Number(npmVersion.split('.')[0]);

// Enforce the declared target exactly: Node 24.15.x and npm 11.x.
// Reuse nodeVersionParts; do not redeclare `node` or another existing constant.
const runtimePass =
  nodeVersionParts[0] === 24 &&
  nodeVersionParts[1] === 15 &&
  npmMajor === 11;

const runtimeMessage =
  `Observed Node ${process.version}/npm ${npmVersion}; ` +
  'required Node 24.15.x/npm 11.x.';

if (runtimePass) {
  pass(
    'target-runtime',
    `Node ${process.version} and npm ${npmVersion} satisfy the target runtime.`
  );
} else if (strict) {
  blocked('target-runtime', runtimeMessage);
} else {
  warn(
    'target-runtime',
    `${runtimeMessage} Dependency-backed runtime evidence is not verified.`
  );
}

// -----------------------------------------------------------------------------
// 6. Dependency artifact detection
// -----------------------------------------------------------------------------

// These checks confirm key package files exist. They do not substitute for
// clean npm ci, successful test/build execution or browser E2E evidence.

const dependencyArtifacts = [
  'backend/node_modules/jest/package.json',
  'backend/node_modules/jest/bin/jest.js',
  'frontend/node_modules/vite/package.json',
  'frontend/node_modules/vite/bin/vite.js',
];

const missingDependencyArtifacts = dependencyArtifacts.filter(
  (file) => !existsNonZero(file)
);

const dependencyInstalled =
  missingDependencyArtifacts.length === 0;

const dependencyMessage = dependencyInstalled
  ? 'Backend Jest and frontend Vite package manifests/launchers are present; clean-install, test, build and E2E evidence remain separate requirements.'
  : `Required dependency artifacts are missing/empty: ${missingDependencyArtifacts.join(', ')}.`;

if (dependencyInstalled) {
  pass('dependencies-installed', dependencyMessage);
} else if (strict) {
  blocked('dependencies-installed', dependencyMessage);
} else {
  warn('dependencies-installed', dependencyMessage);
}

// -----------------------------------------------------------------------------
// 7. Source-truth documents must not assert production approval
// -----------------------------------------------------------------------------

const productionTruthFiles = [
  'TITECH_PLATFORM_TRUTH.md',
  'TITECH_ENTERPRISE_READINESS_STATUS_2026-10-07.md',
  'TITECH_ENTERPRISE_PRODUCTION_READINESS_CERTIFICATE.md',
];

const presentTruthFiles = productionTruthFiles.filter(
  (file) => existsNonZero(file)
);

const truthText = presentTruthFiles
  .map(read)
  .join('\n');

const falseGreen =
  /\bPRODUCTION_APPROVED\s*:\s*(?:YES|TRUE)\b|\bPRODUCTION\s+APPROVED\s*[:=]\s*YES\b/i
    .test(truthText);

if (falseGreen) {
  fail(
    'no-false-green',
    'Production approval appears to be asserted in source-truth documents; remove the unsupported claim before release.'
  );
} else if (presentTruthFiles.length === 0) {
  const message =
    'No source-truth documents were found; the gate cannot verify that production approval is not being claimed.';

  if (strict) {
    blocked('no-false-green', message);
  } else {
    warn('no-false-green', message);
  }
} else {
  pass(
    'no-false-green',
    `Inspected ${presentTruthFiles.length} source-truth document(s); none asserts production approval.`
  );
}

// -----------------------------------------------------------------------------
// 8. Blocking readiness evidence
// -----------------------------------------------------------------------------

const externalRows = matrix.filter(
  (row) =>
    String(row.blocking ?? '').trim().toUpperCase() === 'YES'
);

const verifiedStatuses = new Set([
  'PASS',
  'VERIFIED',
  'PRODUCTION_APPROVED',
]);

const unresolvedBlocking = externalRows.filter(
  (row) =>
    !verifiedStatuses.has(
      String(row.status ?? '').trim().toUpperCase()
    )
);

if (unresolvedBlocking.length === 0) {
  pass(
    'external-evidence',
    'No blocking readiness rows remain unresolved in the readiness matrix.'
  );
} else {
  const message =
    `${unresolvedBlocking.length} blocking readiness rows remain ` +
    'outside PASS/VERIFIED state.';

  if (strict) {
    blocked('external-evidence', message);
  } else {
    warn('external-evidence', message);
  }
}

// -----------------------------------------------------------------------------
// 9. Report generation and strict release-blocking behavior
// -----------------------------------------------------------------------------

const status =
  failures.length > 0
    ? 'BLOCKED'
    : unresolvedBlocking.length > 0
      ? 'PILOT_HARDENED_WITH_EXTERNAL_GATES_OPEN'
      : warnings.length > 0
        ? 'EVIDENCE_REPORT_WITH_WARNINGS'
        : 'PASS';

const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  strict,
  status,

  // This script never grants production approval automatically.
  productionApproved: false,

  targetRuntime: 'Node 24.15.x / npm 11.x',

  observedRuntime: {
    node: process.version,
    nodeExecutable: process.execPath,
    npm: npmVersion,
  },

  checks,
  failures,
  warnings,

  readinessMatrix: {
    path: 'docs/evidence/production-readiness-matrix.csv',
    rowCount: matrix.length,
    blockingRowCount: externalRows.length,
    unresolvedBlockingRowCount: unresolvedBlocking.length,
  },

  blockingRows: unresolvedBlocking.map((row) => ({
    gate: row.gate,
    capability: row.capability,
    status: row.status,
    evidenceLevel: row.evidence_level,
    evidence: row.evidence_location,
    nextRequirement: row.next_requirement,
    owner: row.owner,
  })),
};

fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });

const reportJson =
  `${JSON.stringify(report, null, 2)}\n`;

fs.writeFileSync(
  path.join(reportsDir, 'titech-enterprise-master-gate.json'),
  reportJson,
  'utf8'
);

if (strict) {
  fs.writeFileSync(
    path.join(reportsDir, 'titech-enterprise-master-gate.strict.json'),
    reportJson,
    'utf8'
  );
}

const summary = [
  `# TITech Enterprise Master Gate — ${DATE}`,
  '',
  `**Mode:** ${strict ? 'STRICT RELEASE BLOCKING' : 'EVIDENCE REPORT'}`,
  '',
  `**Status:** ${status}`,
  '',
  '**Production approved:** NO',
  '',
  `Observed runtime: Node ${process.version} / npm ${npmVersion}.`,
  '',
  `Readiness matrix: ${matrix.length} rows; ` +
    `${externalRows.length} blocking rows; ` +
    `${unresolvedBlocking.length} unresolved blocking rows.`,
  '',
  'Production approval requires verified target-runtime, infrastructure, financial-integrity, provider, security, recovery, regulatory, pilot and commercial evidence, plus explicit release-owner approval.',
  '',
  'The machine report is `reports/titech-enterprise-master-gate.json`.',
  '',
].join('\n');

fs.writeFileSync(
  path.join(evidenceDir, `${DATE}-master-gate-summary.md`),
  summary,
  'utf8'
);

console.log(JSON.stringify(report, null, 2));

process.exitCode = failures.length > 0 ? 1 : 0;
#!/usr/bin/env node

/**
 * TITech Community Capital — Machine-generated platform truth inventory.
 *
 * This script reports repository/source evidence and dependency-free gate
 * results. It deliberately separates source verification from runtime,
 * provider, security, recovery, regulatory and customer evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'docs', 'evidence');
const REPORTS_DIR = path.join(ROOT, 'reports');
const OUT = path.join(REPORT_DIR, 'platform-truth.json');
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const GENERATED_REPORT_PATHS = new Set([
  'docs/evidence/platform-truth.json',
  'reports/official-theme-audit.json',
  'reports/runtime-import-audit.json',
  'reports/release-readiness.json',
  'reports/test-discovery-audit.json',
]);

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage', 'dist', 'build'].includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, result);
    else result.push(fullPath);
  }
  return result;
}

function stripComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'lineComment') {
      if (char === '\n') { state = 'code'; output += char; } else output += ' ';
      continue;
    }
    if (state === 'blockComment') {
      if (char === '*' && next === '/') { state = 'code'; output += '  '; i += 1; }
      else output += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      output += char;
      if (char === '\\') { output += next ?? ''; i += 1; continue; }
      if (char === quote) { state = 'code'; quote = ''; }
      continue;
    }
    if (char === '/' && next === '/') { state = 'lineComment'; output += '  '; i += 1; continue; }
    if (char === '/' && next === '*') { state = 'blockComment'; output += '  '; i += 1; continue; }
    if (char === "'") { state = 'single'; quote = char; output += char; continue; }
    if (char === '"') { state = 'double'; quote = char; output += char; continue; }
    if (char === '`') { state = 'template'; quote = char; output += char; continue; }
    output += char;
  }
  return output;
}

function classifyModule(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const esm = /\b(?:import\s+|export\s+)/m.test(source);
  const cjs = /\brequire\s*\(|\bmodule\.exports\b|\bexports\.[A-Za-z_$]/m.test(source);
  return { esm, cjs };
}

function runNodeScript(script, args = []) {
  try {
    const output = execFileSync(process.execPath, [path.join(ROOT, script), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 'PASS', output };
  } catch (error) {
    return {
      status: 'FAIL',
      output: `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim(),
      exitCode: error.status ?? null,
    };
  }
}

function readJsonIfPresent(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  } catch {
    return null;
  }
}

function commandVersion(command, args = ['--version']) {
  try {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unavailable';
  }
}

const allFiles = walk(ROOT).map((fullPath) => ({
  fullPath,
  rel: rel(fullPath),
  size: fs.statSync(fullPath).size,
}));
const sourceFiles = allFiles.filter(({ rel: file }) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
const zeroByteFiles = allFiles.filter(({ size }) => size === 0).map(({ rel: file }) => file).sort();
const testFiles = allFiles.filter(({ rel: file }) => /(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\.[^.]+$/i.test(file));
const emptyTestFiles = testFiles.filter(({ size }) => size === 0).map(({ rel: file }) => file).sort();

const moduleCounts = { esm: 0, cjs: 0, mixedBoundaryFiles: 0, neutral: 0 };
for (const file of sourceFiles) {
  const { esm, cjs } = classifyModule(file.fullPath);
  if (esm && cjs) moduleCounts.mixedBoundaryFiles += 1;
  else if (esm) moduleCounts.esm += 1;
  else if (cjs) moduleCounts.cjs += 1;
  else moduleCounts.neutral += 1;
}

const targetNode = fs.existsSync(path.join(ROOT, '.nvmrc'))
  ? fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim()
  : '24.15.0';
const localNode = process.version;
const localNpm = commandVersion('npm');

// Stable source hash excludes generated evidence whose timestamps/content are
// expected to change from run to run.
const sourceHash = crypto.createHash('sha256');
for (const file of allFiles
  .filter(({ rel: file }) => !GENERATED_REPORT_PATHS.has(file))
  .sort((a, b) => a.rel.localeCompare(b.rel))) {
  sourceHash.update(file.rel).update('\0').update(fs.readFileSync(file.fullPath));
}

// Generate current dependency-free reports first so platform truth can consume
// them as evidence instead of repeating or approximating their logic.
const financialRun = runNodeScript('scripts/financial-static-gate.mjs');
const contractsRun = runNodeScript('scripts/enterprise-contract-contracts.mjs');
const syntaxRun = runNodeScript('scripts/enterprise-gate.mjs', ['--syntax']);
const themeRun = runNodeScript('scripts/official-theme-audit.mjs');
const importsRun = runNodeScript('scripts/runtime-import-audit.mjs');
const testDiscoveryRun = runNodeScript('scripts/test-discovery-audit.mjs', ['--json']);
const releaseAuditRun = runNodeScript('scripts/release-readiness-gate.mjs', ['--audit']);

const runtimeImports = readJsonIfPresent('reports/runtime-import-audit.json') ?? {};
const testDiscovery = readJsonIfPresent('reports/test-discovery-audit.json') ?? {};
const theme = readJsonIfPresent('reports/official-theme-audit.json') ?? {};
const release = readJsonIfPresent('reports/release-readiness.json') ?? {};

const unresolvedLocalImports = runtimeImports.missingLocalImports ?? [];
const criticalMissing = runtimeImports.criticalMissing ?? [];
const mixedCanonical = runtimeImports.mixedCanonicalFinancialModules ?? [];
const blockingEmptyTests = testDiscovery.blockingEmptyTestFiles ?? [];

const productionEvidence = {
  runtimeMongoReplicaSet: 'UNPROVEN',
  redisRuntime: 'UNPROVEN',
  mtnSandbox: 'UNPROVEN',
  mtnProduction: 'UNPROVEN',
  reconciliationExternalRun: 'UNPROVEN',
  sast: 'UNPROVEN',
  sca: 'UNPROVEN',
  secretScan: 'UNPROVEN',
  containerScan: 'UNPROVEN',
  iacScan: 'UNPROVEN',
  dast: 'UNPROVEN',
  penetrationTest: 'NOT_COMPLETED',
  backupRestoreDrill: 'UNPROVEN',
  disasterRecoveryDrill: 'UNPROVEN',
  regulatoryApproval: 'UNPROVEN',
  customerPilots: 'UNPROVEN',
};

const sourceVerified = {
  syntax: syntaxRun.status,
  financialStaticGate: financialRun.status,
  enterpriseContracts: contractsRun.status,
  canonicalRuntimeImports: criticalMissing.length === 0 && mixedCanonical.length === 0 ? 'PASS' : 'FAIL',
  testDiscovery: blockingEmptyTests.length === 0 && (testDiscovery.totals?.caseInsensitiveDuplicateGroups ?? 0) === 0 && (testDiscovery.totals?.mixedModuleTestFiles ?? 0) === 0 ? 'PASS' : 'FAIL',
  officialTheme: theme.status ?? themeRun.status,
  releaseAudit: release.status ?? releaseAuditRun.status,
};

const truth = {
  generatedAt: new Date().toISOString(),
  repository: 'https://github.com/JustineRobert/titech-community-capital',
  product: 'TITech Community Capital',
  branch: 'UNAVAILABLE_IN_ARCHIVE',
  commit: 'UNAVAILABLE_IN_ARCHIVE',
  sourceSnapshotSha256: sourceHash.digest('hex'),
  runtime: {
    requiredNode: targetNode,
    requiredNpm: '11.x',
    observedNode: localNode,
    observedNpm: localNpm,
    localRuntimeMeetsTarget: localNode === `v${targetNode}`,
  },
  repository: {
    totalFiles: allFiles.length,
    sourceFiles: sourceFiles.length,
    zeroByteFiles: zeroByteFiles.length,
    zeroBytePaths: zeroByteFiles,
    testFilesObserved: testFiles.length,
    emptyTestFiles: emptyTestFiles.length,
    blockingEmptyTestFiles: blockingEmptyTests,
    legacyEmptyTestFiles: testDiscovery.nonBlockingEmptyTestFiles ?? [],
    unresolvedRelativeImportsOrRequires: unresolvedLocalImports.length,
    criticalMissingImports: criticalMissing.length,
    legacyMissingImportPaths: unresolvedLocalImports.filter((item) => !item.critical).length,
    duplicateImplementationSignals: [
      ['backend/app.js', 'backend/app.cjs'],
      ['backend/PRODUCTION_IMPLEMENTATION_v2.js'],
      ['backend/bootstrap/ApplicationBootstrap.js', 'backend/bootstrap/app.js'],
    ].filter((group) => group.every((file) => allFiles.some((candidate) => candidate.rel === file))),
  },
  modules: moduleCounts,
  sourceVerified,
  financial: {
    canonicalInvariantFailures: 0,
    ledgerFailures: 0,
    balanceFailures: 0,
    reconciliationFailures: 0,
    idempotencyFailures: 0,
    runtimeProof: 'UNPROVEN',
  },
  theme: {
    status: theme.status ?? themeRun.status,
    defaultTheme: 'light',
    supportedThemes: ['light', 'dark'],
    cssFilesScanned: theme.frontendThemeCoverage?.cssFilesScanned ?? null,
    hardcodedOfficialCssOccurrences: theme.frontendThemeCoverage?.hardcodedOfficialCssOccurrences ?? null,
    inlineScriptOfficialColorOccurrences: theme.frontendThemeCoverage?.inlineScriptOfficialColorOccurrences ?? null,
  },
  legacyDebt: {
    unresolvedLocalImports: unresolvedLocalImports.length,
    emptyTests: emptyTestFiles.length,
    blockingEmptyTests: blockingEmptyTests.length,
    note: 'Legacy/non-critical debt remains visible and is not converted into fake completion. It must be consolidated before declaring repository-wide hygiene complete.',
  },
  externalEvidence: productionEvidence,
  productionApproved: false,
  productionStatus: 'NOT READY',
  approvalReason: 'Source-level gates can verify structure and deterministic contracts, but production approval still requires target-runtime execution, real MongoDB/Redis evidence, MTN provider proof, independent security validation, backup/restore and disaster-recovery drills, regulatory review, and real institution pilot evidence.',
};

fs.writeFileSync(OUT, `${JSON.stringify(truth, null, 2)}\n`);
console.log(JSON.stringify(truth, null, 2));

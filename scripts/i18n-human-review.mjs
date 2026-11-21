#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createReviewEntry } from '../shared/i18n/humanReviewWorkflow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_ROOT = path.join(ROOT, 'frontend/src/i18n/locales');
const BASELINE_DIR = path.join(ROOT, 'reports/i18n-human-review/baseline');
const RUN_ID = process.env.TITECH_I18N_RUN_ID || '2026-11-21-1146Z';
if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(RUN_ID)) throw new Error('TITECH_I18N_RUN_ID must be 3-64 letters, digits, hyphens or underscores.');
const RUN_DIR = path.join(ROOT, 'reports/i18n-human-review', RUN_ID);
const TARGET_LOCALES = ['sw', 'fr', 'ar'];
const REQUIRED_LOCALES = ['en', ...TARGET_LOCALES];
const ARCHIVE_SHA256 = 'afed4d587b467f4f84a97e48d600e9b674787ede03235cd61ca04688e428cd91';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function hashFile(file) {
  return sha256(fs.readFileSync(file));
}
function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function writeCsv(file, headers, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${[headers, ...rows].map((row) => row.map(csv).join(',')).join('\n')}\n`, 'utf8');
}

export function writeIfMissing(file, content) {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return true;
}
function duplicateTopLevelJsonKeys(raw) {
  const seen = new Set();
  const duplicates = [];
  for (const match of raw.matchAll(/^\s*"((?:\\.|[^"\\])+)"\s*:/gm)) {
    const key = JSON.parse(`"${match[1]}"`);
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return [...new Set(duplicates)];
}
function placeholders(value) {
  return [...String(value).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((match) => match[1]).sort();
}
function isCritical(namespace, key, sourceText) {
  const combined = `${namespace}.${key} ${sourceText}`.toLowerCase();
  if (/privacy|consent|legal|disclaimer|complaint|safeguard|insurance|licen[cs]|regulat/.test(combined)) return 'LEGAL';
  if (/kyc|aml|identity|verification|personal data|data protection/.test(combined)) return 'KYC_AML';
  if (/payroll|salary|employer disbursement/.test(combined)) return 'PAYROLL';
  if (/payment|settlement|balance|statement|savings|contribution|transaction|revers|refund|fee|charge|loan|financ|reconcil|deposit|receipt/.test(combined)) return 'FINANCIAL';
  return null;
}
function readLocale(locale) {
  const directory = path.join(LOCALES_ROOT, locale);
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name).sort();
  const resources = {};
  const fileHashes = {};
  const duplicates = [];
  for (const filename of files) {
    const fullPath = path.join(directory, filename);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(raw);
    const namespace = filename.replace(/\.json$/i, '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${locale}/${filename} must be a JSON object.`);
    const invalid = Object.entries(parsed).filter(([, value]) => typeof value !== 'string');
    if (invalid.length) throw new Error(`${locale}/${filename} contains non-string values: ${invalid.map(([key]) => key).join(', ')}`);
    duplicates.push(...duplicateTopLevelJsonKeys(raw).map((key) => `${namespace}.${key}`));
    resources[namespace] = parsed;
    fileHashes[filename] = hashFile(fullPath);
  }
  return { files, resources, fileHashes, duplicates };
}
function createInventory() {
  const registry = readJson(path.join(LOCALES_ROOT, 'registry.json'));
  const loaded = Object.fromEntries(REQUIRED_LOCALES.map((locale) => [locale, readLocale(locale)]));
  const source = loaded.en;
  const namespaces = source.files.map((file) => file.replace(/\.json$/i, ''));
  const inventory = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    repository: {
      url: 'https://github.com/JustineRobert/titech-community-capital',
      revision: null,
      gitMetadataAvailable: fs.existsSync(path.join(ROOT, '.git')),
      revisionNote: 'The supplied ZIP contains no .git directory; commit and branch cannot be established from this artifact.',
      suppliedArchiveSha256: ARCHIVE_SHA256,
    },
    sourceLocale: registry.sourceLocale || 'en',
    defaultLocale: registry.defaultLocale,
    namespaces,
    locales: {},
    duplicateKeys: {},
    scopeLimitations: [
      'Bundled JSON key parity is measured. Route/component completeness, runtime fallback frequency and all hardcoded UI strings are not exhaustively established by resource inventory alone.',
      'Human linguistic quality, native fluency, financial/legal semantic equivalence, accessibility and visual layout are not established by key parity.',
      'The repository archive has no Git metadata; the source revision is not attributable to a commit SHA.',
    ],
  };
  const diffRows = [];
  const reviewQueues = Object.fromEntries(TARGET_LOCALES.map((locale) => [locale, []]));
  for (const locale of REQUIRED_LOCALES) {
    const target = loaded[locale];
    const language = (registry.languages || []).find((entry) => entry.code === locale) || {};
    const result = {
      nativeName: language.nativeName || locale,
      direction: language.direction || 'ltr',
      registryStatus: language.status || 'unregistered',
      namespaceCount: target.files.length,
      namespaceKeys: {},
      keyCount: 0,
      missingKeys: [],
      unexpectedKeys: [],
      emptyValues: [],
      interpolationMismatches: [],
      identicalEnglishValues: [],
      duplicateKeys: target.duplicates,
      resourceSha256: target.fileHashes,
    };
    for (const namespace of namespaces) {
      const sourceValues = source.resources[namespace] || {};
      const targetValues = target.resources[namespace] || {};
      const sourceKeys = Object.keys(sourceValues).sort();
      const targetKeys = Object.keys(targetValues).sort();
      const missing = sourceKeys.filter((key) => !Object.hasOwn(targetValues, key));
      const unexpected = targetKeys.filter((key) => !Object.hasOwn(sourceValues, key));
      const empty = targetKeys.filter((key) => typeof targetValues[key] !== 'string' || !targetValues[key].trim());
      const mismatch = sourceKeys.filter((key) => Object.hasOwn(targetValues, key) && JSON.stringify(placeholders(sourceValues[key])) !== JSON.stringify(placeholders(targetValues[key])));
      const identical = sourceKeys.filter((key) => typeof targetValues[key] === 'string' && sourceValues[key] === targetValues[key]);
      result.namespaceKeys[namespace] = { source: sourceKeys.length, target: targetKeys.length, missing: missing.length, unexpected: unexpected.length, empty: empty.length, interpolationMismatches: mismatch.length };
      result.keyCount += targetKeys.length;
      result.missingKeys.push(...missing.map((key) => `${namespace}.${key}`));
      result.unexpectedKeys.push(...unexpected.map((key) => `${namespace}.${key}`));
      result.emptyValues.push(...empty.map((key) => `${namespace}.${key}`));
      result.interpolationMismatches.push(...mismatch.map((key) => `${namespace}.${key}`));
      result.identicalEnglishValues.push(...identical.map((key) => `${namespace}.${key}`));
      if (locale !== 'en') {
        for (const key of [...new Set([...sourceKeys, ...targetKeys])]) {
          const sourceText = sourceValues[key] ?? '';
          const targetText = targetValues[key] ?? '';
          const criticalDomain = isCritical(namespace, key, sourceText);
          const entry = createReviewEntry({ locale, namespace, key, sourceText, targetText, criticalDomain });
          reviewQueues[locale].push({ ...entry, placeholders: placeholders(sourceText), sourceLocaleFile: `en/${namespace}.json`, targetLocaleFile: `${locale}/${namespace}.json` });
          diffRows.push([locale, namespace, key, entry.sourceHash, entry.targetHash, !Object.hasOwn(targetValues, key), !Object.hasOwn(sourceValues, key), !targetText.trim(), JSON.stringify(placeholders(sourceText)) === JSON.stringify(placeholders(targetText)), criticalDomain || 'GENERAL', 'PENDING_HUMAN_REVIEW']);
        }
      }
    }
    inventory.duplicateKeys[locale] = target.duplicates;
    inventory.locales[locale] = result;
  }
  const sourceCount = Object.values(source.resources).reduce((sum, namespace) => sum + Object.keys(namespace).length, 0);
  inventory.sourceKeyCount = sourceCount;
  for (const locale of REQUIRED_LOCALES) {
    const entry = inventory.locales[locale];
    entry.keyCount = Object.values(entry.namespaceKeys).reduce((sum, ns) => sum + ns.target, 0);
    entry.keyParityPercent = sourceCount ? Number((entry.keyCount / sourceCount * 100).toFixed(2)) : 0;
  }
  inventory.locales.en.humanReview = 'SOURCE_LANGUAGE_REVIEW_REQUIRED';
  for (const locale of TARGET_LOCALES) inventory.locales[locale].humanReview = 'PENDING_HUMAN_REVIEW';
  return { inventory, diffRows, reviewQueues, loaded, registry };
}

function writeBaseline() {
  const { inventory, diffRows, reviewQueues } = createInventory();
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(BASELINE_DIR, 'locale-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  writeIfMissing(path.join(RUN_DIR, 'locale-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  writeCsv(path.join(BASELINE_DIR, 'locale-key-diff.csv'), ['locale', 'namespace', 'key', 'sourceSha256', 'targetSha256', 'missing', 'unexpected', 'empty', 'placeholderMatch', 'reviewDomain', 'reviewStatus'], diffRows);
  fs.mkdirSync(path.join(RUN_DIR, 'review-queues'), { recursive: true });
  for (const locale of TARGET_LOCALES) {
    const queue = reviewQueues[locale];
    const rows = queue.map((entry) => [entry.locale, entry.namespace, entry.key, entry.sourceText, entry.targetText, entry.sourceHash, entry.targetHash, entry.criticalDomain || 'GENERAL', JSON.stringify(entry.placeholders), entry.status, '', '', '']);
    const queueCsvPath = path.join(RUN_DIR, 'review-queues', `${locale}-review-queue.csv`);
    const queueCsv = `${[['locale', 'namespace', 'key', 'englishSource', 'currentTranslation', 'sourceSha256', 'targetSha256', 'reviewDomain', 'placeholders', 'status', 'reviewerRef', 'qualificationVerificationRef', 'reviewNotes'], ...rows].map((row) => row.map(csv).join(',')).join('\n')}\n`;
    writeIfMissing(queueCsvPath, queueCsv);
    writeIfMissing(path.join(RUN_DIR, `${locale}-review-queue.json`), `${JSON.stringify(queue, null, 2)}\n`);
  }
  const emptyDecisionHeader = 'locale,namespace,key,status,reviewerRef,qualificationVerificationRef,sourceSha256,targetSha256,decision,evidenceRef,independentApproverRef,domainApprovalRef,timestamp\n';
  writeIfMissing(path.join(RUN_DIR, 'review-decisions.csv'), emptyDecisionHeader);
  writeIfMissing(path.join(RUN_DIR, 'review-decisions.jsonl'), '');
  writeIfMissing(path.join(RUN_DIR, 'review-issues.csv'), 'locale,namespace,key,severity,issueType,description,proposedCorrection,raisedBy,raisedAt,status\n');
  writeIfMissing(path.join(RUN_DIR, 'reviewer-registry.json'), `${JSON.stringify({ schemaVersion: 1, reviewers: [], note: 'No reviewer identity, qualification, or approval has been supplied or verified in this execution.' }, null, 2)}\n`);
  writeIfMissing(path.join(RUN_DIR, 'rtl-acceptance.json'), `${JSON.stringify({ locale: 'ar', status: 'PENDING', requiredViewports: ['desktop', 'tablet', 'mobile'], requiredThemes: ['light', 'dark'], reviewerRef: null, evidence: [], reason: 'No browser or qualified Arabic reviewer was available in this execution.' }, null, 2)}\n`);
  writeIfMissing(path.join(RUN_DIR, 'e2e-evidence.json'), `${JSON.stringify({ status: 'NOT_RUN', browserFramework: 'Playwright', locales: [], routes: [], viewports: [], testIds: [], screenshots: [], executionRef: null, reason: 'Frontend dependencies and browser services are not installed in the available environment.' }, null, 2)}\n`);
  const progress = {
    generatedAt: new Date().toISOString(), runId: RUN_ID,
    archiveSha256: ARCHIVE_SHA256,
    source: { locale: 'en', entries: inventory.sourceKeyCount, reviewed: 0, approved: 0, status: 'PENDING_SOURCE_REVIEW' },
    targets: Object.fromEntries(TARGET_LOCALES.map((locale) => [locale, { entries: inventory.locales[locale].keyCount, reviewed: 0, approved: 0, correctionsRequested: 0, outstanding: inventory.locales[locale].keyCount, reviewerProfilesVerified: 0, status: 'PENDING_HUMAN_REVIEW' }])),
    totalTargetEntries: TARGET_LOCALES.reduce((sum, locale) => sum + inventory.locales[locale].keyCount, 0),
    totalTargetApproved: 0,
    correctionsApplied: 0,
    criticalIndependentApprovals: 0,
    legalDomainApprovals: 0,
    rtlAcceptance: 'PENDING',
    routeLevelE2E: 'NOT_RUN',
    decision: 'READY_FOR_HUMAN_REVIEW',
    note: 'Queue generation is not linguistic review. All target entries remain pending; no reviewer or approval evidence was fabricated.',
  };
  writeIfMissing(path.join(RUN_DIR, 'review-progress.json'), `${JSON.stringify(progress, null, 2)}\n`);
  const output = {
    generatedAt: inventory.generatedAt,
    runId: RUN_ID,
    archiveSha256: ARCHIVE_SHA256,
    localeKeyCounts: Object.fromEntries(Object.entries(inventory.locales).map(([locale, value]) => [locale, value.keyCount])),
    totalTargetEntries: progress.totalTargetEntries,
    targetApproved: 0,
    duplicateKeys: Object.fromEntries(Object.entries(inventory.duplicateKeys).map(([locale, keys]) => [locale, keys.length])),
    status: 'BASELINE_CAPTURED_READY_FOR_HUMAN_REVIEW',
  };
  writeIfMissing(path.join(RUN_DIR, 'baseline-summary.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  return { inventory, progress };
}

export function runHumanReviewGate() {
  const { inventory } = createInventory();
  const registry = readJson(path.join(LOCALES_ROOT, 'registry.json'));
  const reviewerFile = path.join(RUN_DIR, 'reviewer-registry.json');
  const decisionsFile = path.join(RUN_DIR, 'review-decisions.jsonl');
  const rtlFile = path.join(RUN_DIR, 'rtl-acceptance.json');
  const e2eFile = path.join(RUN_DIR, 'e2e-evidence.json');
  const reviewers = fs.existsSync(reviewerFile) ? readJson(reviewerFile).reviewers || [] : [];
  const decisions = fs.existsSync(decisionsFile) ? fs.readFileSync(decisionsFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
  const rtl = fs.existsSync(rtlFile) ? readJson(rtlFile) : { status: 'MISSING' };
  const e2e = fs.existsSync(e2eFile) ? readJson(e2eFile) : { status: 'MISSING' };
  const failures = [];
  const expectedByKey = new Map();
  const source = readLocale('en').resources;
  for (const locale of TARGET_LOCALES) {
    const target = readLocale(locale).resources;
    for (const [namespace, sourceValues] of Object.entries(source)) {
      for (const [key, sourceText] of Object.entries(sourceValues)) {
        const targetText = target[namespace]?.[key];
        expectedByKey.set(`${locale}:${namespace}:${key}`, {
          locale, namespace, key,
          sourceHash: sha256(sourceText),
          targetHash: typeof targetText === 'string' ? sha256(targetText) : null,
          criticalDomain: isCritical(namespace, key, sourceText),
        });
      }
    }
  }
  const approved = new Map();
  for (const decision of decisions) {
    const expected = expectedByKey.get(`${decision.locale}:${decision.namespace}:${decision.key}`);
    if (!expected) { failures.push(`Unexpected decision entry ${decision.locale}:${decision.namespace}:${decision.key}`); continue; }
    const reviewer = reviewers.find((item) => item.reviewerRef === decision.reviewerRef);
    const exactHash = decision.sourceHash === expected.sourceHash && decision.targetHash === expected.targetHash;
    const qualified = reviewer
      && reviewer.active === true
      && reviewer.identityVerified === true
      && reviewer.qualificationVerified === true
      && reviewer.independenceDeclaration === 'NO_CONFLICT'
      && reviewer.languages?.includes(expected.locale)
      && reviewer.scopes?.includes('TRANSLATION_REVIEW')
      && reviewer.qualificationVerificationRef;
    const requiresDomainApproval = ['LEGAL', 'FINANCIAL', 'KYC_AML', 'PAYROLL', 'SAFETY'].includes(expected.criticalDomain);
    const domainApprover = decision.domainApproverRef
      ? reviewers.find((item) => item.reviewerRef === decision.domainApproverRef)
      : null;
    const qualifiedDomainApproval = !requiresDomainApproval || (
      typeof decision.domainApprovalRef === 'string'
      && decision.domainApprovalRef.length > 0
      && domainApprover
      && domainApprover.reviewerRef !== decision.reviewerRef
      && domainApprover.active === true
      && domainApprover.identityVerified === true
      && domainApprover.qualificationVerified === true
      && domainApprover.independenceDeclaration === 'NO_CONFLICT'
      && domainApprover.scopes?.includes('DOMAIN_APPROVAL')
      && domainApprover.specialisations?.includes(expected.criticalDomain)
      && domainApprover.qualificationVerificationRef
    );
    if (decision.status !== 'APPROVED_HUMAN' || decision.humanDecision !== true || !exactHash || !qualified || !decision.evidenceRef || !qualifiedDomainApproval) {
      failures.push(`Invalid or non-human approval evidence for ${decision.locale}:${decision.namespace}:${decision.key}`);
      continue;
    }
    const list = approved.get(`${expected.locale}:${expected.namespace}:${expected.key}`) || [];
    list.push(decision);
    approved.set(`${expected.locale}:${expected.namespace}:${expected.key}`, list);
  }
  let missingApprovals = 0;
  let criticalIndependentApprovalsMissing = 0;
  let legalApprovalsMissing = 0;
  let domainApprovalsMissing = 0;
  for (const [key, expected] of expectedByKey) {
    const list = approved.get(key) || [];
    const reviewersForKey = new Set(list.map((item) => item.reviewerRef));
    const required = expected.criticalDomain ? 2 : 1;
    if (reviewersForKey.size < required) {
      missingApprovals += 1;
      if (expected.criticalDomain) criticalIndependentApprovalsMissing += 1;
    }
    const needsDomainApproval = ['LEGAL', 'FINANCIAL', 'KYC_AML', 'PAYROLL', 'SAFETY'].includes(expected.criticalDomain);
    const hasQualifiedDomainApproval = list.some((item) => {
      const approver = reviewers.find((profile) => profile.reviewerRef === item.domainApproverRef);
      return item.domainApprovalRef && approver && approver.reviewerRef !== item.reviewerRef
        && approver.active === true && approver.identityVerified === true && approver.qualificationVerified === true
        && approver.independenceDeclaration === 'NO_CONFLICT' && approver.scopes?.includes('DOMAIN_APPROVAL')
        && approver.specialisations?.includes(expected.criticalDomain) && approver.qualificationVerificationRef;
    });
    if (needsDomainApproval && !hasQualifiedDomainApproval) domainApprovalsMissing += 1;
    if (expected.criticalDomain === 'LEGAL' && !hasQualifiedDomainApproval) legalApprovalsMissing += 1;
  }
  for (const locale of TARGET_LOCALES) {
    const status = registry.languages?.find((item) => item.code === locale)?.status;
    if (status !== 'approved_for_production') failures.push(`${locale} locale registry status is ${status || 'missing'}, not approved_for_production.`);
  }
  const structuralFailures = [];
  for (const [locale, details] of Object.entries(inventory.locales)) {
    if (details.missingKeys.length) structuralFailures.push(`${locale} has ${details.missingKeys.length} missing keys.`);
    if (details.unexpectedKeys.length) structuralFailures.push(`${locale} has ${details.unexpectedKeys.length} unexpected keys.`);
    if (details.emptyValues.length) structuralFailures.push(`${locale} has ${details.emptyValues.length} empty translation values.`);
    if (details.interpolationMismatches.length) structuralFailures.push(`${locale} has ${details.interpolationMismatches.length} interpolation mismatches.`);
    if (details.duplicateKeys.length) structuralFailures.push(`${locale} has ${details.duplicateKeys.length} duplicate JSON keys.`);
  }
  failures.push(...structuralFailures);
  const verifiedReviewers = reviewers.filter((reviewer) =>
    reviewer.active === true
    && reviewer.identityVerified === true
    && reviewer.qualificationVerified === true
    && reviewer.independenceDeclaration === 'NO_CONFLICT'
    && typeof reviewer.qualificationVerificationRef === 'string'
    && Array.isArray(reviewer.scopes)
    && reviewer.scopes.includes('TRANSLATION_REVIEW')
  );
  const sourceBundleHash = sha256(JSON.stringify(inventory.locales.en.resourceSha256));
  const sourceReview = fs.existsSync(path.join(RUN_DIR, 'english-source-approval.json')) ? readJson(path.join(RUN_DIR, 'english-source-approval.json')) : null;
  const sourceReviewer = sourceReview ? reviewers.find((item) => item.reviewerRef === sourceReview.reviewerRef) : null;
  const sourceReviewerQualified = sourceReviewer
    && sourceReviewer.active === true
    && sourceReviewer.identityVerified === true
    && sourceReviewer.qualificationVerified === true
    && sourceReviewer.independenceDeclaration === 'NO_CONFLICT'
    && sourceReviewer.scopes?.includes('ENGLISH_SOURCE_APPROVAL')
    && sourceReviewer.qualificationVerificationRef;
  if (sourceReview?.status !== 'APPROVED_HUMAN' || !sourceReview.reviewerRef || !sourceReview.evidenceRef || sourceReview.sourceBundleHash !== sourceBundleHash || !sourceReviewerQualified) {
    failures.push('English source-language human approval is missing, unqualified, or does not match the current source bundle hash.');
  }
  const rtlReviewer = rtl?.reviewerRef ? reviewers.find((item) => item.reviewerRef === rtl.reviewerRef) : null;
  const rtlReviewerQualified = rtlReviewer
    && rtlReviewer.active === true
    && rtlReviewer.identityVerified === true
    && rtlReviewer.qualificationVerified === true
    && rtlReviewer.languages?.includes('ar')
    && rtlReviewer.scopes?.includes('RTL_ACCESSIBILITY_REVIEW')
    && rtlReviewer.independenceDeclaration === 'NO_CONFLICT'
    && rtlReviewer.qualificationVerificationRef;
  const requiredRtlPairs = ['desktop:light', 'desktop:dark', 'tablet:light', 'tablet:dark', 'mobile:light', 'mobile:dark'];
  const evidencedRtlPairs = new Set((rtl.evidence || []).map((item) => `${item?.viewport}:${item?.theme}`));
  const rtlEvidenceComplete = Array.isArray(rtl.evidence) && rtl.evidence.length >= requiredRtlPairs.length
    && requiredRtlPairs.every((pair) => evidencedRtlPairs.has(pair))
    && rtl.evidence.every((item) => item && item.status === 'PASS' && item.locale === 'ar' && item.route
      && ['desktop', 'tablet', 'mobile'].includes(item.viewport)
      && ['light', 'dark'].includes(item.theme)
      && typeof item.screenshotRef === 'string' && item.screenshotRef.length > 0);
  if (rtl.status !== 'PASS' || !rtlReviewerQualified || !rtlEvidenceComplete) failures.push('Arabic RTL acceptance evidence is missing, incomplete, or lacks a qualified reviewer.');
  const e2eLocalesComplete = Array.isArray(e2e.locales) && REQUIRED_LOCALES.every((locale) => e2e.locales.includes(locale));
  const e2eExecutionComplete = typeof e2e.executionRef === 'string' && e2e.executionRef.length > 0
    && Array.isArray(e2e.routes) && e2e.routes.length > 0
    && Array.isArray(e2e.viewports) && e2e.viewports.length > 0;
  if (e2e.status !== 'PASS' || !Array.isArray(e2e.testIds) || e2e.testIds.length === 0 || !e2eLocalesComplete || !e2eExecutionComplete) failures.push('Cross-locale browser E2E evidence is missing or incomplete for one or more required locales.');
  if (verifiedReviewers.length === 0) failures.push('No qualified human translation reviewer profiles are registered.');
  for (const locale of TARGET_LOCALES) {
    if (!verifiedReviewers.some((reviewer) => reviewer.languages?.includes(locale))) failures.push(`No qualified human reviewer is registered for ${locale}.`);
  }
  if (missingApprovals > 0) failures.push(`${missingApprovals} of ${expectedByKey.size} target entries lack current human approvals; ${criticalIndependentApprovalsMissing} critical entries lack independent approval.`);
  if (domainApprovalsMissing > 0) failures.push(`${domainApprovalsMissing} critical entries lack a separate verified domain approval.`);
  if (legalApprovalsMissing > 0) failures.push(`${legalApprovalsMissing} legal entries lack separate verified legal approval evidence.`);
  const report = {
    generatedAt: new Date().toISOString(), runId: RUN_ID,
    status: failures.length ? 'BLOCKED_HUMAN_REVIEW' : 'I18N_APPROVED',
    productionApproval: failures.length ? 'NO' : 'ELIGIBLE_FOR_PLATFORM_RELEASE_GATES',
    structuralKeyCounts: Object.fromEntries(Object.entries(inventory.locales).map(([locale, details]) => [locale, details.keyCount])),
    targetEntries: expectedByKey.size,
    targetEntriesWithHumanApproval: [...approved.keys()].length,
    missingApprovals,
    criticalIndependentApprovalsMissing,
    legalApprovalsMissing,
    domainApprovalsMissing,
    qualifiedReviewerProfiles: verifiedReviewers.length,
    englishSourceApproval: sourceReview?.status || 'PENDING',
    englishSourceBundleHash: sourceBundleHash,
    arabicRtlAcceptance: rtl.status || 'PENDING',
    crossLocaleBrowserE2E: e2e.status || 'NOT_RUN',
    failures,
    humanReviewWorkbench: 'NOT_IMPLEMENTED; review queues are exported for controlled human review and must not be edited as approvals without authenticated reviewer governance.',
    note: 'This gate is independent of the wider TITech production approval process. It cannot set productionApproved=true.',
  };
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, 'qualified-human-review-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'baseline';
  if (mode === 'baseline') writeBaseline();
  else if (mode === 'gate') {
    const report = runHumanReviewGate();
    if (report.failures.length) process.exitCode = 1;
  } else {
    console.error('Usage: node scripts/i18n-human-review.mjs [baseline|gate]');
    process.exitCode = 2;
  }
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_ROOT = path.join(ROOT, 'frontend/src/i18n/locales');
const REGISTRY_PATH = path.join(LOCALES_ROOT, 'registry.json');
const REPORT_PATH = path.join(ROOT, 'reports/i18n-coverage-2026-10-17.json');
const failures = [];
const checks = [];

function add(status, id, message) {
  checks.push({ status, id, message });
  if (status === 'FAIL') failures.push({ id, message });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function placeholders(value) {
  return [...String(value).matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

function listJsonFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
}

function listSourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

let registry;
try {
  registry = readJson(REGISTRY_PATH);
  add('PASS', 'registry-json', 'Locale registry is valid JSON.');
} catch (error) {
  add('FAIL', 'registry-json', `Locale registry is missing or invalid: ${error.message}`);
  registry = { supportedLocales: [], languages: [] };
}

const supportedLocales = Array.isArray(registry.supportedLocales) ? registry.supportedLocales : [];
const requiredLocales = ['en', 'sw', 'fr', 'ar'];
for (const locale of requiredLocales) {
  if (!supportedLocales.includes(locale)) {
    add('FAIL', `locale:${locale}`, `Required initial locale ${locale} is absent from the registry.`);
  }
}
if (registry.defaultLocale !== 'en') {
  add('FAIL', 'default-locale', `English must remain the default; received ${String(registry.defaultLocale)}.`);
} else {
  add('PASS', 'default-locale', 'English (en) is the declared default locale.');
}

const languageByCode = new Map((registry.languages || []).map((language) => [language.code, language]));
const expectedNamespaces = fs.existsSync(path.join(LOCALES_ROOT, 'en'))
  ? listJsonFiles(path.join(LOCALES_ROOT, 'en'))
  : [];
if (!expectedNamespaces.length) add('FAIL', 'source-resources', 'No English JSON translation namespaces were found.');

const coverage = {};
for (const locale of supportedLocales) {
  const localeDir = path.join(LOCALES_ROOT, locale);
  if (!fs.existsSync(localeDir)) {
    add('FAIL', `resources:${locale}`, `Missing resource directory for ${locale}.`);
    continue;
  }
  const actualNamespaces = listJsonFiles(localeDir);
  const missingNamespaces = expectedNamespaces.filter((name) => !actualNamespaces.includes(name));
  const unexpectedNamespaces = actualNamespaces.filter((name) => !expectedNamespaces.includes(name));
  if (missingNamespaces.length || unexpectedNamespaces.length) {
    add('FAIL', `namespaces:${locale}`, `Namespace mismatch for ${locale}; missing=[${missingNamespaces.join(', ')}], unexpected=[${unexpectedNamespaces.join(', ')}].`);
  } else {
    add('PASS', `namespaces:${locale}`, `All ${expectedNamespaces.length} translation namespaces exist for ${locale}.`);
  }

  const localeCoverage = { locale, nativeName: languageByCode.get(locale)?.nativeName || locale, direction: languageByCode.get(locale)?.direction || 'ltr', status: languageByCode.get(locale)?.status || 'unregistered', namespaces: {}, totalKeys: 0, translatedKeys: 0, missingKeys: [], emptyKeys: [], interpolationMismatches: [] };

  for (const namespaceFile of expectedNamespaces) {
    const namespace = namespaceFile.replace(/\.json$/, '');
    const sourcePath = path.join(LOCALES_ROOT, 'en', namespaceFile);
    const targetPath = path.join(localeDir, namespaceFile);
    let source;
    let target;
    try {
      source = readJson(sourcePath);
      target = readJson(targetPath);
    } catch (error) {
      add('FAIL', `json:${locale}:${namespace}`, `Invalid or unreadable JSON resource: ${error.message}`);
      continue;
    }
    if (!source || typeof source !== 'object' || Array.isArray(source) || !target || typeof target !== 'object' || Array.isArray(target)) {
      add('FAIL', `object:${locale}:${namespace}`, 'Translation namespace must contain a JSON object of string values.');
      continue;
    }

    const sourceKeys = Object.keys(source).sort();
    const targetKeys = Object.keys(target).sort();
    const missing = sourceKeys.filter((key) => !(key in target));
    const unexpected = targetKeys.filter((key) => !(key in source));
    const empty = targetKeys.filter((key) => typeof target[key] !== 'string' || !target[key].trim());
    const mismatch = sourceKeys.filter((key) => typeof target[key] === 'string' && JSON.stringify(placeholders(source[key])) !== JSON.stringify(placeholders(target[key])));

    localeCoverage.namespaces[namespace] = {
      sourceKeys: sourceKeys.length,
      targetKeys: targetKeys.length,
      missing: missing.length,
      unexpected: unexpected.length,
      empty: empty.length,
      interpolationMismatches: mismatch.length,
      coveragePercent: sourceKeys.length ? Number(((sourceKeys.length - missing.length - empty.length) / sourceKeys.length * 100).toFixed(2)) : 100,
    };
    localeCoverage.totalKeys += sourceKeys.length;
    localeCoverage.translatedKeys += sourceKeys.filter((key) => typeof target[key] === 'string' && target[key].trim().length > 0).length;
    localeCoverage.missingKeys.push(...missing.map((key) => `${namespace}.${key}`));
    localeCoverage.emptyKeys.push(...empty.map((key) => `${namespace}.${key}`));
    localeCoverage.interpolationMismatches.push(...mismatch.map((key) => `${namespace}.${key}`));

    if (missing.length || unexpected.length || empty.length || mismatch.length) {
      add('FAIL', `keys:${locale}:${namespace}`, `${namespace} resource for ${locale}: missing=${missing.length}, unexpected=${unexpected.length}, empty=${empty.length}, interpolation mismatches=${mismatch.length}.`);
    } else {
      add('PASS', `keys:${locale}:${namespace}`, `${sourceKeys.length} keys match the English source and have valid interpolation in ${locale}/${namespace}.`);
    }
  }

  localeCoverage.coveragePercent = localeCoverage.totalKeys
    ? Number((localeCoverage.translatedKeys / localeCoverage.totalKeys * 100).toFixed(2))
    : 0;
  localeCoverage.productionTranslationReview = locale === (registry.sourceLocale || 'en')
    ? 'CANONICAL_SOURCE_LOCALE'
    : localeCoverage.status === 'approved_for_production'
      ? 'APPROVED_BY_RECORDED_GOVERNANCE_STATUS'
      : 'PENDING_HUMAN_REVIEW';
  coverage[locale] = localeCoverage;
}

if (languageByCode.get('ar')?.direction !== 'rtl') {
  add('FAIL', 'arabic-direction', 'Arabic must be declared RTL in the locale registry.');
} else {
  add('PASS', 'arabic-direction', 'Arabic is declared RTL.');
}

// Static source scan: catches typos/missing keys where components call t('namespace.key').
const sourceRoot = path.join(ROOT, 'frontend/src');
const sourceFiles = listSourceFiles(sourceRoot);
const usedKeys = new Map();
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\s*\(\s*(['"])([A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+)\1/g)) {
    const fullKey = match[2];
    const splitAt = fullKey.indexOf('.');
    const namespace = fullKey.slice(0, splitAt);
    const key = fullKey.slice(splitAt + 1);
    const reference = `${namespace}.${key}`;
    if (!usedKeys.has(reference)) usedKeys.set(reference, []);
    usedKeys.get(reference).push(path.relative(ROOT, file));
    if (!expectedNamespaces.includes(`${namespace}.json`)) {
      add('FAIL', `source-key:${reference}`, `Referenced namespace ${namespace} is absent from the English resource catalog (${path.relative(ROOT, file)}).`);
      continue;
    }
    const sourceResource = readJson(path.join(LOCALES_ROOT, 'en', `${namespace}.json`));
    if (!Object.prototype.hasOwnProperty.call(sourceResource, key)) {
      add('FAIL', `source-key:${reference}`, `Referenced translation key is absent from English resources (${path.relative(ROOT, file)}).`);
    }
  }
}
add('PASS', 'source-key-references', `Scanned ${sourceFiles.length} frontend source files and found ${usedKeys.size} unique literal translation-key references; missing referenced keys are failures.`);

const report = {
  generatedAt: new Date().toISOString(),
  sourceLocale: 'en',
  defaultLocale: registry.defaultLocale || null,
  supportedLocales,
  resourceScope: 'Bundled common, auth and financial status namespaces only; source scan checks literal t("namespace.key") references but this is not a whole-application route coverage claim.',
  staticSourceFilesScanned: sourceFiles.length,
  uniqueLiteralKeyReferences: usedKeys.size,
  status: failures.length ? 'FAIL' : 'PASS',
  productionEligible: supportedLocales.every((locale) => languageByCode.get(locale)?.status === 'approved_for_production'),
  checks,
  failures,
  coverage,
};
fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, productionEligible: report.productionEligible, checks: checks.length, failures, coverage: Object.fromEntries(Object.entries(coverage).map(([locale, item]) => [locale, { percent: item.coveragePercent, translatedKeys: item.translatedKeys, totalKeys: item.totalKeys, review: item.productionTranslationReview }])), report: path.relative(ROOT, REPORT_PATH) }, null, 2));
if (failures.length) process.exitCode = 1;

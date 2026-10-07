#!/usr/bin/env node

/**
 * TITech Community Capital
 * Frontend runtime ownership / React bundle safety audit.
 *
 * This audit is intentionally dependency-free so it can run before npm install
 * and in constrained release-validation environments.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');
const INDEX_HTML = path.join(FRONTEND, 'index.html');
const VITE_CONFIG = path.join(FRONTEND, 'vite.config.js');
const NGINX_CONFIG = path.join(FRONTEND, 'nginx.conf');
const DIST = path.join(FRONTEND, 'dist');
const REPORT_DIR = path.join(ROOT, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'frontend-runtime-audit.json');

const results = [];
const errors = [];
const warnings = [];

function check(id, status, message, evidence = []) {
  const row = { id, status, message, evidence };
  results.push(row);
  if (status === 'FAIL') errors.push(row);
  if (status === 'WARN') warnings.push(row);
}

function walkFiles(directory) {
  const output = [];
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(full));
    else output.push(full);
  }
  return output;
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

function hasReactImport(source) {
  return /(?:^|\n)\s*import\s+React(?:\s*,|\s*\{|\s+from\s+["']react["'])/.test(source)
    || /import\s*\{[^}]*\bReact\b[^}]*\}\s*from\s*["']react["']/.test(source);
}

const indexHtml = read(INDEX_HTML);
const vite = read(VITE_CONFIG);
const nginx = read(NGINX_CONFIG);

check(
  'html-module-entry',
  /<script[^>]+type=["']module["'][^>]+src=["']\/src\/main\.jsx["']/.test(indexHtml) ? 'PASS' : 'FAIL',
  'TITech must bootstrap through the module-based Vite entrypoint.',
  ['frontend/index.html'],
);

check(
  'html-no-react-cdn',
  !/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^\n]*(?:react|react-dom)/i.test(indexHtml) ? 'PASS' : 'FAIL',
  'The app must not depend on a CDN/UMD React global.',
  ['frontend/index.html'],
);

check(
  'vite-react-plugin',
  /@vitejs\/plugin-react/.test(vite) && /jsxRuntime\s*:\s*["']automatic["']/.test(vite) ? 'PASS' : 'FAIL',
  'Vite must use the canonical React plugin with the automatic JSX runtime.',
  ['frontend/vite.config.js'],
);

check(
  'vite-no-react-externalization',
  !/external\s*:\s*[^\n]*(?:react|react-dom)/.test(vite) ? 'PASS' : 'FAIL',
  'React and ReactDOM must not be externalized into an assumed browser global.',
  ['frontend/vite.config.js'],
);

check(
  'vite-react-dedupe',
  /dedupe\s*:\s*\[[^\]]*["']react["'][^\]]*["']react-dom["']/.test(vite) ? 'PASS' : 'FAIL',
  'React and ReactDOM are explicitly deduplicated to prevent multiple-runtime identity defects.',
  ['frontend/vite.config.js'],
);

check(
  'vite-no-global-react-definition',
  !/(define\s*:\s*\{[^}]*\bReact\b|globalThis\.React\s*=|window\.React\s*=)/s.test(vite) ? 'PASS' : 'FAIL',
  'Vite must not manufacture a global React dependency as a workaround.',
  ['frontend/vite.config.js'],
);

check(
  'nginx-index-cache-policy',
  /location\s*=\s*\/index\.html[\s\S]*?Cache-Control\s+\"no-cache, no-store, must-revalidate\"/.test(nginx)
    ? 'PASS'
    : 'FAIL',
  'The HTML application shell must revalidate so new HTML cannot be paired with stale hashed JavaScript.',
  ['frontend/nginx.conf'],
);

check(
  'nginx-service-worker-cache-policy',
  /location\s*=\s*\/sw\.js[\s\S]*?Cache-Control\s+\"no-cache, no-store, must-revalidate\"/.test(nginx)
    ? 'PASS'
    : 'FAIL',
  'The service-worker script must revalidate so deployment updates cannot remain pinned to an old worker.',
  ['frontend/nginx.conf'],
);

const sourceFiles = walkFiles(SRC).filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));
const reactHazards = [];
const externalAssetReferences = [];

for (const file of sourceFiles) {
  const source = read(file);
  if (/\bReact\s*\./.test(source) && !hasReactImport(source)) {
    reactHazards.push(rel(file));
  }
  for (const match of source.matchAll(/chrome-extension:\/\/[^\s'"`<>)]*/g)) {
    externalAssetReferences.push({ file: rel(file), reference: match[0] });
  }
  if (/(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^\n]*(?:react|react-dom)/i.test(source)) {
    externalAssetReferences.push({ file: rel(file), reference: 'React CDN reference' });
  }
}

check(
  'source-react-imports',
  reactHazards.length === 0 ? 'PASS' : 'FAIL',
  reactHazards.length === 0
    ? 'No source module uses the React namespace without a React import.'
    : 'React namespace usage without an import can generate a bare browser global dependency.',
  reactHazards,
);

const manifests = walkFiles(ROOT).filter((file) => /(?:^|\/)manifest(?:\.v3)?\.json$/i.test(file));
const extensionIndicators = walkFiles(ROOT).filter((file) => /(?:chrome|extension|content-script|service-worker)/i.test(rel(file)));

if (manifests.length === 0 && externalAssetReferences.length === 0) {
  check(
    'extension-ownership',
    'PASS',
    'No TITech-owned Chrome extension manifest or source reference was found in the repository snapshot.',
    [],
  );
} else {
  check(
    'extension-ownership',
    'WARN',
    'Extension-like resources exist; browser-context ownership must be validated before treating chrome-extension:// diagnostics as TITech defects.',
    [...manifests.map(rel), ...extensionIndicators.slice(0, 20).map(rel)],
  );
}

check(
  'font-warning-safety',
  externalAssetReferences.filter((x) => x.reference.startsWith('chrome-extension://')).length === 0 ? 'PASS' : 'WARN',
  'TITech source contains no chrome-extension:// font dependency; browser-extension AdobeClean font warnings must remain externally classified unless an installed TITech extension proves ownership.',
  externalAssetReferences.filter((x) => x.reference.startsWith('chrome-extension://')),
);

if (fs.existsSync(DIST)) {
  const distFiles = walkFiles(DIST);
  const jsFiles = distFiles.filter((file) => /\.js$/.test(file));
  const mapFiles = distFiles.filter((file) => /\.js\.map$/.test(file));
  const htmlFiles = distFiles.filter((file) => /\.html$/.test(file));

  check(
    'dist-present',
    jsFiles.length > 0 ? 'PASS' : 'FAIL',
    'Production build output contains JavaScript assets.',
    jsFiles.map(rel),
  );

  const globalReactChunks = [];
  for (const file of jsFiles) {
    const source = read(file);
    if (/\bReact\.(?:createElement|jsx|jsxs|useState|useEffect)\b/.test(source)
      && !/(?:\b(?:var|let|const)\s+React\b|\bfunction\s+React\b|import\s+\*\s+as\s+React\s+from)/.test(source)) {
      globalReactChunks.push(rel(file));
    }
  }

  check(
    'dist-bare-react-global',
    globalReactChunks.length === 0 ? 'PASS' : 'FAIL',
    'Built assets must not contain an unresolved React namespace global.',
    globalReactChunks,
  );

  check(
    'dist-source-maps',
    mapFiles.length > 0 ? 'PASS' : 'WARN',
    'Source maps are recommended for staged incident diagnosis; production exposure remains deployment-policy dependent.',
    mapFiles.slice(0, 20).map(rel),
  );

  check(
    'dist-html',
    htmlFiles.length > 0 ? 'PASS' : 'WARN',
    'A built HTML document must be present for HTML-to-asset integrity checks.',
    htmlFiles.map(rel),
  );
} else {
  check(
    'dist-present',
    'WARN',
    'No frontend/dist directory exists in the supplied source snapshot; production bundle runtime evidence cannot be claimed here.',
    ['frontend/dist'],
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  status: errors.length ? 'FAIL' : warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS',
  summary: {
    checks: results.length,
    pass: results.filter((x) => x.status === 'PASS').length,
    warn: warnings.length,
    fail: errors.length,
  },
  conclusions: {
    adobeCleanChromeExtensionWarning: 'EXTERNAL_UNLESS_TITECH_EXTENSION_OWNERSHIP_IS_PROVEN',
    reactRuntimeError: 'BUNDLE_OR_RUNTIME_CONTEXT_MUST_BE_PROVEN_WITH_PRODUCTION_ARTIFACT_AND_CLEAN_BROWSER_PROFILE',
  },
  results,
};

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
process.exitCode = errors.length ? 1 : 0;

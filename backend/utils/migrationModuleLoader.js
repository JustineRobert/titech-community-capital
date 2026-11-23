import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInThisContext } from 'node:vm';

/**
 * Load historic CommonJS migrations without changing their filenames or
 * recorded migration versions. New ESM migrations are loaded natively.
 * Migration source remains repository-controlled executable code.
 */
export async function loadMigrationModule(filePath) {
  const absolutePath = path.resolve(filePath);
  const source = await readFile(absolutePath, 'utf8');

  if (!source.trim()) {
    throw new Error(`Migration file is empty: ${absolutePath}`);
  }

  const looksCommonJs = /\bmodule\.exports\b|\bexports\.[\w$]+\s*=|\brequire\s*\(/.test(source);
  if (!looksCommonJs || absolutePath.endsWith('.mjs')) {
    const moduleNamespace = await import(pathToFileURL(absolutePath).href);
    return moduleNamespace.default ?? moduleNamespace;
  }

  const localRequire = createRequire(absolutePath);
  const moduleRecord = { exports: {} };
  const wrapperSource = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
  const wrapper = runInThisContext(wrapperSource, { filename: absolutePath });
  wrapper(
    moduleRecord.exports,
    localRequire,
    moduleRecord,
    absolutePath,
    path.dirname(absolutePath),
  );

  return moduleRecord.exports;
}

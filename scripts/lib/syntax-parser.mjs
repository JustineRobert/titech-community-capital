const SCRIPT_KIND_NAMES = Object.freeze({
  '.js': 'JS',
  '.mjs': 'JS',
  '.cjs': 'JS',
  '.jsx': 'JSX',
  '.ts': 'TS',
  '.tsx': 'TSX',
});

// TypeScript's public ScriptKind enum has stable numeric values. The numeric
// fallback keeps the parser working with compiler builds that expose
// createSourceFile but omit the enum namespace from their public surface.
const SCRIPT_KIND_NUMBERS = Object.freeze({
  JS: 1,
  JSX: 2,
  TS: 3,
  TSX: 4,
});

export function scriptKindForExtension(typescript, extension) {
  const kindName = SCRIPT_KIND_NAMES[String(extension).toLowerCase()];
  if (!kindName) {
    throw new TypeError(`Unsupported syntax-gate extension: ${extension}`);
  }

  const publicKind = typescript?.ScriptKind?.[kindName];
  if (Number.isInteger(publicKind)) return publicKind;

  const fallback = SCRIPT_KIND_NUMBERS[kindName];
  if (!Number.isInteger(fallback)) {
    throw new Error(`No TypeScript ScriptKind mapping exists for ${extension}.`);
  }

  return fallback;
}

export function parseSourceFile(typescript, fileName, source) {
  if (typeof typescript?.createSourceFile !== 'function') {
    throw new TypeError('The installed TypeScript package does not expose createSourceFile().');
  }

  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const scriptKind = scriptKindForExtension(typescript, extension);
  const target = typescript.ScriptTarget?.Latest ?? typescript.ScriptTarget?.ESNext ?? 99;

  return typescript.createSourceFile(fileName, source, target, true, scriptKind);
}

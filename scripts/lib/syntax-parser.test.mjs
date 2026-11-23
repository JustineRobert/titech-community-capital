import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceFile, scriptKindForExtension } from './syntax-parser.mjs';

const enumApi = {
  ScriptKind: { JS: 1, JSX: 2, TS: 3, TSX: 4 },
  ScriptTarget: { Latest: 99 },
  createSourceFile(fileName, source, target, setParentNodes, scriptKind) {
    return { fileName, source, target, setParentNodes, scriptKind, parseDiagnostics: [] };
  },
};

test('syntax parser selects correct TypeScript script kind for every supported extension', () => {
  const expected = new Map([
    ['.js', 1], ['.mjs', 1], ['.cjs', 1], ['.jsx', 2], ['.ts', 3], ['.tsx', 4],
  ]);
  for (const [extension, kind] of expected) {
    assert.equal(scriptKindForExtension(enumApi, extension), kind);
  }
});

test('syntax parser uses stable ScriptKind numbers when the enum namespace is absent', () => {
  const compilerWithoutEnum = { createSourceFile: enumApi.createSourceFile };
  assert.equal(scriptKindForExtension(compilerWithoutEnum, '.js'), 1);
  assert.equal(scriptKindForExtension(compilerWithoutEnum, '.jsx'), 2);
  assert.equal(scriptKindForExtension(compilerWithoutEnum, '.ts'), 3);
  assert.equal(scriptKindForExtension(compilerWithoutEnum, '.tsx'), 4);
});

test('syntax parser invokes createSourceFile with the mapped language kind', () => {
  const parsed = parseSourceFile(enumApi, 'src/App.tsx', 'const App = () => <main />;');
  assert.equal(parsed.scriptKind, enumApi.ScriptKind.TSX);
  assert.equal(parsed.target, enumApi.ScriptTarget.Latest);
  assert.equal(parsed.setParentNodes, true);
});

test('unsupported file extensions fail instead of being silently skipped', () => {
  assert.throws(() => scriptKindForExtension(enumApi, '.vue'), /Unsupported syntax-gate extension/);
});

test('missing compiler parser API fails explicitly', () => {
  assert.throws(() => parseSourceFile({}, 'src/App.ts', ''), /does not expose createSourceFile/);
});

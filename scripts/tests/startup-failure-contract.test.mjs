import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../../backend/server.js', import.meta.url), 'utf8');
const hooks = await readFile(new URL('../../backend/bootstrap/hooks.js', import.meta.url), 'utf8');
const loggerConfig = await readFile(new URL('../../backend/config/logger.js', import.meta.url), 'utf8');

function extract(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Expected source marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `Expected source end marker: ${end}`);
  return source.slice(from, to);
}

test('ordinary direct-start rejection preserves the original safe error and uses a non-zero exit code without process.exit', () => {
  const failureHandler = extract(
    server,
    'if (isDirectExecution()) {\n  startServer().catch((error) => {',
    '/* =============================================================================\n * ESM PUBLIC API',
  );
  assert.match(failureHandler, /sanitizeValue\(error\)/);
  assert.match(failureHandler, /processStartupStatus\s*=\s*STARTUP_STATUS\.FAILED/);
  assert.match(failureHandler, /process\.exitCode\s*=\s*FATAL_EXIT_CODE/);
  assert.doesNotMatch(failureHandler, /process\.exit\s*\(/);
});

test('server startup diagnostics do not assume readiness when bootstrap readiness is absent', () => {
  assert.match(server, /ready:\s*Boolean\(bootstrap\.ready\s*\?\?\s*bootstrap\.isReady\?\.\(\)\)/);
  assert.doesNotMatch(server, /bootstrap\.isReady\?\.\(\)\s*\?\?\s*true/);
});

test('graceful signal handling cannot overwrite an existing non-zero startup failure status', () => {
  const signalHandler = extract(
    hooks,
    'const handler = async (signal) => {',
    'signalHandlerReferences.push({',
  );
  assert.match(signalHandler, /process\.exitCode\s*===\s*undefined/);
  assert.match(signalHandler, /process\.exitCode\s*===\s*null/);
  assert.match(signalHandler, /process\.exitCode\s*===\s*0/);
  assert.match(signalHandler, /process\.exitCode\s*=\s*0/);
  assert.match(signalHandler, /process\.exitCode\s*=\s*1/);
});

test('backend logging identity has one canonical application and service default', () => {
  assert.match(loggerConfig, /process\.env\.SERVICE_NAME\s*\|\|\s*'titech-community-capital-backend'/);
  assert.match(loggerConfig, /process\.env\.APP_NAME\s*\|\|\s*'TITech Community Capital'/);
});

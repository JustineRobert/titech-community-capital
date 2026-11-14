import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Vercel routes JSON group API requests to backend while preserving browser deep links', async () => {
  const config = JSON.parse(await read('../../frontend/vercel.json'));
  const rewrites = config.rewrites;
  assert.equal(rewrites.at(-1).source, '/(.*)');
  assert.equal(rewrites.at(-1).destination, '/index.html');
  const exact = rewrites.find((rule) => rule.source === '/groups');
  const nested = rewrites.find((rule) => rule.source === '/groups/:path*');
  for (const rule of [exact, nested]) {
    assert.ok(rule);
    assert.equal(rule.destination, rule.source === '/groups' ? '/api/groups' : '/api/groups/:path*');
    assert.equal(rule.has?.[0]?.type, 'header');
    assert.equal(rule.has?.[0]?.key, 'accept');
    assert.ok((rule.has?.[0]?.value?.re || '').includes('application/json'));
  }
});

test('same-origin API bridge is server-configured and fails closed without public upstream configuration', async () => {
  const proxy = await read('../../frontend/api/[...path].js');
  const productionEnv = await read('../../frontend/.env.production.example');
  assert.match(proxy, /process\.env\.TITECH_API_ORIGIN/);
  assert.doesNotMatch(proxy, /request\.headers\.get\(['"]x-forwarded-host/);
  assert.match(proxy, /API_PROXY_NOT_CONFIGURED/);
  assert.match(proxy, /MAX_REQUEST_BYTES/);
  assert.match(proxy, /AbortSignal\.timeout/);
  assert.match(productionEnv, /TITECH_API_ORIGIN/);
  assert.match(productionEnv, /server-side/);
  assert.doesNotMatch(productionEnv, /^VITE_TITECH_API_ORIGIN=/m);
});

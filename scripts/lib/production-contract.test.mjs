import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiOrigin, verifyProductionContract } from './production-contract.mjs';

function response(status, payload, contentType = 'application/json; charset=utf-8') {
  return new Response(payload === undefined ? null : JSON.stringify(payload), {
    status,
    headers: { 'content-type': contentType },
  });
}

test('production origin requires HTTPS and rejects credentials, paths and query strings', () => {
  assert.equal(normalizeApiOrigin('https://api.titech.test/', 'production'), 'https://api.titech.test');
  assert.throws(() => normalizeApiOrigin('http://api.titech.test', 'production'), /HTTPS origin/);
  assert.throws(() => normalizeApiOrigin('https://user:pass@api.titech.test', 'production'), /HTTPS origin/);
  assert.throws(() => normalizeApiOrigin('https://api.titech.test/api', 'production'), /HTTPS origin/);
  assert.equal(normalizeApiOrigin('http://127.0.0.1:5000', 'local'), 'http://127.0.0.1:5000');
  assert.throws(() => normalizeApiOrigin('http://127.0.0.1:5000', 'staging'), /HTTPS origin/);
});

test('transport verifier passes only when health, readiness and auth routes return JSON', async () => {
  const seen = [];
  const result = await verifyProductionContract({
    origin: 'https://api.titech.test',
    mode: 'production',
    fetchImpl: async (url, options) => {
      seen.push({ pathname: new URL(url).pathname, method: options.method });
      if (new URL(url).pathname.endsWith('/health')) return response(200, { success: true, status: 'healthy' });
      if (new URL(url).pathname.endsWith('/ready')) return response(200, { success: true, status: 'ready' });
      return response(401, { code: 'INVALID_CREDENTIALS' });
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.checks.length, 3);
  assert.deepEqual(seen.map((item) => item.method), ['GET', 'GET', 'POST']);
});

test('transport verifier rejects an HTML SPA fallback for API paths', async () => {
  await assert.rejects(
    verifyProductionContract({
      origin: 'https://app.titech.test',
      fetchImpl: async () => response(200, '<html>Application</html>', 'text/html'),
    }),
    /CONTENT_TYPE_FAILURE/,
  );
});

test('transport verifier distinguishes a missing API route', async () => {
  await assert.rejects(
    verifyProductionContract({
      origin: 'https://app.titech.test',
      fetchImpl: async () => response(404, { code: 'NOT_FOUND' }),
    }),
    /ROUTING_FAILURE/,
  );
});

test('transport verifier rejects a backend that is not ready', async () => {
  let counter = 0;
  await assert.rejects(
    verifyProductionContract({
      origin: 'https://api.titech.test',
      fetchImpl: async () => {
        counter += 1;
        return counter === 1 ? response(200, { success: true, status: 'healthy' }) : response(503, { success: false, status: 'not_ready' });
      },
    }),
    /UPSTREAM_OR_APPLICATION_FAILURE/,
  );
});


test('transport verifier rejects HTTP 200 when health payload is unhealthy', async () => {
  await assert.rejects(
    verifyProductionContract({
      origin: 'https://api.titech.test',
      fetchImpl: async () => response(200, { success: false, status: 'unhealthy' }),
    }),
    /HEALTH_PAYLOAD_FAILURE/,
  );
});

test('transport verifier rejects HTTP 200 when readiness payload is not ready', async () => {
  let counter = 0;
  await assert.rejects(
    verifyProductionContract({
      origin: 'https://api.titech.test',
      fetchImpl: async () => {
        counter += 1;
        return counter === 1
          ? response(200, { success: true, status: 'healthy' })
          : response(200, { success: false, status: 'not_ready' });
      },
    }),
    /READINESS_PAYLOAD_FAILURE/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../api/[...path].js';

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('same-origin API bridge forwards method, query, auth, cookies and request body', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, groupId: 'group-123' }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'backend-request-1',
        'set-cookie': 'refreshToken=opaque; Domain=api.example.test; Path=/; HttpOnly; Secure; SameSite=None',
      },
    });
  };

  try {
    await withEnvironment({
      TITECH_API_ORIGIN: 'https://api.example.test',
      NODE_ENV: 'test',
    }, async () => {
      const response = await POST(new Request('https://app.example.test/api/groups?limit=10', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-access-token',
          cookie: 'refreshToken=opaque',
          'content-type': 'application/json',
          'idempotency-key': 'create-group-001',
          origin: 'https://app.example.test',
        },
        body: JSON.stringify({ name: 'Test Group' }),
      }));

      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), { success: true, groupId: 'group-123' });
      assert.equal(captured.url, 'https://api.example.test/api/groups?limit=10');
      assert.equal(captured.options.method, 'POST');
      assert.equal(captured.options.headers.get('authorization'), 'Bearer test-access-token');
      assert.equal(captured.options.headers.get('cookie'), 'refreshToken=opaque');
      assert.equal(captured.options.headers.get('idempotency-key'), 'create-group-001');
      assert.equal(new TextDecoder().decode(captured.options.body), JSON.stringify({ name: 'Test Group' }));
      assert.equal(response.headers.get('x-request-id'), 'backend-request-1');
      assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
      assert.match(response.headers.get('set-cookie') || '', /SameSite=None/);
      assert.doesNotMatch(response.headers.get('set-cookie') || '', /Domain=/i);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API bridge fails closed with a useful 503 when backend origin is not configured', async () => {
  await withEnvironment({ TITECH_API_ORIGIN: undefined, NODE_ENV: 'production' }, async () => {
    const response = await GET(new Request('https://app.example.test/api/v1/health'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'API_PROXY_NOT_CONFIGURED');
  });
});

test('API bridge rejects insecure non-local backend origins in production', async () => {
  await withEnvironment({ TITECH_API_ORIGIN: 'http://api.example.test', NODE_ENV: 'production' }, async () => {
    const response = await GET(new Request('https://app.example.test/api/v1/health'));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'API_PROXY_CONFIGURATION_INVALID');
  });
});

test('API bridge returns a safe upstream-unavailable response and does not leak origin details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('connect ECONNREFUSED api.example.test:443 private details');
  };
  try {
    await withEnvironment({ TITECH_API_ORIGIN: 'https://api.example.test', NODE_ENV: 'test' }, async () => {
      const response = await GET(new Request('https://app.example.test/api/v1/ready'));
      assert.equal(response.status, 502);
      const payload = await response.json();
      assert.equal(payload.code, 'API_UPSTREAM_UNAVAILABLE');
      assert.doesNotMatch(JSON.stringify(payload), /api\.example\.test|ECONNREFUSED/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API bridge enforces request body size before contacting the backend', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}');
  };
  try {
    await withEnvironment({ TITECH_API_ORIGIN: 'https://api.example.test', NODE_ENV: 'test' }, async () => {
      const response = await POST(new Request('https://app.example.test/api/groups', {
        method: 'POST',
        headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
        body: 'too-large',
      }));
      assert.equal(response.status, 413);
      assert.equal((await response.json()).code, 'API_PROXY_REQUEST_TOO_LARGE');
      assert.equal(called, false);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('API bridge safely forwards empty 204 and 304 upstream responses', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamStatus = 204;
  globalThis.fetch = async () => new Response(null, { status: upstreamStatus });

  try {
    await withEnvironment({
      TITECH_API_ORIGIN: 'https://api.example.test',
      NODE_ENV: 'test',
    }, async () => {
      const noContent = await GET(new Request('https://app.example.test/api/v1/health'));
      assert.equal(noContent.status, 204);
      assert.equal(await noContent.text(), '');

      upstreamStatus = 304;
      const notModified = await GET(new Request('https://app.example.test/api/v1/health'));
      assert.equal(notModified.status, 304);
      assert.equal(await notModified.text(), '');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

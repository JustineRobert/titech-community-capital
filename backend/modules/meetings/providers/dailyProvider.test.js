import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyProvider, dailyConfiguration } from './dailyProvider.js';

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('Daily provider remains unavailable without server-only credentials', async () => {
  const provider = createDailyProvider({ env: {} });
  assert.deepEqual(provider.status(), {
    provider: 'DAILY', configured: false, status: 'UNAVAILABLE', reason: 'DAILY_API_KEY and DAILY_DOMAIN are required.',
  });
  await assert.rejects(provider.ensureRoom({ meetingId: 'meeting1' }), { code: 'VIDEO_PROVIDER_NOT_CONFIGURED', statusCode: 503 });
});

test('Daily configuration rejects non-HTTPS, untrusted and path-bearing domains', () => {
  assert.equal(dailyConfiguration({ DAILY_API_KEY: 'server-secret', DAILY_DOMAIN: 'https://example.com' }).configured, false);
  assert.equal(dailyConfiguration({ DAILY_API_KEY: 'server-secret', DAILY_DOMAIN: 'https://demo.daily.co/path' }).configured, false);
  assert.equal(dailyConfiguration({ DAILY_API_KEY: 'server-secret', DAILY_DOMAIN: 'demo.daily.co' }).configured, true);
});

test('room provisioning is private, reuses the canonical room and does not enable recording', async () => {
  const calls = [];
  const now = () => Date.parse('2026-10-19T10:00:00Z');
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return response(404, {});
    const body = JSON.parse(options.body);
    return response(200, { name: body.name, url: `https://demo.daily.co/${body.name}` });
  };
  const provider = createDailyProvider({ env: { DAILY_API_KEY: 'test-secret', DAILY_DOMAIN: 'demo.daily.co' }, fetchImpl, now });
  const room = await provider.ensureRoom({ meetingId: 'Meeting_0123', scheduledStart: '2026-10-19T11:00:00Z', scheduledEnd: '2026-10-19T12:00:00Z' });
  assert.equal(room.provider, 'DAILY');
  assert.match(room.roomName, /^tt-meeting0123$/);
  const createBody = JSON.parse(calls[1].options.body);
  assert.equal(createBody.privacy, 'private');
  assert.equal(createBody.properties.enable_recording, undefined);
  assert.equal(createBody.properties.enable_transcription, undefined);
  assert.equal(createBody.properties.enable_chat, false);
  assert.equal(createBody.properties.enable_knocking, true);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer test-secret'));
});

test('Daily join tokens are short-lived, room-scoped and non-owner by default', async () => {
  const calls = [];
  const provider = createDailyProvider({
    env: { DAILY_API_KEY: 'test-secret', DAILY_DOMAIN: 'demo.daily.co' },
    now: () => Date.parse('2026-10-19T10:00:00Z'),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, { token: 'short-lived-token-value-over-20-chars' });
    },
  });
  const grant = await provider.createJoinToken({ roomName: 'tt-meeting1', actorId: 'user-123', displayName: 'Test User' });
  const payload = JSON.parse(calls[0].options.body).properties;
  assert.equal(payload.room_name, 'tt-meeting1');
  assert.equal(payload.is_owner, false);
  assert.equal(payload.user_id, 'user-123');
  assert.equal(payload.exp - payload.nbf, 15 * 60 + 15);
  assert.equal(payload.eject_at_token_exp, false);
  assert.equal(grant.expiresAt, '2026-10-19T10:15:00.000Z');
});

test('provider rejects malformed join-token responses', async () => {
  const provider = createDailyProvider({
    env: { DAILY_API_KEY: 'test-secret', DAILY_DOMAIN: 'demo.daily.co' },
    fetchImpl: async () => response(200, { token: 'short' }),
  });
  await assert.rejects(provider.createJoinToken({ roomName: 'tt-test', actorId: 'u1' }), { code: 'VIDEO_PROVIDER_TOKEN_INVALID' });
});

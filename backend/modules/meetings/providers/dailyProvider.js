/** Daily REST API adapter. Secrets remain server-side; no recordings/transcription are enabled. */
const API_BASE = 'https://api.daily.co/v1';

function providerError(message, code = 'VIDEO_PROVIDER_ERROR', statusCode = 502) {
  return Object.assign(new Error(message), { code, statusCode });
}

function configuration(env) {
  const apiKey = String(env.DAILY_API_KEY || '').trim();
  const domainRaw = String(env.DAILY_DOMAIN || '').trim();
  if (!apiKey || !domainRaw) return { configured: false, reason: 'DAILY_API_KEY and DAILY_DOMAIN are required.' };
  let domainUrl;
  try {
    domainUrl = new URL(domainRaw.includes('://') ? domainRaw : `https://${domainRaw}`);
  } catch {
    return { configured: false, reason: 'DAILY_DOMAIN must be a valid HTTPS Daily domain.' };
  }
  if (domainUrl.protocol !== 'https:' || !domainUrl.hostname.endsWith('.daily.co') || domainUrl.username || domainUrl.password || domainUrl.port || domainUrl.pathname !== '/' || domainUrl.search || domainUrl.hash) {
    return { configured: false, reason: 'DAILY_DOMAIN must be an HTTPS *.daily.co domain without a path.' };
  }
  return { configured: true, apiKey, domainUrl: new URL(`https://${domainUrl.hostname}`) };
}

export function createDailyProvider({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  function status() {
    const config = configuration(env);
    return { provider: 'DAILY', configured: config.configured, status: config.configured ? 'CONFIGURED_NOT_LIVE_VERIFIED' : 'UNAVAILABLE', reason: config.reason || null };
  }

  async function request(path, { method = 'GET', body } = {}) {
    const config = configuration(env);
    if (!config.configured) throw providerError('Video conferencing is not configured.', 'VIDEO_PROVIDER_NOT_CONFIGURED', 503);
    if (typeof fetchImpl !== 'function') throw providerError('Server fetch support is unavailable.', 'VIDEO_PROVIDER_CLIENT_UNAVAILABLE', 503);
    let response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw providerError('The video provider could not be reached.', 'VIDEO_PROVIDER_UNREACHABLE', 503);
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* Provider error body is untrusted. */ }
    if (!response.ok) {
      if (response.status === 404 && method === 'GET') return null;
      throw providerError('The video provider rejected the request.', response.status === 429 ? 'VIDEO_PROVIDER_RATE_LIMITED' : 'VIDEO_PROVIDER_REQUEST_FAILED', response.status === 429 ? 503 : 502);
    }
    return payload;
  }

  async function ensureRoom({ meetingId, scheduledStart, scheduledEnd }) {
    const config = configuration(env);
    if (!config.configured) throw providerError('Video conferencing is not configured.', 'VIDEO_PROVIDER_NOT_CONFIGURED', 503);
    const roomName = `tt-${String(meetingId).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90)}`;
    if (roomName.length < 5) throw providerError('Meeting identifier cannot be mapped to a provider room.', 'VIDEO_ROOM_NAME_INVALID', 422);
    const nowSeconds = Math.floor(now() / 1000);
    const startSeconds = Math.max(nowSeconds, scheduledStart ? Math.floor(new Date(scheduledStart).getTime() / 1000) - 900 : nowSeconds);
    const endValue = scheduledEnd ? new Date(scheduledEnd).getTime() : now() + 2 * 60 * 60 * 1000;
    const expirySeconds = Math.max(nowSeconds + 3600, Math.floor(endValue / 1000) + 7200);
    let room = await request(`/rooms/${encodeURIComponent(roomName)}`);
    if (!room) {
      room = await request('/rooms', {
        method: 'POST',
        body: {
          name: roomName,
          privacy: 'private',
          properties: {
            nbf: startSeconds,
            exp: expirySeconds,
            enable_prejoin_ui: true,
            enable_knocking: true,
            enable_screenshare: true,
            enable_chat: false,
            enforce_unique_user_ids: true,
          },
        },
      });
    }
    const url = new URL(`/${encodeURIComponent(roomName)}`, config.domainUrl).toString();
    if (room?.name && room.name !== roomName) throw providerError('Provider room identity did not match the requested room.', 'VIDEO_ROOM_IDENTITY_MISMATCH');
    if (room?.url) {
      const returned = new URL(room.url);
      if (returned.protocol !== 'https:' || returned.hostname !== config.domainUrl.hostname || returned.pathname.replace(/\/$/, '') !== `/${roomName}`) {
        throw providerError('Provider returned an unexpected room URL.', 'VIDEO_ROOM_URL_INVALID');
      }
    }
    return { provider: 'DAILY', roomName, roomUrl: url };
  }

  async function createJoinToken({ roomName, actorId, displayName, isOwner = false }) {
    const nowSeconds = Math.floor(now() / 1000);
    const tokenExpiresAt = nowSeconds + 15 * 60;
    const response = await request('/meeting-tokens', {
      method: 'POST',
      body: {
        properties: {
          room_name: roomName,
          user_id: String(actorId).slice(0, 128),
          user_name: String(displayName || 'TITech participant').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80),
          is_owner: Boolean(isOwner),
          nbf: nowSeconds - 15,
          exp: tokenExpiresAt,
          // Token expiry limits new joins; do not eject people mid-meeting.
          eject_at_token_exp: false,
          enable_screenshare: true,
        },
      },
    });
    if (typeof response?.token !== 'string' || response.token.length < 20) {
      throw providerError('Video provider did not return a valid short-lived join token.', 'VIDEO_PROVIDER_TOKEN_INVALID');
    }
    return { token: response.token, expiresAt: new Date(tokenExpiresAt * 1000).toISOString() };
  }

  return Object.freeze({ status, ensureRoom, createJoinToken });
}

const dailyProvider = createDailyProvider();
export { configuration as dailyConfiguration };
export default dailyProvider;

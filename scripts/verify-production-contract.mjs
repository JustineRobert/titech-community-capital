#!/usr/bin/env node
const origin = String(process.env.TITECH_PRODUCTION_API_ORIGIN || '').trim().replace(/\/+$/, '');
if (!origin) {
  console.error('TITech production verification requires TITECH_PRODUCTION_API_ORIGIN.');
  console.error('Example: TITECH_PRODUCTION_API_ORIGIN=https://api.example.com npm run verify:production');
  process.exitCode = 1;
  process.exit();
}

async function check(pathname, expectedStatuses, options = {}) {
  const url = `${origin}${pathname}`;
  const response = await fetch(url, { redirect: 'manual', ...options });
  const body = await response.text();
  console.log(`${options.method || 'GET'} ${pathname} -> ${response.status}`);
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${url} returned ${response.status}; expected ${expectedStatuses.join(', ')}. Body: ${body.slice(0, 200)}`);
  }
}

try {
  await check('/api/v1/health', [200]);
  await check('/api/v1/ready', [200]);
  await check('/api/auth/login', [400, 401, 403, 422, 429, 500, 503], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid-test@example.invalid', password: 'invalid-test' }),
  });
  console.log('TITech production runtime/auth transport contract: PASSED (health=200, readiness=200, login route reachable)');
} catch (error) {
  console.error('TITech production transport contract: FAILED');
  console.error(error?.message || error);
  process.exitCode = 1;
}

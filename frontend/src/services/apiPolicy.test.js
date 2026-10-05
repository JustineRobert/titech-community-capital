import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import {
  getToken,
  clearToken,
  setToken,
  shouldRetryRequest,
} from './api.js';

import {
  setApiConnectivityDegraded,
  setApiConnectivityReady,
} from './runtimeConnectivity.js';

describe('TITech API runtime safety policy', () => {
  beforeEach(() => {
    clearToken();
    setApiConnectivityReady({ status: 200 });
  });

  afterEach(() => {
    clearToken();
    setApiConnectivityReady({ status: 200 });
  });

  it('keeps access tokens memory-only', () => {
    const token = 'memory-only-test-token';
    setToken(token);

    expect(getToken()).toBe(token);
    expect(window.localStorage.getItem('accessToken')).toBeNull();
    expect(window.sessionStorage.getItem('accessToken')).toBeNull();
  });

  it('does not retry network failures once the shared API is degraded', () => {
    setApiConnectivityDegraded({
      status: 503,
      code: 'ERR_NETWORK',
    });

    expect(
      shouldRetryRequest(
        { method: 'get', url: '/api/notifications' },
        { code: 'ERR_NETWORK' },
      ),
    ).toBe(false);

    expect(
      shouldRetryRequest(
        { method: 'post', url: '/api/payments' },
        { code: 'ERR_NETWORK' },
      ),
    ).toBe(false);
  });

  it('allows safe network retry only while API was previously ready', () => {
    setApiConnectivityReady({ status: 200 });

    expect(
      shouldRetryRequest(
        { method: 'get', url: '/api/notifications' },
        { code: 'ERR_NETWORK' },
      ),
    ).toBe(true);
  });

  it('requires an idempotency key for mutation retries', () => {
    setApiConnectivityReady({ status: 200 });

    expect(
      shouldRetryRequest(
        { method: 'post', url: '/api/payments' },
        { response: { status: 503 } },
      ),
    ).toBe(false);

    expect(
      shouldRetryRequest(
        {
          method: 'post',
          url: '/api/payments',
          headers: { 'Idempotency-Key': 'payment-123' },
        },
        { response: { status: 503 } },
      ),
    ).toBe(true);
  });

  it('records offline degradation without treating it as a ready API', () => {
    const state = setApiConnectivityDegraded({
      offline: true,
      code: 'CLIENT_OFFLINE',
    });

    expect(state.ready).toBe(false);
    expect(state.status).toBe('OFFLINE');
  });
});

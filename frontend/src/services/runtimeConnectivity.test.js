import {
  API_CONNECTIVITY_STATUS,
  getApiConnectivityState,
  onApiConnectivityChange,
  probeApiConnectivity,
  setApiConnectivityDegraded,
  setApiConnectivityReady,
  setBrowserConnectivity,
} from './runtimeConnectivity.js';

describe('runtime connectivity state', () => {
  afterEach(() => {
    setApiConnectivityReady({ status: 200, latencyMs: 1 });
  });

  it('tracks browser offline state without fabricating API readiness', () => {
    const next = setBrowserConnectivity(false);

    expect(next.status).toBe(API_CONNECTIVITY_STATUS.OFFLINE);
    expect(next.ready).toBe(false);
    expect(next.lastErrorCode).toBe('CLIENT_OFFLINE');
  });

  it('tracks API degraded state explicitly', () => {
    const next = setApiConnectivityDegraded({
      status: 503,
      code: 'HTTP_5XX',
      message: 'Service unavailable',
    });

    expect(next.status).toBe(API_CONNECTIVITY_STATUS.DEGRADED);
    expect(next.ready).toBe(false);
    expect(next.lastHttpStatus).toBe(503);
    expect(next.lastErrorCode).toBe('HTTP_5XX');
  });

  it('deduplicates concurrent readiness probes', async () => {
    let calls = 0;
    let release;

    const probe = new Promise((resolve) => {
      release = resolve;
    });

    const probeFn = async () => {
      calls += 1;
      await probe;
      return { healthy: true, status: 200, latency: 4 };
    };

    const first = probeApiConnectivity(probeFn, { force: true });
    const second = probeApiConnectivity(probeFn, { force: true });

    expect(calls).toBe(1);

    release();

    const [firstState, secondState] = await Promise.all([first, second]);

    expect(firstState.status).toBe(API_CONNECTIVITY_STATUS.READY);
    expect(secondState.status).toBe(API_CONNECTIVITY_STATUS.READY);
    expect(getApiConnectivityState().ready).toBe(true);
  });

  it('notifies subscribers and allows deterministic cleanup', () => {
    const seen = [];
    const unsubscribe = onApiConnectivityChange((state) => {
      seen.push(state.status);
    });

    setApiConnectivityDegraded({ status: 503, code: 'HTTP_5XX' });
    unsubscribe();
    setApiConnectivityReady({ status: 200 });

    expect(seen[0]).toBe(API_CONNECTIVITY_STATUS.READY);
    expect(seen).toContain(API_CONNECTIVITY_STATUS.DEGRADED);
    expect(seen.at(-1)).toBe(API_CONNECTIVITY_STATUS.DEGRADED);
  });
});

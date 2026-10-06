import {
  API_CONNECTIVITY_STATUS,
  getApiConnectivityState,
  onApiConnectivityChange,
  probeApiConnectivity,
  setApiConnectivityDegraded,
  setApiConnectivityReady,
  setApiConnectivityReachable,
  setApiConnectivityUnavailable,
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
    expect(next.apiReachable).toBe(false);
    expect(next.lastErrorCode).toBe('CLIENT_OFFLINE');
  });

  it('distinguishes reachable-but-not-ready from unavailable', () => {
    const reachable = setApiConnectivityReachable({ status: 200 });
    expect(reachable.status).toBe(API_CONNECTIVITY_STATUS.API_REACHABLE);
    expect(reachable.apiReachable).toBe(true);
    expect(reachable.ready).toBe(false);

    const degraded = setApiConnectivityDegraded({
      status: 503,
      code: 'API_NOT_READY',
      message: 'Service is alive but not ready',
    });
    expect(degraded.status).toBe(API_CONNECTIVITY_STATUS.API_DEGRADED);
    expect(degraded.apiReachable).toBe(true);
    expect(degraded.ready).toBe(false);

    const unavailable = setApiConnectivityUnavailable({
      code: 'ERR_NETWORK',
      message: 'Connection refused',
    });
    expect(unavailable.status).toBe(API_CONNECTIVITY_STATUS.API_UNAVAILABLE);
    expect(unavailable.apiReachable).toBe(false);
  });

  it('classifies a live but not-ready readiness probe as degraded', async () => {
    const result = await probeApiConnectivity(
      async () => ({
        healthy: false,
        reachable: false,
        unavailable: false,
        status: 503,
        code: 'API_NOT_READY',
      }),
      { force: true },
    );

    expect(result.status).toBe(API_CONNECTIVITY_STATUS.API_DEGRADED);
    expect(result.ready).toBe(false);
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


  it('coalesces a first recovery probe even when forced by multiple callers', async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return { healthy: true, status: 200, latency: 3 };
    };

    await Promise.all([
      probeApiConnectivity(probe, { force: true }),
      probeApiConnectivity(probe, { force: true }),
    ]);

    expect(calls).toBe(1);
  });

  it('coalesces forced recovery probes into one in-flight call', async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return { healthy: true, status: 200, latency: 3 };
    };

    await Promise.all([
      probeApiConnectivity(probe, { force: true }),
      probeApiConnectivity(probe, { force: true }),
    ]);

    expect(calls).toBe(1);
  });

  it('notifies subscribers and allows deterministic cleanup', () => {
    const seen = [];
    const unsubscribe = onApiConnectivityChange((nextState) => {
      seen.push(nextState.status);
    });

    setApiConnectivityDegraded({ status: 503, code: 'API_NOT_READY' });
    unsubscribe();
    setApiConnectivityReady({ status: 200 });

    expect(seen[0]).toBe(API_CONNECTIVITY_STATUS.READY);
    expect(seen).toContain(API_CONNECTIVITY_STATUS.API_DEGRADED);
    expect(seen.at(-1)).toBe(API_CONNECTIVITY_STATUS.API_DEGRADED);
  });
});

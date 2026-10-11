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
    await Promise.resolve(); // the probe intentionally begins in the next microtask

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

    const recovery = Promise.all([
      probeApiConnectivity(probe, { force: true }),
      probeApiConnectivity(probe, { force: true }),
    ]);
    await Promise.resolve(); // verify coalescing after the deferred probe starts
    expect(calls).toBe(1);
    await recovery;
  });

  it('coalesces forced recovery probes into one in-flight call', async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return { healthy: true, status: 200, latency: 3 };
    };

    const recovery = Promise.all([
      probeApiConnectivity(probe, { force: true }),
      probeApiConnectivity(probe, { force: true }),
    ]);
    await Promise.resolve(); // verify coalescing after the deferred probe starts
    expect(calls).toBe(1);
    await recovery;
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


  it('does not let an in-flight READY response overwrite an offline transition', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const running = probeApiConnectivity(async () => {
      await pending;
      return { healthy: true, status: 200, latency: 9 };
    }, { force: true });

    setBrowserConnectivity(false);
    release();
    const result = await running;

    expect(result.status).toBe(API_CONNECTIVITY_STATUS.OFFLINE);
    expect(getApiConnectivityState().status).toBe(API_CONNECTIVITY_STATUS.OFFLINE);
    expect(getApiConnectivityState().ready).toBe(false);
  });

  it('does not let an older readiness result overwrite a newer API failure', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const running = probeApiConnectivity(async () => {
      await pending;
      return { healthy: true, status: 200, latency: 11 };
    }, { force: true });

    setApiConnectivityUnavailable({ code: 'NEWER_FAILURE', message: 'A newer request failed.' });
    release();
    const result = await running;

    expect(result.status).toBe(API_CONNECTIVITY_STATUS.API_UNAVAILABLE);
    expect(result.lastErrorCode).toBe('NEWER_FAILURE');
    expect(result.ready).toBe(false);
  });


  it('aborts the active probe when the browser goes offline', async () => {
    let release;
    let requestSignal;
    const pending = new Promise((resolve) => { release = resolve; });
    const running = probeApiConnectivity(async (signal) => {
      requestSignal = signal;
      await pending;
      return { healthy: true, status: 200, latency: 8 };
    }, { force: true });

    await Promise.resolve();
    setBrowserConnectivity(false);
    expect(requestSignal?.aborted).toBe(true);
    release();
    const state = await running;
    expect(state.status).toBe(API_CONNECTIVITY_STATUS.OFFLINE);
    expect(state.ready).toBe(false);
  });

  it('distinguishes a readiness timeout from an HTTP 5xx response', async () => {
    const timedOut = await probeApiConnectivity(async () => ({
      healthy: false, reachable: false, timeout: true, code: 'REQUEST_TIMEOUT', latency: 20,
    }), { force: true });
    expect(timedOut.status).toBe(API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT);
    expect(timedOut.ready).toBe(false);

    const serverError = await probeApiConnectivity(async () => ({
      healthy: false, reachable: false, serverError: true, status: 500, code: 'HTTP_SERVER_ERROR', latency: 4,
    }), { force: true });
    expect(serverError.status).toBe(API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR);
    expect(serverError.lastHttpStatus).toBe(500);
    expect(serverError.ready).toBe(false);
  });

});

#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  API_CONNECTIVITY_STATUS,
  getApiConnectivityState,
  probeApiConnectivity,
  setApiConnectivityUnavailable,
  setBrowserConnectivity,
} from '../frontend/src/services/runtimeConnectivity.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

// A request that completes after the browser goes offline cannot restore READY.
{
  const pending = deferred();
  let signal;
  const request = probeApiConnectivity(async (probeSignal) => {
    signal = probeSignal;
    await pending.promise;
    return { healthy: true, status: 200, latency: 2 };
  }, { force: true });

  await Promise.resolve();
  setBrowserConnectivity(false);
  assert.equal(signal?.aborted, true, 'offline transition must abort the active readiness request');
  pending.resolve();
  const state = await request;
  assert.equal(state.status, API_CONNECTIVITY_STATUS.OFFLINE);
  assert.equal(state.ready, false);
}

// A newer API failure must win over an older readiness response.
{
  setBrowserConnectivity(true);
  const pending = deferred();
  const request = probeApiConnectivity(async () => {
    await pending.promise;
    return { healthy: true, status: 200, latency: 3 };
  }, { force: true });

  setApiConnectivityUnavailable({ code: 'NEWER_FAILURE', message: 'newer event wins' });
  pending.resolve();
  const state = await request;
  assert.equal(state.status, API_CONNECTIVITY_STATUS.API_UNAVAILABLE);
  assert.equal(state.lastErrorCode, 'NEWER_FAILURE');
  assert.equal(state.ready, false);
}

// Concurrent callers share one in-flight probe and a recovered service can be READY.
{
  setBrowserConnectivity(true);
  let calls = 0;
  const probe = async () => {
    calls += 1;
    return { healthy: true, status: 200, latency: 1 };
  };

  const [a, b, c] = await Promise.all([
    probeApiConnectivity(probe, { force: true }),
    probeApiConnectivity(probe, { force: true }),
    probeApiConnectivity(probe, { force: true }),
  ]);
  assert.equal(calls, 1);
  assert.equal(a.status, API_CONNECTIVITY_STATUS.READY);
  assert.equal(b.status, API_CONNECTIVITY_STATUS.READY);
  assert.equal(c.status, API_CONNECTIVITY_STATUS.READY);
  assert.equal(getApiConnectivityState().ready, true);
}

// HTTP routing/configuration and access failures mean the API answered;
// they must not be mislabeled as a refused TCP/network connection.
{
  setBrowserConnectivity(true);
  const endpointError = await probeApiConnectivity(async () => ({
    endpointError: true, reachable: true, status: 404, code: 'API_ENDPOINT_MISCONFIGURED',
  }), { force: true });
  assert.equal(endpointError.status, API_CONNECTIVITY_STATUS.API_ENDPOINT_ERROR);
  assert.equal(endpointError.apiReachable, true);
  assert.equal(endpointError.ready, false);
  assert.equal(endpointError.lastHttpStatus, 404);

  const accessError = await probeApiConnectivity(async () => ({
    httpError: true, reachable: true, status: 403, code: 'API_READINESS_ACCESS_403',
  }), { force: true });
  assert.equal(accessError.status, API_CONNECTIVITY_STATUS.API_HTTP_ERROR);
  assert.equal(accessError.apiReachable, true);
  assert.equal(accessError.ready, false);
  assert.equal(accessError.lastHttpStatus, 403);
}

// Readiness timeout and HTTP 5xx stay distinct from network-unreachable state.
{
  setBrowserConnectivity(true);
  const timedOut = await probeApiConnectivity(async () => ({
    healthy: false, reachable: false, timeout: true, status: null, code: 'REQUEST_TIMEOUT', latency: 25,
  }), { force: true });
  assert.equal(timedOut.status, API_CONNECTIVITY_STATUS.REQUEST_TIMEOUT);
  assert.equal(timedOut.ready, false);

  const serverError = await probeApiConnectivity(async () => ({
    healthy: false, reachable: false, serverError: true, status: 500, code: 'HTTP_SERVER_ERROR', latency: 4,
  }), { force: true });
  assert.equal(serverError.status, API_CONNECTIVITY_STATUS.HTTP_SERVER_ERROR);
  assert.equal(serverError.lastHttpStatus, 500);
  assert.equal(serverError.ready, false);
}

console.log('Runtime connectivity state verification: PASS (6 groups, including endpoint/access HTTP classification)');

#!/usr/bin/env node

/**
 * Dependency-free operational probe for container/host automation.
 */

const cliPath = process.argv[2];

const url =
  process.env.TITECH_HEALTHCHECK_URL ||
  (cliPath
    ? `http://127.0.0.1:${process.env.PORT || 5000}${cliPath.startsWith('/') ? cliPath : `/${cliPath}`}`
    : 'http://127.0.0.1:5000/healthz');

const timeoutMs = Number.isFinite(Number(process.env.TITECH_HEALTHCHECK_TIMEOUT_MS))
  ? Math.max(250, Number(process.env.TITECH_HEALTHCHECK_TIMEOUT_MS))
  : 5000;

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(url, {
    method: 'GET',
    signal: controller.signal,
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    console.error(`TITech healthcheck failed: HTTP ${response.status}`);
    process.exitCode = 1;
  } else {
    console.log(`TITech healthcheck passed: ${url}`);
  }
} catch (error) {
  console.error(`TITech healthcheck failed: ${error?.message || error}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}

# Vercel API transport report

The existing same-origin API bridge/routing implementation was inspected and retained; no fictitious backend hostname or registry was added. The production verification script was hardened to require an explicit origin, remote HTTPS, local HTTP only for loopback in local/integration mode, JSON responses, successful health payload (`success: true`, `status: healthy`), readiness payload (`success: true`, `status: ready`), and expected login error/status semantics. Redirects are manual and network/timeouts receive sanitized classifications.

## Verification

Seven transport-specific unit scenarios were included within the 29-test suite: origin validation; expected JSON endpoints; HTML SPA fallback rejection; API route 404; readiness failure; HTTP 200 with unhealthy health body; HTTP 200 with non-ready readiness body. All pass in deterministic mock tests.

`node scripts/verify-production-contract.mjs` against the repository's actual environment is **BLOCKED** with `API_ORIGIN_MISSING`. There is no configured API origin and no Vercel/Express endpoint available. Mock transport tests are not live preview or production verification. The public URL mentioned in historic logs was not used as an assumed valid origin.

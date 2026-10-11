# Authentication and Connectivity Failure Matrix

| Observed condition | Classification | Client behavior | Server/readiness behavior | Retry rule | Evidence status |
|---|---|---|---|---|---|
| TCP connection refused / no response | Backend unreachable or wrong target address | Show service unavailable, not invalid credentials | No HTTP response exists | Bounded readiness retry only | Supplied browser trace; live repro not run |
| Browser offline | Client offline | Disable/hold auth actions and show offline state | Not contacted | Retry only after online transition / controlled action | Stale-result harness passes |
| `GET /api/v1/ready` returns 503 | Backend not ready | Keep login gated; distinguish from invalid credentials | `status=not_ready` | Controlled backoff | Source contract verified; live HTTP test blocked |
| Readiness endpoint times out | Request timeout | Show service check timeout | Unknown at client; server may still run | Bounded, cancellable check | No live browser test |
| Readiness returns 5xx | Server/readiness failure | Show service issue | Never coerce to ready | Bounded readiness retry | Not integration-tested |
| Invalid credentials | Authentication failure | Generic safe credential message | Verify server-side; no credential retry loop | User-controlled resubmission subject to rate limits | Not integration-tested here |
| Auth store unavailable | Required auth persistence unavailable | Show temporary service error | Controller returns `AUTH_STORE_UNAVAILABLE`/503 when persistent store is required | No credential retry storm | Source inspected, no live request |
| 401 due to expired session | Unauthenticated/session expired | Single-flight refresh if supported; otherwise clear invalid state | Protected request rejected | Avoid refresh loops | Full client/server integration not run |
| 403 permission/tenant boundary | Authorization failure | Access denied, don't treat as login failure | Server-side RBAC/tenant scope is authoritative | No retry as connectivity | Static RBAC gate passes; live cross-tenant test not run |
| 429 rate limit | Rate limited | Communicate retry window safely | Existing rate limit governs | Honor backoff; don't retry credentials automatically | Not load/security-tested here |
| `chrome-extension://` async/font warning | Likely external browser-extension noise unless ownership proven | Test in clean browser profile | Does not establish TITech backend failure | No auth code change based only on extension warning | Static frontend runtime audit classifies Adobe font warning as external unless ownership proven |

The matrix is intentionally evidence-tagged. An unrun row is not represented as a passing integration test.

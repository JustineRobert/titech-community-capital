# Authentication Monitoring and Incident Response

**Status:** runbook guidance prepared; operational alert delivery not verified.

## Events requiring redacted audit/metrics

Track login successes/failures, verified/unverified login results, invitation denials, registration blocked by legal readiness, verification-provider failures, refresh success/failure, refresh-token reuse, logout pending/revocation failure, logout-all, tenant authorization denial, suspicious socket access and transaction-start failures. Labels must be low-cardinality and must not contain tokens, passwords, raw invitation codes or cookie values.

## Response

- **Refresh-token reuse:** treat as potential credential compromise; revoke the affected family according to policy, invalidate sessions where required, preserve redacted audit evidence and notify the authorized incident owner.
- **Database outage:** do not use insecure transaction fallbacks; fail closed on operations requiring persistent session/financial integrity, distinguish local signout from confirmed server revocation.
- **Email delivery failure:** preserve the failure state, make recovery/resend available under rate limits and never report provider acceptance as inbox delivery.
- **Cross-tenant denial spike:** alert the security owner, capture request/correlation identifiers without protected payloads and investigate before restoring affected access.
- **Potential account compromise:** revoke sessions, rotate compromised credentials/secrets as appropriate, preserve records under retention policy and conduct documented post-incident review.

Before calling this operationally ready, configure real alerts, on-call ownership, retention, escalation and test the procedures in a controlled exercise. This file itself does not prove that monitoring is active.

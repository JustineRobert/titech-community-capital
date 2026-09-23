# Security Assessment Evidence

**Assessment date:** `TBD`
**Commit/build:** `TBD`
**Environment:** `TBD`
**Assessor:** `TBD`

## Required controls

| Control | Tool/exercise | Result | Critical findings | Evidence |
|---|---|---|---:|---|
| SAST | CodeQL/approved SAST | NOT_EXECUTED | TBD | TBD |
| Dependency scan | npm audit/OSV | NOT_EXECUTED | TBD | TBD |
| Secret scan | Trivy/GitHub secret scanning | NOT_EXECUTED | TBD | TBD |
| Container scan | Trivy image scan | NOT_EXECUTED | TBD | TBD |
| DAST | OWASP ZAP/approved tool | NOT_EXECUTED | TBD | TBD |
| Tenant isolation | Automated adversarial tests | NOT_EXECUTED | TBD | TBD |
| Authorization matrix | Automated matrix | NOT_EXECUTED | TBD | TBD |
| Webhook security | Signature/replay/fuzz tests | NOT_EXECUTED | TBD | TBD |
| Rate limiting | Abuse tests | NOT_EXECUTED | TBD | TBD |

## Remediation rule

No P0 release gate may pass with an unresolved critical/high finding unless an explicit risk acceptance exists with accountable owner, compensating control and expiry date.

# TITech Production Readiness Matrix — 7 October 2026

| Gate | Capability | State | Evidence | Blocking | Next requirement |
|---|---|---|---|---|---|
| 0 | Repository integrity | PASS | `STATIC` | NO | Continue legacy debt consolidation without touching critical path |
| 0 | Critical financial imports | PASS | `STATIC` | NO | Maintain zero missing canonical imports |
| 0 | Legacy import debt | WARN | `STATIC` | NO | Consolidate by authority map, not bulk rewrite |
| 0 | Zero-byte inventory | WARN | `STATIC` | NO | Disposition in controlled backlog |
| 1 | Target runtime | NOT_VERIFIED | `RUNTIME` | YES | Execute clean on target runtime |
| 1 | Dependency installation | NOT_VERIFIED | `RUNTIME` | YES | Run npm ci under Node 24.15.x |
| 1 | Backend build | PASS | `STATIC` | NO | Re-run after dependency install |
| 1 | Frontend build artifact | NOT_VERIFIED | `RUNTIME` | YES | Build exact artifact and retain hash |
| 1 | Browser E2E | NOT_VERIFIED | `E2E` | YES | Run against built artifact |
| 2 | Golden Money Path | PASS | `STATIC` | NO | Add runtime dependency-backed evidence |
| 2 | Double-entry invariant | PASS | `UNIT/SOURCE` | NO | Run with full dependency stack |
| 2 | Balance reconstruction | PASS | `UNIT/SOURCE` | NO | Prove with persistent ledger integration |
| 2 | Duplicate/replay safety | NOT_VERIFIED | `INTEGRATION` | YES | MongoDB/Redis concurrency proof |
| 2 | Reversal/refund | NOT_VERIFIED | `INTEGRATION` | YES | Runtime transaction + audit proof |
| 3 | MTN sandbox | NOT_VERIFIED | `PROVIDER` | YES | Execute controlled MTN sandbox transaction |
| 3 | Provider callback authenticity | PASS | `SOURCE` | NO | Prove in provider sandbox |
| 3 | Provider production | NOT_VERIFIED | `PROVIDER` | YES | Only after legal/partner approvals |
| 4 | Reconciliation matching | NOT_VERIFIED | `RUNTIME` | YES | Execute populated settlement window |
| 4 | Exception handling | PASS | `SOURCE` | NO | Prove on real pilot exceptions |
| 5 | Authentication/RBAC | PASS | `SOURCE` | NO | Complete runtime/E2E authorization tests |
| 5 | Secrets/logging | PASS | `STATIC` | NO | Run live secret/DAST scans |
| 5 | Independent security assessment | NOT_VERIFIED | `EXTERNAL` | YES | Independent assessment required |
| 5 | Data protection | EXTERNAL_REQUIRED | `LEGAL` | YES | Qualified Ugandan legal/privacy review |
| 6 | Regulatory boundary | EXTERNAL_REQUIRED | `LEGAL` | YES | Counsel + partner review |
| 6 | Regulatory monitoring | PASS | `PROCESS` | NO | Run monthly and pre-release |
| 6 | Pilot regulatory checklist | PASS | `PROCESS` | NO | Complete per pilot |
| 7 | Pilot 01 | NOT_VERIFIED | `PILOT` | YES | Live pilot + acceptance |
| 7 | Pilot 02 | NOT_VERIFIED | `PILOT` | YES | Live pilot + acceptance |
| 7 | Pilot 03 | NOT_VERIFIED | `PILOT` | YES | Live pilot + acceptance |
| 7 | Pilot ROI | NOT_VERIFIED | `PILOT` | YES | Measured customer ROI |
| 8 | Paid customer | NOT_VERIFIED | `COMMERCIAL` | YES | Invoice/payment evidence |
| 8 | Renewal/retention | NOT_VERIFIED | `COMMERCIAL` | YES | Renewal or paid continuation |
| 8 | Deployment repeatability | NOT_VERIFIED | `OPERATIONAL` | YES | Run 2+ measured deployments |
| 8 | Backup/restore | NOT_VERIFIED | `RECOVERY` | YES | Execute real restore and financial validation |
| 8 | Rollback | NOT_VERIFIED | `RECOVERY` | YES | Execute real rollback |
| 8 | Production approval | BLOCKED | `APPROVAL` | YES | All blocking evidence must be PASS and approval recorded |

## State counts

- **214 repository-wide non-critical missing local imports:** 1
- **Accountable human approval + all gates:** 1
- **Authorized production transaction:** 1
- **Backend build contract:** 1
- **Baseline vs after measurable savings:** 1
- **Canonical financial runtime-import audit:** 1
- **Canonical payment→finance→ledger orchestration:** 1
- **Change monitoring and review cadence:** 1
- **Clean npm ci and installed test/build toolchain:** 1
- **Compensating financial effects:** 1
- **Continuation evidence:** 1
- **Controlled provider lifecycle:** 1
- **Controller/processor, retention, notices, consent:** 1
- **Days, not months:** 1
- **Debits equal credits:** 1
- **Dormant/future scaffolding classification:** 1
- **Exact artifact browser workflows:** 1
- **Exception IDs, owners, evidence, resolution:** 1
- **Minor-unit balance arithmetic:** 1
- **No access tokens/secrets in inappropriate storage/logs:** 1
- **Node 24.15.x + npm 11.x:** 1
- **One financial effect per idempotency key/callback:** 1
- **Partner/license/data/complaint controls:** 1
- **Provider/internal/ledger/settlement chain:** 1
- **Real agreement + payment evidence:** 1
- **Real institution workflow:** 3
- **Repository inventory and source-of-truth controls:** 1
- **SAST/SCA/DAST/penetration assessment:** 1
- **Successful deployment rollback drill:** 1
- **Successful restore drill:** 1
- **TITech vs regulated partner roles:** 1
- **Tenant isolation and privileged controls:** 1
- **Verify signature/replay window:** 1
- **Vite production artifact:** 1

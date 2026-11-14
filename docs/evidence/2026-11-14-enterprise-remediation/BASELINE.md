# TITech Community Capital — Source Archive Baseline

**Assessment date:** 14 November 2026  
**Product:** TITech Community Capital  
**Organization:** TITECH CAPITAL - SMC LTD  
**Source:** user-uploaded `titech-community-capital-main.zip`  
**Certificate source:** user-uploaded `REGISTRATION_CERTIFICATE.pdf`  
**Release posture:** NOT READY; `productionApproved=false`

## Source identity and limits

- Original ZIP SHA-256: `3eed27b6e8966e8be2546469b379fe2b81112b163cce8d5bd298a21135ba922d`.
- The archive integrity check completed successfully before extraction.
- The archive contains no `.git` directory. Branch, starting commit, final commit and remote synchronization cannot be established from this artifact. No GitHub push or deployment is claimed.
- The certificate file SHA-256 recorded in the organization profile is `81df8a5c6c200b29248413376c40541131639e865b595670159bdf47b9cbbe99`.
- The uploaded certificate states that TITECH CAPITAL - SMC LTD (Single Member Company) was incorporated with limited liability under the Companies Act, Cap 106, Section 20, registration number 80049233029029, at Kampala on 13 November 2026. Its authenticity and current registry standing have not been independently verified.
- P.O. Box 601200, Clock Tower, Uganda is treated as owner-supplied postal correspondence information only, not a verified registered office.

## Runtime and local services

| Item | Observed | Required / expected | Result |
|---|---|---|---|
| Node.js | 22.16.0 | >=24.15.0 (`.nvmrc` 24.15.0) | BLOCKED |
| npm | 10.9.2 | >=11.0.0 | BLOCKED |
| Root dependencies | Not installed | `npm ci` under supported runtime | BLOCKED |
| Frontend dependencies | Not installed | `npm --prefix frontend ci` | BLOCKED |
| MongoDB executable/service | Not available | Isolated test DB; replica set for transaction tests | BLOCKED |
| Redis executable/service | Not available | Configured test Redis where required | BLOCKED |
| Docker executable | Not available | Optional service orchestration | NOT AVAILABLE |
| Browser E2E runtime | Not established | Repository's existing configured browser runner | NOT RUN |
| Vercel credentials / deployment | Not supplied | Authorized project access | NOT AVAILABLE |
| Provider sandbox credentials / network test SIMs | Not supplied | Contracted aggregator test access | NOT AVAILABLE |

## Baseline architecture observed

The archive includes React/Vite/React Router frontend source, Express ESM backend source, Mongoose models, Redis-based runtime patterns, canonical JWT/HttpOnly refresh-cookie authentication, action-based RBAC, tenant scoping, audit infrastructure and financial modules. This assessment made focused additions to existing surfaces; it did not replace the application architecture or create parallel group, authentication, ledger or payment systems.

The group API is registered at `/api/groups`, `/api/v1/groups` and `/groups`. The deployed frontend configuration used a same-origin API base, while the original Vercel config had only an SPA fallback. Group clients use both `/groups` and `/api/groups` paths. This is a confirmed source configuration mismatch and a credible explanation for production requests being served by the SPA instead of the backend; the exact live-site failure remains unconfirmed because no live deployment/browser access was available.

The USSD module contains a provider-neutral callback contract, registry interface, menu renderer and unit tests. It has no configured production aggregator adapter or externally evidenced network route. The existing default gates are disabled.

## Baseline repository caveat

The uploaded ZIP is not a Git clone. The remediation report therefore uses an archive SHA-256 and exact folder/file paths, not Git commit hashes. The final ZIP is an archive-local source deliverable and is not proof of remote repository update.

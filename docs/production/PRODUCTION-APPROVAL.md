# TITech Community Capital

# Production Approval

## Current decision state

**NOT PRODUCTION APPROVED**

This repository contains implementation and source-level verification evidence, but production approval remains blocked until the external evidence package is complete.

Required external gates include:

- Node 24.15.x/npm 11.x dependency-backed installation and runtime proof;
- MongoDB/Redis runtime/concurrency evidence;
- Golden Money Path E2E evidence;
- two externally verified payment rails;
- security assessment and disposition of critical/high findings;
- successful backup/restore drill;
- Kubernetes rollout/rollback evidence where Kubernetes is the deployment target;
- measured reconciliation results;
- real pilot/customer acceptance;
- jurisdiction-specific legal/regulatory review;
- accountable approval reference and expiry.

The protected production gate requires all of the above plus `TITECH_PRODUCTION_APPROVAL=YES` and accountable approval metadata.

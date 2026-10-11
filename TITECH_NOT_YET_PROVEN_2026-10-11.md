# What TITech Community Capital Has NOT Yet Proven — 11 October 2026

This is the current release-control register. It intentionally supersedes the dated assessment in `TITECH_NOT_YET_PROVEN_2026-10-07.md`; the older file remains historical.

## Runtime / authentication

- Clean dependency installation and execution under Node.js >=24.15.0 / npm >=11.0.0.
- A live backend process successfully binds to the configured host/port and remains healthy after bootstrap.
- Real HTTP proof for `/api/v1/ready` returning 503 when a required dependency is unavailable and 200 only when actually ready.
- Actual local cause of the captured `ERR_CONNECTION_REFUSED` proven as startup failure, bind failure or incorrect API target; source changes alone do not identify which occurred at capture time.
- Full browser login → authenticated current-user/protected resource → refresh → valid session after reload → logout/revocation → post-logout protected-resource rejection.
- Live CORS/CSRF/cookie/domain/Secure/SameSite behavior behind the deployment reverse proxy.
- Live tenant mismatch, role/permission denial, 401 refresh coordination, refresh replay/reuse, rate limits, concurrency and security regression tests.
- React Strict Mode / browser test proof that actual application mounts do not create uncontrolled readiness/login/refresh storms.

## Financial core / products

- Real MongoDB multi-document transaction/session behavior and concurrent idempotency proof.
- Real Redis connectivity/locking/queue recovery proof where Redis is required by the deployed workflow.
- End-to-end contribution golden path with provider outcome, cleared/settled funds, canonical financial transaction, balanced journal, derived balance, receipt, outbox, audit and reconciliation evidence.
- Persisted recurring contribution plan + consent/mandate + unique due occurrence + concurrency-safe worker/lease + controlled retry/unknown outcome + safe reversal/refund + reconciliation lifecycle.
- Live MTN/Airtel sandbox lifecycle and provider callback signature/replay/query-after-timeout proof.
- Real settlement and ledger reconciliation closure, including mismatch/exception and period-close evidence.
- Fixed-deposit approved terms snapshot, exact accrual/rounding, cleared-funds gating, maturity event, authorized payout/reinvestment and reconciled ledger path.
- Authorized investment issuer/distributor/custodian, product/terms, disclosures/eligibility, partner order/holding/redemption lifecycle and settlement proof.

## Operations / security / external approvals

- Full dependency-backed backend Jest suite, frontend Vitest suite, frontend production build and lint pipeline.
- Independent security assessment, DAST/penetration evidence, secret/dependency scans and abuse/rate-limit tests.
- Tested backup restore and rollback in a disposable environment, including post-restore ledger/audit consistency.
- Staging/production deployment and operational monitoring proof.
- Qualified Uganda legal/regulatory/compliance review for each enabled activity and jurisdiction; institutional accounting/tax/product-term approvals.
- Three actual design-partner pilots, measured outcome baselines, reconciliation/support effort, customer retention, signed paid contracts and received revenue.
- Production approval.

## Evidence available from this run

The focused source/static checks and native tests listed in `docs/REMEDIATION_VERIFICATION_2026-10-11.md` passed. They do not substitute for any item above. Current release decision remains **NOT READY**, and `PRODUCTION_APPROVED` remains **NO**.

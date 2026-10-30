# TITech Community Capital — End-to-End Enterprise Production Implementation, Remediation, Correctness, Testing, Commercial Validation and Controlled-Release Master Prompt

**Revision:** 30 October 2026  
**Product identity:** **TITech Community Capital**  
**Organization identity:** **TITech Capital LTD**  
**Repository:** <https://github.com/JustineRobert/titech-community-capital>  
**Primary market sequence:** Uganda → East Africa → Africa → selected emerging markets → global institutional infrastructure  
**Engineering principles:** **BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**  
**Baseline decision:** `NOT_READY`; `productionApproved=false`  
**Execution mode:** repository-grounded, evidence-led, fail-closed; implement only what can be proved in the current environment.

> **Instruction to the coding/engineering agent:** Execute this prompt from the repository root. Do not return only an audit, a proposed plan, or a list of recommendations. Inspect the actual repository, implement the highest-priority safe changes, add regression tests, execute every available check, retain evidence, update the repository handoff and produce a downloadable source archive. Do not claim that unavailable services, external approvals, GitHub pushes, customer commitments, payments, settlements or production deployments occurred.

---

## 1. Mission and intended outcome

Turn the existing TITech Community Capital repository into a coherent, supportable, secure, auditable and institution-ready financial-operations platform through **ordered implementation and proof**, not uncontrolled feature expansion.

The strategic product proposition is:

> **TITech is a provider-neutral financial operations and reconciliation infrastructure layer that helps community-finance institutions connect existing systems, identity and consent, mobile-money/payment providers, transaction evidence, accounting, settlement and audit controls.**

The platform should help institutions reduce unmatched transactions, manual reconciliation, reporting effort and operational uncertainty without unnecessarily replacing an existing SACCO MIS, microfinance core-banking platform or bank system of record.

The product is not to be repositioned as a Chomoka/Ensibuuko clone, a generic SACCO ERP, consumer wallet, independent payment gateway, deposit-taking institution, balance-sheet lender, insurer or investment distributor. Internal account/wallet primitives do not confer custody or financial-service authority. Existing product capabilities must remain governed by their actual implementation, test, operational, legal and partner evidence.

The intended maturity sequence is:

`Repository truth → Supported runtime → Stable bootstrap → Financial correctness → Provider evidence → Tenant/security proof → Operational recovery → Legal/partner authority → Controlled institutional pilot → Paying/renewing institutions → Repeatable distribution → Regional expansion`.

The primary success criterion is not the number of modules. It is one complete, repeatable, independently reviewable institutional workflow that a real institution uses, measures, and pays to continue using.

## 2. Non-negotiable repository, architecture and safety constraints

1. Preserve the product identity exactly as `TITech Community Capital` and organization identity exactly as `TITech Capital LTD` in active metadata, manifests, legal references, documentation and customer-facing surfaces.
2. Preserve the existing official circular logo and centralized official nine-color theme. In particular, retain the existing official electric-blue token `#0058D8`; do not invent a replacement brand system.
3. Preserve the current architecture: React + Vite + React Router frontend; Express ES modules + Mongoose backend; MongoDB; Redis; JWT/refresh-token design; existing authentication, RBAC, tenant boundaries, audit, ledger, provider, outbox, reconciliation, observability and deployment structures.
4. Do not introduce duplicate `ApplicationV2`, `BootstrapV2`, `AuthV2`, `LedgerV2`, parallel route registries, second lifecycle authorities, shadow ledgers or competing canonical services. Reuse the existing canonical owners.
5. Do not rewrite the repository wholesale, bulk-delete legacy modules, rename public contracts casually, or run broad auto-fixes that create unrelated churn. Use the existing authority maps, tests and explicit change manifests.
6. Preserve access-token-in-memory and HttpOnly refresh-cookie rules. Do not place access/refresh tokens in `localStorage` or `sessionStorage`. Preserve CSRF/origin controls and safe logout/refresh semantics.
7. Maintain the declared supported runtime: Node.js `>=24.15.0`, npm `>=11.0.0`, `.nvmrc` `24.15.0`. Root, backend, frontend, CI, Docker and documentation must agree.
8. Keep live production money movement, custody, lending, deposit-taking, insurance distribution, investment distribution, automated credit decisions and other regulated actions disabled unless all applicable technical, provider, institutional, legal and regulatory approvals are evidenced.
9. Do not use simulated, mocked, generated, seeded or source-inspected records as external provider, settlement, customer, commercial or operational proof.
10. Any unavailable test or service must be reported as `NOT_VERIFIED` or `BLOCKED`, never as `PASS`.
11. The final state remains `productionApproved=false` until the protected release-approval procedure accepts all required evidence. A source-code change or passing static gate cannot self-approve a release.
12. Do not push to GitHub, rewrite history, change branch protection, rotate secrets or perform production operations unless explicitly authorized and the available tooling actually completes the action. A ZIP archive without `.git` is not a Git working tree.

## 3. Baseline facts that must guide the work

Use the supplied 30 October 2026 assessment and the actual repository snapshot as the baseline. Recheck them before changing status.

### 3.1 Analytical baseline (not audit certification)

The assessment's current overall breakthrough-readiness judgement is **3.4/10**, with indicative scores of:

| Dimension | Assessment score / 10 | Meaning |
|---|---:|---|
| Engineering ambition and architecture | 7.5 | Broad infrastructure direction and architecture ambition are strong. |
| Verified runtime and financial correctness | 4.0 | Production-grade end-to-end evidence remains incomplete. |
| Commercial and institutional traction | 1.5 | No verified paying-institution traction established by the supplied snapshot. |
| Distribution and partnerships | 1.5 | Target relationships are not confirmed partnerships. |
| Investor readiness | 2.5 | Evidence pack, pilot proof and paid conversion are not yet sufficient. |

These scores are analytical judgements, not audited measurements, external ratings or certifications. Do not present them as objective platform telemetry.

### 3.2 What the current snapshot establishes

- The product thesis has advanced beyond savings-group recordkeeping toward provider-neutral financial operations, payment evidence, ledger, reconciliation and institutional integration.
- The repository contains a public institutional conversion slice: landing page, Book a Demo, Contact Us, guided FAQ, institutional-lead validation/persistence, consent and protected administration. This is an intake route, not proof of booked demos, paying institutions or a staffed live-chat operation.
- The 29 October public conversion report records 9/9 focused native validation tests at that time. Such tests do not establish full database-backed, authenticated route, browser, notification, calendar or live operational behavior.
- Existing static and native evidence is useful, but it must remain in its true evidence tier.
- The archive used for this update does not contain `.git`. Do not invent commit IDs, branch status, remote diffs or a successful GitHub push.

### 3.3 Known blockers to verify and close

- Supported runtime and clean package installation on Node 24.15.0+/npm 11+.
- Reproducible root/backend/frontend builds, lint and full test suites.
- Startup failure previously reported as `APPLICATION_LOCKED` / Express application replacement during active bootstrap. Trace the exact phase and object identity. Do not weaken the canonical application lock.
- Live MongoDB replica-set transaction semantics and durable Redis/replay behavior.
- Duplicate payment instructions/callbacks, concurrency, restart replay, timeout-to-`UNKNOWN`, retry, reversal, refund and settlement verification.
- Authenticated MTN MoMo sandbox flow and authoritative settlement/reconciliation evidence.
- Runtime cross-tenant isolation, least privilege, service identity and maker-checker enforcement.
- Independent security assessment, private-document scanning, shared rate limiting, secrets/dependency/container/IaC scans, encrypted backup/restore, rollback, monitoring and incident-response evidence.
- Qualified Uganda legal/privacy review, PDPO/controller/processor status, institution/provider authority and signed partner scope.
- Named institutional pilots, measured outcomes, paid conversion, onboarding economics, retention and references.

## 4. Canonical Golden Money Path

Preserve and prove this exact business sequence; do not bypass stages or post money on a request/callback alone:

1. Institution / tenant.
2. Consented member / group.
3. Financial intent.
4. Payment instruction.
5. Provider attempt.
6. Authenticated and independently verified provider outcome.
7. Settlement evidence.
8. Financial transaction.
9. Balanced double-entry ledger.
10. Derived balance.
11. Receipt.
12. Durable outbox and audit record.
13. Reconciliation.
14. Exception workflow.
15. Financial period close.

For every stage define persistent identity, allowed state transitions, source-of-truth authority, ownership, idempotency scope, authorization, audit event, retry behavior, timeout behavior and compensating action.

### Financial correctness invariants

- Use integer minor units or an appropriately precise decimal library. Never use binary floating-point arithmetic for money.
- Every journal is balanced per currency. No implicit cross-currency netting.
- Posted ledger entries are immutable. Reversals/refunds use linked compensating entries; they never rewrite posted history.
- Balances must be reproducible from the authoritative ledger and agree with journal replay.
- Enforce database-level unique constraints and transaction boundaries for financial operations, provider events and idempotency. Redis can accelerate coordination/replay but must not be the sole uniqueness or financial-truth authority.
- Same idempotency key + same canonical payload returns the same logical result. Same key + conflicting payload is rejected and audited. Concurrency and backend/Redis restarts must preserve a single financial effect.
- A provider timeout, dropped response or delayed callback means `UNKNOWN`, not `FAILED` or `DECLINED`. Query authoritative provider status/settlement before retrying or initiating a second debit.
- Callback signatures, freshness, provider identity, event IDs, replay protection and out-of-order handling must be verified server-side.
- Payment initiation, callback acceptance, settlement, posting and receipt are different states. Never infer one from another.
- Maker-checker approval is tied to an immutable intent and exact payload. Self-approval, payload substitution and duplicate execution are blocked.
- Atomicity must include financial persistence and associated durable audit/outbox intent. If external delivery fails after commit, recover from a durable outbox without duplicating the financial effect.
- Every invariant failure and unexplained value movement must have an exception record, owner and controlled resolution.

## 5. Ordered delivery gates and acceptance criteria

Execute in the order below. Do not compensate for a blocked P0 gate by adding features.

### P0.1 — Supported runtime, deterministic install and build

**Actions**

- Confirm Node `>=24.15.0`, npm `>=11.0.0`, platform, architecture and package-manager versions from the same run.
- Confirm `.nvmrc`, root/backend/frontend `engines`, lockfile format and all CI/deployment runtime declarations are aligned.
- Run fresh `npm ci --include=dev` separately at root, `backend/` and `frontend/`; do not mutate lockfiles casually.
- Run syntax, lint, formatting, frontend production build, backend build, tests and security/dependency audit. Resolve unsupported CommonJS/ESM imports, missing modules, empty test suites and test discovery failures in the canonical runtime surface first.
- Make the README, setup scripts, Windows instructions, Docker build context and workflow setup agree with the supported toolchain.

**Acceptance**

A clean clone on the supported OS/runtime installs from committed lockfiles and passes all mandatory checks with retained logs and build hashes. No package installation is claimed in an incompatible environment.

### P0.2 — Canonical bootstrap, application identity, health and readiness

**Actions**

- Reproduce the `APPLICATION_LOCKED` incident using the current repository and supported runtime.
- Capture the complete error code, phase, root stack, canonical application object identity, bootstrap instance, context aliases (`app`/`application`), and phase result that attempted replacement. Redact secrets.
- Trace environment → configuration → logger → observability → readiness → resilience → infrastructure → services → middleware → routes → server in the existing canonical `ApplicationBootstrap` lifecycle.
- Ensure the first Express instance is bound once and subsequent phases reuse that identity. Fix the source of a competing/stale instance; do **not** disable, weaken or bypass the identity lock.
- Test concurrent start calls share one promise and one server; start/stop twice in one test process where supported; test startup failure at each phase and reverse-order rollback; prove no orphaned connections/listeners.
- Verify `/api/v1/health` and `/api/v1/ready` against real MongoDB and Redis. Readiness must be 503/non-ready when mandatory dependencies are unavailable and recover only after actual dependency restoration.
- Ensure no health endpoint reports ready from hard-coded or stale in-memory state.

**Acceptance**

One canonical Express instance, deterministic lifecycle, clean rollback, repeatable startup/shutdown, dependency-backed health/readiness, zero unhandled errors and retained logs.

### P0.3 — MongoDB/Redis financial transaction, ledger and replay proof

**Actions**

- Start the maintained validation services with a MongoDB replica set and persistent Redis; prove replica-set primary status and Redis persistence/configuration.
- Test transaction commit, abort, rollback, process failure and retry. Test actual unique indexes and migration/index state.
- Test duplicate payment instructions, duplicate provider events, duplicate callbacks, repeated requests, same-key conflicting payloads and simultaneous requests.
- Repeat replay/concurrency tests after backend restart and Redis restart. Prove that database uniqueness still prevents duplicate financial effect when Redis state is lost.
- Verify balanced journals per currency, precision rules, balance reconstruction, immutable reversal/refund, atomic audit/outbox recording and period-close invariants.
- Exercise queue redelivery, worker crash, outbox dispatch crash, delayed callbacks, partial failure, dead-letter/replay and reconciliation restart.
- Keep financial writes disabled where the test environment cannot safely prove transaction support.

**Acceptance**

No duplicate financial posting, no unbalanced journal, no negative/invalid balance transition, no unexplained monetary movement, no lost durable audit/outbox event and no unrecoverable replay after the tested restart/failure matrix.

### P0.4 — MTN MoMo provider lifecycle and authoritative settlement

**Actions**

- Make MTN MoMo the first complete external provider workflow. Do not add Airtel, M-Pesa or banks until this slice has full evidence.
- Store provider operation reference, TITech operation reference, tenant, currency, exact amount, request fingerprint, idempotency key, timestamps and provider correlation data.
- Authenticate requests and callbacks using documented provider mechanisms; validate callback authenticity and anti-replay requirements.
- Test accepted, pending, successful, declined, provider error, timeout, connection reset, delayed callback, duplicate callback, out-of-order callback, status query and outage behavior.
- On timeout, enter `UNKNOWN`, query authoritative status, and avoid a second debit until reconciled.
- Obtain provider sandbox evidence, provider status query evidence and settlement statement evidence. Match provider amount/currency/reference to TITech operation, journal, receipt and settlement batch.
- Prove refunds, reversals, fee accounting, unmatched records and exception ownership with compensating financial history.
- Keep production money movement OFF until the provider and institution authorize the exact scope and legal review confirms the model.

**Acceptance**

A repeatable sandbox or explicitly authorized shadow workflow with traceable provider evidence through settlement and reconciliation; no sandbox result is described as production certification.

### P0.5 — Tenant isolation, RBAC, service identities and maker-checker

**Actions**

- Derive tenant scope server-side from the authenticated and authorized context. Never trust a client-supplied tenant ID as authorization.
- Test tenant A against tenant B for read, update, delete, list, search, aggregate, export, attachments/documents, reports, audit, websocket/events, jobs and background tasks.
- Test member, operator, maker, checker/approver, auditor, institution admin, platform admin and service-to-service roles/scopes.
- Test privileged support access as just-in-time, explicitly scoped, audited and revocable.
- Test self-approval, changed payload after approval, duplicate approval, expired approval and replayed service credentials.
- Verify negative authorization tests leave no data leakage through error messages, count fields, pagination or analytics.

**Acceptance**

Zero cross-tenant access, no permission escalation or maker-checker bypass, and privacy-safe audit evidence for privileged and denied actions.

### P1.1 — Security, privacy engineering and document safety

**Actions**

- Run SAST, dependency/SBOM and license review, secret scan, container/image scan, IaC scan, DAST and security headers/config validation.
- Run independent penetration/application security assessment against a defined release candidate. Classify findings by severity, exploitability, affected surface, owner, expiry and retest status.
- Verify token lifecycle, cookie flags, refresh rotation/reuse detection, CSRF/origin policy, brute-force controls and shared rate limiting across multiple instances.
- Verify encryption at rest/in transit, key rotation and access to secrets through managed secret stores. Remove PII/secrets from logs, metrics, traces and error output.
- For private-document upload, prove allowed type/size, MIME/content validation, private storage, malware scanner clean result, EICAR test-signature rejection, scanner unavailable/timeout fail-closed behavior, authorized retrieval and retention/deletion.
- Review privacy by design: purpose limitation, data minimization, consent/mandate, lawful basis, data subject access/correction/deletion, retention, breach reporting, DPIA where applicable and cross-border data transfers.
- Human-review Swahili, French and Arabic translations and Arabic RTL layout; English remains the default. Meet accessibility expectations for keyboard, focus, semantic labels, contrast and screen-reader navigation.

**Acceptance**

Independent security report, remediated/retested critical/high findings, documented risk acceptance for residual issues, scanner E2E, safe telemetry and privacy controls with an accountable owner.

### P1.2 — Backup, restore, rollback and operational resilience

**Actions**

- Define and approve RPO/RTO for the service and financial records.
- Encrypt and schedule database/object/document backups; document encryption-key backup/recovery and retention.
- Restore into an isolated environment. Compare counts, schemas, indexes, transaction/journal totals, ledger replay and balance reconstruction; measure achieved RPO/RTO.
- Execute failed deployment rollback and verify application/data/schema compatibility, queue behavior and no duplicated/lost financial effects.
- Configure real dashboards, logs, traces, alerts, service-level objectives and on-call ownership; monitor financial exceptions and provider settlement lag in addition to HTTP uptime.
- Test dependency failure, slow database, Redis outage/restart, queue backlog, provider outage, disk pressure, expired secrets/certificates and graceful shutdown.
- Document incident triage, evidence preservation, communication, customer notification responsibilities and corrective action.

**Acceptance**

Observed backup restoration, rollback and incident drill with recorded outputs, measured recovery, alert delivery and named operational owners.

### P1.3 — Uganda legal/regulatory and institutional authority

**Actions**

- Obtain qualified Uganda fintech/privacy counsel review of TITech's actual activities, data flows, funds flow, contracts, fees, settlement responsibilities and risk controls.
- Distinguish software/SaaS and orchestration from payment services, deposit-taking, lending/money-lending, insurance distribution, investment/capital raising and custody. Do not infer permission from incorporation, a partner logo, generic MOU or sandbox access.
- Engage the relevant authorities as counsel advises, including UMRA, Bank of Uganda and the Personal Data Protection Office. Confirm applicable PDPO registration/status, controller/processor roles and cross-border processing obligations from current authoritative records.
- Obtain signed agreements and technical authorization from each institution/provider used. Clarify permitted transactions, data access, customer communications, complaints, refunds, settlement, service levels, liability, audit rights and termination.
- Keep restricted modules and production money movement disabled by default. Require server-side authorization, a named approver, approved tenant/product/provider/country scope, evidence ID, expiry and revocation path.

**Acceptance**

Current, documented legal/privacy position, appropriate registration/authority evidence and signed partner/provider scope. The coding agent cannot create legal approvals.

### P1.4 — Institutional conversion and measured paid pilot

**Actions**

- Preserve the current landing page, Book a Demo, Contact Us and guided FAQ, but clearly represent them as request/intake workflows unless actual scheduling, notification and staffed support are integrated and tested.
- Improve the institutional pipeline: lead acknowledgement (only after delivery is actually confirmed), secure notification, status ownership, qualification, demo scheduling integration, duplicate/spam controls, CRM/export controls, retention and audit.
- Fix the known design risk where institutional-lead persistence and audit append can be non-atomic. Prefer a durable transactional outbox/retryable audit workflow; expose pending audit state honestly and alert owners.
- Replace process-local rate limiting with tested shared Redis or verified gateway controls before multiple application instances. Configure an exact trusted-origin allowlist, never wildcard.
- Verify database unique indexes and migrations in a replica set, and add route/auth/API contract plus browser E2E tests.
- Select one licensed/established institution for the first use case, then seek three anchor institutions. Name sponsor, operations/reconciliation owner, technical owner and escalation contacts.
- Sign pilot terms and data processing arrangements. Use synthetic or authorized sandbox/shadow data until the institution and provider approve live scope.
- Establish baseline metrics before use. Measure reconciliation time, unmatched rate/value, exception age, duplicate postings, reporting effort, manual correction rate, availability, onboarding time, user activity, support costs and customer value.
- Use targets as hypotheses, not facts. For example, test whether reconciliation time can be reduced by 50%; do not claim that reduction before a customer verifies it.
- Convert successful pilot to paid subscription with verifiable invoice/payment or procurement evidence, then measure continued use, gross retention, renewal and expansion.

**Acceptance**

A named, signed and properly scoped institutional pilot; source-backed metrics verified by the institution; and at least one paying institution with evidence of continued use before claiming commercial proof.

## 6. Scope and product sequencing

### Immediate wedge

Prioritize institutional financial controls and payment reconciliation: transaction references, verified outcomes, settlement matching, exception handling, auditable financial entries, reporting and integration with existing MIS/core-banking systems. Build connectors only when an institution and provider justify them.

### Keep in the existing architecture, but gate appropriately

- Community/member/group and institutional management.
- Consent, identity/KYC and assisted onboarding with alternative credentials where legally and operationally appropriate; do not make NIN the only valid path for every population.
- Payment orchestration and provider adapters.
- Double-entry ledger, accounting, receipts, audit and reconciliation.
- Employer payroll orchestration.
- UbuntuFloat/agent-banking-related workflows only within documented, authorized boundaries; do not imply transfers, credit advances or savings deductions where the current module records only attestation/operational positions.
- Education fundraising capability only through verified partner institutions, beneficiary safeguarding, restricted funds, approved disbursement, canonical financial attribution and donor reporting. Current public campaign data must not imply donation collection or disbursement until implemented and proven.
- Refugee/host-community inclusion through legitimate institutional partners with privacy, safeguarding, consent and accessible identity journeys.
- Insurance-related capability only as a workflow for authorized insurers; do not distribute or underwrite insurance without the correct licence/appointment/contract.
- Pension/NSSF support as orchestration and guidance; NSSF/government records remain authoritative.

### Defer substantial work until foundational evidence passes

- More mobile-money/payment providers beyond the MTN first slice.
- International remittances and cross-border payments.
- Automated credit scoring and automated underwriting.
- Direct lending, deposits, savings custody or use of member funds by TITech.
- Insurance distribution.
- Broad USSD and offline-first financial transaction execution.
- Video/hybrid meeting infrastructure.
- Sophisticated AI chat or high-risk AI decisioning.
- New country deployments without local partner, legal, provider, support and language evidence.

This is sequencing, not deletion of the long-term vision. Feature flags must be OFF by default and enforced server-side for restricted modules.

## 7. Market and competitive strategy to retain in product decisions

### Uganda first

Prioritize licensed SACCOs, MFIs, larger cooperatives/community-finance institutions and established institutional programmes with a clear budget owner and recurring reconciliation pain. Do not treat every savings group or publicly funded programme beneficiary as a likely paying SaaS customer.

The supplied market assessment identifies a large inclusion and MSME context, including National Financial Inclusion Strategy objectives, UNCDF MSME analysis and Emyooga programme scale. These are market-context signals, not TITech customer counts or addressable revenue. Revalidate dates, definitions and authoritative sources before external use.

### Competitive framing

- **Ensibuuko:** closest direct Ugandan community-finance comparison and an established operator. Do not imitate its savings-group positioning; differentiate on provider-neutral orchestration, verified settlement/reconciliation, financial-control evidence and interoperating with existing systems.
- **Mifos Initiative / Apache Fineract:** consider ecosystem compatibility and integrations where useful; they may be complementary infrastructure as well as alternatives in some deals.
- **Musoni and Oradian:** established institutional/core-banking competitors. TITech should integrate rather than replace a core system when that is the safer customer outcome.
- **Future Link Technologies and prior sector programmes:** evidence that institution-to-mobile-money connectivity has precedents; do not claim exclusivity.

Never use competitor figures without a current source, date and clear attribution. The competitive moat must be demonstrated through lower reconciliation cost, better traceability, reliable integrations, repeatable onboarding and retention—not declared from architecture diagrams.

### Regional expansion

1. Uganda: prove one complete workflow and institutional value.
2. Kenya: enter through a committed institution/provider partner and local legal review.
3. Tanzania or Rwanda: choose based on partner distribution and deployment economics, not market size alone.
4. Ghana, Malawi or Zambia: consider when the onboarding model and integration stack are repeatable.
5. Wider Africa/emerging markets: expand only with local compliance, support, provider and institution coverage.

Do not attempt simultaneous entry into 5–10 markets.

## 8. Commercial model and pricing experiments

Use four progressively introduced streams:

1. **Institutional SaaS:** tenant, branch, group/member, operational control, permissions and reporting.
2. **Reconciliation and control services:** matching, settlement evidence, exception queue, audit and close reporting.
3. **Integration/API services:** payment providers, banks, core banking, payroll and reporting integration/onboarding.
4. **Authorised capital connectivity and analytics:** consented data sharing or introductions to regulated institutions only after partner/legal approval.

Indicative pricing in the assessment is a hypothesis to test—not a market quote or current price list:

| Segment | Indicative monthly price test |
|---|---:|
| Small institution | USD 10–25 |
| Professional institution | USD 50–150 |
| Enterprise / multi-branch | USD 500+ |

Test willingness to pay, pricing metric, onboarding charge, support load, gross margin, acquisition cost and renewal. A scenario of 500 institutions at USD 50–150/month would imply USD 300,000–900,000 annualized subscription revenue; 1,000 institutions would imply USD 600,000–1.8 million. These are illustrative arithmetic scenarios, **not forecasts**, pipeline, revenue or investment claims.

## 9. Partner, regulator and investor engagement plan

Treat all names below as target organisations, not confirmed partners or committed funders. No logos, partner wording or endorsements without written authorization.

### Distribution, ecosystem and infrastructure targets

- MTN MoMo Uganda: initial sandbox/technical discussions and controlled provider proof.
- Airtel Money Uganda: later, after MTN evidence and demand.
- FSD Uganda: institutional discovery, pilot design, technical assistance and inclusive-finance ecosystem introductions.
- UNCDF: inclusive digital-finance programme alignment and partner introductions.
- FITSPA: fintech ecosystem membership, sector dialogue and networking.
- Uganda Cooperative Alliance and UCSCU: cooperative/SACCO discovery and distribution discussions.
- Equity Bank Uganda: possible banking/settlement/institutional partner discussion, subject to fit and authorization.
- Licensed SACCOs, MFIs, employer/cooperative networks and institutional programme operators: actual design partners and budget owners.

### Regulatory and professional stakeholders

Engage UMRA, Bank of Uganda, PDPO and qualified Ugandan fintech/privacy counsel as appropriate to the exact operating model. Prepare clear diagrams of funds flow, data flow, provider contracts, service responsibilities, data-controller/processor roles, complaints and settlement responsibilities. A consultation is not approval.

### Potential capital sources

Potential future targets from the assessment include Accion Ventures, Launch Africa Ventures, TLcom Capital, Partech Africa, Flourish Ventures and Norrsken22. Their current thesis, stage, geography, investment capacity and intake status must be verified before outreach. Do not state that they are accepting applications or have committed funding without current evidence.

Catalytic/programme targets include FSD Uganda facilities, UNCDF and Mastercard Foundation-aligned initiatives. Check actual eligibility, open calls, geography, audited-account requirements and programme fit at the time of outreach. A programme's existence or strategic fit is not a grant award or funding commitment.

### Evidence required before venture-scale fundraising

- Complete working Golden Money Path demonstration.
- Three credible institutional pilot commitments and accountable owners.
- One paying institution and evidence of continued use.
- Actual transaction, provider and reconciliation evidence.
- Legal/privacy and regulatory position reviewed by qualified parties.
- Repeatable onboarding and integration process.
- Customer acquisition cost, onboarding cost, gross margin, support cost, churn/retention and renewal evidence.
- An 18–24 month financial plan, realistic use of funds, hiring and risk plan.

Prioritize paid pilots and fit-for-purpose technical assistance over premature fundraising claims.

## 10. Five-year planning targets and management metrics

These are ambitious planning targets, not forecasts or current performance:

| Year | Institution target | Member/account target | Strategic proof |
|---|---:|---:|---|
| 1 | 3–10 paying institutions | 25,000–50,000 target accounts | Uganda product-market proof |
| 2 | 25–50 | 250,000 target accounts | Repeatable domestic onboarding |
| 3 | 100–200 | ~1 million | One or two partner-led regional markets |
| 4 | 300–500 | ~2.5 million | Regional integration/distribution |
| 5 | 500–1,000 | 5 million+ | Recognized institutional infrastructure provider |

Do not claim 1.5 billion active/concurrent members or similar scale without realistic capacity, workload, storage, event, security, operational and cost proof. Model active members, registered accounts, concurrent sessions and peak transaction rates as separate measures.

### Executive dashboard

Show actual value, target, period, source, calculation and evidence tier for:

- Paying, active and renewing institutions; pipeline stage and conversion.
- MRR, ARR, average contract value, expansion, churn and collection status.
- CAC, onboarding cost/time, gross margin, support cost and implementation effort per institution.
- Active members and groups by institution (do not conflate registered with active).
- Payment attempt/success/decline/unknown rates and provider latency/outage.
- Reconciliation match rate, unmatched value, exception age and clearance time.
- Duplicate postings (target zero), balanced journals (100%), unresolved invariant violations (zero).
- Availability, p95/p99 latency, error rate, RPO/RTO, restore results and incident counts.
- Security findings, patch age, access review and tenant-isolation findings.

Aspirational targets such as at least 50% lower reconciliation time are hypotheses to validate against baseline and an institution's measured results.

## 11. Ninety-day execution sequence

The timeline is an execution plan, not a guarantee of approvals or customers.

| Period | Engineering focus | Institution/business focus | Required evidence |
|---|---|---|---|
| Days 1–14 | Supported install, bootstrap root cause, clean build/test, health/readiness | Interview 10–15 qualified institutions; select reconciliation pain point | Runtime logs; customer problem evidence |
| Days 15–30 | MongoDB/Redis transactions, replay, ledger invariants, tenant E2E foundations | Secure 3 serious design-partner intentions | Persistent financial integration tests; written pilot intentions |
| Days 31–45 | MTN MoMo sandbox/callback/status proof | Agree exact controlled pilot workflow | Provider request/callback/status evidence |
| Days 46–60 | Reconciliation, tenant isolation, privacy/security and restore | Pilot contract, roles, baseline and support plan | Security/privacy/recovery evidence; signed pilot scope |
| Days 61–75 | Fix high-severity findings; deploy non-production pilot; alerting | Start approved shadow/sandbox pilot | Institution usage, exceptions and weekly metrics |
| Days 76–90 | Complete E2E and operational proof | Seek paid continuation/first subscription | Customer-verified ROI, invoice/payment or approved procurement evidence |

If a prerequisite slips, preserve the gate and update the timeline. Do not mark a gate complete to meet a calendar date.

## 12. Repository execution protocol and required artefacts

### Step A — Establish repository truth

- Inspect branch/remotes/working-tree if `.git` exists. If it does not, say that the source is an archive.
- Inventory package manifests, lockfiles, `.nvmrc`, CI workflows, Dockerfiles/Compose files, environment templates, bootstrap, server, health/readiness, financial services, ledger, idempotency, providers, callbacks, reconciliation, auth/RBAC and all relevant tests.
- Read `TITECH_PLATFORM_TRUTH.md`, the latest handoff, critical gate contract, readiness matrix, provider proof, financial invariants, reconciliation proof, security assessment, tenant isolation proof, backup/restore and public conversion workflow.
- Identify stale conflicting readiness claims and resolve by dated evidence. Do not delete historical records; mark them superseded.

### Step B — Run baseline checks before editing

Run dependency-free checks first: runtime gate, critical-gate contract, syntax/static gates, conflict scan and selected `node --test` suites. Record exact runtime, OS, commands and exit codes. Then run dependency-backed/full tests only in a compatible environment with committed lockfiles installed. Do not install with `--force`, ignore engines, or silently substitute unsupported versions.

### Step C — Implement in small traceable changes

For each change record: issue, root cause, files changed, why each file changed, migration/compatibility impact, security/financial risk, regression tests and evidence level. Fix root causes; no superficial suppression of errors, test disabling, broad `|| true`, fail-open behavior or test assertions that merely inspect source when integration evidence is required.

### Step D — Verify and inspect the diff

- Re-run targeted tests and the relevant static gates after each change.
- Run full root/backend/frontend lint, format, tests, builds and security scans on supported runtime.
- Run replica-set/Redis integration, browser E2E and provider tests where services/credentials/authorization exist.
- Review the complete diff for secrets, PII, generated clutter, lockfile graph drift, duplicate architecture, stale docs, changed identities, unsafe feature flags, disabled tests and misleading success claims.

### Step E — Update evidence, not just code

Use the existing evidence system. Update the authoritative platform truth, matrix, gate contract, change manifest and dated handoff. Each evidence item requires:

- evidence ID and gate;
- test/operation performed;
- date/time, OS, architecture, Node/npm and service versions;
- exact command or procedure and exit result;
- redacted raw output/log and artifact hash;
- evidence level and status;
- owner/reviewer, known limitations and next action.

A generated report alone does not promote the gate. External evidence must be provided and reviewed by the appropriate independent party.

### Step F — Package the handoff

Produce a downloadable ZIP containing the updated source, master prompt, change manifest and evidence report. Exclude `node_modules`, `.env`, credentials, private keys, local databases, caches and temporary artifacts. Include lockfiles and safe `.env.example` placeholders. Record archive SHA-256. If `.git` is absent, do not claim a push/commit.

## 13. Required commands (adapt only when repository scripts differ)

On a clean, supported Node/npm environment:

```bash
node --version
npm --version
npm run check:runtime
npm ci --include=dev
npm ci --prefix backend --include=dev
npm ci --prefix frontend --include=dev
npm run titech:critical-gates
npm run check
npm run test:critical-gates
npm run test:ci
npm run test:backend:ci
npm run test:frontend:ci
npm run build:backend
npm run build:frontend
npm run release:gate
npm run release:gate:strict
npm run production:approval-gate
```

For service-backed validation:

```bash
docker compose -f docker-compose.validation.yml up -d
# Verify MongoDB rs0 has a primary and Redis is healthy/persistent.
npm run test:integration
npm run test:providers
npm run test:backend:ci
# Capture logs before teardown.
docker compose -f docker-compose.validation.yml logs --no-color
docker compose -f docker-compose.validation.yml down --volumes --remove-orphans
```

For a browser E2E and pilot environment, deploy only to an isolated non-production environment with synthetic or expressly authorized data. Do not use real funds. Record all service versions and environment IDs.

## 14. Definition of done and controlled release

The platform may be described as **ready for a controlled external pilot review** only when supported runtime, clean builds, canonical bootstrap, complete in-scope Golden Money Path, tenant/security baseline, operational recovery and a legally reviewed pilot scope have the required evidence and owners.

The platform may be described as **production approved** only after all applicable P0/P1 gates are independently reviewed and accepted, external provider/institution/legal/privacy/security approvals are attached, production deployment/rollback/recovery have been tested, the exact release artifact is identified by hash, and the protected approval process authorizes the release.

The evidence ladder is immutable in order:

`Designed → Implemented → Unit → Integration → E2E → Operational → Security-Assessed → Externally-Approved → Production-Approved`.

A lower rung may not be skipped. Passing source/static checks cannot be upgraded to runtime, operational, security-assessed, external approval or production approval by wording.

## 15. Mandatory final implementation report

Return a factual report with:

1. Executive decision: `NOT_READY`, `PILOT_REVIEW_ELIGIBLE` (only if evidenced), or another explicitly supported state; always state `productionApproved`.
2. Actual source baseline, date, environment/runtime and whether `.git`/remote access existed.
3. Architecture/product areas inspected and preserved.
4. Root causes discovered and implemented changes, with exact paths.
5. Tests/checks run with exact result counts, exit codes and evidence boundaries.
6. Tests not run and the exact blocker (unsupported runtime, no dependencies, no Docker, absent credentials, no external approval, etc.).
7. Financial, provider, tenant/security, recovery and legal status by gate.
8. Actual institutional/customer/partner evidence vs proposed targets.
9. Residual risks, owner and next concrete action.
10. Updated change manifest, report paths and artifact SHA-256.
11. Downloadable updated repository archive.

Close with the operating principle: **BUILD LESS. PROVE MORE. FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**

---

## 16. First three execution decisions

1. Freeze non-essential breadth. Prioritize clean supported runtime, canonical bootstrap and the Golden Money Path.
2. Make verified reconciliation the first market wedge. Integrate existing institution systems where that is safer than replacement.
3. Secure three qualified Ugandan institutional design partners and convert the first measured, authorized pilot into a paying/renewing customer before claiming a commercial breakthrough.

**Do not claim production readiness until the evidence proves it.**

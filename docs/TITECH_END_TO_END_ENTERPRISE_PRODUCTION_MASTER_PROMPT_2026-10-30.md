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

---

## Appendix A — Authentication, Session Security and Dashboard Consolidation Master Prompt (30 October 2026)

The following supplemental prompt is included in full so that authentication/session correctness, legal acceptance, canonical route/dashboard integration and related regression controls remain part of the same end-to-end execution mandate. Its instructions are subordinate to repository truth, fail-closed financial/security controls and the evidence ladder defined above.

# TITech Community Capital — Authentication, Session Security, Dashboard Consolidation and Enterprise Readiness Master Prompt

**Revision:** 30 October 2026  
**Product:** TITech Community Capital  
**Repository:** https://github.com/JustineRobert/titech-community-capital  
**Organization identity:** Preserve the repository's existing canonical organization identity. Do not undertake an unrelated company or product renaming exercise.  
**Primary market:** Uganda → East Africa → Africa → emerging markets → global  
**Engineering principle:** BUILD LESS. PROVE MORE.  
**Financial principle:** FINANCIAL CORRECTNESS BEFORE CONVENIENCE.  
**Initial decision:** `NOT_READY` until the applicable acceptance criteria have been demonstrated.  
**Production approval:** `productionApproved=false` unless all independent production approval requirements are satisfied and explicitly evidenced.

---

# 1. YOUR ROLE AND MANDATE

Act as the principal enterprise software architect, senior full-stack engineer, application security engineer, identity and access management specialist, financial systems engineer, quality assurance lead, DevSecOps engineer and technical auditor responsible for remediating TITech Community Capital.

You are working inside the existing TITech Community Capital repository.

Your assignment is to execute an end-to-end engineering programme covering:

1. Authentication architecture verification and remediation.
2. Registration, invitation and legal acceptance correctness.
3. Login and account-security improvements.
4. Refresh-token rotation, replay prevention and session revocation.
5. Reliable logout and logout-all implementation.
6. Tenant context, RBAC and permission consistency.
7. Frontend protected-route and redirect correctness.
8. Dashboard architecture consolidation.
9. Integration of the existing Administration Center.
10. Role-aware dashboard routing and navigation.
11. Dashboard financial-data correctness and provenance.
12. Risk, fraud and compliance dashboard integrity.
13. Executive and board reporting integration.
14. Institutional onboarding and agriculture dashboard integration.
15. Backend and frontend integration testing.
16. Security, performance, reliability and regression verification.
17. Operational evidence and controlled-readiness assessment.

**This is an implementation assignment, not merely a research, advisory or documentation assignment.**

You must inspect the actual repository, establish the active runtime architecture, implement the highest-priority corrections, execute the tests that the environment supports, repair implementation defects discovered during testing, and provide a reproducible evidence report.

Do not return only a list of recommendations.

Do not claim that something is implemented, secure, tested, operational or production-ready merely because a corresponding component, endpoint, model, test file or dashboard exists.

---

# 2. NON-NEGOTIABLE ENGINEERING RULES

## 2.1 Preserve the existing canonical architecture

Maintain the existing technology stack and established application boundaries:

- React.
- Vite.
- React Router.
- Express with ECMAScript modules.
- MongoDB and Mongoose.
- Redis.
- JWT-based short-lived access authentication.
- Opaque, persistent, hashed refresh-token records.
- HttpOnly refresh-token cookies.
- Existing authentication middleware.
- Existing tenant and institution models.
- Existing RBAC and audit services.
- Existing financial ledger, payment and reconciliation architecture.
- Existing API versioning and service boundaries.

Inspect the repository before selecting implementation locations.

Do not introduce unnecessary alternatives such as:

- `AuthV2`.
- `ApplicationV2`.
- `BootstrapV2`.
- `DashboardV2`.
- `LedgerV2`.
- A new parallel authentication provider.
- A second competing dashboard framework.
- A second permission engine.
- A second tenant-context implementation.

There must be one canonical authentication provider, one authoritative route architecture, one effective permission model and one authoritative source for each financial metric.

Where legacy code exists, reuse, migrate, deprecate or remove it safely according to evidence. Do not simply duplicate it.

## 2.2 Repository truth takes precedence

The supplied 30 October 2026 source review is the remediation baseline, not an unquestionable substitute for inspecting the current repository.

Verify every finding before modifying code.

For each finding, record:

- File path.
- Function, component, endpoint or model.
- Existing behaviour.
- Reproduction method.
- Actual risk.
- Proposed correction.
- Implemented change.
- Relevant test.
- Test result.
- Remaining limitation.

If a finding is no longer applicable, record why and provide evidence. Do not make unnecessary modifications just to match the wording of the review.

## 2.3 Protect the legal and financial boundaries

Do not weaken or bypass existing:

- Registration legal gates.
- Institution invitation requirements.
- Email verification requirements.
- Tenant-isolation controls.
- Maker-checker requirements.
- Financial ledger invariants.
- Payment-provider verification requirements.
- Reconciliation requirements.
- Audit requirements.
- Security approval gates.

Do not activate regulated financial services merely because dashboard screens or API endpoints exist.

Do not imply that a payment was settled because it was initiated, submitted to a provider or returned a preliminary acknowledgement.

Do not interpret missing risk data as evidence of zero risk.

Do not interpret missing fraud data as evidence of zero fraud.

Do not display fabricated financial, regulatory, institutional, executive or operational metrics.

## 2.4 Preserve the production-readiness decision

Keep:

`productionApproved=false`

until the actual approval criteria are satisfied.

Use the existing evidence ladder:

`Designed → Implemented → Unit-Tested → Integration-Tested → E2E-Tested → Operationally-Verified → Security-Assessed → Externally-Approved → Production-Approved`

Passing a unit test does not prove operational readiness.

Passing frontend tests does not prove database transaction correctness.

Passing a mocked provider test does not prove live provider settlement.

A dashboard rendering successfully does not establish financial-data correctness.

## 2.5 Work incrementally

Implement in controlled stages:

1. Inspect.
2. Establish a baseline.
3. Identify canonical implementations.
4. Prioritise.
5. Remediate.
6. Test.
7. Verify.
8. Document.
9. Reassess readiness.

Avoid unrelated rewrites and large changes that cannot be independently reviewed.

---

# 3. PROJECT BASELINE TO VERIFY

The source review identifies the following canonical active application flow:

```text
frontend/index.html
       |
       v
frontend/src/main.jsx
       |
       v
frontend/src/app/providers.jsx
       |
       v
frontend/src/context/AuthContext.jsx
       |
       v
frontend/src/routes/AppRoutes.jsx
       |
       +---- Login
       +---- Register
       +---- Verify Email
       +---- Forgot Password
       +---- Reset Password
       |
       +---- Protected Application
                    |
                    +---- Dashboard
                    +---- Members
                    +---- Savings
                    +---- Loans
                    +---- Transactions
                    +---- Reports
                    +---- Payroll
                    +---- Settings
                    +---- Access Governance
```

The review identifies:

- `frontend/src/context/AuthContext.jsx` as the active authentication provider.
- `frontend/src/app/providers.jsx` as its integration point.
- `frontend/src/routes/AppRoutes.jsx` as the active Vite route tree.
- `frontend/src/pages/Dashboard.jsx` as the currently accessible community dashboard.
- `frontend/src/layouts/AdminLayout.jsx` as the active application shell.

The following other authentication or route implementations may exist:

- `AuthProvider.jsx`.
- Older `App.jsx`.
- Older route configurations.
- Legacy administrator components.

Verify actual imports and runtime reachability before editing any of them.

The review also identifies these existing dashboard components:

| Component | Source |
|---|---|
| Community Dashboard | `frontend/src/pages/Dashboard.jsx` |
| Enterprise Administration Center | `frontend/src/pages/admin/AdminDashboard.jsx` |
| Legacy User and Group Administration | `frontend/src/pages/AdminDashboard.jsx` |
| Financial Analytics Dashboard | `frontend/src/pages/dashboard/AdminDashboard.jsx` |
| Executive and Board Dashboard | `frontend/src/pages/dashboard/ExecutiveDashboard.jsx` |
| Integrated Enterprise Dashboard | `frontend/src/pages/dashboard/Dashboard.jsx` |
| Risk Intelligence Dashboard | `frontend/src/pages/AdminRiskDashboard.jsx` |
| Agriculture Dashboard | `frontend/src/pages/agriculture/AgricultureDashboard.jsx` |
| SACCO Onboarding Dashboard | `frontend/src/pages/onboarding/OnboardingDashboard.jsx` |

These are candidates for reuse and integration. Their existence is not proof of active routing, complete data integration or production verification.

---

# 4. STAGE ZERO — REPOSITORY DISCOVERY AND BASELINE

Before implementing anything, inspect the repository thoroughly.

## 4.1 Inspect the active application entry points

Trace:

- `frontend/index.html`.
- `frontend/src/main.jsx`.
- `frontend/src/app/providers.jsx`.
- Authentication context imports.
- Router imports.
- Active route definitions.
- Application layouts.
- Sidebar navigation.
- Permission components.
- API clients.
- Backend bootstrap.
- Express application initialization.
- Authentication middleware.
- Authentication routes and controllers.
- User and refresh-token models.

Produce a verified dependency map.

Identify source files that are active, indirectly imported, legacy, duplicated, orphaned or test-only.

Do not treat file names alone as proof of active usage.

## 4.2 Inspect package and runtime configuration

Inspect:

- Root and frontend/backend `package.json` files.
- Lockfiles.
- Node engine declarations.
- npm requirements.
- Vite configuration.
- Express startup configuration.
- MongoDB connection configuration.
- Redis configuration.
- Environment variable validation.
- Docker and Compose files.
- Test configuration.
- Build and CI scripts.

Use the repository's declared supported Node and npm versions. The expected baseline from the project configuration is Node 24.15+ and npm 11+, but confirm the actual declarations before execution.

Do not change package engines merely to make an unsupported local environment appear compliant.

Preserve existing configured service ports, database names, Redis key prefixes, cookie settings and API version conventions unless an evidenced defect requires correction.

Never expose environment secrets in logs or reports.

## 4.3 Establish a clean baseline

Run available checks before modification:

```powershell
node --version
npm --version
git status --short
git branch --show-current
git log -1 --oneline
```

Inspect scripts before running them:

```powershell
npm run
```

Run the repository-supported equivalents of:

```text
dependency installation
lint
frontend build
backend syntax/module checks
unit tests
integration tests
frontend tests
backend tests
security checks
```

Use the correct workspace commands from the repository.

Capture all output, exit codes and environmental blockers.

Distinguish:

- A failed test.
- A missing test.
- An empty test suite.
- An unavailable database.
- An unavailable Redis service.
- An incompatible runtime.
- A missing external provider credential.
- A source-code defect.

Do not convert an unavailable integration dependency into a fabricated passing test.

## 4.4 Create a baseline evidence report

Create or update:

`docs/auth-dashboard/AUTH_DASHBOARD_BASELINE.md`

Include:

- Active frontend entry point.
- Canonical authentication provider.
- Active router.
- Authentication endpoint map.
- Existing token model.
- User/session model.
- Role and permission model.
- Dashboard inventory.
- Active versus inactive routes.
- Existing API dependencies.
- Initial test status.
- Known environmental limitations.
- Confirmed versus unconfirmed review findings.

---

# 5. STAGE ONE — AUTHENTICATION ARCHITECTURE REMEDIATION

## 5.1 Establish one canonical authentication implementation

Use the currently active authentication provider and backend authentication services as the canonical implementation unless repository evidence demonstrates that another existing implementation is already authoritative.

Do not maintain two active providers that can produce different user, tenant, token or logout states.

Review:

- `frontend/src/context/AuthContext.jsx`.
- `frontend/src/app/providers.jsx`.
- `frontend/src/services/api.js`.
- Login, registration and verification pages.
- Backend authentication routes.
- Authentication controllers.
- Authentication middleware.
- User model.
- RefreshToken model.
- Password-reset and verification services.

Document deprecated implementations and their consumers before removing or consolidating anything.

## 5.2 Define the required authentication states

Use explicit authentication states rather than ambiguous booleans.

At minimum:

```text
INITIALIZING
CHECKING
API_UNAVAILABLE
ANONYMOUS
AUTHENTICATING
AUTHENTICATED
REFRESHING
SESSION_EXPIRED
SIGNING_OUT
SIGNED_OUT
SECURITY_ERROR
```

The implementation can use the repository's established state model if it provides equivalent semantics.

Requirements:

- A browser reload must not assume that a previous in-memory session still exists.
- A browser reload must attempt restoration through the refresh-cookie mechanism.
- Access tokens must remain in application memory.
- Refresh tokens must remain inaccessible to JavaScript.
- API unavailability must not be confused with an anonymous session.
- A failed refresh must not silently manufacture an authenticated user.
- An older asynchronous authentication request must not overwrite a newer logout or login operation.
- Logout must invalidate any in-flight refresh operation using an authentication generation or equivalent concurrency-safe mechanism.

Do not persist access or refresh tokens in:

- `localStorage`.
- `sessionStorage`.
- IndexedDB.
- Browser-readable cookies.
- URL parameters.
- Browser history.
- Logs or analytics payloads.

A non-secret display preference or user-interface state may be persisted where appropriate, but it must not establish authentication.

---

# 6. P0 — LOGOUT REVOCATION AND FAILURE CORRECTNESS

This is the first critical remediation.

## 6.1 Existing defect to verify

The review identifies backend logic in `backend/controllers/authController.js` that ignores refresh-token lookup or revocation errors and still clears the refresh cookie and returns HTTP 204.

The frontend also catches logout API errors, proceeds with local cleanup and can display:

`Logged out successfully`

This conflates local sign-out with confirmed persistent server-side session revocation.

## 6.2 Required backend behaviour

Rework the canonical logout operation.

For a valid presented refresh token:

1. Extract the refresh token securely from the configured cookie.
2. Hash it using the same secure token-hashing mechanism used when it was issued.
3. Locate the corresponding authoritative refresh-token record.
4. Revoke the session using an atomic and appropriately conditional database operation.
5. Record revocation metadata and an audit event where required.
6. Confirm the required persistent state.
7. Clear the refresh cookie.
8. Return a success response only when the applicable revocation semantics are satisfied.

For an already-revoked token:

- Treat logout idempotently.
- Do not restore or recreate a session.
- Confirm the session remains revoked.
- Clear the cookie.

For a missing refresh token:

- Clear the configured cookie.
- Make no false claim that a persistent session was revoked.
- Apply the agreed idempotent logout contract consistently.

For MongoDB failure:

- Do not swallow the error.
- Do not claim confirmed server-side revocation.
- Return an appropriate service error.
- Log a safe operational error identifier without recording the raw token.
- Preserve the distinction between persistence failure and an already-revoked session.

Use appropriate status codes, such as 503 when the authoritative persistence dependency is unavailable, according to the existing API error conventions.

Do not return success merely because cookie deletion succeeded.

## 6.3 Required frontend behaviour

Local sign-out must remain possible even if the backend is unavailable.

The frontend should:

1. Invalidate the authentication generation.
2. Cancel refresh timers.
3. Cancel or invalidate pending authenticated requests where appropriate.
4. Attempt server-side revocation.
5. Disconnect authenticated sockets.
6. Clear the in-memory access token.
7. Clear authenticated user state.
8. Clear frontend tenant context.
9. Notify other browser tabs.
10. Navigate to the unauthenticated application state.
11. Display an accurate result.

Differentiate at least:

- `SERVER_SESSION_REVOKED`.
- `SESSION_ALREADY_REVOKED`.
- `NO_SERVER_SESSION_PRESENT`.
- `LOCAL_SIGNOUT_COMPLETE_SERVER_REVOCATION_UNCONFIRMED`.

Never tell users that server-side logout succeeded after the revocation API has failed.

Ensure the user cannot continue using protected application screens after local sign-out simply because server revocation failed.

## 6.4 Audit and privacy

Record security-relevant logout events without storing raw refresh tokens, passwords or unnecessary sensitive request data.

Include appropriate:

- User/session reference.
- Tenant reference.
- Timestamp.
- Event type.
- Result.
- Safe correlation ID.
- Failure category.

Ensure logging failures do not accidentally restore an authenticated session or conceal a revocation failure.

## 6.5 Required logout tests

Implement and execute:

| Test | Expected result |
|---|---|
| Logout with valid refresh token | Persistent session revoked |
| Logout with missing token | Cookie cleared; no false revocation claim |
| Logout with already-revoked token | Idempotent outcome |
| Logout with expired token | No active session remains |
| MongoDB unavailable | No false server success |
| Database update failure | Correct service error |
| Cookie deletion | Correct cookie name, path and attributes |
| Frontend logout API failure | Local sign-out still completes |
| Logout during refresh | Refresh cannot restore session |
| Logout in one browser tab | Other tabs clear authentication |
| Socket connection active | Authenticated socket disconnected |
| Re-login after logout | New session established independently |

Acceptance requirement:

**No test may establish successful server-side logout when persistent revocation could not be confirmed.**

---

# 7. P0 — ACCESS-TOKEN REVOCATION AND SECURITY VERSION ENFORCEMENT

## 7.1 Verify the existing implementation

Inspect:

- JWT generation.
- `securityVersion`.
- `sessionVersion`.
- User model fields.
- Authentication middleware.
- Password-change logic.
- Logout-all.
- Administrative session revocation.
- Account suspension and reactivation.

The review indicates that version claims are included in JWTs but are not compared with authoritative persisted values in the canonical middleware.

Confirm this before changing the implementation.

## 7.2 Required implementation

Every protected request must validate:

1. JWT signature.
2. Allowed algorithm.
3. Issuer and audience where configured.
4. Expiration.
5. Subject and token identity.
6. Required security/session claims.
7. Current authoritative user existence.
8. Current account status.
9. JWT version claims against persisted authoritative user versions.
10. Applicable tenant and session permissions.

Use the repository's canonical user and authentication services.

The version comparison must reject a JWT whose security/session version no longer matches the authoritative user record.

Missing or invalid version claims must follow a deliberate fail-closed policy. Do not silently accept old tokens without a documented and tested migration policy.

Ensure version validation occurs in the canonical middleware used by protected API routes.

Do not rely only on frontend state or refresh-token revocation.

## 7.3 Logout-all

Implement or correct:

`POST /api/auth/logout-all`

It must:

1. Authenticate and authorize the requesting user.
2. Revoke all applicable active refresh-token records.
3. Increment the authoritative session/security version according to the selected revocation model.
4. Persist the result safely.
5. Produce an auditable result.
6. Prevent old access tokens from continuing to access protected endpoints.
7. Prevent old refresh tokens from creating new sessions.

Where multiple persistence writes must remain consistent, use a transaction or a concurrency-safe implementation with demonstrated semantics.

## 7.4 Additional revocation events

Test session invalidation after:

- Logout-all.
- Password change.
- Password reset.
- Administrative session revocation.
- Account suspension.
- Account disablement.
- Security incident requiring forced reauthentication.
- User removal or deactivation.

Acceptance criterion:

A previously issued access JWT must be rejected after the corresponding authoritative revocation event, not merely after its natural expiry.

Document any deliberate cache or propagation window. Do not claim instantaneous revocation if a cache permits stale authorization data.

---

# 8. P0 — ATOMIC REFRESH-TOKEN ROTATION AND REPLAY PROTECTION

## 8.1 Verify the existing defect

Inspect the canonical refresh operation in:

`backend/controllers/authController.js`

The review identifies an implementation where:

- A MongoDB session is created.
- The existing refresh token is read.
- A replacement token is generated.
- The old token is revoked.
- Replacement metadata is updated.
- A transaction is committed.

However, `createRefreshToken()` appears to write using `RefreshToken.create()` without receiving the active MongoDB session.

The replacement record may therefore be written outside the transaction.

The review also identifies a non-transactional fallback when starting a transaction fails.

Verify the actual source before changing it.

## 8.2 Required rotation model

Implement one-time rotation with atomic persistence.

The intended lifecycle is:

```text
ACTIVE REFRESH TOKEN
        |
        v
VALIDATE TOKEN HASH
        |
        v
CHECK EXPIRATION
        |
        v
CHECK USER STATUS
        |
        v
BEGIN ATOMIC ROTATION
        |
        +---- Create replacement record
        |
        +---- Revoke previous token
        |
        +---- Link replacement metadata
        |
        +---- Preserve token-family history
        |
        v
COMMIT TRANSACTION
        |
        v
SET NEW HTTPONLY COOKIE
        |
        v
RETURN NEW ACCESS TOKEN
```

Every relevant persistence write must use the same MongoDB session.

Refactor token-creation helpers to accept and correctly pass an optional transaction session where appropriate.

Do not silently fall back to non-transactional refresh rotation in production.

If transaction support is unavailable, return an appropriate service-unavailable error and preserve the previous authoritative state.

The test environment must support MongoDB transactions through an appropriate replica-set configuration. Do not use a standalone in-memory MongoDB instance to claim successful transaction verification.

## 8.3 Concurrency and one-time-use requirements

The old token must be consumed exactly once.

Use a conditional atomic transition that verifies the token is still:

- Active.
- Not revoked.
- Not expired.
- Associated with the expected user and token family.
- Eligible for rotation.

The operation must not permit two concurrent refresh requests to establish two independently valid replacement sessions from the same token.

Use conditional updates, transactions and unique constraints as appropriate.

Handle write conflicts and transient transaction errors safely, using bounded retries where justified.

Do not retry an operation in a way that creates multiple replacement records or reuses a consumed token.

## 8.4 Token reuse detection

Maintain token-family relationships.

Where reuse of a previously rotated token is detected:

- Reject the request.
- Apply the documented token-family revocation policy.
- Prevent descendants in the compromised family from remaining active where the policy requires revoking the family.
- Record a security event.
- Do not reveal raw token data.
- Do not expose unnecessary information about other sessions.

Do not interpret routine concurrent browser-tab coordination as proof of malicious activity. The frontend must coordinate refresh requests and the backend must remain authoritative.

## 8.5 Refresh-cookie security

Verify:

- `HttpOnly`.
- `Secure` in the relevant production environment.
- Deliberate `SameSite` policy.
- Correct path.
- Correct domain policy.
- Expiration and maximum age.
- Exact CORS origins.
- Credentialed requests.
- Appropriate CSRF protection for cookie-authenticated operations.

The frontend must not read the refresh token.

Ensure cookie clearing uses attributes compatible with the original cookie configuration.

## 8.6 Required refresh tests

| Scenario | Expected behaviour |
|---|---|
| Valid refresh | Exactly one replacement |
| Expired refresh | Rejected |
| Unknown refresh | Rejected |
| Revoked refresh | Rejected |
| Replayed previous token | Rejected and reuse policy applied |
| Two simultaneous requests | Only one successful rotation |
| Multiple browser tabs | Shared refresh coordination |
| Replacement write failure | Old token state remains transactionally correct |
| Old-token revocation failure | No partial successful rotation |
| MongoDB transaction unavailable | No unsafe fallback |
| Backend restart during rotation | Persistent state remains consistent |
| Redis failure/restart | No invalid authentication restoration |
| Suspended account | Refresh rejected |
| Disabled account | Refresh rejected |
| User password reset | Old sessions invalidated according to policy |

Acceptance criterion:

**Refresh-token replacement and consumption must be one demonstrated atomic operation.**

---

# 9. P0/P1 — INVITATION REGISTRATION AND LEGAL ACCEPTANCE

## 9.1 Preserve institutional invitation registration

TITech registration is controlled institutional onboarding, not unrestricted public self-registration.

A valid tenant invitation is required.

Preserve the following rules:

- Invitation must exist.
- Invitation must not be revoked.
- Invitation must not be expired.
- Invitation must not exceed its permitted usage limit.
- Invitation must be scoped to the relevant institution or tenant.
- Invitation must not grant privileges beyond its defined scope.
- Registration must not automatically establish an authenticated session unless a separately approved policy explicitly requires it.

Do not remove invitation restrictions to simplify testing or improve conversion.

## 9.2 Make invitation consumption transactional

Inspect invitation validation, usage increments and user creation.

Where invitation consumption and account creation must be consistent:

- Use one MongoDB transaction.
- Pass the same session to every relevant operation.
- Enforce invitation usage limits atomically.
- Protect against concurrent invitation consumption.
- Enforce database-level email uniqueness.
- Handle duplicate registration attempts safely.
- Prevent invitations being consumed without a corresponding successful account creation.

If transactions cannot be supported by the current runtime infrastructure, preserve the production gate and document the blocker.

## 9.3 Align password validation

The review identifies a mismatch between frontend and backend password requirements.

Implement one canonical password-policy definition shared across the application where practical.

Required baseline:

- Minimum 12 characters.
- Maximum 128 characters.
- Explicit, consistently implemented complexity policy.
- Clear and accessible validation messages.
- Consistent frontend, API, model and test behaviour.
- Safe password hashing.
- No plaintext password logging.

Avoid duplicating slightly different password validators across several files.

Ensure the maximum length and encoding behaviour are intentional and tested.

Frontend validation is for usability. Backend validation remains authoritative.

Test passwords below minimum, at minimum, within range and above maximum.

## 9.4 Legal acceptance must be persisted

Preserve the current production registration gate.

The source review indicates:

- Legal acceptance integration is explicitly disabled.
- A shared legal document is marked draft.
- Acceptance integration is not integrated.
- Production registration is blocked.

Do not change a false legal-integration constant to true simply to enable registration.

Implement the missing legal workflow.

Requirements:

1. Published Terms of Service.
2. Published Privacy Policy.
3. Approved document versions.
4. Immutable document version or content-hash reference.
5. Explicit user acceptance.
6. Acceptance timestamp.
7. Link to the newly created user/account.
8. Applicable tenant/institution context.
9. An auditable acceptance event.
10. A retrievable acceptance history.
11. A deliberate process for future document-version changes.
12. No automatic acceptance of later versions on behalf of the user.

Capture only legally justified request metadata. Avoid unnecessary personal-data collection.

Differentiate Terms of Service acceptance from Privacy Policy acknowledgement where legally and operationally required.

Do not store only frontend checkbox values without persistent backend evidence.

The registration controller must verify actual acceptance against currently published, approved legal documents.

## 9.5 Registration production gate

Production registration may only become available when:

- Legal documents are published.
- Current approved versions are retrievable.
- Acceptance persistence works.
- Acceptance audit records are verified.
- Invitation consumption is transactionally correct.
- Password validation is consistent.
- Email verification workflow is sufficiently operational.
- Applicable legal and product approvals exist.

Otherwise, return a truthful service-unavailable or registration-disabled response using the established API error contract.

## 9.6 Email verification and resend

Inspect:

- Email verification request.
- Token generation.
- Token storage.
- Token expiry.
- Verification endpoint.
- Email provider integration.
- Resend endpoint.
- Rate limiting.
- Frontend status handling.

Verification tokens must be securely generated and stored using a suitable hashed representation.

Verification must be one-time and time-limited.

Do not leak verification tokens in logs, analytics, error messages or browser URLs beyond the necessary controlled workflow.

Implement truthful delivery states, such as:

```text
NOT_REQUESTED
QUEUED
SENDING
SENT
DELIVERY_CONFIRMED
FAILED
DELIVERY_UNKNOWN
```

Use only states that the actual provider integration can substantiate.

A successful queue operation is not equivalent to successful delivery.

A development console log is not a production email-delivery service.

Where an email provider supports delivery webhooks, verify their authenticity and correlate events safely.

Provide a safe resend workflow with rate limiting and account-enumeration protections.

## 9.7 Required registration tests

Test:

- Registration without invitation.
- Invalid invitation.
- Expired invitation.
- Revoked invitation.
- Exhausted invitation.
- Concurrent use of a limited invitation.
- Duplicate email.
- Password below 12 characters.
- Password above the maximum.
- Valid password.
- Missing Terms acceptance.
- Missing Privacy acknowledgement where required.
- Draft legal publication.
- Unapproved legal publication.
- Valid published legal versions.
- Database failure during registration.
- Email-service failure.
- Email resend rate limit.
- Invalid verification token.
- Expired verification token.
- Reused verification token.
- Successful verification.
- Login before verification.
- Login after verification.

---

# 10. P1 — LOGIN CORRECTNESS, RATE LIMITING AND DEEP-LINK RESTORATION

## 10.1 Login behaviour

Preserve the existing credential and account checks:

- User existence.
- Password validity.
- Email verification.
- Account status.
- Account lockout.
- Tenant membership and status.
- Security/session validity.
- Applicable login policy.

Avoid username/email enumeration.

Use consistent generic credential error responses where required.

Preserve appropriate distinctions for unverified, suspended or locked accounts without unnecessarily revealing sensitive account information.

## 10.2 Rate limiting

Inspect the existing login rate limiter.

The review identifies a default in-process limiter store, which may not coordinate requests across multiple backend instances.

Use a distributed Redis-backed rate-limiting implementation where required by the deployment architecture.

Requirements:

- Per-IP controls.
- Account-based controls that avoid unsafe user enumeration.
- Appropriate limits for login.
- Appropriate limits for verification and resend.
- Appropriate limits for password recovery.
- Appropriate controls for refresh and sensitive session endpoints.
- Documented key expiry.
- Safe error responses.
- Metrics and operational visibility.
- Deliberate Redis-unavailable behaviour.

Do not silently fall back to an uncoordinated in-memory limiter in production.

The browser-side five-attempt/15-minute lockout may remain as additional usability protection. It must not be treated as the security authority.

## 10.3 Deep-link redirect correction

The review identifies a mismatch:

- ProtectedRoute stores the original path as a string.
- Login expects `location.state.from.pathname`.

Inspect the active implementation.

Create one canonical redirect-state structure.

Preserve:

- Original pathname.
- Query parameters.
- Hash fragment.

Validate the resulting target as a local application path.

Prevent open redirects to arbitrary external websites.

After login:

1. Validate the stored target.
2. Confirm the user is authorized to access it.
3. Navigate to the original destination where permitted.
4. Otherwise navigate to the appropriate authorized dashboard.

Test:

```text
/dashboard
/members?page=2
/groups/example-id?tab=members#summary
/admin/access
```

Also test malicious external and malformed redirect values.

Do not make the original destination override access-control decisions.

---

# 11. P1 — TENANT CONTEXT AND CENTRALIZED RBAC

## 11.1 Server-authoritative tenant identity

The source review indicates that the backend derives the authenticated tenant from the persisted user, but the login response and frontend profile do not consistently provide `tenantId`.

Inspect actual user, tenant, membership and authentication-response contracts.

Where authorized and appropriate, expose a stable tenant identifier in the authenticated user profile and relevant login/profile responses.

The frontend may use this identifier for display, application navigation and context synchronization.

It must never be trusted as the authority for tenant access.

The backend must derive and validate tenant scope using the authenticated identity and authorized membership.

Never allow a client-submitted tenant ID to override the server-authoritative tenant.

## 11.2 Consistent authorization model

The application shell and dashboard analytics reportedly use different administrator-role lists.

Centralize role and permission decisions using the existing canonical authorization service.

Do not make authorization dependent on hard-coded UI role strings scattered through components.

Define permission codes based on actions and resources, for example:

```text
dashboard.member.read
dashboard.group.read
dashboard.institution.read
dashboard.admin.read
dashboard.executive.read
dashboard.risk.read
dashboard.onboarding.read

users.read
users.manage
groups.read
groups.manage
groups.approve

financial.analytics.read
financial.reconciliation.read

risk.read
risk.investigate

compliance.read
compliance.manage

institution.manage
platform.manage
access_governance.manage
```

These are illustrative identifiers. Reuse existing permissions where equivalent ones already exist.

Use explicit policy mappings rather than assuming that every `admin` role can access every administrative resource.

## 11.3 Backend enforcement

Every protected endpoint must perform server-side authorization.

Implement or verify:

- Authentication.
- Account status.
- Tenant scope.
- Role/permission.
- Resource ownership.
- Institution membership.
- Action-specific authorization.
- Audit requirements.

Frontend route guards and hidden menu items are not security boundaries.

Test cross-tenant access attempts, direct API calls and privilege escalation.

---

# 12. DASHBOARD CONSOLIDATION — ONE CANONICAL ROUTE ARCHITECTURE

## 12.1 Objective

TITech already has substantial dashboard source code.

The immediate problem is not simply insufficient dashboard UI. It is inconsistent integration, fragmented data access, route incompleteness and multiple competing implementations.

Create one canonical dashboard architecture that reuses the best existing work.

Do not build another general-purpose dashboard merely to solve route integration.

## 12.2 Canonical dashboard structure

The intended structure is:

```text
TITech Community Capital
          |
          v
Canonical Application Shell
          |
          +---- Authentication
          |
          +---- Authoritative Tenant Context
          |
          +---- RBAC and Permissions
          |
          +---- Dashboard Resolver
                   |
                   +---- Member Dashboard
                   |
                   +---- Group / Community Dashboard
                   |
                   +---- Institution Dashboard
                   |
                   +---- Administration Center
                   |
                   +---- Executive and Board Dashboard
                   |
                   +---- Risk Intelligence
                   |
                   +---- SACCO Onboarding
                   |
                   +---- Agriculture Workspace
          |
          v
Canonical Data and Service Layer
          |
          +---- MongoDB
          +---- Redis
          +---- Double-Entry Ledger
          +---- Payment Evidence
          +---- Reconciliation
          +---- Audit
          +---- Reporting Read Models
          +---- Operational Readiness
```

These are purpose-specific workspaces inside one application, not separate competing applications.

## 12.3 Role-oriented landing pages

Use the following as the target access model, subject to the repository's actual role definitions and institution structure.

| User role or purpose | Recommended default |
|---|---|
| Member | Member Dashboard |
| Group administrator | Group / Community Dashboard |
| SACCO/MFI operator | Institution Dashboard |
| Tenant administrator | Institution Administration |
| Platform administrator | Platform Administration |
| Risk/compliance officer | Risk Intelligence |
| Executive/director | Executive and Board |
| Onboarding officer | SACCO Onboarding |

A user with multiple authorized roles must have a deliberate, secure dashboard-selection policy.

Do not invent a role or assign permissions merely to make a dashboard visible.

## 12.4 Route integration

Audit the active route tree in:

`frontend/src/routes/AppRoutes.jsx`

Compare it with:

- `frontend/src/pages/admin/AdminDashboard.jsx`.
- `frontend/src/pages/AdminDashboard.jsx`.
- `frontend/src/pages/dashboard/AdminDashboard.jsx`.
- `frontend/src/pages/dashboard/ExecutiveDashboard.jsx`.
- `frontend/src/pages/dashboard/Dashboard.jsx`.
- `frontend/src/pages/AdminRiskDashboard.jsx`.
- `frontend/src/pages/agriculture/AgricultureDashboard.jsx`.
- `frontend/src/pages/onboarding/OnboardingDashboard.jsx`.
- `frontend/src/layouts/AdminLayout.jsx`.
- `frontend/src/routes/routeConfig.js`.

Create a canonical route and permission matrix.

Potential route structure:

```text
/dashboard
/members
/groups
/groups/create
/groups/:id

/savings
/loans
/transactions
/reports
/payroll

/admin
/admin/users
/admin/groups
/admin/approvals
/admin/access

/executive-dashboard
/risk
/onboarding
/agriculture

/settings
/logout
```

This is a target route proposal, not permission to register every path unconditionally.

Inspect existing APIs, components, data contracts and feature gates before activating a route.

Where functionality is incomplete:

- Keep the route safely unavailable.
- Display an honest controlled state.
- Do not expose broken pages as operational modules.
- Do not remove the underlying business data or existing source implementation unnecessarily.

Do not maintain a separate active legacy route tree.

If `/logout` is registered, it must invoke the canonical logout mechanism. It must not implement a second logout service.

---

# 13. COMMUNITY DASHBOARD REMEDIATION

Canonical source identified:

`frontend/src/pages/Dashboard.jsx`

Canonical active route:

`/dashboard`

## 13.1 Preserve useful existing functionality

Retain the implemented features where verified:

- Community overview.
- Total savings.
- Groups.
- Members.
- Active loans.
- Community group cards.
- Membership/contribution information.
- Group actions.
- Loading and error states.
- Manual refresh.
- Automatic refresh.
- Abortable API requests.
- Responsive layout.

Do not discard working functionality merely because another dashboard component exists.

## 13.2 Correct group navigation

The review identifies links to:

- `/groups`.
- `/groups/create`.
- `/groups/:id`.

Verify whether the pages and associated APIs exist.

Integrate valid group pages into the active route architecture.

Ensure group actions are authorized for the current user and tenant.

Do not make links appear operational when their destinations are missing or inaccessible.

## 13.3 Correct administration navigation

The community dashboard reportedly links to `/admin`, but that route is missing.

Replace the hard-coded or inconsistent administrator navigation with a centralized permission-aware route link.

Only appropriately authorized users should see and access the administration entry.

Ensure that the backend also enforces the relevant permissions.

## 13.4 Correct fraud analytics defaults

The current implementation reportedly supplies:

```javascript
[
  { name: "Clean", value: 100 },
  { name: "Flagged", value: 0 }
]
```

when fraud statistics are missing.

Remove this misleading fallback.

A missing API response, null value, unavailable risk service or failed request must never be converted into a 100% clean result.

Represent missing states explicitly:

```text
AVAILABLE
PARTIALLY_AVAILABLE
NO_DATA
UNAVAILABLE
STALE
ERROR
```

Use `null` or a structured unavailable state rather than invented zero values.

Distinguish:

- No recorded events.
- No data available.
- Risk-service unavailable.
- Data not yet populated.
- Data stale.
- Failed request.

Only display a clean-versus-flagged chart when an authoritative dataset is available.

## 13.5 Make the readiness indicator truthful

Remove the static operational assertion:

`TITech Community Capital services operational`

Integrate with:

`GET /api/v1/ready`

Use the existing readiness response schema.

Show truthful states such as:

```text
READY
DEGRADED
NOT_READY
UNAVAILABLE
```

Distinguish liveness from readiness.

A successful HTTP connection is not sufficient evidence that all required services are ready.

Display last-checked time and a safe explanation for degraded or unavailable status.

Do not expose sensitive infrastructure information to ordinary members.

## 13.6 Centralize administrator visibility

Use the canonical permission service rather than separate administrator-role arrays.

Verify all roles and permissions against the backend authorization model.

---

# 14. ENTERPRISE ADMINISTRATION CENTER

Canonical candidate:

`frontend/src/pages/admin/AdminDashboard.jsx`

Proposed active route:

`/admin`

## 14.1 Objective

Integrate this component as the canonical Administration Center, subject to verification.

It is preferable to retain a dedicated administrative landing page rather than force all platform administration into the ordinary community dashboard.

## 14.2 Preserve and consolidate useful features

Inspect and retain verified functionality for:

- Total users.
- Active users.
- Active groups.
- Pending approvals.
- Active loans.
- Total savings.
- Recent activity.
- Platform overview.
- Quick actions.
- Dashboard health and refresh feedback.

Use existing service APIs where correct:

- `/api/admin/stats`.
- `/api/admin/activity`.

Do not assume that the API response contains accurate or reconciled statistics simply because the endpoint returns HTTP 200.

## 14.3 Reuse legacy user and group management

Inspect:

`frontend/src/pages/AdminDashboard.jsx`

Extract useful functionality into the canonical Administration Center or its dedicated subroutes:

- User management.
- Group requests.
- Pending approvals.
- Approved groups.
- KYC/AML entry points.
- Risk Engine entry points.
- Approval processing.
- User lifecycle operations.

Avoid a second competing administrator dashboard.

Preserve maker-checker controls for sensitive approval operations.

Do not allow an administrator to approve their own restricted action where the policy prohibits it.

---

# 15. ENTERPRISE FINANCIAL ANALYTICS DASHBOARD

Candidate:

`frontend/src/pages/dashboard/AdminDashboard.jsx`

## 15.1 Consolidate, do not duplicate

Inspect its existing:

- Members KPI.
- Savings KPI.
- Loan portfolio.
- Transactions.
- Mobile Money.
- Fraud cases.
- Savings trend.
- Loan distribution.
- Transaction volume.
- Fraud analytics.
- Executive summary.
- Regulatory reporting.
- System health.

Extract reusable analytics components into the canonical dashboard/service architecture.

Do not preserve an unnecessary third general-purpose administrator landing page.

## 15.2 Financial metric correctness

Every financial KPI and chart must identify or make retrievable:

- Metric name.
- Authoritative data source.
- Tenant/institution scope.
- Currency.
- Reporting period.
- Calculation method.
- Aggregation timestamp.
- Last successful update.
- Evidence status.
- Freshness status.
- Relevant exclusions or caveats.

Do not combine different currencies without a verified conversion methodology and documented valuation time.

Do not present initiated payments as settled payments.

## 15.3 Payment lifecycle distinctions

At minimum, maintain explicit distinctions between:

```text
INITIATED
PENDING
PROVIDER_ACCEPTED
VERIFIED
SETTLED
RECONCILED
FAILED
REVERSED
REFUNDED
UNKNOWN
```

Reuse the existing canonical payment and provider status model where available.

Do not assume every listed status must be a separate enum in every subsystem. Establish a clear mapping to the actual authoritative state machine.

Important:

- Provider acknowledgement does not automatically equal settlement.
- Settlement does not automatically equal reconciliation.
- An HTTP timeout does not automatically mean failure.
- An unknown provider outcome must remain unknown until independently resolved.
- Reversal and refund must be represented as distinct financial events.
- Financial charts must derive from verified authoritative financial records.

## 15.4 Double-entry ledger integrity

Dashboard aggregations must use the canonical financial transaction and ledger services.

Maintain:

- Balanced postings.
- Exact monetary representation using suitable decimal or integer minor-unit arithmetic.
- Currency consistency.
- Immutable or appropriately corrected transaction history.
- Reversal and refund traceability.
- Tenant isolation.
- Reconciliation status.
- Period-close semantics.

Never calculate authoritative balances by simply adding frontend payment events.

Do not introduce a new ledger merely to support dashboard reporting.

---

# 16. EXECUTIVE AND BOARD DASHBOARD

Candidate:

`frontend/src/pages/dashboard/ExecutiveDashboard.jsx`

Proposed route:

`/executive-dashboard`

## 16.1 Objective

Preserve the existing executive presentation layer, but do not activate it with fabricated component props.

The current source review indicates that the component expects financial and operational metrics as props rather than obtaining trusted data independently.

Correct this through the existing backend data architecture.

## 16.2 Authoritative executive read model

Inspect existing reporting and aggregation services before defining new endpoints.

Create the smallest necessary trusted read model for:

- Total assets.
- Total liabilities.
- Revenue.
- Profit.
- Loan portfolio.
- Savings.
- Active members.
- Groups.
- Mobile-money activity.
- Portfolio growth.
- Revenue trend.
- Savings mix.
- Loan performance.
- Risk and governance indicators.
- Regulatory status.
- Fraud and AML alerts.

Do not expose every underlying member-level financial record to board users.

Use tenant-scoped, appropriately aggregated read models.

Where asset, liability, revenue or profit calculations are not implemented or cannot be proven, show `UNAVAILABLE` or an equivalent truthful status.

Clearly differentiate financial accounting concepts from operational statistics.

## 16.3 Board reporting controls

Support:

- Reporting period.
- Currency.
- Institution/tenant scope.
- Data cutoff.
- Last update.
- Evidence status.
- Approved calculation methodology.
- Export authorization.
- Auditability.

Board-level reporting must not silently mix preliminary operational metrics with finalized accounting data.

Do not present regulatory compliance as achieved merely because a dashboard contains a compliance indicator.

Keep the route disabled or gated until the necessary read models and permissions are proven.

---

# 17. RISK INTELLIGENCE AND FRAUD DASHBOARD

Candidate:

`frontend/src/pages/AdminRiskDashboard.jsx`

Proposed route:

`/risk`

## 17.1 Preserve its decision-support purpose

Review:

- Low-risk indicators.
- Review-required indicators.
- High-risk indicators.
- Average fraud score.
- Fraud events.
- Portfolio risk.
- Risk profiles.
- Investigation history.

Inspect the existing API dependencies:

- `/api/risk/profiles`.
- `/api/fraud/logs`.
- `/api/admin/portfolio`.

Verify that the actual backend routes, services and permission requirements exist.

## 17.2 Human review and explainability

Risk intelligence is decision support.

Do not turn an unverified risk score into an automatic fraud accusation, financial denial or irreversible account restriction.

Provide:

- Risk event reference.
- Source.
- Event timestamp.
- Evidence status.
- Risk indicators.
- Explanation or contributing factors where available.
- Assigned reviewer.
- Review status.
- Decision history.
- Audit trail.
- Appeal/escalation handling where relevant.

Separate machine-generated indicators from verified human decisions.

Do not invent risk explanations when the underlying data does not support them.

## 17.3 Privacy and access boundaries

Restrict sensitive risk information to appropriately authorized roles.

Test direct API access and cross-tenant requests.

Avoid disclosing sensitive risk profiles to ordinary group members or unrelated institutions.

Maintain traceable investigation and access records.

---

# 18. SACCO / MFI ONBOARDING DASHBOARD

Candidate:

`frontend/src/pages/onboarding/OnboardingDashboard.jsx`

Proposed route:

`/onboarding`

## 18.1 Preserve useful functions

Inspect and retain verified functionality for:

- SACCO search.
- Status filtering.
- Institution listing.
- Member-count display.
- KYC monitoring.
- Subscription status.
- Go-live review.
- Institution readiness metrics.

Review existing `getMetrics()` and `getSaccos()` service integrations.

## 18.2 Controlled institution lifecycle

Use a truthful lifecycle model consistent with the existing onboarding implementation.

Illustrative states:

```text
DRAFT
SUBMITTED
KYC_REVIEW
KYC_APPROVED
SUBSCRIPTION_PENDING
SUBSCRIPTION_ACTIVE
TECHNICAL_VALIDATION
GO_LIVE_REVIEW
APPROVED_FOR_PILOT
PILOT_ACTIVE
LIVE
SUSPENDED
REJECTED
```

Reuse existing state names where possible.

Do not mark an institution `LIVE` merely because it has registered or completed an onboarding form.

Go-live must depend on the appropriate legal, technical, operational, security, integration and partner approvals.

Preserve evidence for every important lifecycle transition.

---

# 19. AGRICULTURE DASHBOARD INTEGRATION

Candidate:

`frontend/src/pages/agriculture/AgricultureDashboard.jsx`

Proposed route:

`/agriculture`

## 19.1 Preserve the existing business scope

Inspect existing agriculture UI and `/api/v1/agriculture/{resource}` services.

Verify:

- Resource availability.
- User and institution permissions.
- Data ownership.
- Delivery information.
- Buyer and supplier records where applicable.
- Production and delivery status.
- Financial and settlement references.

## 19.2 Never imply settlement

The following are different business events:

```text
PRODUCTION_REPORTED
DELIVERY_RECORDED
DELIVERY_VERIFIED
BUYER_ACCEPTED
PAYMENT_INITIATED
PAYMENT_VERIFIED
SETTLEMENT_CONFIRMED
RECONCILED
```

A farmer's production report is not a payment.

A recorded delivery is not proof that the buyer paid.

A buyer's acknowledgement is not proof that funds were received.

Settlement requires authoritative payment evidence and reconciliation according to the canonical financial architecture.

---

# 20. INTEGRATED DASHBOARD AND REAL-TIME SERVICES

Candidate:

`frontend/src/pages/dashboard/Dashboard.jsx`

## 20.1 Assessment before integration

This component appears to compose:

- `useDashboardData`.
- `useRealtimeDashboard`.
- `FeatureGate`.
- `PermissionGate`.
- Shared KPI and chart components.
- Community group information.
- Mobile Money.
- Fraud monitoring.
- Regulatory reporting.
- System health.
- Notifications.
- Recent activity.
- Offline awareness.

Do not automatically replace the active community dashboard with this component.

Inspect every hook, service and imported component.

Verify that the data is authoritative, permission checks are consistent and real-time events cannot bypass authorization.

## 20.2 Reusable integration

Reuse suitable shared components and hooks across the canonical dashboard workspaces.

Do not make the integrated dashboard a second architecture with different tenant, authentication or permission state.

## 20.3 Real-time security

For socket or event-driven features:

- Authenticate connections.
- Validate session status.
- Apply tenant scope.
- Apply relevant permissions.
- Revoke or disconnect sockets when sessions are invalidated.
- Avoid exposing event payloads across tenant boundaries.
- Do not broadcast access tokens.
- Handle reconnects without restoring an invalid session.
- Validate event ownership and subscription scope.

## 20.4 Offline awareness

Offline state must be visibly distinguished from server readiness.

Do not show a live financial balance as current when it may be stale or cached.

Display last-known update time where permitted.

Never treat a locally queued financial action as an authoritative ledger posting.

---

# 21. CANONICAL DASHBOARD DATA CONTRACT

Establish a consistent dashboard API response structure or adapt the existing canonical contract.

Illustrative schema:

```json
{
  "success": true,
  "data": {
    "metrics": {},
    "charts": {},
    "period": {
      "from": null,
      "to": null,
      "timezone": null
    },
    "currency": "UGX",
    "tenantScope": "authorized-tenant-reference",
    "asOf": null,
    "lastSuccessfulUpdate": null,
    "freshness": "UNKNOWN",
    "evidenceStatus": "UNVERIFIED"
  },
  "meta": {
    "requestId": "safe-correlation-id",
    "schemaVersion": "1"
  }
}
```

This is a conceptual contract. Adapt it to existing API conventions.

Do not expose internal identifiers or infrastructure metadata unnecessarily.

Possible data states:

```text
AVAILABLE
PARTIAL
NO_DATA
UNAVAILABLE
STALE
ERROR
```

Possible evidence states:

```text
DESIGNED
IMPLEMENTED
UNIT_TESTED
INTEGRATION_TESTED
E2E_TESTED
OPERATIONALLY_VERIFIED
SECURITY_ASSESSED
EXTERNALLY_APPROVED
PRODUCTION_APPROVED
```

Never send a stronger evidence state than the underlying records justify.

All dashboard services must:

- Validate tenant scope.
- Enforce permissions.
- Validate reporting periods.
- Use safe pagination.
- Limit returned data.
- Use cancellation where supported.
- Avoid uncontrolled aggregation queries.
- Expose meaningful error states.
- Maintain auditability for sensitive access.
- Prevent cross-tenant information disclosure.

---

# 22. STANDARDIZE FRONTEND DASHBOARD EXPERIENCE

Use existing shared UI components where possible.

Standardize:

- Dashboard headers.
- Breadcrumbs.
- Filters.
- Reporting periods.
- KPI cards.
- Charts.
- Empty states.
- Loading states.
- Error states.
- Data freshness indicators.
- Evidence indicators.
- Permission-denied states.
- Retry behaviour.
- Responsive layout.
- Accessibility.

Do not introduce a new design system unless an actual repository gap requires it.

Preserve the TITech product identity, existing brand assets, circular logo and established color system.

Preserve the platform's official blue identity, including the established `#0058D8` reference where it is already part of the design system.

Do not rename the product or replace the branding as part of authentication/dashboard remediation.

Accessibility requirements:

- Keyboard navigation.
- Semantic headings.
- Meaningful labels.
- Accessible form errors.
- Sufficient contrast.
- Screen-reader-friendly charts or textual alternatives.
- Accessible loading and status announcements.
- Arabic RTL compatibility where supported.
- English as the default language.
- Existing Swahili, French and Arabic language infrastructure must not be broken.

---

# 23. FRONTEND API AND SESSION COORDINATION

Inspect the canonical API service:

`frontend/src/services/api.js`

Ensure:

1. Access tokens remain in memory.
2. Authenticated requests receive the current access token.
3. Refresh uses the configured credentialed cookie.
4. Concurrent refresh requests use a single-flight mechanism.
5. Refresh does not recurse indefinitely.
6. Failed refresh does not retry protected requests indefinitely.
7. Logout invalidates ongoing refresh operations.
8. Requests begun under an old authentication generation cannot overwrite a new session.
9. API-unavailable states remain distinguishable from anonymous states.
10. No raw authentication token is sent through browser-tab synchronization.

Review the existing `BroadcastChannel` mechanism, including `titech-auth`.

Only send safe event metadata such as:

```text
AUTH_LOGIN
AUTH_LOGOUT
SESSION_INVALIDATED
SECURITY_STATE_CHANGED
```

Do not broadcast access or refresh tokens.

Verify storage-event fallbacks, browser compatibility and graceful cleanup.

---

# 24. P1 — API AND ROUTE CONSISTENCY

Produce one route inventory combining:

- Active React routes.
- Backend authentication routes.
- Dashboard API routes.
- Administrative API routes.
- Risk API routes.
- Onboarding API routes.
- Agriculture API routes.
- Settings and access-governance routes.

For every route record:

| Attribute | Required |
|---|---|
| Method | Yes |
| Path | Yes |
| Active frontend consumer | Yes |
| Backend implementation | Yes |
| Authentication required | Yes |
| Required permission | Yes |
| Tenant scope | Yes |
| Data classification | Yes |
| Test coverage | Yes |
| Current evidence status | Yes |

Identify:

- Frontend links with no registered route.
- Routes with no backend implementation.
- Backend endpoints with no active consumer.
- Endpoints with inconsistent permissions.
- Duplicate routes.
- Stale service references.
- Inactive dashboard components.
- Incorrect API version usage.

Do not delete an endpoint solely because no current frontend component uses it; first establish whether external integrations or other supported clients depend on it.

---

# 25. AUTOMATED TESTING AND ACCEPTANCE MATRIX

All tests must use the real canonical application code.

Do not make empty or skipped test suites appear successful.

## 25.1 Authentication unit tests

Test:

- Password validation.
- Invitation validation.
- Legal acceptance validation.
- JWT claim generation.
- Version-claim verification.
- Refresh token hashing.
- Token expiry.
- Token-family handling.
- Revocation rules.
- Permission evaluation.
- Tenant-scoped authorization.
- Logout result classification.
- Error mapping.

## 25.2 Authentication integration tests

Use realistic MongoDB and Redis test infrastructure.

For transaction tests, use MongoDB replica-set infrastructure.

Do not replace important transaction tests with mocked Mongoose calls.

Test:

- User registration.
- Invitation consumption.
- Legal acceptance persistence.
- Verification-token lifecycle.
- Login.
- Failed login accounting.
- Account lockout.
- Refresh rotation.
- Concurrent refresh.
- Refresh replay.
- Logout.
- Logout-all.
- Password change.
- Administrative session revocation.
- User suspension.
- Cross-tenant access denial.

Use isolated test databases and clean test fixtures.

## 25.3 Frontend unit and component tests

Test:

- Login validation.
- Registration validation.
- Email verification.
- Authentication state transitions.
- API unavailable state.
- Refresh coordination.
- Logout state.
- Cross-tab logout synchronization.
- Protected route.
- Deep-link restoration.
- Permission-gated navigation.
- Dashboard loading.
- Dashboard unavailable state.
- Missing fraud data.
- Stale financial data.
- Readiness display.

## 25.4 End-to-end authentication tests

Using the repository's supported E2E framework, test:

1. Unauthenticated access to protected routes.
2. Redirect to login.
3. Original route restoration after authentication.
4. External redirect rejection.
5. Valid login.
6. Invalid credentials.
7. Unverified account.
8. Locked account.
9. Browser reload.
10. Session restoration.
11. Expired access token.
12. Successful refresh.
13. Failed refresh.
14. Logout.
15. Logout persistence failure.
16. Logout-all.
17. Cross-tab session invalidation.
18. Password reset.
19. Tenant switching, where supported.
20. Unauthorized dashboard access.

## 25.5 Dashboard integration and E2E tests

Test:

| Scenario | Expected result |
|---|---|
| Member opens dashboard | Only authorized member information |
| Group administrator opens group dashboard | Authorized group scope |
| Institution operator opens institution dashboard | Correct tenant/institution scope |
| Platform administrator opens `/admin` | Authorized administration workspace |
| Ordinary member opens `/admin` | Denied |
| Risk officer opens `/risk` | Authorized risk data |
| Unauthorized user opens `/risk` | Denied |
| Executive opens executive dashboard | Authorized aggregate read model |
| Executive data unavailable | Honest unavailable state |
| Onboarding officer opens onboarding | Authorized institution data |
| User opens missing group route | Correct registered page or controlled unavailable state |
| Fraud service unavailable | No fabricated clean percentage |
| Readiness service unavailable | No operational success claim |
| API returns no data | Honest no-data state |
| Cross-tenant request | Denied and appropriately audited |
| Stale financial data | Clearly identified as stale |
| Payment pending | Not counted as settled |
| Settlement without reconciliation | Not labelled reconciled |

## 25.6 Security testing

Include:

- Authentication bypass attempts.
- JWT tampering.
- Expired JWT.
- JWT algorithm rejection.
- Missing token claims.
- Old session version.
- Refresh-token replay.
- Refresh-token theft simulation.
- CSRF checks.
- CORS checks.
- Rate-limit checks.
- User enumeration checks.
- Authorization bypass.
- Cross-tenant data leakage.
- IDOR tests.
- Privilege escalation.
- Unauthorized administrative actions.
- Sensitive-data exposure.
- Log redaction.
- Cookie security attributes.
- Dependency vulnerability review.

Document unresolved security findings.

---

# 26. PERFORMANCE, RESILIENCE AND OPERATIONAL REQUIREMENTS

Do not sacrifice correctness for dashboard speed.

Review:

- Aggregation query efficiency.
- Appropriate indexes.
- Tenant-scoped indexes.
- Date-range filters.
- Pagination.
- Cache invalidation.
- Cache freshness.
- Redis failure handling.
- MongoDB failure handling.
- Slow API behaviour.
- API cancellation.
- Socket reconnection.
- Background refresh.
- Dashboard refresh timers.
- Memory leaks.
- Excessive component re-rendering.

Ensure automatic refresh intervals are cleared when components unmount or authentication changes.

Dashboard refresh must not generate unnecessary expensive aggregation workloads.

Use bounded retries with backoff and jitter where appropriate.

Do not retry non-idempotent financial actions without an established idempotency contract.

Ensure the application distinguishes:

- Liveness.
- Readiness.
- Dependency health.
- Degraded functionality.

The existing `/api/v1/health` and `/api/v1/ready` contracts must remain consistent with actual application readiness.

---

# 27. SECURITY AND PRIVACY REVIEW

Conduct a focused security assessment of the modified authentication and dashboard surfaces.

Review:

- Authentication boundaries.
- Session management.
- Password storage.
- Token handling.
- Cookie security.
- CSRF protection.
- CORS.
- Rate limiting.
- RBAC.
- Tenant isolation.
- API authorization.
- Administrative actions.
- Risk-data permissions.
- Audit logging.
- Error responses.
- Information disclosure.
- PII collection and retention.
- Data exports.
- Dashboard caching.

Follow data minimisation principles.

Avoid putting sensitive user, financial or investigation data into browser logs or client-side analytics.

Ensure cached dashboard information cannot be reused across tenants or users without the required scope checks.

Sensitive administrative and executive actions must be auditable.

---

# 28. REQUIRED IMPLEMENTATION PRIORITIES

Execute work in this order.

## P0 — Security and financial correctness

| Priority | Work item | Mandatory proof |
|---|---|---|
| P0.1 | Reliable logout revocation | Database-backed tests |
| P0.2 | Honest logout error handling | Frontend and backend failure tests |
| P0.3 | JWT security/session version enforcement | Old JWT rejection tests |
| P0.4 | Logout-all correctness | Persistent revocation and access-token invalidation |
| P0.5 | Atomic refresh-token rotation | MongoDB replica-set integration tests |
| P0.6 | Concurrent refresh/replay prevention | Race-condition tests |
| P0.7 | Preserve legal registration gate | Production registration remains blocked until evidence exists |
| P0.8 | Transactional invitation consumption | Database integration tests |

## P1 — Authentication and application consistency

| Priority | Work item | Mandatory proof |
|---|---|---|
| P1.1 | Align password validation | Frontend/backend/model tests |
| P1.2 | Legal acceptance persistence | Auditable acceptance records |
| P1.3 | Email verification delivery state | Provider/queue workflow evidence |
| P1.4 | Email resend workflow | Security and E2E tests |
| P1.5 | Distributed login rate limiting | Redis integration tests |
| P1.6 | Protected-route deep-link correction | Browser E2E |
| P1.7 | Tenant context synchronization | API and frontend tests |
| P1.8 | Centralized permissions | Role/permission matrix tests |
| P1.9 | Administration Center route integration | Authorized and unauthorized E2E |
| P1.10 | Group route/navigation integration | Route coverage |
| P1.11 | Fraud analytics correction | No-data and service-failure tests |
| P1.12 | Dynamic readiness indicator | Real readiness integration |
| P1.13 | Canonical dashboard data contract | API integration tests |

## P2 — Advanced dashboard activation

| Priority | Work item | Mandatory proof |
|---|---|---|
| P2.1 | Financial analytics consolidation | Trusted financial aggregation tests |
| P2.2 | Executive read-model integration | Calculation and source verification |
| P2.3 | Risk Intelligence integration | Permission and investigation tests |
| P2.4 | SACCO/MFI onboarding integration | Lifecycle and authorization tests |
| P2.5 | Agriculture integration | Delivery/payment/settlement separation |
| P2.6 | Integrated real-time components | Socket authorization and session tests |
| P2.7 | Dashboard component consolidation | Duplicate implementation inventory |
| P2.8 | Accessibility and internationalisation | Automated/manual accessibility evidence |

P2 features must not delay the P0 security corrections.

Do not activate partially implemented modules just to increase the apparent number of available features.

---

# 29. REQUIRED TECHNICAL DELIVERABLES

Implement the necessary source changes, tests and documentation.

At minimum, create or update the following documentation:

```text
docs/auth-dashboard/
    AUTH_DASHBOARD_BASELINE.md
    AUTHENTICATION_ARCHITECTURE.md
    AUTHENTICATION_SECURITY_REMEDIATION.md
    REFRESH_TOKEN_ROTATION_AND_REVOCATION.md
    REGISTRATION_AND_LEGAL_ACCEPTANCE.md
    TENANT_AND_PERMISSION_MATRIX.md
    DASHBOARD_ARCHITECTURE.md
    DASHBOARD_ROUTE_INVENTORY.md
    DASHBOARD_DATA_PROVENANCE.md
    AUTHENTICATION_TEST_EVIDENCE.md
    DASHBOARD_TEST_EVIDENCE.md
    SECURITY_FINDINGS.md
    AUTH_DASHBOARD_RELEASE_READINESS.md
```

Adapt the paths to the existing repository documentation structure if an equivalent canonical location exists.

Also:

- Add meaningful automated tests.
- Correct existing tests that no longer reflect the intended contract.
- Remove empty test suites where appropriate.
- Do not introduce tests that only assert mocks were called when the actual persistence guarantee is the subject.
- Update route and API documentation.
- Document environment and integration dependencies.
- Preserve the existing master readiness and evidence documentation.
- Avoid creating redundant documentation files that merely repeat existing canonical documents.

---

# 30. DEFINITION OF DONE

The remediation programme is complete only when the applicable criteria below are demonstrated.

## Authentication

- One canonical authentication provider.
- One consistent backend authentication path.
- Correct account-state handling.
- Access tokens stored in memory only.
- Refresh tokens held in HttpOnly cookies.
- Persistent refresh-token records stored securely.
- Reliable logout revocation.
- Honest logout failure reporting.
- Access-token version enforcement.
- Logout-all invalidates existing sessions.
- Refresh rotation is atomic.
- Concurrent refresh requests cannot create multiple valid replacements.
- Reuse detection works.
- Invitation consumption is safe.
- Legal acceptance is persistently auditable.
- Registration legal gates remain intact.
- Password requirements match across layers.
- Email verification states are truthful.
- Rate limiting is suitable for the deployment architecture.
- Deep-link restoration is correct and safe.
- Tenant context is server-authoritative.

## Dashboards

- One active canonical router.
- One canonical application shell.
- Centralized permission checks.
- Current community dashboard remains operational.
- Missing group routes are corrected.
- Administration Center is integrated securely.
- Legacy administrator functionality is consolidated.
- Fraud dashboards never invent zero fraud.
- Health indicators derive from actual readiness evidence.
- Financial metrics disclose provenance and period.
- Initiated, pending, verified, settled and reconciled states remain distinct.
- Executive dashboards use trusted read models.
- Risk dashboards preserve human review and explainability.
- Onboarding uses a controlled institutional lifecycle.
- Agriculture does not imply settlement without evidence.
- Real-time updates enforce session and tenant authorization.
- Unauthorized dashboard data cannot be retrieved directly through backend APIs.

## Testing

- Relevant unit tests pass.
- Relevant backend integration tests pass.
- Relevant frontend tests pass.
- Relevant E2E tests pass.
- Database transaction tests use transaction-capable infrastructure.
- Redis-dependent tests use appropriate integration infrastructure.
- No empty test suites falsely count as coverage.
- Known failures are documented.
- Tests can be reproduced using documented commands.

## Production control

- `productionApproved=false` remains unchanged unless all required independent approvals are genuinely completed.
- No unverified provider integration is labelled operational.
- No dashboard claims financial correctness without evidence.
- No legal gate is bypassed.
- No unresolved P0 security defect is hidden by a passing build.
- No external approval is fabricated.

---

# 31. FINAL VALIDATION COMMANDS

Inspect the existing package scripts and choose the repository-supported commands.

At minimum, attempt the applicable equivalents of:

```powershell
node --version
npm --version
git status --short
npm run
```

Then execute, using the correct workspaces:

```text
clean dependency verification
backend lint
frontend lint
backend module/syntax validation
frontend production build
backend unit tests
frontend unit tests
authentication integration tests
MongoDB transaction tests
Redis integration tests
authentication E2E tests
dashboard route E2E tests
authorization and tenant-isolation tests
security checks
```

Perform a final source review of:

- Authentication provider.
- Logout controller.
- Refresh controller.
- Authentication middleware.
- Registration controller.
- Invitation model and service.
- Legal acceptance model and service.
- Email verification service.
- Rate limiter.
- Tenant middleware.
- Permission middleware.
- Protected route.
- Active AppRoutes.
- Dashboard navigation.
- Administration Center.
- Dashboard data hooks.
- Financial analytics.
- Risk analytics.
- Executive reporting.
- Onboarding.
- Agriculture.

Capture command, exit code and significant output.

Do not claim a check passed if it was skipped, blocked, mocked beyond its proof objective or executed under an unsupported runtime without an explicit qualification.

---

# 32. FINAL ENGINEERING REPORT

At completion, produce an executive and technical report titled:

**TITech Community Capital — Authentication and Dashboard Remediation Report**

Revision date: 30 October 2026 or the actual completion date.

The report must contain:

## A. Executive summary

State:

- What was inspected.
- What was implemented.
- What was corrected.
- What remains incomplete.
- Whether any P0 issue remains.
- Whether the application is operationally ready.
- Whether production approval remains blocked.

## B. Authentication remediation matrix

For each authentication defect, show:

| Finding | Original state | Implementation | Test evidence | Status |
|---|---|---|---|---|

## C. Dashboard integration matrix

For each dashboard, show:

| Dashboard | Source component | Canonical route | Permissions | Data source verified | Test evidence | Status |
|---|---|---|---|---|---|---|

Use accurate states such as:

- Implemented.
- Integrated.
- Unit-tested.
- Integration-tested.
- E2E-tested.
- Blocked.
- Not ready.
- Coming soon.
- Not applicable.

## D. Security evidence

Report:

- Logout revocation.
- Refresh-token rotation.
- Replay protection.
- Session invalidation.
- JWT version enforcement.
- Cookie protection.
- Rate limiting.
- Legal acceptance persistence.
- Tenant isolation.
- Role and permission enforcement.
- Outstanding vulnerabilities.

## E. Financial and data-integrity evidence

Report:

- KPI source correctness.
- Currency and reporting-period handling.
- Payment status distinctions.
- Settlement evidence.
- Reconciliation status.
- Fraud-data handling.
- Executive metric provenance.
- Any unverified financial calculation.

## F. Test execution matrix

For every test category provide:

- Command.
- Environment.
- Result.
- Passed count.
- Failed count.
- Skipped count.
- Blocked count.
- Evidence location.
- Explanation.

Do not provide invented percentages.

## G. Changed-files inventory

List:

- Created files.
- Modified files.
- Consolidated components.
- Deprecated files.
- Removed files.
- Database/schema changes.
- Configuration changes.
- API contract changes.

## H. Outstanding risks

Identify all unresolved P0, P1 and P2 issues.

Explain the impact, owner/action required, and acceptance evidence for each.

## I. Final readiness declaration

Choose exactly one appropriate overall assessment:

```text
NOT_READY
REMEDIATION_IN_PROGRESS
PILOT_CANDIDATE
PILOT_READY_PRODUCTION_GAPS_REMAIN
PRODUCTION_CANDIDATE_PENDING_APPROVAL
PRODUCTION_APPROVED
```

Only use the final state when its independent requirements are genuinely satisfied.

The default must remain:

```text
productionApproved=false
```

unless a properly evidenced, authorized approval process changes it.

---

# 33. IMPLEMENTATION AGENT EXECUTION INSTRUCTIONS

Do not stop after producing the baseline report.

Proceed to implementation.

Follow this execution sequence:

**PHASE 1 — Discover**

Inspect the repository and prove the active application architecture.

**PHASE 2 — Baseline**

Record existing tests, runtime conditions, known failures and environmental dependencies.

**PHASE 3 — P0 security remediation**

Correct logout, JWT version enforcement, logout-all and atomic refresh rotation first.

**PHASE 4 — Registration remediation**

Correct invitation transactionality, password validation, legal acceptance persistence and verification delivery states without removing registration controls.

**PHASE 5 — Authentication consistency**

Correct rate limiting, deep-link restoration, tenant synchronization and centralized authorization.

**PHASE 6 — Dashboard architecture**

Inventory all source components and create the canonical active route/permission matrix.

**PHASE 7 — Dashboard integration**

Integrate the Administration Center and valid group routes first. Consolidate useful legacy features and correct misleading data displays.

**PHASE 8 — Financial and enterprise data**

Integrate analytics, executive, risk, onboarding and agriculture capabilities only where trusted data and authorization are demonstrable.

**PHASE 9 — Testing**

Execute meaningful unit, integration, security and E2E tests. Correct failures rather than masking them.

**PHASE 10 — Evidence and readiness**

Produce the required reports, identify residual gaps and maintain the production approval gate.

At each stage:

- Preserve existing working functionality.
- Avoid unrequested architecture changes.
- Keep changes scoped.
- Explain material design decisions in code comments or documentation.
- Prefer existing canonical services.
- Add tests alongside implementation.
- Run relevant tests immediately after each critical change.
- Continue to the next stage where safe.
- Do not declare completion with unresolved P0 security defects.

If an external dependency, infrastructure service, credential or authorization is unavailable, implement what can safely be implemented, record the precise blocker, and do not fabricate the missing proof.

Do not ask the user to repeat information already contained in this prompt or the repository.

Do not replace implementation with an advisory report.

---

# 34. FINAL PRODUCT PRINCIPLE

TITech Community Capital must become a coherent institutional financial-control platform, not a collection of attractive dashboards and partially connected authentication features.

The authentication layer must establish who the user is, which session is valid, which institution the user belongs to and which operations that user may perform.

The dashboard layer must show only information the user is authorized to access and only metrics whose provenance, calculation and evidence status can be defended.

The financial layer must remain authoritative for transactions, balances, payment outcomes, settlement, reconciliation and reporting.

The risk layer must support explainable investigation and human governance.

The onboarding layer must distinguish institutional registration from technical, legal and operational go-live approval.

The executive layer must report trusted financial and operational information—not illustrative figures presented as real results.

**Do not create more architecture to conceal incomplete integration. Integrate what exists, correct what is wrong, remove what is redundant and prove what works.**

**BUILD LESS. PROVE MORE.**

**FINANCIAL CORRECTNESS BEFORE CONVENIENCE.**

**TITech Community Capital — Community Finance Infrastructure + Payment/Reconciliation Control Plane.**

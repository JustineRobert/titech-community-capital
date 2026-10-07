# TITech Community Capital — 90-Day Breakthrough Plan

**Window:** 2026-10-07 to 2027-01-04  
**Objective:** move TITech from broad enterprise engineering readiness toward repeatable, paid institutional proof.

## North-star outcome

By the end of 90 days, TITech should have a **small number of real institutions using a verified financial workflow end-to-end**, with customer evidence strong enough to support a larger pilot/seed conversation.

The target is not a bigger codebase. The target is a working loop:

```text
Institution
  ↓
Tenant / RBAC / KYC controls
  ↓
Member / group activity
  ↓
Payment intent
  ↓
Regulated payment/bank rail
  ↓
Callback / status machine
  ↓
Double-entry ledger
  ↓
Settlement
  ↓
Reconciliation
  ↓
Receipt / audit
  ↓
Institution reporting
  ↓
Customer value + renewal signal
```

## Days 1–14 — release truth and runtime closure

### Engineering

- run Node 24.15.x / npm 11.x exactly as declared by the repository;
- install root/backend/frontend dependencies from lockfiles;
- run the full canonical quality pipeline;
- build the actual frontend production artifact;
- reproduce `React is not defined` in a clean Chrome profile;
- capture exact URL, stack, chunk, source map and network failure data;
- run a second pass with normal browser extensions enabled;
- validate service-worker version recovery;
- confirm the `index.html` / hashed-JS release contract across two simulated releases.

### Acceptance

- production artifact exists;
- source map resolves the incident or proves the error is injected externally;
- no new React runtime errors;
- full build/test result recorded;
- production-approval gate remains closed until evidence is complete.

## Days 15–30 — Golden Money Path

### Engineering

Finish one narrow, production-shaped payment use case rather than many partial modules.

Required evidence:

- idempotency;
- provider request/attempt state;
- callback verification;
- success/failure/timeout states;
- retry policy;
- reversal/refund behavior;
- double-entry journal;
- balance projection;
- settlement status;
- reconciliation record;
- receipt;
- immutable audit trail;
- exception handling and operational alerts.

### Business

Select 3–5 prospective design-partner institutions and baseline their current manual process.

Measure:

- time to reconcile;
- number of unresolved exceptions;
- payment failure/retry burden;
- report preparation time;
- member/account onboarding effort.

## Days 31–45 — controlled customer pilot

Deploy to a staging/controlled pilot environment with:

- one regulated financial/payment partner;
- one or two actual payment rails;
- clear tenant boundaries;
- support/runbook ownership;
- data-protection controls;
- incident and rollback procedure.

### Pilot success signals

- first real transaction or controlled sandbox equivalent is fully traceable;
- every financial effect reconciles;
- institution staff can complete the workflow without engineering intervention;
- exceptions are visible and actionable;
- no unexplained balance mutation occurs.

## Days 46–60 — customer value proof

Turn pilot activity into measurable evidence.

Build a customer evidence pack containing:

1. baseline process;
2. TITech process;
3. reconciliation-time improvement;
4. error/exception reduction;
5. reporting improvement;
6. security/control evidence;
7. reliability/SLA evidence;
8. testimonial/reference where permitted;
9. commercial proposal.

The first commercial objective is a **paid institutional subscription or signed paid pilot**, not maximum transaction volume.

## Days 61–75 — repeatability

Make the successful pilot installable by another institution without bespoke engineering.

Deliver:

- onboarding checklist;
- institution configuration template;
- standard chart-of-accounts/ledger policy;
- provider configuration template;
- reconciliation operating procedure;
- support escalation matrix;
- deployment checklist;
- customer training kit;
- security/data-processing checklist.

## Days 76–90 — convert proof into a growth engine

### Commercial

- close first paid reference customers;
- secure at least one formal payment/banking partner relationship;
- establish implementation/channel partner conversations;
- build a qualified pipeline of 20–30 target institutions;
- identify the highest-converting vertical (SACCO, cooperative, employer/payroll, NGO program, agriculture/community enterprise).

### Investor

Prepare a data room containing:

- product architecture;
- customer contracts/pilots;
- monthly active institutions;
- transaction volumes;
- reconciliation metrics;
- retention/cohort evidence;
- regulatory/data-protection evidence;
- security review;
- deployment/reliability evidence;
- 24-month financial model;
- cap table and use of funds.

## 90-day KPI scorecard

| KPI | 90-day target | Why it matters |
|---|---:|---|
| Live / controlled anchor institutions | 3–5 | Proof of institutional demand |
| Paying institutions | 1–3+ | Commercial validation |
| Regulated payment/bank partners | 1+ | Trust and real-money path |
| Verified payment rails | 2 | Reduces single-provider dependency |
| Golden Money Path | 1 end-to-end path | Core product proof |
| Reconciliation exceptions | 100% traceable | Financial trust |
| Critical frontend runtime errors | 0 known TITech-owned | Release quality |
| Deployment rollback drill | 1 completed | Operational readiness |
| Security/data-protection evidence pack | 1 | Partner/investor readiness |
| Qualified institutional pipeline | 20–30 | Next-stage growth |

## What NOT to do in the 90 days

Do not prioritize:

- a broad consumer wallet launch;
- another large UI redesign;
- a new country before Uganda proof;
- unnecessary payment-license expansion;
- speculative AI features before data quality;
- parallel duplicate services/models;
- features that cannot be attached to a customer outcome.

## Breakthrough gate at day 90

Advance to the next growth stage only when the following are true:

```text
[ ] Real institution using TITech
[ ] Paid or commercially committed account
[ ] Regulated partner operating
[ ] Money path fully reconciled
[ ] Customer value measured
[ ] Security/data protection evidence assembled
[ ] Repeatable onboarding documented
[ ] Reference customer available
[ ] Clear unit economics hypothesis
[ ] Capital story backed by evidence
```

If these boxes are not closed, continue the Uganda proof cycle rather than expanding geographically.

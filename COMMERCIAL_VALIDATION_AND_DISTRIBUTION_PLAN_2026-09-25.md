# TITech Community Capital — Commercial Validation & Distribution Plan — 2026-09-25

## Objective

Move TITech from architecture-heavy development to evidence of repeatable institutional usage without sacrificing financial, security or regulatory controls.

## The validation funnel

```text
Target institutions
      |
      v
Discovery interviews
      |
      v
Design partner
      |
      v
Controlled pilot
      |
      v
Paid / contracted pilot
      |
      v
Repeatable onboarding
      |
      v
Reference customer
      |
      v
Channel / partner distribution
```

## Initial beachhead

Start with Uganda and prioritize institution types where TITech's current architecture has immediate fit:

- SACCOs needing payment/ledger/reconciliation modernization;
- savings-group networks and community-finance organizations;
- cooperatives with distributed collections;
- NGOs/programmes with controlled community disbursements;
- MFIs or licensed lenders seeking community-data connectivity.

Do not open ten countries simultaneously.

## Design-partner program

Target 3-5 design partners first.

For each institution capture:

- current workflow;
- current software/paper process;
- payment providers;
- reconciliation pain;
- number of groups and members;
- transaction volume;
- reporting requirements;
- support model;
- data-protection role;
- integration requirements;
- decision maker;
- procurement path;
- willingness to pay;
- success criteria;
- reference rights.

## Two-rail proof

Rather than implementing every provider at once, select two high-value rails and prove them deeply. Candidate rails can include MTN Mobile Money, Airtel Money, M-Pesa or bank rails according to partner demand and actual certification feasibility.

For each selected rail prove:

- initiation;
- authentication;
- idempotency;
- asynchronous status;
- callback verification;
- reconciliation;
- retries;
- provider outage handling;
- settlement evidence;
- support operations.

## Reconciliation-led sales motion

Position reconciliation as an enterprise painkiller where appropriate:

> one canonical financial record across institution, provider and settlement evidence.

Measure:

- auto-match rate;
- unmatched volume;
- exception ageing;
- manual effort saved;
- time to close reconciliation;
- financial discrepancy rate.

## Partner strategy

Build five partner lanes:

1. **Payment rails** — mobile-money operators, banks, aggregators.
2. **Institutional distribution** — SACCO unions, VSLA networks, cooperative federations, NGOs.
3. **Capital** — banks, MFIs, DFIs, embedded lenders.
4. **Technology** — Fineract/core-finance ecosystems, identity/KYC providers, infrastructure providers.
5. **Programme finance** — donors, government programmes and development organizations.

Each partner needs a concrete integration/use case and a mutual commercial or programme objective.

## Partner evidence pack

Maintain a reusable partner package containing:

- architecture overview;
- API documentation;
- security profile;
- data-protection model;
- provider adapter contract;
- reconciliation contract;
- uptime/SLA model;
- sandbox certification checklist;
- pilot plan;
- commercial model;
- references once available.

## Commercial KPIs

The product dashboard should distinguish technology metrics from business proof.

### Technology

- p95 API latency;
- provider success rate;
- reconciliation match rate;
- ledger invariant failures;
- incident MTTR;
- sync success rate;
- uptime.

### Adoption

- activated institutions;
- active groups;
- active members;
- retention;
- transaction frequency.

### Revenue

- paid institutions;
- ARR/MRR where relevant;
- implementation fees;
- payment/orchestration revenue where legally appropriate;
- partner revenue;
- gross margin;
- revenue concentration.

### Commercial efficiency

- sales cycle;
- implementation time;
- onboarding completion;
- support hours per institution;
- CAC where measurable;
- expansion/renewal rate.

## Capital connectivity guardrails

Capital-provider integrations must remain permissioned and governed.

Never monetize or share community financial data without the required legal basis, consent/purpose controls, contract terms and applicable regulatory review.

Keep underwriting decisions with the licensed/approved capital provider unless the operating model and permissions explicitly support another structure.

## 90-day commercial execution target

### Days 0-30

- Select 5 target institutions.
- Conduct workflow and reconciliation discovery.
- Choose 2 priority payment rails.
- Produce partner/security/data-protection packs.
- Define pilot success metrics.

### Days 31-60

- Launch first controlled pilot.
- Process real or controlled transactions in approved environments.
- Measure reconciliation and support burden.
- Fix the first production-like failure modes.
- Secure at least one structured capital/programme partner discussion.

### Days 61-90

- Expand to 3-5 institutions only if evidence supports it.
- Convert at least one pilot to paid/contracted use where commercially feasible.
- Establish referenceable case-study evidence.
- Document repeatable onboarding.
- Freeze broad feature expansion until the validation review is complete.

## Anti-feature-factory rule

Before approving a new feature, require a written link to at least one of:

- customer requirement;
- payment reliability;
- reconciliation reduction;
- regulatory/security control;
- revenue path;
- retention path;
- partner integration;
- measurable operational risk reduction.

Otherwise classify the work as backlog exploration rather than priority implementation.

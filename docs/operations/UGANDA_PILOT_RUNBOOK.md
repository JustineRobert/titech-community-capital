# TITech Community Capital — Uganda Pilot Runbook

## Purpose

Provide a controlled operating procedure for the first 3–5 institutional deployments without treating a pilot as an unbounded production launch.

## Pilot scope

Start with:

- 3–5 institutions;
- 20–50 groups;
- approximately 1,000–5,000 members;
- one narrow contribution journey;
- two verified payment rails before widening the workflow.

## Pilot entry gates

1. Production approval mechanism remains explicit and reviewable.
2. Real MongoDB/Redis validation is green.
3. Golden Money Path evidence exists.
4. Provider sandbox evidence exists for every claimed integration.
5. KYC/consent/support workflows are operationally tested.
6. Backup/restore evidence exists.
7. Security blockers are closed or formally accepted through the existing governance process.

## Pilot transaction journey

```text
Member
  ↓
Institution / Group
  ↓
Contribution request
  ↓
Payment provider
  ↓
TITech transaction state
  ↓
Verification / callback
  ↓
Reconciliation
  ↓
Ledger
  ↓
Receipt / report
```

## Daily operating metrics

- active institutions;
- active groups;
- active members;
- contribution count/value;
- payment success rate;
- unknown-payment rate;
- reconciliation mismatches;
- duplicate-payment prevention events;
- support tickets;
- incident severity and MTTR;
- refund/reversal events;
- operator actions requiring maker-checker review.

## Pilot incident rules

Any of the following pauses expansion until reviewed:

- unexplained financial imbalance;
- cross-tenant data exposure;
- irreversible duplicate settlement;
- inability to reconcile a provider settlement;
- missing audit trail for a material financial action;
- backup or restore failure;
- security incident involving credentials or customer data.

## Customer-success evidence

The pilot should produce a 30/60/90-day evidence pack containing operational usage, reliability, support and commercial outcomes. Customer testimonials may supplement, but must not replace, transaction and reconciliation evidence.

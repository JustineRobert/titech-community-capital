# Billing operations runbook — current dashboard preview

## What operators can do now

- Platform administrators and finance-reader roles can inspect platform billing counts, status summaries, invoice totals by currency, subscriptions/invoices and a capped overdue/payment-exception queue.
- Institution administrators can inspect billing records belonging to the authenticated tenant only.
- Finance readers can review overdue invoice ageing and current payment exception records.
- Users can refresh the read projection and navigate paginated lists.

## What operators must not assume

- A payment record or provider reference is not settlement evidence.
- An invoice amount is not necessarily collected cash or recognized revenue.
- Dashboard counts do not prove subscriptions are active or legally contracted.
- A plan ID is not an approved price quote.
- MRR, ARR and recognized revenue are unavailable.
- No dashboard action initiates a transfer, payment, refund, invoice issue, journal posting, plan change, collection reminder or institutional suspension.

## Incident handling

- HTTP 403: verify the user's canonical role/permission and authenticated tenant assignment; do not add a permissive fallback.
- HTTP 503/data unavailable: check existing MongoDB readiness and collection/index state. Do not substitute demo values.
- Unexpected amount/status: preserve source evidence and escalate to the authorized finance control owner; do not manually edit records through the dashboard.
- Suspicious cross-tenant query: preserve correlation ID, invoke existing security incident procedure and investigate canonical auth/tenant middleware.
- Provider mismatch/unknown status: no write resolution is available in this release; escalate to the provider/payment operations owner.

## Contacts configured in TITech brand profile

TITECH CAPITAL - SMC LTD · P.O. Box 601200 · titechcapital@gmail.com · +256782397907 · WhatsApp +256772123546. These are organization-supplied contact records, not a verified service-level support arrangement.

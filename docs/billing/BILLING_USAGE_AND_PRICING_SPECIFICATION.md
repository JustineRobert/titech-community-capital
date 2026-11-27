# Billing usage and pricing specification

## Current source-backed components

The commercial fee engine contains FeeRule, FeeAssessment, UsageRecord and associated services/repositories for commercial fee assessment. Its authoritative documentation is `docs/commercial/AUTHORITATIVE_COMMERCIAL_BILLING_CORE.md`. These components require trusted server-side commercial terms, approved effective fee rules, source-event provenance and tenant-scoped idempotency.

## SaaS subscription gaps

The SaaS plan model/service, subscription model/service, billing account repository and entitlement model are empty in this archive. The new read-only dashboards do not create usage or charge an institution.

## Required approval and measurement rules

- No subscription prices are invented or preloaded.
- Each plan price requires authorized approval, effective dates, currency and an immutable version.
- Billable usage must originate from trusted server events; browser-supplied quantity is not authoritative.
- Each event carries tenant, source module, unique event identity, period, measurement status and idempotency key.
- Sandbox, test, internal and non-billable activity are excluded under explicit approved rules.
- Included quota, overage rules, tier interpretation, discounts and tax policy must be documented before activation.
- Usage period aggregation and invoice generation must be deterministic and replay-safe.
- Entitlements are derived server-side from an approved subscription snapshot, not frontend state.

## Dashboard scope

The current pages show existing subscription references and dates when present. They do not promise prices, feature limits, member quotas, overage calculations or renewal terms.

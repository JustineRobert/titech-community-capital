# SACCO / VSLA / Chama / ROSCA Domain Model — Current and Target Boundaries

## Current canonical aggregate

`backend/models/Group.js` is the current Mongo/Mongoose community-group aggregate. It defines twelve group `type` values and explicitly states that it is not a wallet or ledger. It scopes groups to a tenant, preserves membership history and uses optimistic concurrency. `memberRoles` holds rich membership role/status/origin state; `members` remains a compatibility/lookup projection.

The backend controller now imports the `GROUP_TYPES` export from this model. The active creation form enumerates the same twelve values. This resolves a previous controller/UI mismatch but does not implement distinct financial rules per type.

## Type-specific capabilities are not yet implemented as full product behavior

| Type | What current type value means | Still required before operational claims |
|---|---|---|
| `sacco` | Organization/group classification | Legal licence/authorization checks, institution member numbers, share/account ownership, approved product catalogue, signatory/approval rules, account mapping, member-level statements and partner settlement |
| `vsla` | Group classification | Meeting/cycle aggregate, share ledger, share-out calculation with independent reconciliation, social-fund rules and any lending approval boundary |
| `chama` | Group classification | Contribution schedule/cycle, payout or investment governance, member obligations, cycle close and immutable historic snapshots |
| `rosca` | Rotating association classification | Deterministic rotation order, payout eligibility, owed/paid obligations, missed-payment handling, immutable payout history and concurrency control |
| `savings` | General savings group classification | Explicit savings product configuration and mapping to canonical account/ledger boundaries |
| `cooperative` | Cooperative classification | Legal form, member/governance authority, approved transaction capabilities and jurisdiction-specific reporting |
| `farmer_group`, `producer_organization` | Producer/agriculture classifications | Season, delivery/procurement and collective-sale rules, with distinct accounting/event contracts |
| `investment`, `community`, `welfare`, `mixed_community_group` | Generic group classifications | Type-specific governance and appropriate restricted capabilities |

## Existing member model

- Group membership is represented in `memberRoles` with role and membership status, not just the compatibility `members` array.
- The group model's role vocabulary includes member, group administrator, treasurer and secretary.
- Group workflow has membership request, invitation, acceptance, approval/rejection and leave/moderation code paths.
- `Member` is a separate tenant-scoped member identity/customer aggregate; it does not own savings, shares, loans or ledger balances.
- `User` authentication identity and `Member` business/member profile are not interchangeable. The product must explicitly map the actor/user to a member record when a financial contribution requires a member identity.

## Financial boundary

The only approved financial source of truth is the existing canonical financial transaction/ledger architecture. Contributions should be modelled as financial instructions/intents and canonical posted transactions, not by mutating a group field or writing a `balance` into `Group`.

The current `Group` Mongoose schema contains no canonical account or wallet reference. `backend/models/GroupWallet.js` is a separate Sequelize factory with UUID tenant/group references and an optional account code; it is not currently an explicit connected account reference on the Mongoose Group aggregate. Until the ownership and migration path is resolved, the group balance endpoint now returns controlled `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` after authorization.

## Future implementation rules

1. Define each group subtype's invariant and approved capabilities before implementing a service.
2. Reuse existing transaction, journal, outbox, audit and reconciliation boundaries.
3. Record money as integer minor units at API boundaries and exact decimal/BigInt arithmetic in the financial layer.
4. Validate tenant, group, member, account, currency, policy and consent on the server.
5. Use durable idempotency, concurrency control and recoverable operation references.
6. Make cycle/payout/share-out closure immutable; apply corrections through authorized reversal/adjustment procedures.
7. Never use group type as a substitute for licence verification, institution approval, product authorization or regulated permissions.

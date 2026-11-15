# Financial Integrity Report — Group Contributions and Balance Disclosure

## Canonical financial ownership

The source repository already has a canonical financial operation/transaction boundary, journal services and immutable ledger-entry concepts. The contribution controller is intentionally an application boundary; it requires a financial transaction session/idempotency record and delegates through `processFinancialOperation` and `executeFinancialOperation`. It does not directly update a group balance or call a payment provider.

The controller comments and implementation identify required request context including tenant, principal/member, SACCO reference, amount, currency, payment reference and idempotency. The `POST /api/v1/contributions` route is wired through authenticated tenant middleware, request-body validation and idempotency controls.

## Proven defects repaired in this source archive

### Unsupported Group Details contribution call

The previous `GroupDetails.jsx` attempted `POST /api/groups/:id/contribute`. No equivalent route exists in `backend/routes/groups.js` or the active mount registry. That component also generated a local success message and did not run the canonical financial provider/settlement path. The action has been removed and replaced with a visible, non-actionable status that says no payment or contribution was initiated from that screen.

### Unsafe group balance calculation

The original group-wallet read summed `CREDIT` amounts and subtracted `DEBIT` amounts for every ledger line tagged with the group. This treats all journal accounts as if they were one wallet. In a balanced double-entry journal, both sides are present; summing them indiscriminately can net to zero and does not calculate a designated account's balance.

The Group model has no canonical account or wallet reference. The similarly named `GroupWallet` is a separate Sequelize factory, and this execution did not find a proven active relation from the Mongoose Group aggregate to the canonical Mongo financial account. The balance controller therefore now:

1. requires trusted tenant context;
2. validates the group identifier;
3. loads the tenant-owned group;
4. enforces `canViewGroup` against the authenticated actor;
5. returns a controlled `503 GROUP_FINANCIAL_ACCOUNT_NOT_CONFIGURED` rather than a misleading `0` or false authoritative value.

The Group Details screen displays `Unavailable` for this state and explicitly says it does not assume a zero balance. It accepts financial position data only when the response source is `authoritative-ledger` and the response group ID matches, but the current controller intentionally does not yet provide that response.

## Financial state that must remain distinct

- Membership approval does not mean that funds were collected.
- A submitted contribution instruction is not a provider attempt.
- A provider attempt is not a verified provider outcome.
- A provider success callback is not necessarily settlement evidence.
- Settlement evidence is not itself proof of a balanced ledger posting.
- A pending/unknown financial operation is not a failed operation and must not be resubmitted as a new payment.
- A posted journal must be balanced; a reversal must be a separately authorized compensating entry.
- A receipt must be built from authoritative backend financial transaction/ledger evidence, not from a UI form submission.

## Amount and currency

The canonical financial path uses an exact monetary representation; the contribution boundary validates amounts and currency. Any future group contribution screen must validate UGX as an integer unit (including the approved minimum/maximum), reject zero/negative/fractional/overflow values and confirm the actual selected amount. A configurable fee must come from an approved rule; no fee may be invented.

## Provider and settlement limitations

The inspected controller explicitly does not call provider APIs. This archive-local execution had no authorized live or sandbox MTN MoMo credentials/provider environment, and no verified callback or settlement fixture. Therefore:

- no real payment was initiated;
- no test payment was sent to a live member;
- no provider success was fabricated;
- no settlement was claimed;
- no ledger posting or receipt was proven for the group flow;
- Airtel and other providers remain subject to their existing adapter gates and independent verification.

## Required completion work

1. Decide and document canonical Mongoose group-to-financial-account ownership; reconcile legacy Sequelize `GroupWallet` rather than creating another wallet.
2. Add account mapping under authorized provisioning with unique tenant/group/account/currency constraints.
3. Use the existing canonical financial account balance repository or ledger account projection; never roll up all group journal sides.
4. Add read-only account/statement API with role and field-level access controls.
5. Add a contribution instruction endpoint that maps real authenticated `Member` and group to the financial operation using server-side lookups.
6. Implement provider initiation/verification only for configured approved providers and keep unknown outcomes recoverable.
7. Link posted journals and outbox to reconciliations; create receipts only after verified financial state.
8. Test amount boundaries, currency mismatches, duplicate requests, callback replay, concurrent posting, failed transaction rollback and compensating reversal against a Mongo replica set and provider sandbox.

## Evidence state

| Requirement | Evidence level in this execution |
|---|---|
| Remove unmounted contribution API call from Group Details | IMPLEMENTED + SOURCE CONTRACT TESTED |
| Prevent unauthenticated/cross-tenant/non-member group financial reads | IMPLEMENTED in controller; test added but integration unexecuted |
| Avoid synthetic group zero balance | IMPLEMENTED fail-closed; source contract tested |
| Correct canonical group account mapping | BLOCKED / NOT IMPLEMENTED |
| Durable group contribution intent + recovery | EXISTING canonical contribution path; group UI integration not implemented |
| Provider verification / settlement | BLOCKED — external provider configuration/evidence not available |
| Ledger posting and balanced journal in this group journey | NOT TESTED / NOT PROVEN |
| Group-level reconciled statement and receipt | BLOCKED |

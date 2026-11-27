# Billing payment and reconciliation specification

## Existing payment work

`billingPayment.model.js` and `billingPayment.service.js` implement a substantial commercial payment contract. The service relies on repository and invoice operations that are absent or empty in the uploaded archive. The financial-core port/adapter is present but requires actual canonical dependencies and a live database session.

## Read-only status

The new billing read model reads `titech_billing_payments` using an allowlisted projection. It does not create payment instructions, process provider callbacks, mark payments successful, allocate amounts, post journals, issue receipts, or reconcile bank/provider settlement. Status records are not proof of settled cash.

## Required payment lifecycle

Institution invoice ownership check → idempotent payment attempt → configured canonical provider adapter → authenticated callback/inquiry → provider reference/amount/currency validation → verified provider outcome → independent settlement evidence → bounded invoice allocation → canonical platform billing financial-core posting → reconciliation → audit and receipt.

Unknown outcomes must remain UNKNOWN/PENDING until independently resolved. Invalid signatures, repeated callbacks, out-of-order events, amount mismatch, reference conflict and reversal must be isolated for investigation.

## Reconciliation prerequisites

- Provider credentials and signed callback secret, stored in approved secret management.
- Raw-body/signature validation matching provider specification.
- Provider inquiry or settlement report evidence.
- Unique provider event and transaction references.
- Settlement date, amount, currency, net fees and reversals.
- Independent matching rules and exception queue.
- Finance approval and immutable resolution history.

No MTN MoMo, Airtel Money, bank or card provider is asserted to be live in this build.

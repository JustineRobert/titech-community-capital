/**
 * Explicit adapter from commercial billing to TITech's existing financial core.
 * It never writes ledger/account/balance models directly. A deployment must
 * inject the existing canonical posting functions; no guessed service method
 * or fallback ledger is provided here.
 */
import { assertBillingFinancialCorePort } from './billingFinancialCore.port.js';

function required(value, field) {
  if (value == null || String(value).trim() === '') throw new TypeError(`${field} is required.`);
  return String(value).trim();
}

function extractTransactionId(result) {
  const id = result?.financialTransactionId ?? result?.transactionId ?? result?.financial?.transactionId ?? result?.transaction?._id ?? result?.transaction?.id ?? result?._id;
  return id == null ? null : String(id);
}

export function createTitechFinancialCoreAdapter({ postCanonicalBillingPayment, reverseCanonicalBillingPayment = null } = {}) {
  if (typeof postCanonicalBillingPayment !== 'function') {
    throw new TypeError('postCanonicalBillingPayment must be wired to the established canonical financial transaction/ledger service.');
  }

  const adapter = {
    async postBillingPayment(input = {}) {
      const tenantId = required(input.tenantId, 'tenantId');
      const invoiceId = required(input.invoice?._id ?? input.invoice?.id, 'invoice.id');
      const paymentId = required(input.payment?._id ?? input.payment?.id, 'payment.id');
      const amount = required(input.amount, 'amount');
      const currency = required(input.currency, 'currency').toUpperCase();
      const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
      if (String(input.invoice?.tenantId ?? '') !== tenantId || String(input.payment?.tenantId ?? '') !== tenantId) {
        throw new Error('Cross-tenant billing payment posting was rejected by the financial-core adapter.');
      }
      if (typeof input.session?.inTransaction !== 'function' || input.session.inTransaction() !== true) {
        throw new Error('An active MongoDB transaction session is required for atomic commercial-to-financial posting.');
      }

      const result = await postCanonicalBillingPayment({
        tenantId,
        invoiceId,
        billingPaymentId: paymentId,
        amount,
        currency,
        provider: required(input.provider, 'provider'),
        providerPaymentId: input.providerPaymentId == null ? null : String(input.providerPaymentId),
        providerReference: input.providerReference == null ? null : String(input.providerReference),
        idempotencyKey,
        occurredAt: input.occurredAt,
        financialContext: input.financialContext ?? {},
        metadata: input.metadata ?? {},
        session: input.session,
        source: 'TITECH_COMMERCIAL_BILLING',
      });
      const financialTransactionId = extractTransactionId(result);
      if (!financialTransactionId) {
        throw new Error('Canonical financial core did not return an authoritative financial transaction ID.');
      }
      if (result?.posted !== true && String(result?.status ?? '').toUpperCase() !== 'POSTED') {
        throw new Error('Canonical financial core did not explicitly confirm a POSTED journal/transaction.');
      }
      return { ...result, financialTransactionId };
    },

    async reverseBillingPayment(input = {}) {
      if (typeof reverseCanonicalBillingPayment !== 'function') {
        throw new Error('Billing-payment reversal is unavailable until the canonical financial reversal workflow is wired.');
      }
      const tenantId = required(input.tenantId, 'tenantId');
      const financialTransactionId = required(input.financialTransactionId, 'financialTransactionId');
      const reason = required(input.reason, 'reason');
      if (typeof input.session?.inTransaction !== 'function' || input.session.inTransaction() !== true) {
        throw new Error('An active MongoDB transaction session is required for atomic financial reversal.');
      }
      return reverseCanonicalBillingPayment({ ...input, tenantId, financialTransactionId, reason, source: 'TITECH_COMMERCIAL_BILLING' });
    },
  };

  return Object.freeze(assertBillingFinancialCorePort(adapter));
}

export default createTitechFinancialCoreAdapter;

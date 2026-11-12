/** Contract boundary between commercial billing and TITech's canonical financial core. */
export class BillingFinancialCorePort {
  async postBillingPayment() {
    throw new Error('BillingFinancialCorePort.postBillingPayment must be supplied by the canonical financial-core adapter.');
  }

  async reverseBillingPayment() {
    throw new Error('BillingFinancialCorePort.reverseBillingPayment must be supplied by an authorised canonical financial-core adapter.');
  }
}

export function assertBillingFinancialCorePort(candidate) {
  if (!candidate || typeof candidate.postBillingPayment !== 'function') {
    throw new TypeError('A configured canonical financial core with postBillingPayment is required.');
  }
  return candidate;
}

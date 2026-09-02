// Minimal mobile money provider adapter skeleton
module.exports = {
  providerName: 'mobileMoney',
  async createIntent({ amount, currency, metadata, idempotencyKey }) {
    // Implement provider API integration here
    return { id: `mm_${Date.now()}`, clientData: { vendor: 'mobile-money', checkoutUrl: null } };
  },
  verifyWebhook(payload, headers) {
    // verify signature if applicable
    return true;
  },
  parseEvent(payload) {
    return { type: 'payment.succeeded', data: payload };
  },
};

const PaymentService = require('../../community-savings-app-backend/services/payment/PaymentService');

describe('PaymentService (unit)', () => {
  test('createPaymentIntent requires params', async () => {
    const svc = new PaymentService({ providers: {} });
    await expect(svc.createPaymentIntent({})).rejects.toThrow();
  });
});

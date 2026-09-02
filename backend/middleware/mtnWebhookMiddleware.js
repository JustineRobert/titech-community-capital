// middleware/mtnWebhookMiddleware.js

const WebhookSecurity = require('../utils/webhookSecurity');

const MTN_SECRET = process.env.MTN_WEBHOOK_SECRET;

const mtnWebhookMiddleware = (req, res, next) => {
  try {
    const signature = req.headers['x-mtn-signature'];
    const timestamp = Number(req.headers['x-mtn-timestamp']);

    // ✅ Validate timestamp (anti-replay attack)
    if (!WebhookSecurity.preventReplayAttack(timestamp)) {
      return res.status(403).json({ message: 'Invalid or expired request' });
    }

    // ✅ Validate signature
    const isValid = WebhookSecurity.validateSignature(
      req.body,
      signature,
      MTN_SECRET
    );

    if (!isValid) {
      return res.status(403).json({ message: 'Invalid signature' });
    }

    next();
  } catch (err) {
    console.error('Webhook validation failed:', err);
    res.status(500).json({ message: 'Webhook error' });
  }
};

module.exports = mtnWebhookMiddleware;
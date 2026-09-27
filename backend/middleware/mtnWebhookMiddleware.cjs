// backend/middleware/mtnWebhookMiddleware.cjs

const WebhookSecurity = require('../utils/webhookSecurity.cjs');

function mtnWebhookMiddleware(req, res, next) {
  try {
    const signature = req.headers['x-mtn-signature'];
    const timestamp = req.headers['x-mtn-timestamp'];
    const secret = process.env.MTN_WEBHOOK_SECRET;

    if (!secret) {
      return res.status(503).json({
        success: false,
        error: { code: 'WEBHOOK_SECURITY_NOT_CONFIGURED' },
      });
    }

    if (!WebhookSecurity.preventReplayAttack(timestamp)) {
      return res.status(403).json({ message: 'Invalid or expired request' });
    }

    const valid = WebhookSecurity.validateSignature(
      req.body,
      signature,
      secret,
      req.rawBody,
    );

    if (!valid) {
      return res.status(403).json({ message: 'Invalid signature' });
    }

    return next();
  } catch (error) {
    console.error('Webhook validation failed:', {
      code: error?.code || 'WEBHOOK_VALIDATION_FAILED',
      message: error?.message || 'Webhook validation failed',
    });
    return res.status(403).json({ message: 'Webhook validation failed' });
  }
}

module.exports = mtnWebhookMiddleware;

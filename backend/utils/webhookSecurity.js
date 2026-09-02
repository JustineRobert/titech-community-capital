// utils/webhookSecurity.js

const crypto = require('crypto');

class WebhookSecurity {
  static validateSignature(payload, signature, secret) {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    return hash === signature;
  }

  static preventReplayAttack(timestamp) {
    const now = Date.now();
    const diff = Math.abs(now - timestamp);

    // Allow max 5 minutes window
    return diff < 5 * 60 * 1000;
  }
}

module.exports = WebhookSecurity;
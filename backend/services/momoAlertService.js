// services/momoAlertService.js

class MoMoAlertService {
  static async sendSMS(phone, message) {
    try {
      // ✅ Replace with MTN MoMo / SMS Gateway API
      console.log(`📩 Sending SMS to ${phone}: ${message}`);

      /*
      await axios.post(MTN_SMS_API, {
        to: phone,
        message
      });
      */

      return true;
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }

  static async sendFraudAlert(user, data) {
    const message = `🚨 Alert: Suspicious transaction detected.
Score: ${data.score}
Action: ${data.decision}`;

    return this.sendSMS(user.phone, message);
  }
}

module.exports = MoMoAlertService;
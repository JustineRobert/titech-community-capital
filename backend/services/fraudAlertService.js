const sendEmail = require('../services/emailService').sendEmail;

export async function sendAlert(message) {
  console.warn('[ALERT]', message);

  // Example: email/slack integration placeholder
}

async function sendFraudAlert(user, transaction) {
  const message = `⚠️ Suspicious transaction detected: UGX ${transaction.amount}`;

  // ✅ Email
  await sendEmail({
    to: user.email,
    subject: "Fraud Alert",
    template: "fraud_alert",
    data: { message }
  });

  // ✅ SMS (Mock or integrate Africa’s Talking / Twilio)
  console.log("📱 SMS ALERT:", message);
}

module.exports = { sendFraudAlert };
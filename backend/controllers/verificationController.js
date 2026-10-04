// controllers/verificationController.js

const OTPService = require('../services/otpService.cjs');

const verifyOTP = async (req, res) => {
  const { userId, otp } = req.body;

  const isValid = await OTPService.verifyOTP(userId, otp);

  if (!isValid) {
    return res.status(400).json({
      message: 'Invalid or expired OTP'
    });
  }

  return res.json({
    message: 'Transaction verified successfully'
  });
};

module.exports = { verifyOTP };
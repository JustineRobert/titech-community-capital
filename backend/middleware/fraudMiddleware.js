// middleware/fraudMiddleware.js

const { FraudDetectionService } = require('../services/fraudDetectionService');
const DeviceFingerprintService = require('../services/deviceFingerprintService');
const OTPService = require('../services/otpService');
const MoMoAlertService = require('../services/momoAlertService');

const fraudMiddleware = async (req, res, next) => {
  try {
    const user = req.user;
    const transaction = req.body;

    // ✅ Device fingerprinting
    const fingerprint = DeviceFingerprintService.generateFingerprint(req);
    const isNewDevice = DeviceFingerprintService.isNewDevice(user, fingerprint);
    transaction.newDevice = isNewDevice;

    const result = await FraudDetectionService.checkTransaction(user, transaction);

    // ✅ BLOCK FLOW
    if (result.decision === 'BLOCK') {
      await MoMoAlertService.sendFraudAlert(user, result);

      return res.status(403).json({
        message: 'Transaction blocked due to high fraud risk',
        fraudScore: result.score
      });
    }

    // ✅ STEP-UP FLOW (OTP + ALERT)
    if (result.decision === 'STEP_UP_AUTH') {
      const otp = OTPService.generateOTP(user._id);

      await MoMoAlertService.sendSMS(
        user.phone,
        `🔐 OTP Verification Required: ${otp}`
      );

      return res.status(202).json({
        message: 'OTP verification required',
        fraudScore: result.score,
        stepUp: true
      });
    }

    // ✅ STORE trusted device
    if (isNewDevice) {
      user.knownDevices = user.knownDevices || [];
      user.knownDevices.push(fingerprint);
      await user.save();
    }

    next();
  } catch (error) {
    console.error('Fraud middleware error:', error);
    next(error);
  }
};

module.exports = fraudMiddleware;
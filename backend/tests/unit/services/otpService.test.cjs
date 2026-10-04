'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const OTPService = require('../../../services/otpService.cjs');

test('OTP generates a six-digit value and verifies once', async () => {
  const userId = 'otp-test-user';
  const otp = await OTPService.generateOTP(userId);

  assert.match(otp, /^\d{6}$/);
  assert.equal(await OTPService.verifyOTP(userId, otp), true);
  assert.equal(await OTPService.verifyOTP(userId, otp), false);
});

test('OTP verification rejects an incorrect code', async () => {
  const userId = 'otp-test-user-invalid';
  const otp = await OTPService.generateOTP(userId);

  assert.equal(await OTPService.verifyOTP(userId, '000000' === otp ? '111111' : '000000'), false);
  assert.equal(await OTPService.verifyOTP(userId, otp), true);
});

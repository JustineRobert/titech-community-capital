'use strict';

/**
 * Secure OTP service for legacy verification/fraud middleware.
 * OTPs are stored as hashes with a short TTL in Redis when available.
 * Production refuses an unavailable Redis dependency rather than silently
 * treating an in-process map as secure multi-instance state.
 */
const crypto = require('node:crypto');
const redis = require('./redis.cjs');

const TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS || 300);
const KEY_PREFIX = 'titech:otp:';
const HASH_ALGORITHM = 'sha256';

function hashCode(userId, otp) {
  return crypto
    .createHash(HASH_ALGORITHM)
    .update(`${String(userId)}:${String(otp)}`)
    .digest('hex');
}

function redisKey(userId) {
  return `${KEY_PREFIX}${String(userId)}`;
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function generateOTP(userId) {
  if (!userId) throw new Error('userId is required for OTP generation');
  const otp = generateCode();
  const hashed = hashCode(userId, otp);

  if (redis?.client && redis.isReady?.()) {
    await redis.client.set(redisKey(userId), hashed, 'EX', Math.max(60, TTL_SECONDS));
  } else if (process.env.NODE_ENV === 'production') {
    const error = new Error('OTP storage is unavailable in production.');
    error.code = 'OTP_STORE_UNAVAILABLE';
    throw error;
  } else {
    generateOTP.memory ||= new Map();
    generateOTP.memory.set(String(userId), {
      hash: hashed,
      expiresAt: Date.now() + Math.max(60, TTL_SECONDS) * 1000,
    });
  }

  return otp;
}

async function verifyOTP(userId, otp) {
  if (!userId || !otp) return false;
  const expected = hashCode(userId, otp);

  let actual = null;
  if (redis?.client && redis.isReady?.()) {
    actual = await redis.client.get(redisKey(userId));
  } else {
    const entry = generateOTP.memory?.get(String(userId));
    if (entry && entry.expiresAt > Date.now()) actual = entry.hash;
    else generateOTP.memory?.delete(String(userId));
  }

  if (!actual) return false;

  const valid = crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  if (valid && redis?.client && redis.isReady?.()) await redis.client.del(redisKey(userId));
  if (valid) generateOTP.memory?.delete(String(userId));
  return valid;
}

module.exports = Object.freeze({ generateOTP, verifyOTP, hashCode });

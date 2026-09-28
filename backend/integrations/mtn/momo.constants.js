module.exports = Object.freeze({
  PROVIDER: 'MTN_MOMO',
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || 'UGX',
  ENVIRONMENT: process.env.MTN_MOMO_ENVIRONMENT || process.env.NODE_ENV || 'development',
});

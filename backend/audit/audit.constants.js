/** Compatibility boundary: canonical audit constants live in modules/audit. */
module.exports = Object.freeze({
  REDACTION_PATTERN: /(?:password|secret|token|authorization|cookie|privatekey|private_key|clientsecret|accesskey|refresh)/i,
  CHAIN_GENESIS: 'GENESIS',
});

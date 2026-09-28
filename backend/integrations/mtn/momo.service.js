/** Canonical MTN service compatibility boundary; financial posting remains owned by the financial core. */
const collections = require('../../services/mtn/collections.js');
const disbursements = require('../../services/mtn/disbursements.js');
const auth = require('../../services/mtn/auth.js');
const reconciliation = require('../../services/mtn/reconciliation.js');
const webhooks = require('../../services/mtn/webhooks.js');
module.exports = Object.freeze({
  auth,
  collections,
  disbursements,
  reconciliation,
  webhooks,
});

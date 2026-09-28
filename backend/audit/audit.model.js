/** Compatibility boundary for legacy CommonJS consumers. */
const canonical = require('../modules/audit/audit.model.js');
module.exports = canonical.default || canonical;

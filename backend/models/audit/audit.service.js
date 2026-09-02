// backend/modules/audit/audit.service.js
"use strict";

const Audit = require("./audit.model");
const crypto = require("crypto");

/**
 * Verify audit chain integrity for a tenant
 * - Iterates through all logs in chronological order
 * - Recomputes hashes and compares with stored values
 * - Returns true if chain is intact, false if tampered
 *
 * @param {String} tenantId - Tenant identifier
 * @returns {Promise<{ valid: boolean, errors: Array }>}
 */
async function verifyAuditChain(tenantId) {
  const logs = await Audit.find({ tenantId }).sort({ createdAt: 1 }).lean();

  let previousHash = "GENESIS";
  const errors = [];

  for (const log of logs) {
    const recomputedHash = crypto
      .createHash("sha256")
      .update(previousHash + JSON.stringify(log.data) + log.action)
      .digest("hex");

    if (log.previousHash !== previousHash) {
      errors.push({
        id: log._id,
        issue: "Previous hash mismatch",
        expected: previousHash,
        found: log.previousHash,
      });
    }

    if (log.hash !== recomputedHash) {
      errors.push({
        id: log._id,
        issue: "Hash mismatch",
        expected: recomputedHash,
        found: log.hash,
      });
    }

    previousHash = log.hash;
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  createAuditLog,
  verifyAuditChain,
};

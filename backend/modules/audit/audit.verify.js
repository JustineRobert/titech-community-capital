// backend/modules/audit/audit.verify.js
"use strict";

const crypto = require("crypto");
const Audit = require("./audit.model");
const logger = require("../utils/logger") || console;

/**
 * Verify audit chain integrity for a tenant
 * - Iterates through all logs in chronological order
 * - Recomputes hashes and compares with stored values
 * - Returns detailed report of integrity status
 *
 * @param {String} tenantId - Tenant identifier
 * @returns {Promise<{ valid: boolean, errors: Array }>}
 */
async function verifyAuditChain(tenantId) {
  if (!tenantId) throw new Error("TenantId is required for chain verification");

  try {
    const logs = await Audit.find({ tenantId }).sort({ createdAt: 1 }).lean();

    if (!logs.length) {
      logger.warn("[AuditVerify] No logs found for tenant", { tenantId });
      return { valid: true, errors: [] }; // nothing to verify
    }

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

    const valid = errors.length === 0;

    logger.info("[AuditVerify] Chain verification completed", {
      tenantId,
      valid,
      errorCount: errors.length,
    });

    return { valid, errors };
  } catch (error) {
    logger.error("[AuditVerify] Chain verification error", {
      tenantId,
      error: error.message,
    });
    throw error;
  }
}

module.exports = { verifyAuditChain };

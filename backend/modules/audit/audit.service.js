// backend/modules/audit/audit.service.js
"use strict";

const crypto = require("crypto");
const Audit = require("./audit.model");
const logger = require("../utils/logger") || console;

/**
 * Create an immutable audit log entry
 * - Chains logs with SHA‑256 hash for tamper evidence
 * - Validates tenant context and action
 * - Stores previous hash for blockchain‑like integrity
 *
 * @param {Object} params
 * @param {String} params.tenantId - Tenant identifier
 * @param {String} params.action - Action performed
 * @param {Object} params.data - Arbitrary payload describing the event
 * @returns {Promise<Document>} - Audit log document
 */
async function createAuditLog({ tenantId, action, data }) {
  if (!tenantId) throw new Error("TenantId is required");
  if (!action) throw new Error("Action is required");
  if (!data) throw new Error("Data payload is required");

  try {
    // ✅ Get last record for chain integrity
    const lastLog = await Audit.findOne({ tenantId }).sort({ createdAt: -1 }).lean();
    const previousHash = lastLog ? lastLog.hash : "GENESIS";

    // ✅ Generate new hash (includes action + data)
    const hash = crypto
      .createHash("sha256")
      .update(previousHash + JSON.stringify(data) + action)
      .digest("hex");

    // ✅ Persist audit log
    const log = await Audit.create({
      tenantId,
      action,
      data,
      previousHash,
      hash,
    });

    logger.info("[AuditService] Log created", {
      tenantId,
      action,
      hash,
      previousHash,
    });

    return log;
  } catch (error) {
    logger.error("[AuditService] Audit log error", {
      tenantId,
      action,
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  createAuditLog,
};

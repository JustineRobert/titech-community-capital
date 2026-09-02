// models/Audit.js
AuditSchema.statics.verifyChain = async function (tenantId) {
  const crypto = require("crypto");
  const logs = await this.find({ tenantId }).sort({ createdAt: 1 }).lean();

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
};

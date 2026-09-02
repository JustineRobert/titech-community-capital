// controllers/kyc.controller.js
"use strict";

const { verifyIdentity } = require("../modules/kyc/kyc.service");
const logger = require("../utils/logger") || console;

/**
 * Verify User Identity
 * - Validates request payload
 * - Calls KYC service
 * - Normalizes response for client
 */
exports.verifyUser = async (req, res) => {
  try {
    const { firstName, lastName, nin } = req.body;

    if (!firstName || !lastName || !nin) {
      logger.warn("[KYCController] Missing required fields", { body: req.body });
      return res.status(400).json({ error: "firstName, lastName, and nin are required" });
    }

    const result = await verifyIdentity({ firstName, lastName, nin });

    if (result.status === "verified") {
      logger.info("[KYCController] User verified", {
        nin,
        firstName,
        lastName,
        confidence: result.matchScore,
      });

      return res.json({
        verified: true,
        confidence: result.matchScore,
      });
    }

    logger.info("[KYCController] Verification failed", {
      nin,
      firstName,
      lastName,
      reason: result.reason,
    });

    return res.status(400).json({
      verified: false,
      reason: result.reason,
    });
  } catch (error) {
    logger.error("[KYCController] Internal error", {
      error: error.message,
      body: req.body,
    });
    return res.status(500).json({ error: "Internal server error" });
  }
};

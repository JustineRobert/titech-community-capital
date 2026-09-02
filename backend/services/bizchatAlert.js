// services/bizchatAlert.js
"use strict";

const axios = require("axios");
const winston = require("winston");

// Configure logger (extend with file, DB, or cloud transports if needed)
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Send alert to BizChat webhook
 * @param {Object} payload - JSON payload to send
 * @returns {Promise<void>}
 */
exports.sendBizChatAlert = async (payload) => {
  const webhookUrl = process.env.BIZCHAT_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.error("BIZCHAT_WEBHOOK_URL is not defined in environment variables");
    throw new Error("Missing BizChat webhook URL");
  }

  try {
    await axios.post(webhookUrl, payload, {
      timeout: 5000,
      headers: { "Content-Type": "application/json" },
    });

    logger.info("BizChat alert successfully sent", { payload });
  } catch (err) {
    logger.error("BizChat alert failed", {
      error: err.message,
      stack: err.stack,
      payload,
    });

    // Optional retry for transient network errors
    if (["ECONNRESET", "ETIMEDOUT"].includes(err.code)) {
      try {
        await axios.post(webhookUrl, payload);
        logger.warn("BizChat alert retried successfully after network error");
      } catch (retryErr) {
        logger.error("BizChat retry failed", {
          error: retryErr.message,
          stack: retryErr.stack,
        });
      }
    }
  }
};

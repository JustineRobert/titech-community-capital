// services/alert.service.js
"use strict";

const axios = require("axios");
const winston = require("winston");

// Configure a simple logger (you can extend with transports like MongoDB or CloudWatch)
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
 * @param {Object} event - Event payload to send
 * @returns {Promise<void>}
 */
exports.sendAlert = async (event) => {
  const webhookUrl = process.env.BIZCHAT_WEBHOOK_URL;

  if (!webhookUrl) {
    logger.error("BIZCHAT_WEBHOOK_URL is not defined in environment variables");
    throw new Error("Missing BizChat webhook URL");
  }

  try {
    const payload = {
      text: JSON.stringify(event, null, 2),
    };

    await axios.post(webhookUrl, payload, {
      timeout: 5000, // prevent hanging requests
      headers: { "Content-Type": "application/json" },
    });

    logger.info("Alert successfully sent to BizChat", { event });
  } catch (error) {
    logger.error("Failed to send alert", {
      error: error.message,
      stack: error.stack,
      event,
    });

    // Optional: retry once if network error
    if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT") {
      try {
        await axios.post(webhookUrl, { text: JSON.stringify(event, null, 2) });
        logger.warn("Alert retried successfully after network error");
      } catch (retryError) {
        logger.error("Retry failed", {
          error: retryError.message,
          stack: retryError.stack,
        });
      }
    }
  }
};

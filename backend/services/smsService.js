// ============================================================================
// File: backend/services/smsService.js
// Description: Enterprise SMS Service
// ============================================================================

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const logger = require("../utils/logger");

// ============================================================================
// Constants
// ============================================================================

const SMS_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED"
};

const SMS_PROVIDERS = {
  AFRICAS_TALKING: "AFRICAS_TALKING",
  TWILIO: "TWILIO",
  INFOBIP: "INFOBIP",
  MOCK: "MOCK"
};

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PROVIDER =
  process.env.SMS_PROVIDER ||
  SMS_PROVIDERS.MOCK;

const DEFAULT_SENDER_ID =
  process.env.SMS_SENDER_ID ||
  "COMMUNITY";

const REQUEST_TIMEOUT =
  Number(
    process.env.SMS_TIMEOUT_MS ||
      30000
  );

// ============================================================================
// Errors
// ============================================================================

class SMSServiceError extends Error {
  constructor(
    message,
    code,
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name = "SMSServiceError";
    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateMessageId() {
  return `sms_${crypto.randomUUID()}`;
}

function normalizePhoneNumber(
  phoneNumber
) {
  if (!phoneNumber) {
    throw new SMSServiceError(
      "Phone number is required",
      "PHONE_REQUIRED",
      400
    );
  }

  return String(phoneNumber)
    .replace(/\s+/g, "")
    .replace(/[^\d+]/g, "");
}

function validateMessage(
  phoneNumber,
  message
) {
  if (!phoneNumber) {
    throw new SMSServiceError(
      "Phone number is required",
      "PHONE_REQUIRED",
      400
    );
  }

  if (!message) {
    throw new SMSServiceError(
      "Message is required",
      "MESSAGE_REQUIRED",
      400
    );
  }
}

// ============================================================================
// Provider Implementations
// ============================================================================

async function sendViaAfricasTalking({
  phoneNumber,
  message,
  senderId
}) {
  const apiKey =
    process.env
      .AFRICAS_TALKING_API_KEY;

  const username =
    process.env
      .AFRICAS_TALKING_USERNAME;

  const response =
    await axios.post(
      "https://api.africastalking.com/version1/messaging",
      new URLSearchParams({
        username,
        to: phoneNumber,
        message,
        from: senderId
      }),
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          apiKey,
          "Content-Type":
            "application/x-www-form-urlencoded"
        }
      }
    );

  return response.data;
}

async function sendViaTwilio({
  phoneNumber,
  message
}) {
  const sid =
    process.env.TWILIO_ACCOUNT_SID;

  const token =
    process.env.TWILIO_AUTH_TOKEN;

  const from =
    process.env.TWILIO_PHONE;

  const response =
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      new URLSearchParams({
        To: phoneNumber,
        From: from,
        Body: message
      }),
      {
        auth: {
          username: sid,
          password: token
        }
      }
    );

  return response.data;
}

async function sendViaInfobip({
  phoneNumber,
  message,
  senderId
}) {
  const apiKey =
    process.env.INFOBIP_API_KEY;

  const baseUrl =
    process.env.INFOBIP_BASE_URL;

  const response =
    await axios.post(
      `${baseUrl}/sms/2/text/advanced`,
      {
        messages: [
          {
            from: senderId,
            destinations: [
              {
                to: phoneNumber
              }
            ],
            text: message
          }
        ]
      },
      {
        timeout: REQUEST_TIMEOUT,
        headers: {
          Authorization:
            `App ${apiKey}`,
          "Content-Type":
            "application/json"
        }
      }
    );

  return response.data;
}

async function sendViaMock({
  phoneNumber,
  message
}) {
  logger.info(
    "[SMS MOCK]",
    {
      phoneNumber,
      message
    }
  );

  return {
    success: true,
    provider: "MOCK"
  };
}

// ============================================================================
// Provider Router
// ============================================================================

async function routeMessage(
  provider,
  payload
) {
  switch (provider) {
    case SMS_PROVIDERS.AFRICAS_TALKING:
      return sendViaAfricasTalking(
        payload
      );

    case SMS_PROVIDERS.TWILIO:
      return sendViaTwilio(
        payload
      );

    case SMS_PROVIDERS.INFOBIP:
      return sendViaInfobip(
        payload
      );

    default:
      return sendViaMock(payload);
  }
}

// ============================================================================
// Core SMS Sender
// ============================================================================

async function send({
  phoneNumber,
  message,
  senderId = DEFAULT_SENDER_ID,
  provider = DEFAULT_PROVIDER,
  tenantId = null,
  metadata = {}
}) {
  validateMessage(
    phoneNumber,
    message
  );

  const normalizedPhone =
    normalizePhoneNumber(
      phoneNumber
    );

  const messageId =
    generateMessageId();

  try {
    const providerResponse =
      await routeMessage(
        provider,
        {
          phoneNumber:
            normalizedPhone,
          message,
          senderId
        }
      );

    logger.info(
      "SMS sent successfully",
      {
        messageId,
        tenantId,
        provider,
        phoneNumber:
          normalizedPhone
      }
    );

    return {
      success: true,
      messageId,
      provider,
      status:
        SMS_STATUS.SENT,
      phoneNumber:
        normalizedPhone,
      providerResponse,
      metadata
    };
  } catch (error) {
    logger.error(
      "SMS delivery failed",
      {
        messageId,
        provider,
        error:
          error.message
      }
    );

    throw new SMSServiceError(
      error.message,
      "SMS_SEND_FAILED",
      500
    );
  }
}

// ============================================================================
// Bulk SMS
// ============================================================================

async function sendBulk({
  recipients,
  message,
  senderId
}) {
  const results =
    await Promise.allSettled(
      recipients.map(
        (phoneNumber) =>
          send({
            phoneNumber,
            message,
            senderId
          })
      )
    );

  return results;
}

// ============================================================================
// OTP Delivery
// ============================================================================

async function sendOTP({
  phoneNumber,
  otp,
  tenantName
}) {
  return send({
    phoneNumber,
    message:
      `${tenantName || "Community Savings"} verification code: ${otp}. Do not share this code.`
  });
}

// ============================================================================
// Transaction Alert
// ============================================================================

async function sendTransactionAlert({
  phoneNumber,
  amount,
  transactionType,
  reference
}) {
  return send({
    phoneNumber,
    message:
      `${transactionType}: UGX ${amount}. Ref: ${reference}`
  });
}

// ============================================================================
// Templates
// ============================================================================

const templates = {
  loanApproved(data) {
    return `Your loan of UGX ${data.amount} has been approved.`;
  },

  repaymentReceived(data) {
    return `Repayment of UGX ${data.amount} received successfully.`;
  },

  depositReceived(data) {
    return `Deposit of UGX ${data.amount} received.`;
  },

  withdrawalProcessed(data) {
    return `Withdrawal of UGX ${data.amount} completed.`;
  }
};

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service: "sms-service",
    provider:
      DEFAULT_PROVIDER,
    status: "UP",
    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  SMS_STATUS,
  SMS_PROVIDERS,

  SMSServiceError,

  send,
  sendBulk,

  sendOTP,
  sendTransactionAlert,

  templates,

  healthCheck
};
// ============================================================================
// File: backend/services/pushNotificationService.js
// Description: Enterprise Push Notification Service
// ============================================================================

"use strict";

const crypto = require("crypto");
const admin = require("firebase-admin");

const logger = require("../utils/logger");

// ============================================================================
// Firebase Initialization
// ============================================================================

let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) {
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FCM_PROJECT_ID,
        clientEmail: process.env.FCM_CLIENT_EMAIL,
        privateKey: process.env.FCM_PRIVATE_KEY
          ? process.env.FCM_PRIVATE_KEY.replace(
              /\\n/g,
              "\n"
            )
          : undefined
      })
    });

    firebaseInitialized = true;

    logger.info(
      "Firebase push service initialized"
    );
  } catch (error) {
    logger.error(
      "Firebase initialization failed",
      {
        error: error.message
      }
    );
  }
}

initializeFirebase();

// ============================================================================
// Constants
// ============================================================================

const PUSH_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED"
};

const PUSH_TYPES = {
  SYSTEM: "SYSTEM",

  SAVINGS_DEPOSIT:
    "SAVINGS_DEPOSIT",

  SAVINGS_WITHDRAWAL:
    "SAVINGS_WITHDRAWAL",

  LOAN_APPROVED:
    "LOAN_APPROVED",

  LOAN_REPAYMENT:
    "LOAN_REPAYMENT",

  LOAN_OVERDUE:
    "LOAN_OVERDUE",

  KYC_APPROVED:
    "KYC_APPROVED",

  KYC_REJECTED:
    "KYC_REJECTED",

  AML_ALERT:
    "AML_ALERT",

  BILLING_ALERT:
    "BILLING_ALERT",

  TRANSACTION_ALERT:
    "TRANSACTION_ALERT"
};

// ============================================================================
// Errors
// ============================================================================

class PushNotificationError extends Error {
  constructor(
    message,
    code,
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name =
      "PushNotificationError";

    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateNotificationId() {
  return `push_${crypto.randomUUID()}`;
}

function validateToken(token) {
  if (!token) {
    throw new PushNotificationError(
      "FCM token required",
      "TOKEN_REQUIRED",
      400
    );
  }
}

// ============================================================================
// Core Send
// ============================================================================

async function send({
  token,
  title,
  body,
  data = {},
  imageUrl = null
}) {
  validateToken(token);

  const notificationId =
    generateNotificationId();

  try {
    const message = {
      token,

      notification: {
        title,
        body,
        imageUrl
      },

      data: Object.entries(data)
        .reduce((acc, [key, value]) => {
          acc[key] =
            String(value);

          return acc;
        }, {})
    };

    const response =
      await admin
        .messaging()
        .send(message);

    logger.info(
      "Push notification sent",
      {
        notificationId,
        token
      }
    );

    return {
      success: true,
      notificationId,
      status:
        PUSH_STATUS.SENT,
      response
    };
  } catch (error) {
    logger.error(
      "Push notification failed",
      {
        notificationId,
        error:
          error.message
      }
    );

    throw new PushNotificationError(
      error.message,
      "PUSH_SEND_FAILED"
    );
  }
}

// ============================================================================
// Bulk Send
// ============================================================================

async function sendBulk({
  tokens,
  title,
  body,
  data = {}
}) {
  const results =
    await Promise.allSettled(
      tokens.map((token) =>
        send({
          token,
          title,
          body,
          data
        })
      )
    );

  return results;
}

// ============================================================================
// Topic Send
// ============================================================================

async function sendToTopic({
  topic,
  title,
  body,
  data = {}
}) {
  const response =
    await admin
      .messaging()
      .send({
        topic,

        notification: {
          title,
          body
        },

        data
      });

  return response;
}

// ============================================================================
// Topic Management
// ============================================================================

async function subscribeToken(
  token,
  topic
) {
  return admin
    .messaging()
    .subscribeToTopic(
      token,
      topic
    );
}

async function unsubscribeToken(
  token,
  topic
) {
  return admin
    .messaging()
    .unsubscribeFromTopic(
      token,
      topic
    );
}

// ============================================================================
// Templates
// ============================================================================

const templates = {
  loanApproved(data) {
    return {
      title:
        "Loan Approved",

      body:
        `Your loan of UGX ${data.amount} has been approved.`
    };
  },

  repaymentReceived(data) {
    return {
      title:
        "Repayment Received",

      body:
        `Repayment of UGX ${data.amount} received.`
    };
  },

  depositReceived(data) {
    return {
      title:
        "Deposit Successful",

      body:
        `UGX ${data.amount} deposited successfully.`
    };
  },

  withdrawalProcessed(data) {
    return {
      title:
        "Withdrawal Successful",

      body:
        `UGX ${data.amount} withdrawn successfully.`
    };
  },

  kycApproved() {
    return {
      title:
        "KYC Approved",

      body:
        "Your KYC verification has been approved."
    };
  },

  amlAlert() {
    return {
      title:
        "Compliance Alert",

      body:
        "Your transaction requires additional review."
    };
  }
};

// ============================================================================
// Specialized Notifications
// ============================================================================

async function sendLoanApproved({
  token,
  amount,
  loanId
}) {
  const template =
    templates.loanApproved({
      amount,
      loanId
    });

  return send({
    token,
    ...template,
    data: {
      loanId
    }
  });
}

async function sendTransactionAlert({
  token,
  amount,
  reference,
  transactionType
}) {
  return send({
    token,
    title:
      transactionType,

    body:
      `UGX ${amount} processed successfully.`,

    data: {
      amount,
      reference
    }
  });
}

// ============================================================================
// Retry Wrapper
// ============================================================================

async function sendWithRetry(
  payload,
  retries = 3
) {
  let lastError;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt++
  ) {
    try {
      return await send(payload);
    } catch (error) {
      lastError = error;

      logger.warn(
        "Push retry failed",
        {
          attempt,
          error:
            error.message
        }
      );
    }
  }

  throw lastError;
}

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "push-notification-service",

    status:
      firebaseInitialized
        ? "UP"
        : "DOWN",

    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  PUSH_STATUS,
  PUSH_TYPES,

  PushNotificationError,

  send,
  sendBulk,
  sendToTopic,

  subscribeToken,
  unsubscribeToken,

  sendLoanApproved,
  sendTransactionAlert,

  sendWithRetry,

  templates,

  healthCheck
};
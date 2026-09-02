// ============================================================================
// File: backend/services/notificationService.js
// Description: Enterprise Notification Service
// ============================================================================

"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");

const logger = require("../utils/logger");

// Optional integrations
let emailService;
let smsService;
let pushService;

try {
  emailService = require("./emailService");
} catch (_) {}

try {
  smsService = require("./smsService");
} catch (_) {}

try {
  pushService = require("./pushService");
} catch (_) {}

// ============================================================================
// Notification Model
// ============================================================================

let Notification;

try {
  Notification = mongoose.model("Notification");
} catch (_) {
  const NotificationSchema =
    new mongoose.Schema(
      {
        notificationId: {
          type: String,
          unique: true,
          index: true
        },

        tenantId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Tenant"
        },

        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
          index: true
        },

        type: {
          type: String,
          required: true,
          index: true
        },

        channel: {
          type: String,
          enum: [
            "IN_APP",
            "EMAIL",
            "SMS",
            "PUSH"
          ],
          default: "IN_APP"
        },

        priority: {
          type: String,
          enum: [
            "LOW",
            "NORMAL",
            "HIGH",
            "CRITICAL"
          ],
          default: "NORMAL"
        },

        title: {
          type: String,
          required: true
        },

        message: {
          type: String,
          required: true
        },

        payload: {
          type: mongoose.Schema.Types.Mixed,
          default: {}
        },

        status: {
          type: String,
          enum: [
            "PENDING",
            "SENT",
            "FAILED",
            "READ"
          ],
          default: "PENDING"
        },

        readAt: Date,
        deliveredAt: Date,

        error: String,

        createdAt: {
          type: Date,
          default: Date.now
        }
      },
      {
        timestamps: true,
        collection: "notifications"
      }
    );

  NotificationSchema.index({
    userId: 1,
    createdAt: -1
  });

  Notification =
    mongoose.model(
      "Notification",
      NotificationSchema
    );
}

// ============================================================================
// Constants
// ============================================================================

const NOTIFICATION_TYPES = {
  SYSTEM: "SYSTEM",

  LOAN_APPROVED:
    "LOAN_APPROVED",

  LOAN_REPAYMENT:
    "LOAN_REPAYMENT",

  LOAN_OVERDUE:
    "LOAN_OVERDUE",

  SAVINGS_DEPOSIT:
    "SAVINGS_DEPOSIT",

  SAVINGS_WITHDRAWAL:
    "SAVINGS_WITHDRAWAL",

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

class NotificationError extends Error {
  constructor(
    message,
    code,
    status = 500,
    metadata = {}
  ) {
    super(message);

    this.name =
      "NotificationError";

    this.code = code;
    this.status = status;
    this.metadata = metadata;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function generateNotificationId() {
  return `ntf_${crypto.randomUUID()}`;
}

function normalizeRecipients(
  recipients
) {
  if (!Array.isArray(recipients)) {
    return [recipients];
  }

  return recipients.filter(Boolean);
}

// ============================================================================
// Core Send
// ============================================================================

async function send({
  recipients,
  type = NOTIFICATION_TYPES.SYSTEM,
  title,
  message,
  payload = {},
  priority = "NORMAL",
  channel = "IN_APP",
  tenantId = null
}) {
  const users =
    normalizeRecipients(
      recipients
    );

  if (!users.length) {
    logger.warn(
      "Notification skipped. No recipients."
    );

    return [];
  }

  const docs = users.map(
    (userId) => ({
      notificationId:
        generateNotificationId(),

      tenantId,
      userId,

      type,
      channel,
      priority,

      title,
      message,

      payload,

      status: "PENDING"
    })
  );

  try {
    const notifications =
      await Notification.insertMany(
        docs
      );

    logger.info(
      "Notifications created",
      {
        count:
          notifications.length,
        type
      }
    );

    return notifications;
  } catch (error) {
    logger.error(
      "Notification creation failed",
      {
        error:
          error.message
      }
    );

    throw new NotificationError(
      error.message,
      "NOTIFICATION_CREATE_FAILED"
    );
  }
}

// ============================================================================
// Send Email
// ============================================================================

async function sendEmail({
  to,
  subject,
  html,
  text
}) {
  if (!emailService) {
    logger.warn(
      "Email service unavailable"
    );

    return false;
  }

  return emailService.send({
    to,
    subject,
    html,
    text
  });
}

// ============================================================================
// Send SMS
// ============================================================================

async function sendSMS({
  phoneNumber,
  message
}) {
  if (!smsService) {
    logger.warn(
      "SMS service unavailable"
    );

    return false;
  }

  return smsService.send({
    phoneNumber,
    message
  });
}

// ============================================================================
// Push Notification
// ============================================================================

async function sendPush({
  userId,
  title,
  body,
  data
}) {
  if (!pushService) {
    logger.warn(
      "Push service unavailable"
    );

    return false;
  }

  return pushService.send({
    userId,
    title,
    body,
    data
  });
}

// ============================================================================
// Read Notification
// ============================================================================

async function markAsRead(
  notificationId
) {
  return Notification.findOneAndUpdate(
    {
      notificationId
    },
    {
      status: "READ",
      readAt: new Date()
    },
    {
      new: true
    }
  );
}

// ============================================================================
// Bulk Read
// ============================================================================

async function markAllAsRead(
  userId
) {
  const result =
    await Notification.updateMany(
      {
        userId,
        status: {
          $ne: "READ"
        }
      },
      {
        status: "READ",
        readAt: new Date()
      }
    );

  return result.modifiedCount;
}

// ============================================================================
// User Notifications
// ============================================================================

async function getUserNotifications(
  userId,
  options = {}
) {
  const {
    page = 1,
    limit = 20
  } = options;

  const skip =
    (page - 1) * limit;

  const notifications =
    await Notification.find({
      userId
    })
      .sort({
        createdAt: -1
      })
      .skip(skip)
      .limit(limit)
      .lean();

  return notifications;
}

// ============================================================================
// Unread Count
// ============================================================================

async function getUnreadCount(
  userId
) {
  return Notification.countDocuments(
    {
      userId,
      status: {
        $ne: "READ"
      }
    }
  );
}

// ============================================================================
// System Broadcast
// ============================================================================

async function broadcast({
  userIds,
  title,
  message,
  payload = {}
}) {
  return send({
    recipients: userIds,
    title,
    message,
    payload,
    priority: "HIGH"
  });
}

// ============================================================================
// Templates
// ============================================================================

const templates = {
  loanApproved(data) {
    return {
      title:
        "Loan Approved",
      message:
        `Your loan of UGX ${data.amount} has been approved.`
    };
  },

  repaymentReceived(data) {
    return {
      title:
        "Repayment Received",
      message:
        `Repayment of UGX ${data.amount} received successfully.`
    };
  },

  savingsDeposit(data) {
    return {
      title:
        "Deposit Received",
      message:
        `Deposit of UGX ${data.amount} posted successfully.`
    };
  }
};

// ============================================================================
// Health Check
// ============================================================================

async function healthCheck() {
  return {
    service:
      "notification-service",
    status: "UP",
    timestamp:
      new Date().toISOString()
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  NOTIFICATION_TYPES,

  NotificationError,

  send,
  sendEmail,
  sendSMS,
  sendPush,

  markAsRead,
  markAllAsRead,

  getUserNotifications,
  getUnreadCount,

  broadcast,

  templates,

  healthCheck
};
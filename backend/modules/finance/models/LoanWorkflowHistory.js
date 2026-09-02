// backend/modules/finance/models/LoanWorkflowHistory.js
'use strict';

const mongoose = require('mongoose');

const LoanWorkflowHistorySchema =
  new mongoose.Schema(
    {
      tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
        index: true
      },

      loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true,
        index: true
      },

      memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
      },

      fromStatus: {
        type: String,
        required: true
      },

      toStatus: {
        type: String,
        required: true,
        index: true
      },

      transitionType: {
        type: String,
        enum: [
          'SUBMISSION',
          'REVIEW',
          'APPROVAL',
          'REJECTION',
          'DISBURSEMENT',
          'ACTIVATION',
          'OVERDUE',
          'DEFAULT',
          'COLLECTION',
          'WRITE_OFF',
          'CLOSURE'
        ],
        required: true
      },

      actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },

      actorRole: {
        type: String,
        required: true
      },

      reason: String,

      comments: String,

      approvedAmount: Number,

      creditScore: Number,

      riskLevel: {
        type: String,
        enum: [
          'LOW',
          'MEDIUM',
          'HIGH',
          'CRITICAL'
        ]
      },

      ipAddress: String,

      userAgent: String,

      requestId: String,

      previousHash: String,

      hash: {
        type: String,
        required: true,
        unique: true,
        index: true
      },

      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    },
    {
      timestamps: true
    }
  );

LoanWorkflowHistorySchema.index({
  loanId: 1,
  createdAt: -1
});

LoanWorkflowHistorySchema.index({
  tenantId: 1,
  createdAt: -1
});

module.exports = mongoose.model(
  'LoanWorkflowHistory',
  LoanWorkflowHistorySchema
);
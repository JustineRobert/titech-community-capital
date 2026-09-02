// backend/modules/finance/models/LoanApproval.js
// { tenantId, loanId, approverId, role, decision, comments, approvedAt }

'use strict';

const mongoose = require('mongoose');

const LoanApprovalSchema = new mongoose.Schema(
{
/**
* Multi-Tenant Support
*/
tenantId: {
type: mongoose.Schema.Types.ObjectId,
ref: 'Tenant',
required: true,
index: true
},

/**
 * Loan Reference
 */
loanId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Loan',
  required: true,
  index: true
},

/**
 * Borrower
 */
memberId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: true,
  index: true
},

/**
 * Approver
 */
approverId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  required: true,
  index: true
},

approverName: {
  type: String,
  trim: true
},

role: {
  type: String,
  required: true,
  enum: [
    'loan_officer',
    'branch_manager',
    'credit_manager',
    'committee_member',
    'board_member',
    'admin',
    'super_admin'
  ]
},

/**
 * Approval Stage
 */
approvalLevel: {
  type: Number,
  required: true,
  min: 1
},

/**
 * Workflow Decision
 */
decision: {
  type: String,
  required: true,
  enum: [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'ABSTAINED'
  ],
  default: 'PENDING',
  index: true
},

/**
 * Loan Snapshot
 */
requestedAmount: {
  type: Number,
  required: true
},

approvedAmount: {
  type: Number,
  default: 0
},

currency: {
  type: String,
  default: 'UGX'
},

/**
 * Risk Data
 */
creditScore: {
  type: Number,
  min: 0,
  max: 1000
},

riskLevel: {
  type: String,
  enum: [
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  ]
},

/**
 * Decision Notes
 */
comments: {
  type: String,
  trim: true,
  maxlength: 5000
},

rejectionReason: {
  type: String,
  trim: true,
  maxlength: 5000
},

/**
 * Digital Signature
 */
signatureHash: {
  type: String
},

signedAt: {
  type: Date
},

/**
 * Governance
 */
committeeVote: {
  type: Boolean,
  default: false
},

boardVote: {
  type: Boolean,
  default: false
},

/**
 * Security Metadata
 */
ipAddress: String,

userAgent: String,

requestId: {
  type: String,
  index: true
},

/**
 * Audit Integration
 */
auditLogId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'AuditLog'
},

workflowHistoryId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'LoanWorkflowHistory'
},

/**
 * Blockchain-style verification
 */
previousHash: String,

hash: {
  type: String,
  index: true
},

/**
 * Approval Completion
 */
approvedAt: Date,

rejectedAt: Date


},
{
timestamps: true,
versionKey: false
}
);

/**

* Tenant Queries
  */
  LoanApprovalSchema.index({
  tenantId: 1,
  createdAt: -1
  });

/**

* Loan Approval Lookup
  */
  LoanApprovalSchema.index({
  loanId: 1,
  approvalLevel: 1
  });

/**

* Committee Voting
  */
  LoanApprovalSchema.index({
  loanId: 1,
  committeeVote: 1
  });

/**

* Board Voting
  */
  LoanApprovalSchema.index({
  loanId: 1,
  boardVote: 1
  });

/**

* Decision Tracking
  */
  LoanApprovalSchema.index({
  decision: 1,
  createdAt: -1
  });

/**

* Prevent duplicate approval
  */
  LoanApprovalSchema.index(
  {
  loanId: 1,
  approverId: 1
  },
  {
  unique: true
  }
  );

module.exports = mongoose.model(
'LoanApproval',
LoanApprovalSchema
);

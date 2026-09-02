// backend/modules/finance/models/JournalEntry.js

'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const uniqueValidator = require('mongoose-unique-validator');

const { Schema } = mongoose;

/**

* ENUMS
  */

const DIRECTIONS = [
'DEBIT',
'CREDIT'
];

const RECONCILIATION_STATUS = [
'PENDING',
'MATCHED',
'DISPUTED',
'RECONCILED'
];

const ENTRY_TYPES = [
'SAVINGS_DEPOSIT',
'SAVINGS_WITHDRAWAL',
'LOAN_DISBURSEMENT',
'LOAN_REPAYMENT',
'LOAN_INTEREST',
'INTEREST_ACCRUAL',
'PENALTY',
'FEE',
'MOMO_SETTLEMENT',
'AIRTEL_SETTLEMENT',
'BANK_SETTLEMENT',
'WRITE_OFF',
'RECOVERY',
'REVERSAL',
'ADJUSTMENT',
'PROVISION',
'DIVIDEND',
'SHARE_PURCHASE'
];

const ENTRY_STATUS = [
'PENDING',
'POSTED',
'REVERSED'
];

/**

* SCHEMA
  */

const JournalEntrySchema = new Schema(
{
/**
* Multi-Tenant Isolation
*/
tenantId: {
type: Schema.Types.ObjectId,
ref: 'Tenant',
required: true,
index: true
},


/**
 * Journal Header
 */
journalId: {
  type: Schema.Types.ObjectId,
  ref: 'Journal',
  required: true,
  index: true
},

/**
 * Transaction Link
 */
transactionId: {
  type: Schema.Types.ObjectId,
  ref: 'Transaction',
  required: true,
  index: true
},

/**
 * Account
 */
accountId: {
  type: Schema.Types.ObjectId,
  ref: 'Account',
  required: true,
  index: true
},

/**
 * Related Loan
 */
loanId: {
  type: Schema.Types.ObjectId,
  ref: 'Loan',
  default: null,
  index: true
},

/**
 * Related Savings
 */
savingsAccountId: {
  type: Schema.Types.ObjectId,
  ref: 'SavingsAccount',
  default: null,
  index: true
},

/**
 * Amount
 */
amount: {
  type: Schema.Types.Decimal128,
  required: true,
  get: v => (v ? parseFloat(v.toString()) : 0),
  set: v =>
    mongoose.Types.Decimal128.fromString(
      Number(v || 0).toFixed(2)
    )
},

/**
 * Accounting Direction
 */
direction: {
  type: String,
  enum: DIRECTIONS,
  required: true,
  uppercase: true,
  index: true
},

/**
 * Currency
 */
currency: {
  type: String,
  default: 'UGX',
  uppercase: true,
  trim: true,
  index: true
},

/**
 * Exchange Rate
 */
exchangeRate: {
  type: Number,
  default: 1
},

/**
 * Business Event
 */
entryType: {
  type: String,
  enum: ENTRY_TYPES,
  required: true,
  index: true
},

/**
 * Posting Status
 */
status: {
  type: String,
  enum: ENTRY_STATUS,
  default: 'POSTED',
  index: true
},

/**
 * Reconciliation
 */
reconciliationStatus: {
  type: String,
  enum: RECONCILIATION_STATUS,
  default: 'PENDING',
  index: true
},

reconciledAt: {
  type: Date,
  default: null
},

reconciledBy: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  default: null
},

/**
 * External Provider Tracking
 */
provider: {
  type: String,
  uppercase: true,
  trim: true
},

providerReference: {
  type: String,
  trim: true,
  index: true
},

/**
 * Reference
 */
reference: {
  type: String,
  trim: true,
  index: true
},

description: {
  type: String,
  trim: true,
  maxlength: 500
},

/**
 * Branch / Cost Centre
 */
branchId: {
  type: Schema.Types.ObjectId,
  ref: 'Branch',
  default: null,
  index: true
},

costCenterId: {
  type: Schema.Types.ObjectId,
  ref: 'CostCenter',
  default: null,
  index: true
},

/**
 * Reversal
 */
reversed: {
  type: Boolean,
  default: false,
  index: true
},

reversalEntryId: {
  type: Schema.Types.ObjectId,
  ref: 'JournalEntry',
  default: null
},

reversedAt: {
  type: Date,
  default: null
},

/**
 * Approval
 */
approvalRequired: {
  type: Boolean,
  default: false
},

approvedBy: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  default: null
},

approvedAt: {
  type: Date,
  default: null
},

/**
 * AML / Fraud
 */
amlFlagged: {
  type: Boolean,
  default: false,
  index: true
},

fraudFlagged: {
  type: Boolean,
  default: false,
  index: true
},

/**
 * Blockchain Integrity
 */
previousHash: {
  type: String,
  default: null,
  index: true
},

hash: {
  type: String,
  required: true,
  index: true
},

/**
 * Metadata
 */
metadata: {
  type: Schema.Types.Mixed,
  default: {}
},

/**
 * Audit
 */
createdBy: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  index: true
},

updatedBy: {
  type: Schema.Types.ObjectId,
  ref: 'User',
  default: null
}


},
{
timestamps: true,
versionKey: 'version',
toJSON: { getters: true },
toObject: { getters: true }
}
);

/**

* INDEXES
  */

JournalEntrySchema.index({
tenantId: 1,
journalId: 1
});

JournalEntrySchema.index({
tenantId: 1,
transactionId: 1
});

JournalEntrySchema.index({
tenantId: 1,
accountId: 1,
createdAt: -1
});

JournalEntrySchema.index({
tenantId: 1,
entryType: 1
});

JournalEntrySchema.index({
tenantId: 1,
loanId: 1
});

JournalEntrySchema.index({
tenantId: 1,
savingsAccountId: 1
});

JournalEntrySchema.index({
tenantId: 1,
reconciliationStatus: 1
});

JournalEntrySchema.index({
tenantId: 1,
providerReference: 1
});

/**

* HASH CHAIN
  */

JournalEntrySchema.pre('save', function(next) {

const payload = JSON.stringify({
tenantId: this.tenantId,
journalId: this.journalId,
transactionId: this.transactionId,
accountId: this.accountId,
amount: this.amount?.toString(),
direction: this.direction,
previousHash: this.previousHash
});

this.hash = crypto
.createHash('sha256')
.update(payload)
.digest('hex');

next();
});

/**

* METHODS
  */

JournalEntrySchema.methods.markReconciled =
async function(userId) {

this.reconciliationStatus =
  'RECONCILED';

this.reconciledAt =
  new Date();

this.reconciledBy =
  userId;

return this.save();


};

JournalEntrySchema.methods.reverse =
async function(reversalEntryId) {


this.reversed = true;
this.status = 'REVERSED';

this.reversalEntryId =
  reversalEntryId;

this.reversedAt =
  new Date();

return this.save();


};

/**

* STATICS
  */

JournalEntrySchema.statics.getAccountEntries =
function(tenantId, accountId) {

```
return this.find({
  tenantId,
  accountId
}).sort({
  createdAt: -1
});
```

};

JournalEntrySchema.statics.getJournalEntries =
function(tenantId, journalId) {

```
return this.find({
  tenantId,
  journalId
});
```

};

JournalEntrySchema.plugin(uniqueValidator);

/**

* EXPORT
  */

module.exports =
mongoose.models.JournalEntry ||
mongoose.model(
'JournalEntry',
JournalEntrySchema
);

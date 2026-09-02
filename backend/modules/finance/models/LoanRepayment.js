// backend/modules/finance/models/LoanRepayment.js
'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const LoanRepaymentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },

    loanId: { type: Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },

    amount: {
      type: Schema.Types.Decimal128,
      required: true,
      get: v => (v ? parseFloat(v.toString()) : 0),
      set: v => mongoose.Types.Decimal128.fromString(Number(v).toFixed(2))
    },

    paymentDate: { type: Date, default: Date.now },

    status: { type: String, enum: ['SUCCESS', 'FAILED'], default: 'SUCCESS' }
  },
  { timestamps: true, toJSON: { getters: true } }
);

module.exports = mongoose.model('LoanRepayment', LoanRepaymentSchema);
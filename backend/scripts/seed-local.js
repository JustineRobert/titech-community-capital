// scripts/seed-local.js

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Group = require('../models/Group');
const Loan = require('../models/Loan');
const LoanRepaymentSchedule = require('../models/LoanRepaymentSchedule');

// 🔥 ADD THESE (ensure models exist)
const Transaction = require('../models/Transaction');

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGO_URI_FALLBACK ||
  'mongodb://localhost:27017/community-savings';

const NETWORKS = ['MTN', 'AIRTEL'];

function randomAmount(min = 5000, max = 500000) {
  return Math.floor(Math.random() * (max - min) + min);
}

function detectFraud(amount, transactions = []) {
  return (
    amount > 300000 || // high amount
    transactions.length >= 5 // too many quick txns
  );
}

(async function seed() {
  try {
    console.log('🔌 Connecting...');
    await mongoose.connect(MONGO_URI);

    // =========================
    // ✅ TENANTS (MULTI-SACCO)
    // =========================
    const tenants = ['TITech Kampala', 'TITech Entebbe'];

    const users = [];
    const groups = [];
    const loans = [];

    // =========================
    // ✅ USERS PER TENANT
    // =========================
    for (const tenant of tenants) {
      for (let i = 1; i <= 3; i++) {
        const email = `${tenant.replace(/\s/g, '').toLowerCase()}${i}@test.com`;

        let user = await User.findOne({ email });

        if (!user) {
          user = new User({
            name: `${tenant} User ${i}`,
            email,
            password: 'Password123!',
            tenant,
          });

          await user.save();
          console.log('✅ User:', email);
        }

        users.push(user);
      }
    }

    // =========================
    // ✅ GROUPS PER TENANT
    // =========================
    for (const tenant of tenants) {
      const group = new Group({
        name: `${tenant} SACCO`,
        members: users.filter(u => u.tenant === tenant).map(u => u._id),
        tenant,
      });

      await group.save();
      groups.push(group);
      console.log('✅ Group:', group.name);
    }

    // =========================
    // ✅ CREATE LOANS
    // =========================
    for (const user of users) {
      const group = groups.find(g => g.tenant === user.tenant);

      const amount = randomAmount(100000, 500000);

      const loan = new Loan({
        user: user._id,
        group: group._id,
        amount,
        status: 'disbursed',
        interestRate: 10,
        repaymentPeriodMonths: 6,
        disburseDate: new Date(),
      });

      await loan.save();
      loans.push(loan);
      console.log('✅ Loan:', amount);
    }

    // =========================
    // ✅ REPAYMENT SCHEDULE
    // =========================
    for (const loan of loans) {
      const installments = [];

      for (let i = 1; i <= loan.repaymentPeriodMonths; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i);

        installments.push({
          installmentNumber: i,
          amount: Math.ceil(loan.amount / loan.repaymentPeriodMonths),
          dueDate,
          paid: false,
        });
      }

      const schedule = new LoanRepaymentSchedule({
        loan: loan._id,
        installments,
        totalAmount: loan.amount,
        status: 'active',
      });

      await schedule.save();

      loan.repaymentSchedule = schedule._id;
      await loan.save();
    }

    // =========================
    // ✅ SIMULATE MOMO TRANSACTIONS
    // =========================
    for (const user of users) {
      const userTxns = [];

      for (let i = 0; i < 5; i++) {
        const amount = randomAmount();
        const network = NETWORKS[Math.floor(Math.random() * NETWORKS.length)];

        const fraud = detectFraud(amount, userTxns);

        const txn = new Transaction({
          user: user._id,
          amount,
          type: ['deposit', 'withdraw', 'loan_repayment'][Math.floor(Math.random() * 3)],
          network,
          status: 'success',
          reference: `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          isFraud: fraud,
          fraudReason: fraud ? 'High amount or frequency' : null,
          createdAt: new Date(),
        });

        await txn.save();
        userTxns.push(txn);

        console.log(`💰 ${network} TXN UGX ${amount} | Fraud: ${fraud}`);
      }
    }

    // =========================
    // ✅ ADMIN ANALYTICS SUMMARY
    // =========================

    const totalLoans = await Loan.countDocuments();
    const totalTxns = await Transaction.countDocuments();
    const fraudCases = await Transaction.countDocuments({ isFraud: true });

    console.log('\n📊 ADMIN DASHBOARD DATA');
    console.log('----------------------');
    console.log('Users:', users.length);
    console.log('Groups:', groups.length);
    console.log('Loans:', totalLoans);
    console.log('Transactions:', totalTxns);
    console.log('Fraud Flags:', fraudCases);

    // =========================
    // ✅ DONE
    // =========================
    console.log('\n🎉 FULL TITech FINTECH SEED COMPLETE');

    await mongoose.disconnect();
    process.exit(0);

  } catch (err) {
    console.error('❌ Seed failed:', err);

    try {
      await mongoose.disconnect();
    } catch (e) {
      console.error('Error during disconnect:', e.message);
    }

    process.exit(1);
  }
})();
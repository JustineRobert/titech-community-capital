// backend/modules/finance/__tests__/repayment.int.test.js
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;
let app; // your Express app
const Loan = require('../../models/Loan');
const Wallet = require('../../models/Wallet');
const Journal = require('../../models/Journal');
const User = require('../../../../models/User'); // adjust path if needed

jest.setTimeout(30000);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  // Import app after DB connection if your app connects on import; otherwise configure accordingly
  app = require('../../../../app'); // adjust path to your Express app export
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear DB
  const collections = Object.keys(mongoose.connection.collections);
  for (const name of collections) {
    await mongoose.connection.collections[name].deleteMany({});
  }
});

describe('POST /api/finance/repay', () => {
  it('processes a repayment successfully and creates journal + ledger entries', async () => {
    // Create tenant, user, wallet, loan
    const tenantId = mongoose.Types.ObjectId();
    const userId = mongoose.Types.ObjectId();

    // Create wallet with sufficient balance
    const wallet = await Wallet.create({ tenantId, ownerId: userId, balance: mongoose.Types.Decimal128.fromString('1000.00') });

    // Create loan active with balance 500
    const loan = await Loan.create({
      tenantId,
      memberId: userId,
      principal: mongoose.Types.Decimal128.fromString('500.00'),
      interestRate: 0,
      termMonths: 12,
      balance: mongoose.Types.Decimal128.fromString('500.00'),
      status: 'ACTIVE'
    });

    // Mock auth and tenant middleware by injecting headers or using test-only middleware in app
    const paymentId = 'test-pay-1';
    const payload = { loanId: loan._id.toString(), walletId: wallet._id.toString(), amount: 200.0 };

    const res = await request(app)
      .post('/api/finance/repay')
      .set('Idempotency-Key', paymentId)
      .set('Authorization', 'Bearer test-token') // ensure your test app accepts this
      .send(payload)
      .expect(200);

    expect(res.body.success).toBe(true);
    const journalId = res.body.result.journalId;
    expect(journalId).toBeDefined();

    const journal = await Journal.findById(journalId);
    expect(journal).not.toBeNull();
    expect(parseFloat(journal.amount.toString())).toBeCloseTo(200.0);

    // Wallet balance decreased
    const updatedWallet = await Wallet.findById(wallet._id);
    expect(parseFloat(updatedWallet.balance.toString())).toBeCloseTo(800.0);

    // Loan balance decreased
    const updatedLoan = await Loan.findById(loan._id);
    expect(parseFloat(updatedLoan.balance.toString())).toBeCloseTo(300.0);
  });

  it('is idempotent: second identical request returns conflict', async () => {
    const tenantId = mongoose.Types.ObjectId();
    const userId = mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, ownerId: userId, balance: mongoose.Types.Decimal128.fromString('1000.00') });
    const loan = await Loan.create({
      tenantId,
      memberId: userId,
      principal: mongoose.Types.Decimal128.fromString('500.00'),
      interestRate: 0,
      termMonths: 12,
      balance: mongoose.Types.Decimal128.fromString('500.00'),
      status: 'ACTIVE'
    });

    const paymentId = 'test-pay-2';
    const payload = { loanId: loan._id.toString(), walletId: wallet._id.toString(), amount: 100.0 };

    // First request
    await request(app)
      .post('/api/finance/repay')
      .set('Idempotency-Key', paymentId)
      .set('Authorization', 'Bearer test-token')
      .send(payload)
      .expect(200);

    // Second request should return 409 Conflict (as service throws ConflictError)
    const res2 = await request(app)
      .post('/api/finance/repay')
      .set('Idempotency-Key', paymentId)
      .set('Authorization', 'Bearer test-token')
      .send(payload)
      .expect(409);

    expect(res2.body.success).toBe(false);
    expect(res2.body.code).toBe('CONFLICT');
  });

  it('returns 402 when wallet has insufficient funds', async () => {
    const tenantId = mongoose.Types.ObjectId();
    const userId = mongoose.Types.ObjectId();

    const wallet = await Wallet.create({ tenantId, ownerId: userId, balance: mongoose.Types.Decimal128.fromString('50.00') });
    const loan = await Loan.create({
      tenantId,
      memberId: userId,
      principal: mongoose.Types.Decimal128.fromString('500.00'),
      interestRate: 0,
      termMonths: 12,
      balance: mongoose.Types.Decimal128.fromString('500.00'),
      status: 'ACTIVE'
    });

    const paymentId = 'test-pay-3';
    const payload = { loanId: loan._id.toString(), walletId: wallet._id.toString(), amount: 100.0 };

    const res = await request(app)
      .post('/api/finance/repay')
      .set('Idempotency-Key', paymentId)
      .set('Authorization', 'Bearer test-token')
      .send(payload)
      .expect(402);

    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PAYMENT_REQUIRED');
  });
});

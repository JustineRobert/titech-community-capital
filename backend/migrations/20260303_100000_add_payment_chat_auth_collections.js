// Migration: Add Payment, Chat, and Auth Token collections
module.exports = {
  up: async function ({ mongoose }) {
    const PaymentIntent = require('../models/PaymentIntent');
    const Transaction = require('../models/Transaction');
    const EmailVerificationToken = require('../models/EmailVerificationToken');
    const PasswordResetToken = require('../models/PasswordResetToken');
    const Conversation = require('../models/Conversation');
    const ChatMessage = require('../models/ChatMessage');
    const Referral = require('../models/Referral');

    // Create collections and indexes
    await PaymentIntent.collection.createIndex({ user: 1, createdAt: -1 });
    await PaymentIntent.collection.createIndex({ status: 1 });
    await PaymentIntent.collection.createIndex(
      { idempotencyKey: 1 },
      { unique: true, sparse: true }
    );

    await Transaction.collection.createIndex({ user: 1, createdAt: -1 });
    await Transaction.collection.createIndex({ type: 1, status: 1 });

    await EmailVerificationToken.collection.createIndex({ user: 1 });
    await EmailVerificationToken.collection.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 86400 }
    );

    await PasswordResetToken.collection.createIndex({ user: 1 });
    await PasswordResetToken.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

    await Conversation.collection.createIndex({ participants: 1 });
    await Conversation.collection.createIndex({ createdAt: -1 });

    await ChatMessage.collection.createIndex({ conversation: 1, createdAt: -1 });
    await ChatMessage.collection.createIndex({ sender: 1 });

    await Referral.collection.createIndex({ code: 1 }, { unique: true });
    await Referral.collection.createIndex({ referrer: 1 });
    await Referral.collection.createIndex({ used: 1 });

    console.log('Migration: Payment, Chat, Auth and Referral collections created with indexes');
  },

  down: async function ({ mongoose }) {
    // Drop collections if needed
    await mongoose.connection.db.dropCollection('paymentintents').catch(() => {});
    await mongoose.connection.db.dropCollection('transactions').catch(() => {});
    await mongoose.connection.db.dropCollection('emailverificationtokens').catch(() => {});
    await mongoose.connection.db.dropCollection('passwordresettokens').catch(() => {});
    await mongoose.connection.db.dropCollection('conversations').catch(() => {});
    await mongoose.connection.db.dropCollection('chatmessages').catch(() => {});
    await mongoose.connection.db.dropCollection('referrals').catch(() => {});
    console.log('Migration: Collections rolled back');
  },
};

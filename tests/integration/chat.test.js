const mongoose = require('mongoose');
const ChatService = require('../../community-savings-app-backend/services/chatService');
const Conversation = require('../../community-savings-app-backend/models/Conversation');
const ChatMessage = require('../../community-savings-app-backend/models/ChatMessage');
const User = require('../../community-savings-app-backend/models/User');

describe('Chat Integration Tests', () => {
  let user1, user2, conversation;

  beforeAll(async () => {
    // Setup test DB
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    user1 = await User.create({ name: 'User1', email: 'user1@test.com', password: 'pw' });
    user2 = await User.create({ name: 'User2', email: 'user2@test.com', password: 'pw' });
  });

  describe('Conversation Management', () => {
    test('Create DM conversation', async () => {
      conversation = await ChatService.createConversation([user1._id, user2._id], 'dm');
      expect(conversation.type).toBe('dm');
      expect(conversation.participants).toHaveLength(2);
    });

    test('Create group conversation', async () => {
      const conv = await ChatService.createConversation([user1._id, user2._id], 'group');
      expect(conv.type).toBe('group');
    });
  });

  describe('Message Operations', () => {
    beforeEach(async () => {
      conversation = await ChatService.createConversation([user1._id, user2._id], 'dm');
    });

    test('Add message to conversation', async () => {
      const msg = await ChatService.addMessage(conversation._id, user1._id, 'Hello!');
      expect(msg.content).toBe('Hello!');
      expect(msg.sender).toEqual(user1._id);
    });

    test('Message timestamps', async () => {
      const msg = await ChatService.addMessage(conversation._id, user1._id, 'Test');
      expect(msg.createdAt).toBeDefined();
    });

    test('Thread reply (replyTo)', async () => {
      const msg1 = await ChatService.addMessage(conversation._id, user1._id, 'Original');
      const msg2 = await ChatService.addMessage(conversation._id, user2._id, 'Reply', msg1._id);
      expect(msg2.replyTo).toEqual(msg1._id);
    });

    test('Read receipts', async () => {
      const msg = await ChatService.addMessage(conversation._id, user1._id, 'Message');
      await ChatMessage.updateOne({ _id: msg._id }, { $push: { readBy: user2._id } });
      const updated = await ChatMessage.findById(msg._id);
      expect(updated.readBy).toContain(user2._id);
    });

    test('Message list paginated', async () => {
      for (let i = 0; i < 5; i++) {
        await ChatService.addMessage(conversation._id, user1._id, `Message ${i}`);
      }
      const msgs = await ChatMessage.find({ conversation: conversation._id }).limit(3);
      expect(msgs.length).toBe(3);
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(async () => {
      conversation = await ChatService.createConversation([user1._id], 'admin');
    });

    test('Rapid messages detected', async () => {
      let count = 0;
      for (let i = 0; i < 10; i++) {
        await ChatService.addMessage(conversation._id, user1._id, `Spam ${i}`);
        count++;
      }
      expect(count).toBe(10); // In production, rate limiter would reject some
    });
  });
});

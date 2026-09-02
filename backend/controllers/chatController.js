'use strict';

const chatService = require('../services/chatService');
const { validationResult } = require('express-validator');

// Consistent response wrapper
const sendResponse = (res, status, data, message = null) => {
  res.status(status).json({ success: status < 400, data, message });
};

// Helper: enforce role-based access
const requireRole = (user, roles) => {
  if (!roles.includes(user.role)) {
    const err = new Error('Forbidden: insufficient role');
    err.status = 403;
    throw err;
  }
};

exports.createConversation = async (req, res, next) => {
  try {
    validationResult(req).throw();
    requireRole(req.user, ['ADMIN', 'SUPPORT', 'MEMBER']); // adjust as needed
    const conversation = await chatService.createConversation(req.user, req.body);
    sendResponse(res, 201, conversation, 'Conversation created');
  } catch (err) {
    next(err);
  }
};

exports.listConversations = async (req, res, next) => {
  try {
    const conversations = await chatService.listConversations(req.user);
    sendResponse(res, 200, conversations);
  } catch (err) {
    next(err);
  }
};

exports.getConversationById = async (req, res, next) => {
  try {
    const conversation = await chatService.getConversationById(req.user, req.params.id);
    sendResponse(res, 200, conversation);
  } catch (err) {
    next(err);
  }
};

exports.getConversationMessages = async (req, res, next) => {
  try {
    const { limit = 20, skip = 0 } = req.query;
    const messages = await chatService.getConversationMessages(req.user, req.params.id, { limit, skip });
    sendResponse(res, 200, messages);
  } catch (err) {
    next(err);
  }
};

exports.sendMessage = async (req, res, next) => {
  try {
    validationResult(req).throw();
    const message = await chatService.sendMessage(req.user, req.body);
    sendResponse(res, 201, message, 'Message sent');
  } catch (err) {
    next(err);
  }
};

exports.editMessage = async (req, res, next) => {
  try {
    validationResult(req).throw();
    const message = await chatService.editMessage(req.user, req.params.id, req.body);
    sendResponse(res, 200, message, 'Message edited');
  } catch (err) {
    next(err);
  }
};

exports.deleteMessageSoft = async (req, res, next) => {
  try {
    const message = await chatService.deleteMessageSoft(req.user, req.params.id);
    sendResponse(res, 200, message, 'Message deleted (soft)');
  } catch (err) {
    next(err);
  }
};

exports.searchMessages = async (req, res, next) => {
  try {
    const { q, limit = 50 } = req.query;
    const results = await chatService.searchMessages(req.user, { q, limit });
    sendResponse(res, 200, results);
  } catch (err) {
    next(err);
  }
};

// Extra: pin/unpin messages
exports.pinMessage = async (req, res, next) => {
  try {
    requireRole(req.user, ['ADMIN']);
    const conversation = await chatService.pinMessage(req.user, req.params.conversationId, req.params.messageId);
    sendResponse(res, 200, conversation, 'Message pinned');
  } catch (err) {
    next(err);
  }
};

// Extra: archive conversation
exports.archiveConversation = async (req, res, next) => {
  try {
    requireRole(req.user, ['ADMIN', 'SUPPORT']);
    const conversation = await chatService.archiveConversation(req.user, req.params.id);
    sendResponse(res, 200, conversation, 'Conversation archived');
  } catch (err) {
    next(err);
  }
};

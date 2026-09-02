// services/eventStreamService.js
'use strict';

const { EventEmitter } = require('events');
const emitter = new EventEmitter();

// Limit listeners to avoid memory leaks
emitter.setMaxListeners(50);

// Centralized logger (replace with Winston or your logger)
const logger = require('../utils/logger');

function publish(topic, payload) {
  try {
    logger.info(`Publishing event: ${topic}`, { payload });
    emitter.emit(topic, payload);
  } catch (err) {
    logger.error(`Failed to publish event: ${topic}`, { error: err });
  }
}

function subscribe(topic, handler) {
  if (typeof handler !== 'function') {
    throw new Error('Handler must be a function');
  }

  // Wrap handler to catch async errors
  const wrappedHandler = async (payload) => {
    try {
      await handler(payload);
    } catch (err) {
      logger.error(`Error in subscriber for topic: ${topic}`, { error: err });
    }
  };

  emitter.on(topic, wrappedHandler);
  logger.info(`Subscribed to topic: ${topic}`);
}

function unsubscribe(topic, handler) {
  emitter.removeListener(topic, handler);
  logger.info(`Unsubscribed from topic: ${topic}`);
}

function once(topic, handler) {
  emitter.once(topic, async (payload) => {
    try {
      await handler(payload);
    } catch (err) {
      logger.error(`Error in one-time subscriber for topic: ${topic}`, { error: err });
    }
  });
  logger.info(`Subscribed once to topic: ${topic}`);
}

module.exports = {
  publish,
  subscribe,
  unsubscribe,
  once,
};

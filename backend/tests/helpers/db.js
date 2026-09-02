// tests/helpers/db.js
// ============================================================================
// Database Test Helpers
// Utilities for connecting/disconnecting and seeding test data
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../../utils/logger');

/**
 * Connect to test database
 */
async function connectDB() {
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI_TEST || process.env.MONGO_URI, {
        maxPoolSize: 10,
      });
    }
    return mongoose.connection;
  } catch (error) {
    logger.error('Failed to connect to test database', error);
    throw error;
  }
}

/**
 * Disconnect from test database
 */
async function disconnectDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  } catch (error) {
    logger.error('Failed to disconnect from test database', error);
    throw error;
  }
}

/**
 * Clear all collections
 */
async function clearDatabase() {
  try {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      const collection = collections[key];
      await collection.deleteMany({});
    }
  } catch (error) {
    logger.error('Failed to clear database', error);
    throw error;
  }
}

/**
 * Clear specific collections
 */
async function clearCollections(collectionNames) {
  try {
    for (const name of collectionNames) {
      const collection = mongoose.connection.collections[name];
      if (collection) {
        await collection.deleteMany({});
      }
    }
  } catch (error) {
    logger.error('Failed to clear collections', error);
    throw error;
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  clearDatabase,
  clearCollections,
};

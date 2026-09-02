// migrations/20240115_100000_add_email_audit_collection.js
// ============================================================================
// Add Email Audit Collection
// Creates EmailAudit collection with proper indices
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const migration = {
  /**
   * Run migration (upgrade)
   */
  async up() {
    logger.info('[Migration] 20240115_100000 - Creating email_audits collection');

    try {
      const db = mongoose.connection;

      // Create collection with validator
      await db.createCollection('email_audits', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['event', 'status', 'timestamp'],
            properties: {
              event: { bsonType: 'string' },
              userId: { bsonType: 'objectId' },
              email: { bsonType: 'string' },
              ipAddress: { bsonType: 'string' },
              userAgent: { bsonType: 'string' },
              status: { enum: ['success', 'failed'] },
              reason: { bsonType: 'string' },
              metadata: { bsonType: 'object' },
              timestamp: { bsonType: 'date' },
            },
          },
        },
      });

      logger.info('[Migration] 20240115_100000 - Collection created, adding indices');

      // Create indices
      await db.collection('email_audits').createIndexes([
        { key: { event: 1 }, unique: false },
        { key: { userId: 1, event: 1, timestamp: -1 } },
        { key: { email: 1, event: 1, timestamp: -1 } },
        { key: { status: 1, timestamp: -1 } },
        { key: { timestamp: 1 }, expireAfterSeconds: 7776000 }, // 90 days TTL
      ]);

      logger.info('[Migration] ✓ 20240115_100000 - email_audits collection and indices created');
    } catch (error) {
      // Collection might already exist
      if (error.code === 48) {
        logger.info('[Migration] 20240115_100000 - email_audits collection already exists');
      } else {
        logger.error('[Migration] 20240115_100000 - Error', error);
        throw error;
      }
    }
  },

  /**
   * Rollback migration (downgrade)
   */
  async down() {
    logger.info('[Migration] 20240115_100000 - Rolling back email_audits collection');

    try {
      const db = mongoose.connection;
      await db.collection('email_audits').drop();
      logger.info('[Migration] ✓ 20240115_100000 - Rollback complete');
    } catch (error) {
      if (error.code === 26) {
        logger.info('[Migration] 20240115_100000 - Collection does not exist');
      } else {
        logger.error('[Migration] 20240115_100000 - Rollback error', error);
        throw error;
      }
    }
  },
};

module.exports = migration;

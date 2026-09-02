// migrations/20240115_110000_add_migration_collection.js
// ============================================================================
// Add Migration Tracking Collection
// Creates migrations collection for tracking schema changes
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const migration = {
  /**
   * Run migration (upgrade)
   */
  async up() {
    logger.info('[Migration] 20240115_110000 - Creating migrations collection');

    try {
      const db = mongoose.connection;

      // Create migrations collection
      await db.createCollection('migrations', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['version', 'name', 'path', 'status'],
            properties: {
              version: { bsonType: 'string' },
              name: { bsonType: 'string' },
              description: { bsonType: 'string' },
              status: { enum: ['pending', 'running', 'completed', 'failed', 'rolled_back'] },
              path: { bsonType: 'string' },
              batch: { bsonType: 'int' },
              environment: { enum: ['development', 'staging', 'production'] },
              executedBy: { bsonType: 'string' },
              startedAt: { bsonType: 'date' },
              completedAt: { bsonType: 'date' },
              rolledBackAt: { bsonType: 'date' },
              duration: { bsonType: 'int' },
              error: { bsonType: 'string' },
              rollbackError: { bsonType: 'string' },
            },
          },
        },
      });

      logger.info('[Migration] 20240115_110000 - Collection created, adding indices');

      // Create indices
      await db
        .collection('migrations')
        .createIndexes([
          { key: { version: 1 }, unique: true },
          { key: { status: 1, environment: 1 } },
          { key: { batch: 1 } },
          { key: { createdAt: -1 } },
          { key: { path: 1 } },
        ]);

      logger.info('[Migration] ✓ 20240115_110000 - migrations collection and indices created');
    } catch (error) {
      if (error.code === 48) {
        logger.info('[Migration] 20240115_110000 - migrations collection already exists');
      } else {
        logger.error('[Migration] 20240115_110000 - Error', error);
        throw error;
      }
    }
  },

  /**
   * Rollback migration (downgrade)
   */
  async down() {
    logger.info('[Migration] 20240115_110000 - Rolling back migrations collection');

    try {
      const db = mongoose.connection;
      await db.collection('migrations').drop();
      logger.info('[Migration] ✓ 20240115_110000 - Rollback complete');
    } catch (error) {
      if (error.code === 26) {
        logger.info('[Migration] 20240115_110000 - Collection does not exist');
      } else {
        logger.error('[Migration] 20240115_110000 - Rollback error', error);
        throw error;
      }
    }
  },
};

module.exports = migration;

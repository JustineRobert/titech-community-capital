// migrations/20240101_000000_initial_schema.js
// ============================================================================
// Initial Migration
// Creates baseline indices and collections
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const migration = {
  /**
   * Run migration (upgrade)
   */
  async up() {
    logger.info('[Migration] 20240101_000000 - Creating initial schema indices');

    try {
      // Get database connection
      const db = mongoose.connection;

      // Ensure User collection has proper indices
      await db
        .collection('users')
        .createIndexes([
          { key: { email: 1 }, unique: true },
          { key: { email: 1, isActive: 1 } },
          { key: { isVerified: 1, createdAt: -1 } },
          { key: { role: 1 } },
          { key: { referralCode: 1 }, unique: true, sparse: true },
          { key: { resetPasswordToken: 1 }, sparse: true },
          { key: { verificationToken: 1 }, sparse: true },
        ]);

      logger.info('[Migration] 20240101_000000 - User indices created');

      // Ensure RefreshToken collection
      await db
        .collection('refreshtokens')
        .createIndexes([
          { key: { userId: 1 } },
          { key: { tokenHash: 1 }, unique: true },
          { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
          { key: { revokedAt: 1 } },
        ]);

      logger.info('[Migration] 20240101_000000 - RefreshToken indices created');

      // Ensure Group collection
      await db
        .collection('groups')
        .createIndexes([
          { key: { creator: 1 } },
          { key: { members: 1 } },
          { key: { status: 1 } },
          { key: { createdAt: -1 } },
        ]);

      logger.info('[Migration] 20240101_000000 - Group indices created');

      // Ensure Contribution collection
      await db
        .collection('contributions')
        .createIndexes([
          { key: { user: 1, group: 1 } },
          { key: { group: 1 } },
          { key: { status: 1 } },
          { key: { createdAt: -1 } },
        ]);

      logger.info('[Migration] 20240101_000000 - Contribution indices created');

      // Ensure Loan collection
      await db
        .collection('loans')
        .createIndexes([
          { key: { user: 1, group: 1 } },
          { key: { group: 1 } },
          { key: { status: 1 } },
          { key: { createdAt: -1 } },
        ]);

      logger.info('[Migration] 20240101_000000 - Loan indices created');

      // Ensure Chat collection
      await db
        .collection('chats')
        .createIndexes([{ key: { group: 1, createdAt: -1 } }, { key: { sender: 1 } }]);

      logger.info('[Migration] 20240101_000000 - Chat indices created');

      logger.info('[Migration] ✓ 20240101_000000 - Initial schema complete');
    } catch (error) {
      logger.error('[Migration] 20240101_000000 - Error', error);
      throw error;
    }
  },

  /**
   * Rollback migration (downgrade)
   */
  async down() {
    logger.info('[Migration] 20240101_000000 - Rolling back initial schema');

    try {
      const db = mongoose.connection;

      // Drop indices (keep primary _id index)
      const collections = ['users', 'refreshtokens', 'groups', 'contributions', 'loans', 'chats'];

      for (const coll of collections) {
        try {
          const indexes = await db.collection(coll).getIndexes();
          for (const indexName of Object.keys(indexes)) {
            if (indexName !== '_id_') {
              await db.collection(coll).dropIndex(indexName);
            }
          }
          logger.info(`[Migration] 20240101_000000 - Dropped indices for ${coll}`);
        } catch (err) {
          // Collection might not exist or might have no custom indices
          logger.debug(`[Migration] 20240101_000000 - Skipping ${coll}:`, err.message);
        }
      }

      logger.info('[Migration] ✓ 20240101_000000 - Rollback complete');
    } catch (error) {
      logger.error('[Migration] 20240101_000000 - Rollback error', error);
      throw error;
    }
  },
};

module.exports = migration;

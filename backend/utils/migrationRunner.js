// utils/migrationRunner.js
// ============================================================================
// Database Migration Runner
// Production-grade migration system with rollback support
// ============================================================================

const fs = require('fs');
const path = require('path');
// const mongoose = require('mongoose');
const logger = require('./logger');
const Migration = require('../models/Migration');

class MigrationRunner {
  constructor(migrationsDir) {
    this.migrationsDir = migrationsDir;
    this.migrations = [];
  }

  /**
   * Load all migration files from directory
   */
  async loadMigrations() {
    try {
      if (!fs.existsSync(this.migrationsDir)) {
        logger.warn(`Migrations directory not found: ${this.migrationsDir}`);
        return [];
      }

      const files = fs
        .readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.js') && !f.startsWith('.'))
        .sort();

      this.migrations = files.map((file) => ({
        version: file.replace('.js', ''), // e.g., "20240115_143022_create_indices"
        path: path.join(this.migrationsDir, file),
        file,
      }));

      logger.debug(`[MigrationRunner] Loaded ${this.migrations.length} migration(s)`);
      return this.migrations;
    } catch (error) {
      logger.error('[MigrationRunner] Failed to load migrations', error);
      throw error;
    }
  }

  /**
   * Get already-executed migrations
   */
  async getExecutedMigrations() {
    try {
      return await Migration.find({ status: 'completed' })
        .select('version')
        .sort({ batch: 1, createdAt: 1 })
        .lean();
    } catch (error) {
      logger.error('[MigrationRunner] Failed to get executed migrations', error);
      throw error;
    }
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations() {
    const executed = await this.getExecutedMigrations();
    const executedVersions = new Set(executed.map((m) => m.version));

    return this.migrations.filter((m) => !executedVersions.has(m.version));
  }

  /**
   * Run pending migrations
   */
  async runPending(options = {}) {
    const { dryRun = false, batch = null, environment = process.env.NODE_ENV } = options;

    try {
      await this.loadMigrations();
      const pending = await this.getPendingMigrations();

      if (pending.length === 0) {
        logger.info('[MigrationRunner] No pending migrations');
        return { success: true, migrationsRun: 0 };
      }

      logger.info(`[MigrationRunner] Found ${pending.length} pending migration(s)`);

      if (dryRun) {
        logger.info('[MigrationRunner] DRY RUN MODE - No changes will be made');
        return { success: true, migrationsRun: pending.length, dryRun: true };
      }

      // Assign batch number
      const nextBatch =
        batch ||
        ((await Migration.findOne({}, { batch: 1 }).sort({ batch: -1 }).lean())?.batch || 0) + 1;

      const results = [];
      for (const migration of pending) {
        const result = await this.runMigration(migration, nextBatch, environment);
        results.push(result);
        if (!result.success) {
          // Stop on first failure
          logger.error('[MigrationRunner] Stopping migration chain due to failure');
          break;
        }
      }

      return {
        success: results.every((r) => r.success),
        migrationsRun: results.length,
        results,
        batch: nextBatch,
      };
    } catch (error) {
      logger.error('[MigrationRunner] runPending failed', error);
      throw error;
    }
  }

  /**
   * Run a specific migration
   */
  async runMigration(migration, batch, environment) {
    const migrationRecord = {
      version: migration.version,
      name: this.extractNameFromVersion(migration.version),
      path: migration.path,
      status: 'running',
      startedAt: new Date(),
      environment,
      batch,
      executedBy: process.env.MIGRATION_RUN_BY || 'system',
    };

    let dbRecord;

    try {
      // Create record in DB
      dbRecord = await Migration.create(migrationRecord);

      // Load and execute migration
      const migrationModule = require(migration.path);

      if (!migrationModule.up || typeof migrationModule.up !== 'function') {
        throw new Error(`Migration ${migration.version} must export an 'up' function`);
      }

      logger.info(`[MigrationRunner] Running migration: ${migration.version}`);
      const startTime = Date.now();

      await migrationModule.up();

      const duration = Date.now() - startTime;

      // Mark as completed
      await Migration.findByIdAndUpdate(dbRecord._id, {
        status: 'completed',
        completedAt: new Date(),
        duration,
      });

      logger.info(`[MigrationRunner] ✓ Completed: ${migration.version} (${duration}ms)`);

      return { success: true, version: migration.version, duration };
    } catch (error) {
      logger.error(`[MigrationRunner] ✗ Failed: ${migration.version}`, error);

      if (dbRecord) {
        await Migration.findByIdAndUpdate(dbRecord._id, {
          status: 'failed',
          error: error.message,
        });
      }

      return { success: false, version: migration.version, error: error.message };
    }
  }

  /**
   * Rollback the last batch of migrations
   */
  async rollbackBatch(options = {}) {
    const { batch = null, dryRun = false } = options;

    try {
      let targetBatch;

      if (batch) {
        targetBatch = batch;
      } else {
        // Get the last completed batch
        const lastBatch = await Migration.findOne({ status: 'completed' })
          .sort({ batch: -1 })
          .lean();

        if (!lastBatch) {
          logger.info('[MigrationRunner] No migrations to rollback');
          return { success: true, rolledBack: 0 };
        }

        targetBatch = lastBatch.batch;
      }

      // Get all completed migrations in this batch, in reverse order
      const migrationsToRollback = await Migration.find({
        batch: targetBatch,
        status: 'completed',
      })
        .sort({ createdAt: -1 })
        .lean();

      if (migrationsToRollback.length === 0) {
        logger.info(`[MigrationRunner] No completed migrations in batch ${targetBatch}`);
        return { success: true, rolledBack: 0 };
      }

      logger.info(
        `[MigrationRunner] Found ${migrationsToRollback.length} migration(s) to rollback in batch ${targetBatch}`
      );

      if (dryRun) {
        logger.info('[MigrationRunner] DRY RUN MODE - No changes will be made');
        return { success: true, rolledBack: migrationsToRollback.length, dryRun: true };
      }

      const results = [];
      for (const migration of migrationsToRollback) {
        const result = await this.rollbackMigration(migration);
        results.push(result);
        if (!result.success) {
          logger.error('[MigrationRunner] Stopping rollback chain due to failure');
          break;
        }
      }

      return {
        success: results.every((r) => r.success),
        rolledBack: results.filter((r) => r.success).length,
        results,
        batch: targetBatch,
      };
    } catch (error) {
      logger.error('[MigrationRunner] rollbackBatch failed', error);
      throw error;
    }
  }

  /**
   * Rollback a specific migration
   */
  async rollbackMigration(migration) {
    try {
      // Load migration module
      const migrationModule = require(migration.path);

      if (!migrationModule.down || typeof migrationModule.down !== 'function') {
        throw new Error(
          `Migration ${migration.version} must export a 'down' function for rollback`
        );
      }

      logger.info(`[MigrationRunner] Rolling back migration: ${migration.version}`);
      const startTime = Date.now();

      await migrationModule.down();

      const duration = Date.now() - startTime;

      // Update record
      await Migration.findByIdAndUpdate(
        // Use version as filter since we have it from lean()
        { version: migration.version },
        {
          status: 'rolled_back',
          rolledBackAt: new Date(),
        }
      );

      logger.info(`[MigrationRunner] ✓ Rolled back: ${migration.version} (${duration}ms)`);

      return { success: true, version: migration.version, duration };
    } catch (error) {
      logger.error(`[MigrationRunner] ✗ Rollback failed: ${migration.version}`, error);

      await Migration.findOneAndUpdate(
        { version: migration.version },
        {
          status: 'failed', // Mark as failed since rollback couldn't complete
          rollbackError: error.message,
        }
      );

      return { success: false, version: migration.version, error: error.message };
    }
  }

  /**
   * Get migration status
   */
  async getStatus() {
    try {
      const total = this.migrations.length;
      const completed = await Migration.countDocuments({ status: 'completed' });
      const pending = await this.getPendingMigrations();
      const failed = await Migration.countDocuments({ status: 'failed' });

      return {
        total,
        completed,
        pending: pending.length,
        failed,
        migrations: await Migration.find({})
          .select('version name status batch createdAt completedAt environment duration')
          .sort({ batch: 1, createdAt: 1 })
          .lean(),
      };
    } catch (error) {
      logger.error('[MigrationRunner] Failed to get status', error);
      throw error;
    }
  }

  /**
   * Extract human-readable name from version string
   * e.g., "20240115_143022_create_user_indices" -> "create_user_indices"
   */
  extractNameFromVersion(version) {
    const parts = version.split('_');
    if (parts.length > 2) {
      return parts.slice(2).join('_');
    }
    return version;
  }

  /**
   * List all migrations with their status
   */
  async listMigrations() {
    try {
      await this.loadMigrations();
      const executed = await Migration.find({})
        .select('version status createdAt completedAt')
        .lean();

      const executedMap = new Map(executed.map((m) => [m.version, m]));

      return this.migrations.map((m) => ({
        version: m.version,
        name: this.extractNameFromVersion(m.version),
        status: executedMap.has(m.version) ? executedMap.get(m.version).status : 'pending',
        ...executedMap.get(m.version),
      }));
    } catch (error) {
      logger.error('[MigrationRunner] listMigrations failed', error);
      throw error;
    }
  }

  /**
   * Verify migrations are in sync with database
   */
  async verify() {
    try {
      const migrations = await this.listMigrations();
      const issues = [];

      for (const m of migrations) {
        if (m.status === 'failed') {
          issues.push(`Migration ${m.version} is in failed state`);
        } else if (m.status === 'running') {
          issues.push(`Migration ${m.version} is still in running state (may be stuck)`);
        }
      }

      return {
        isHealthy: issues.length === 0,
        issues,
        summary: migrations,
      };
    } catch (error) {
      logger.error('[MigrationRunner] verify failed', error);
      throw error;
    }
  }
}

module.exports = MigrationRunner;

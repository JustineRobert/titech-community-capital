import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import mongoose from 'mongoose';
import Migration from '../models/Migration.js';
import logger from './logger.js';
import { loadMigrationModule } from './migrationModuleLoader.js';

const VALID_ENVIRONMENTS = new Set(['development', 'test', 'staging', 'production']);
const LEASE_MS = 5 * 60 * 1000;

/**
 * Canonical migration runner for the native-ESM backend. Historical CommonJS
 * migration files are loaded through migrationModuleLoader so their file names,
 * checksums and database version identities remain stable.
 */
export default class MigrationRunner {
  constructor(migrationsDir, options = {}) {
    this.migrationsDir = path.resolve(migrationsDir);
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    if (!VALID_ENVIRONMENTS.has(this.environment)) {
      throw new TypeError(`Unsupported migration environment: ${this.environment}`);
    }
    this.executedBy = options.executedBy || process.env.MIGRATION_RUN_BY || 'system';
    this.runnerId = options.runnerId || crypto.randomUUID();
    this.leaseMs = options.leaseMs || LEASE_MS;
    this.migrations = [];
  }

  async loadMigrations() {
    const entries = await fs.readdir(this.migrationsDir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Migrations directory does not exist: ${this.migrationsDir}`, { cause: error });
      }
      throw error;
    });

    const files = entries
      .filter((entry) => entry.isFile() && /\.(?:js|mjs|cjs)$/i.test(entry.name) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));

    this.migrations = await Promise.all(files.map(async (file, sequence) => {
      const filePath = path.join(this.migrationsDir, file);
      const source = await fs.readFile(filePath);
      return {
        version: file.replace(/\.(?:js|mjs|cjs)$/i, ''),
        name: this.extractNameFromVersion(file.replace(/\.(?:js|mjs|cjs)$/i, '')),
        path: filePath,
        file,
        sequence,
        checksum: crypto.createHash('sha256').update(source).digest('hex'),
      };
    }));

    logger.info('[MigrationRunner] Migration source discovery complete', {
      environment: this.environment,
      migrationCount: this.migrations.length,
    });
    return this.migrations;
  }

  async findRegistryRecords() {
    const versions = this.migrations.map((migration) => migration.version);
    if (versions.length === 0) return [];
    return Migration.find({
      environment: this.environment,
      version: { $in: versions },
      isDeleted: false,
    }).sort({ sequence: 1, version: 1 }).lean();
  }

  async getExecutedMigrations() {
    return Migration.find({ environment: this.environment, status: 'completed', isDeleted: false })
      .select('version checksum sequence batch completedAt')
      .sort({ sequence: 1, version: 1 })
      .lean();
  }

  async getPendingMigrations() {
    if (this.migrations.length === 0) await this.loadMigrations();
    const records = await this.findRegistryRecords();
    const byVersion = new Map(records.map((record) => [record.version, record]));
    const now = Date.now();

    return this.migrations.filter((migration) => {
      const record = byVersion.get(migration.version);
      if (!record || record.status === 'pending') return true;
      if (record.status === 'failed') return !record.nextRetryAt || new Date(record.nextRetryAt).getTime() <= now;
      if (record.status === 'running') return Boolean(record.lockExpiresAt && new Date(record.lockExpiresAt).getTime() <= now);
      return false;
    });
  }

  async ensureRegistryRecord(migration, batch) {
    let record = await Migration.findByVersion(migration.version, this.environment);
    if (record) return record;

    try {
      record = await Migration.create({
        version: migration.version,
        name: migration.name,
        sequence: migration.sequence,
        status: 'pending',
        environment: this.environment,
        batch,
        path: migration.path,
        checksumAlgorithm: 'sha256',
        executedBy: this.executedBy,
      });
      return record;
    } catch (error) {
      // A concurrent runner may have registered the same immutable migration.
      if (error?.code === 11000) {
        const concurrentRecord = await Migration.findByVersion(migration.version, this.environment);
        if (concurrentRecord) return concurrentRecord;
      }
      throw error;
    }
  }

  async runPending(options = {}) {
    const dryRun = options.dryRun === true;
    const requestedBatch = options.batch ?? null;
    const environment = options.environment || this.environment;
    if (environment !== this.environment) {
      throw new Error(`Runner environment ${this.environment} does not match requested environment ${environment}.`);
    }

    await this.loadMigrations();
    const pending = await this.getPendingMigrations();
    if (pending.length === 0) {
      logger.info('[MigrationRunner] No pending migrations', { environment });
      return { success: true, migrationsRun: 0, results: [], environment };
    }

    if (dryRun) {
      return {
        success: true,
        migrationsRun: pending.length,
        dryRun: true,
        pending: pending.map(({ version, name, checksum }) => ({ version, name, checksum })),
        environment,
      };
    }

    const latestBatch = await Migration.findOne({ environment, isDeleted: false })
      .sort({ batch: -1 })
      .select('batch')
      .lean();
    const batch = requestedBatch ?? ((latestBatch?.batch || 0) + 1);
    const results = [];

    for (const migration of pending) {
      const result = await this.runMigration(migration, batch);
      results.push(result);
      if (!result.success) {
        logger.error('[MigrationRunner] Stopping migration chain after a failed migration', {
          environment,
          version: migration.version,
          reason: result.error || result.reason,
        });
        break;
      }
    }

    return {
      success: results.every((result) => result.success),
      migrationsRun: results.length,
      results,
      batch,
      environment,
    };
  }

  async runMigration(migration, batch) {
    let claimed;
    let heartbeatTimer;
    let heartbeatInFlight = null;
    let heartbeatFailure = null;

    const stopHeartbeat = async () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (heartbeatInFlight) await heartbeatInFlight;
      if (heartbeatFailure) throw heartbeatFailure;
    };

    try {
      const migrationModule = await loadMigrationModule(migration.path);
      if (typeof migrationModule?.up !== 'function') {
        throw new TypeError(`Migration ${migration.version} must export an up() function.`);
      }

      const existing = await this.ensureRegistryRecord(migration, batch);
      if (existing.status === 'completed') {
        if (existing.checksum && existing.checksum !== migration.checksum) {
          throw new Error(`Checksum drift detected for completed migration ${migration.version}; execution is blocked.`);
        }
        return { success: true, skipped: true, version: migration.version, reason: 'already_completed' };
      }

      if (existing.batch !== batch && existing.status !== 'running') {
        existing.batch = batch;
        await existing.save();
      }

      claimed = await Migration.claimMigration({
        version: migration.version,
        environment: this.environment,
        runnerId: this.runnerId,
        executedBy: this.executedBy,
        hostname: os.hostname(),
        processId: String(process.pid),
        batch,
        leaseMs: this.leaseMs,
      });

      if (!claimed) {
        return {
          success: false,
          version: migration.version,
          reason: 'migration_not_claimed',
          error: 'The migration is already owned by another active runner or is not currently retryable.',
        };
      }

      const startedAt = Date.now();
      const heartbeatIntervalMs = Math.max(1_000, Math.floor(this.leaseMs / 3));
      heartbeatTimer = setInterval(() => {
        if (heartbeatInFlight || heartbeatFailure) return;
        heartbeatInFlight = Migration.renewMigrationLease({
          version: migration.version,
          environment: this.environment,
          runnerId: this.runnerId,
          leaseMs: this.leaseMs,
        }).then((renewed) => {
          if (!renewed) {
            throw new Error(`Migration lease was lost while executing ${migration.version}.`);
          }
        }).catch((error) => {
          heartbeatFailure = error;
        }).finally(() => {
          heartbeatInFlight = null;
        });
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();

      await migrationModule.up({ mongoose, environment: this.environment, runnerId: this.runnerId });
      await stopHeartbeat();

      const completed = await Migration.completeMigration({
        version: migration.version,
        environment: this.environment,
        runnerId: this.runnerId,
        checksum: migration.checksum,
        startedAt: claimed.startedAt,
      });
      if (!completed) {
        throw new Error(`Migration ${migration.version} completed its work after losing its database lease; registry completion was rejected.`);
      }

      return {
        success: true,
        version: migration.version,
        durationMs: Date.now() - startedAt,
        checksum: migration.checksum,
      };
    } catch (error) {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (heartbeatInFlight) {
        try { await heartbeatInFlight; } catch (heartbeatError) { error.heartbeatError = heartbeatError; }
      }
      if (heartbeatFailure && !error.heartbeatError) error.heartbeatError = heartbeatFailure;

      if (claimed) {
        try {
          const failed = await Migration.failMigration({
            version: migration.version,
            environment: this.environment,
            runnerId: this.runnerId,
            error,
            errorCode: error.code || error.name,
            startedAt: claimed.startedAt,
          });
          if (!failed) throw new Error('The migration failure state could not be persisted because the runner no longer owns an active lease.');
        } catch (stateError) {
          error.statePersistenceError = stateError;
        }
      }
      logger.error('[MigrationRunner] Migration execution failed', {
        environment: this.environment,
        version: migration.version,
        error,
      });
      return {
        success: false,
        version: migration.version,
        error: error.message,
        errorCode: error.code || error.name,
        heartbeatError: error.heartbeatError?.message,
        statePersistenceError: error.statePersistenceError?.message,
      };
    }
  }

  async rollbackBatch(options = {}) {
    const requestedBatch = options.batch ?? null;
    const dryRun = options.dryRun === true;
    const recordsQuery = Migration.find({
      environment: this.environment,
      status: 'completed',
      isDeleted: false,
      ...(requestedBatch === null ? {} : { batch: requestedBatch }),
    }).sort({ sequence: -1, version: -1 });
    const records = await recordsQuery;
    const targetBatch = requestedBatch ?? records[0]?.batch;

    if (!records.length) return { success: true, rolledBack: 0, results: [], environment: this.environment };
    const selected = records.filter((record) => record.batch === targetBatch);
    if (dryRun) {
      return { success: true, rolledBack: selected.length, dryRun: true, batch: targetBatch, environment: this.environment };
    }

    await this.loadMigrations();
    const migrationByVersion = new Map(this.migrations.map((migration) => [migration.version, migration]));
    const results = [];

    for (const record of selected) {
      const migration = migrationByVersion.get(record.version);
      if (!migration) {
        results.push({ success: false, version: record.version, error: 'Migration source file is missing; rollback is blocked.' });
        break;
      }
      if (!record.checksum || record.checksum !== migration.checksum) {
        results.push({ success: false, version: record.version, error: 'Migration checksum is missing or has drifted; rollback is blocked.' });
        break;
      }

      let migrationModule;
      try {
        migrationModule = await loadMigrationModule(migration.path);
        if (typeof migrationModule?.down !== 'function') {
          throw new TypeError(`Migration ${record.version} does not export a down() rollback function.`);
        }
        await record.markRollbackStarted();
        await migrationModule.down({ mongoose, environment: this.environment, runnerId: this.runnerId });
        await record.markRolledBack({ executedBy: this.executedBy });
        results.push({ success: true, version: record.version });
      } catch (error) {
        try { await record.markRollbackFailed(error); } catch (stateError) { error.statePersistenceError = stateError; }
        results.push({ success: false, version: record.version, error: error.message });
        break;
      }
    }

    return {
      success: results.every((result) => result.success),
      rolledBack: results.filter((result) => result.success).length,
      results,
      batch: targetBatch,
      environment: this.environment,
    };
  }

  async getStatus() {
    await this.loadMigrations();
    const records = await this.findRegistryRecords();
    const byVersion = new Map(records.map((record) => [record.version, record]));
    const migrations = this.migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      sequence: migration.sequence,
      status: byVersion.get(migration.version)?.status || 'pending',
      batch: byVersion.get(migration.version)?.batch ?? null,
      startedAt: byVersion.get(migration.version)?.startedAt ?? null,
      completedAt: byVersion.get(migration.version)?.completedAt ?? null,
      durationMs: byVersion.get(migration.version)?.durationMs ?? null,
    }));
    const counts = Object.fromEntries(['pending', 'running', 'completed', 'failed', 'rolled_back'].map((status) => [
      status,
      migrations.filter((migration) => migration.status === status).length,
    ]));
    return { total: migrations.length, ...counts, migrations, environment: this.environment };
  }

  async listMigrations() {
    await this.loadMigrations();
    const records = await this.findRegistryRecords();
    const byVersion = new Map(records.map((record) => [record.version, record]));
    return this.migrations.map((migration) => {
      const record = byVersion.get(migration.version);
      return {
        version: migration.version,
        name: migration.name,
        sequence: migration.sequence,
        status: record?.status || 'pending',
        batch: record?.batch ?? null,
        completedAt: record?.completedAt ?? null,
        checksumPresent: Boolean(record?.checksum),
      };
    });
  }

  async verify() {
    await this.loadMigrations();
    // Include registry entries whose source files have disappeared. Restricting
    // this query to discovered versions would silently hide orphaned records.
    const records = await Migration.find({ environment: this.environment, isDeleted: false })
      .sort({ sequence: 1, version: 1 })
      .lean();
    const fileByVersion = new Map(this.migrations.map((migration) => [migration.version, migration]));
    const recordByVersion = new Map(records.map((record) => [record.version, record]));
    const issues = [];

    for (const record of records) {
      const source = fileByVersion.get(record.version);
      if (!source) {
        issues.push(`Registered migration ${record.version} has no source file.`);
        continue;
      }
      if (record.status === 'failed') issues.push(`Migration ${record.version} is in failed state.`);
      if (record.status === 'running') issues.push(`Migration ${record.version} is still running.`);
      if (record.status === 'completed' && !record.checksum) issues.push(`Completed migration ${record.version} has no recorded checksum.`);
      if (record.status === 'completed' && record.checksum && record.checksum !== source.checksum) {
        issues.push(`Completed migration ${record.version} has source checksum drift.`);
      }
    }

    for (const source of this.migrations) {
      if (!recordByVersion.has(source.version)) {
        // A source file with no registry record is pending, not an integrity failure.
        continue;
      }
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      summary: await this.listMigrations(),
      environment: this.environment,
    };
  }

  extractNameFromVersion(version) {
    const parts = String(version).split('_');
    return parts.length > 2 ? parts.slice(2).join('_') : String(version);
  }
}

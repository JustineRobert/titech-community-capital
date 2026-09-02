'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Scheduler
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ Cron-based Scheduling
 * ✅ Automates Provider Statement Import
 * ✅ Automates Settlement Engine Execution
 * ✅ Automates Ledger Reconciliation
 * ✅ Error Handling & Recovery
 * ✅ Audit Logging
 * ✅ Jest/Vitest Compatible
 * ============================================================================
 */

const cron = require('node-cron');
const logger = require('../../../../common/logger');
const ProviderStatementImporter = require('./providerStatementImporter');
const SettlementEngine = require('./settlementEngine');
const LedgerReconciler = require('./ledgerReconciler');

class SettlementScheduler {
  constructor(config = {}) {
    this.config = {
      importSchedule: config.importSchedule || process.env.STATEMENT_IMPORT_CRON || '0 2 * * *', // 2 AM daily
      settlementSchedule: config.settlementSchedule || process.env.SETTLEMENT_RUN_CRON || '0 3 * * *', // 3 AM daily
      reconciliationSchedule: config.reconciliationSchedule || process.env.RECONCILE_RUN_CRON || '0 4 * * *', // 4 AM daily
      statementFile: config.statementFile || process.env.STATEMENT_FILE || 'provider-statement.csv',
    };

    this.importer = new ProviderStatementImporter(config);
    this.engine = new SettlementEngine(config);
    this.reconciler = new LedgerReconciler(config);

    logger.info('[SettlementScheduler] Initialized with config:', this.config);
  }

  /**
   * Start all scheduled jobs
   */
  start() {
    logger.info('[SettlementScheduler] Starting scheduled jobs...');

    // Import provider statements
    cron.schedule(this.config.importSchedule, async () => {
      logger.info('[SettlementScheduler] Running provider statement import job...');
      try {
        await this.importer.importFile(this.config.statementFile);
        logger.info('[SettlementScheduler] Provider statement import completed');
      } catch (err) {
        logger.error('[SettlementScheduler] Provider statement import failed:', err);
      }
    });

    // Run settlement engine
    cron.schedule(this.config.settlementSchedule, async () => {
      logger.info('[SettlementScheduler] Running settlement engine job...');
      try {
        await this.engine.run(this.config.statementFile);
        logger.info('[SettlementScheduler] Settlement engine run completed');
      } catch (err) {
        logger.error('[SettlementScheduler] Settlement engine run failed:', err);
      }
    });

    // Run reconciliation
    cron.schedule(this.config.reconciliationSchedule, async () => {
      logger.info('[SettlementScheduler] Running reconciliation job...');
      try {
        const unsettled = await this.engine.repository.fetchUnsettled();
        await this.reconciler.reconcileBatch(unsettled);
        logger.info('[SettlementScheduler] Reconciliation run completed');
      } catch (err) {
        logger.error('[SettlementScheduler] Reconciliation run failed:', err);
      }
    });
  }
}

module.exports = SettlementScheduler;

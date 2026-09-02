// backend/services/mtn/reconciliation.js

'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

let logger = console;
let Transaction = null;
let LedgerEntry = null;
let AuditLog = null;
let queueService = null;
let notificationService = null;
let regulatoryReportingService = null;
let executiveDashboardService = null;
let reportExportService = null;

try {
  logger = require('../../modules/logger');
} catch {}

try {
  Transaction =
    require('../../models/Transaction');
} catch {}

try {
  LedgerEntry =
    require('../../models/LedgerEntry');
} catch {}

try {
  AuditLog =
    require('../../models/AuditLog');
} catch {}

try {
  queueService =
    require('../../modules/queueService');
} catch {}

try {
  notificationService =
    require('../../modules/notificationService');
} catch {}

try {
  regulatoryReportingService =
    require(
      '../../modules/regulatoryReportingService'
    );
} catch {}

try {
  executiveDashboardService =
    require(
      '../../modules/executiveDashboardService'
    );
} catch {}

try {
  reportExportService =
    require(
      '../../modules/reportExportService'
    );
} catch {}

class MTNReconciliationService extends EventEmitter {
  constructor(config = {}) {
    super();

    this.provider = 'MTN_MOMO';

    this.config = {
      toleranceAmount:
        Number(
          process.env
            .RECON_TOLERANCE_AMOUNT
        ) || 1,

      batchSize:
        Number(
          process.env
            .RECON_BATCH_SIZE
        ) || 5000,

      currency:
        process.env
          .DEFAULT_CURRENCY ||
        'UGX',

      autoRepair:
        process.env
          .RECON_AUTO_REPAIR ===
        'true',

      ...config,
    };

    this.metrics = {
      runs: 0,
      matched: 0,
      variances: 0,
      missingInternal: 0,
      missingProvider: 0,
      duplicates: 0,
      autoRepaired: 0,
      failures: 0,
      lastRunAt: null,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Audit
   |--------------------------------------------------------------------------
   */

  async recordAudit(
    action,
    payload = {}
  ) {
    try {
      const entry = {
        provider:
          this.provider,
        action,
        payload,
        timestamp:
          new Date(),
      };

      if (AuditLog?.create) {
        await AuditLog.create(
          entry
        );
      }

      logger.info(
        `[MTN RECON] ${action}`,
        payload
      );
    } catch (error) {
      logger.error(
        '[MTN RECON] Audit failure',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Date Utilities
   |--------------------------------------------------------------------------
   */

  buildDayRange(date) {
    const target =
      new Date(date);

    const start =
      new Date(target);

    start.setHours(
      0,
      0,
      0,
      0
    );

    const end =
      new Date(target);

    end.setHours(
      23,
      59,
      59,
      999
    );

    return {
      start,
      end,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Data Loaders
   |--------------------------------------------------------------------------
   */

  async loadTransactions({
    date,
    tenantId,
  }) {
    if (!Transaction) {
      return [];
    }

    const {
      start,
      end,
    } =
      this.buildDayRange(
        date
      );

    const query = {
      provider:
        this.provider,
      createdAt: {
        $gte: start,
        $lte: end,
      },
    };

    if (tenantId) {
      query.tenantId =
        tenantId;
    }

    return Transaction.find(
      query
    ).lean();
  }

  async loadLedgerEntries({
    date,
    tenantId,
  }) {
    if (!LedgerEntry) {
      return [];
    }

    const {
      start,
      end,
    } =
      this.buildDayRange(
        date
      );

    const query = {
      createdAt: {
        $gte: start,
        $lte: end,
      },
    };

    if (tenantId) {
      query.tenantId =
        tenantId;
    }

    return LedgerEntry.find(
      query
    ).lean();
  }

  /*
   |--------------------------------------------------------------------------
   | Settlement Import Hooks
   |--------------------------------------------------------------------------
   */

  async loadProviderTransactions(
    providerTransactions = []
  ) {
    return providerTransactions;
  }

  /*
   |--------------------------------------------------------------------------
   | Matching Helpers
   |--------------------------------------------------------------------------
   */

  buildReferenceMap(
    records
  ) {
    const map =
      new Map();

    for (const item of records) {
      const ref =
        item.reference ||
        item.providerReference ||
        item.externalId;

      if (ref) {
        map.set(
          ref,
          item
        );
      }
    }

    return map;
  }

  detectVariance(
    internal,
    provider
  ) {
    return (
      Math.abs(
        Number(
          internal
        ) -
          Number(
            provider
          )
      ) >
      this.config
        .toleranceAmount
    );
  }

  detectDuplicates(
    records
  ) {
    const seen =
      new Set();

    const duplicates =
      [];

    for (const r of records) {
      const ref =
        r.reference ||
        r.providerReference;

      if (!ref) continue;

      if (
        seen.has(ref)
      ) {
        duplicates.push(
          r
        );
      }

      seen.add(ref);
    }

    return duplicates;
  }

  /*
   |--------------------------------------------------------------------------
   | Reconcile Transactions
   |--------------------------------------------------------------------------
   */

  reconcileTransactions(
    internal,
    provider
  ) {
    const matched =
      [];

    const missingInternal =
      [];

    const missingProvider =
      [];

    const variances =
      [];

    const internalMap =
      this.buildReferenceMap(
        internal
      );

    const providerMap =
      this.buildReferenceMap(
        provider
      );

    for (const [
      reference,
      internalTx,
    ] of internalMap.entries()) {
      const providerTx =
        providerMap.get(
          reference
        );

      if (
        !providerTx
      ) {
        missingProvider.push(
          internalTx
        );
        continue;
      }

      if (
        this.detectVariance(
          internalTx.amount,
          providerTx.amount
        )
      ) {
        variances.push({
          reference,
          internalAmount:
            internalTx.amount,
          providerAmount:
            providerTx.amount,
          difference:
            Number(
              providerTx.amount
            ) -
            Number(
              internalTx.amount
            ),
        });
      }

      matched.push({
        reference,
        internal:
          internalTx,
        provider:
          providerTx,
      });
    }

    for (const [
      reference,
      providerTx,
    ] of providerMap.entries()) {
      if (
        !internalMap.has(
          reference
        )
      ) {
        missingInternal.push(
          providerTx
        );
      }
    }

    return {
      matched,
      missingInternal,
      missingProvider,
      variances,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Ledger Reconciliation
   |--------------------------------------------------------------------------
   */

  reconcileLedger(
    transactions,
    ledgerEntries
  ) {
    const transactionTotal =
      transactions.reduce(
        (
          sum,
          tx
        ) =>
          sum +
          Number(
            tx.amount ||
              0
          ),
        0
      );

    const ledgerTotal =
      ledgerEntries.reduce(
        (
          sum,
          entry
        ) =>
          sum +
          Number(
            entry.amount ||
              0
          ),
        0
      );

    const difference =
      ledgerTotal -
      transactionTotal;

    return {
      transactionTotal,
      ledgerTotal,
      difference,
      balanced:
        Math.abs(
          difference
        ) <=
        this.config
          .toleranceAmount,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Auto Repair
   |--------------------------------------------------------------------------
   */

  async autoRepair(
    report
  ) {
    if (
      !this.config
        .autoRepair
    ) {
      return;
    }

    for (const item of report
      .exceptions
      .missingProvider) {
      if (
        queueService
          ?.enqueue
      ) {
        await queueService.enqueue(
          'reconciliation-repair',
          {
            type:
              'MISSING_PROVIDER',
            reference:
              item.reference,
          }
        );

        this.metrics
          .autoRepaired++;
      }
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Main Reconciliation
   |--------------------------------------------------------------------------
   */

  async reconcileDaily({
    tenantId,
    date =
      new Date(),
    providerTransactions =
      [],
  } = {}) {
    const runId =
      crypto.randomUUID();

    this.metrics
      .runs++;
    this.metrics
      .lastRunAt =
      new Date();

    await this.recordAudit(
      'RECON_STARTED',
      {
        runId,
        tenantId,
        date,
      }
    );

    try {
      const internal =
        await this.loadTransactions(
          {
            date,
            tenantId,
          }
        );

      const ledger =
        await this.loadLedgerEntries(
          {
            date,
            tenantId,
          }
        );

      const provider =
        await this.loadProviderTransactions(
          providerTransactions
        );

      const txReport =
        this.reconcileTransactions(
          internal,
          provider
        );

      const ledgerReport =
        this.reconcileLedger(
          internal,
          ledger
        );

      const duplicateInternal =
        this.detectDuplicates(
          internal
        );

      const duplicateProvider =
        this.detectDuplicates(
          provider
        );

      const report = {
        runId,
        provider:
          this.provider,
        tenantId,
        date,

        summary: {
          internalTransactions:
            internal.length,

          providerTransactions:
            provider.length,

          matched:
            txReport
              .matched
              .length,

          missingInternal:
            txReport
              .missingInternal
              .length,

          missingProvider:
            txReport
              .missingProvider
              .length,

          variances:
            txReport
              .variances
              .length,

          duplicateInternal:
            duplicateInternal.length,

          duplicateProvider:
            duplicateProvider.length,
        },

        ledger:
          ledgerReport,

        exceptions: {
          missingInternal:
            txReport
              .missingInternal,

          missingProvider:
            txReport
              .missingProvider,

          variances:
            txReport
              .variances,

          duplicateInternal,

          duplicateProvider,
        },

        generatedAt:
          new Date().toISOString(),
      };

      this.metrics
        .matched +=
        report.summary
          .matched;

      this.metrics
        .variances +=
        report.summary
          .variances;

      this.metrics
        .missingInternal +=
        report.summary
          .missingInternal;

      this.metrics
        .missingProvider +=
        report.summary
          .missingProvider;

      this.metrics
        .duplicates +=
        duplicateInternal.length +
        duplicateProvider.length;

      await this.autoRepair(
        report
      );

      if (
        notificationService
          ?.send
      ) {
        await notificationService.send(
          {
            type:
              'RECON_COMPLETED',
            tenantId,
            payload:
              report.summary,
          }
        );
      }

      if (
        executiveDashboardService
          ?.recordMetric
      ) {
        await executiveDashboardService.recordMetric(
          {
            metric:
              'mtn_reconciliation',
            value:
              report.summary,
          }
        );
      }

      if (
        regulatoryReportingService
          ?.recordReconciliation
      ) {
        await regulatoryReportingService.recordReconciliation(
          report
        );
      }

      await this.recordAudit(
        'RECON_COMPLETED',
        {
          runId,
          summary:
            report.summary,
        }
      );

      this.emit(
        'reconciliation.completed',
        report
      );

      return report;
    } catch (error) {
      this.metrics
        .failures++;

      await this.recordAudit(
        'RECON_FAILED',
        {
          runId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Settlement Validation
   |--------------------------------------------------------------------------
   */

  async validateSettlement({
    expectedAmount,
    settledAmount,
  }) {
    const difference =
      Number(
        settledAmount
      ) -
      Number(
        expectedAmount
      );

    return {
      valid:
        Math.abs(
          difference
        ) <=
        this.config
          .toleranceAmount,

      expectedAmount,
      settledAmount,
      difference,
      checkedAt:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Report Export
   |--------------------------------------------------------------------------
   */

  async exportReport(
    report,
    format = 'pdf'
  ) {
    if (
      !reportExportService
        ?.export
    ) {
      return null;
    }

    return reportExportService.export(
      {
        type:
          'MTN_RECONCILIATION',
        format,
        data:
          report,
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  healthCheck() {
    return {
      service:
        'MTN_RECONCILIATION',
      provider:
        this.provider,
      currency:
        this.config
          .currency,
      toleranceAmount:
        this.config
          .toleranceAmount,
      metrics:
        this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }

  getMetrics() {
    return {
      ...this.metrics,
      provider:
        this.provider,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new MTNReconciliationService();

module.exports.MTNReconciliationService =
  MTNReconciliationService;
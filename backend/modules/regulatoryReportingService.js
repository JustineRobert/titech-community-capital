'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Regulatory Reporting Service
 * ============================================================================
 *
 * Regulatory Reporting / Compliance Reporting Engine
 *
 * Responsibilities:
 *
 *  - CTR reporting
 *  - STR reporting
 *  - SAR reporting
 *  - KYC compliance reporting
 *  - Fraud reporting
 *  - Transaction reporting
 *  - Report lifecycle management
 *  - Report approval workflow
 *  - Regulatory submission workflow
 *  - Report export
 *  - Report integrity hashing
 *  - Audit logging
 *  - Scheduling
 *  - Metrics
 *  - Tenant isolation
 *  - Idempotency
 *
 * Adapter-aware architecture:
 *
 *  RegulatoryReportingService owns:
 *
 *  - report lifecycle
 *  - persistence
 *  - exports
 *  - audit
 *  - idempotency
 *  - integrity
 *  - tenant isolation
 *  - workflow state
 *
 * Regulatory adapters own:
 *
 *  - jurisdiction-specific rules
 *  - thresholds
 *  - schemas
 *  - reporting calendars
 *  - filing destinations
 *  - submission payloads
 *  - submission transport
 *  - acknowledgement handling
 *  - jurisdiction-specific validation
 *
 * IMPORTANT:
 *
 * This service does NOT hard-code jurisdiction-specific legal rules.
 *
 * Existing public methods are intentionally preserved.
 *
 * Adapter integration is additive and backward compatible.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs/promises');
const path = require('path');

/**
 * ============================================================================
 * DEFAULT REPORT TYPES
 * ============================================================================
 */

const DEFAULT_REPORT_TYPES = [
  'CTR',
  'STR',
  'SAR',
  'KYC_COMPLIANCE',
  'FRAUD',
  'TRANSACTION',
];

/**
 * ============================================================================
 * DEFAULT EXPORT FORMATS
 * ============================================================================
 */

const DEFAULT_EXPORT_FORMATS = [
  'json',
  'csv',
  'xml',
];

/**
 * ============================================================================
 * REGULATORY REPORTING SERVICE
 * ============================================================================
 */

class RegulatoryReportingService extends EventEmitter {

  /**
   * ==========================================================================
   * CONSTRUCTOR
   * ==========================================================================
   */

  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    notificationService,
    reportExportService,
    amlService,
    fraudDetectionService,
    kycService,
    metricsService,

    /**
     * New adapter dependencies.
     *
     * Supported:
     *
     * regulatoryAdapter
     * regulatoryAdapterRegistry
     *
     * The registry is preferred for multi-country deployments.
     */
    regulatoryAdapter = null,
    regulatoryAdapterRegistry = null,

    config = {},
  } = {}) {

    super();

    if (!db) {
      throw new Error(
        'RegulatoryReportingService requires a database service.'
      );
    }

    this.db = db;
    this.logger = logger || console;
    this.cache = cache;
    this.queueService = queueService;
    this.auditService = auditService;
    this.notificationService = notificationService;
    this.reportExportService = reportExportService;
    this.amlService = amlService;
    this.fraudDetectionService = fraudDetectionService;
    this.kycService = kycService;
    this.metricsService = metricsService;

    /**
     * ------------------------------------------------------------------------
     * Regulatory Adapter Layer
     * ------------------------------------------------------------------------
     */

    this.regulatoryAdapter =
      regulatoryAdapter || null;

    this.regulatoryAdapterRegistry =
      regulatoryAdapterRegistry || null;

    this.config = {

      reportsDirectory: path.join(
        process.cwd(),
        'storage',
        'reports'
      ),

      /**
       * Deprecated compatibility fallback.
       *
       * New deployments should provide this through a regulatory adapter.
       */
      largeTransactionThreshold: 10000000,

      retryAttempts: 5,

      cacheTtl: 300,

      maxReportRecords: 100000,

      maxPayloadBytes: 25 * 1024 * 1024,

      exportFormats: [
        ...DEFAULT_EXPORT_FORMATS,
      ],

      allowedReportTypes: [
        ...DEFAULT_REPORT_TYPES,
      ],

      /**
       * Default jurisdiction.
       *
       * The adapter registry can override this per tenant.
       */
      defaultJurisdiction: 'DEFAULT',

      /**
       * Optional tenant -> jurisdiction resolver.
       *
       * Can be:
       *
       * - function
       * - static object
       *
       * Example:
       *
       * tenantJurisdictionResolver: async tenantId => 'UG'
       */
      tenantJurisdictionResolver: null,

      statuses: {
        PENDING: 'pending',
        GENERATED: 'generated',
        APPROVED: 'approved',
        SUBMITTED: 'submitted',
        FAILED: 'failed',
      },

      sensitiveFields: [
        'password',
        'passwordHash',
        'refreshToken',
        'accessToken',
        'token',
        'secret',
        'apiKey',
        'clientSecret',
        'privateKey',
        'encryptionKey',
        'otp',
        'otpSecret',
        'securityAnswer',
        'pin',
        'transactionPin',
      ],

      immutableAfterApproval: true,

      requireApprovalBeforeSubmission: true,

      preventDuplicateSubmission: true,

      atomicWrites: true,

      /**
       * Adapter behavior.
       */
      regulatoryAdapterEnabled: true,

      /**
       * If true, adapter failures during jurisdictional processing
       * fail the operation rather than silently falling back.
       */
      failOnAdapterError: true,

      ...config,
    };

    this.config.reportsDirectory =
      path.resolve(
        this.config.reportsDirectory
      );

    this._initialized = false;
  }

  /**
   * ==========================================================================
   * INITIALIZATION
   * ==========================================================================
   */

  async initialize() {

    if (this._initialized) {
      return;
    }

    await fs.mkdir(
      this.config.reportsDirectory,
      {
        recursive: true,
        mode: 0o750,
      }
    );

    this._initialized = true;

    this.logInfo(
      'Regulatory reporting service initialized',
      {
        reportsDirectory:
          this.config.reportsDirectory,

        adapterEnabled:
          this.isRegulatoryAdapterEnabled(),
      }
    );
  }

  /**
   * ==========================================================================
   * ADAPTER RESOLUTION
   * ==========================================================================
   */

  async resolveRegulatoryAdapter({
    tenantId = null,
    jurisdiction = null,
    reportType = null,
  } = {}) {

    if (
      !this.config.regulatoryAdapterEnabled
    ) {
      return null;
    }

    /**
     * Explicit adapter always wins.
     */
    if (
      this.regulatoryAdapter
    ) {
      return this.regulatoryAdapter;
    }

    const registry =
      this.regulatoryAdapterRegistry;

    if (!registry) {
      return null;
    }

    let resolvedJurisdiction =
      jurisdiction;

    if (
      !resolvedJurisdiction &&
      tenantId
    ) {
      resolvedJurisdiction =
        await this.resolveTenantJurisdiction(
          tenantId
        );
    }

    resolvedJurisdiction =
      resolvedJurisdiction ||
      this.config.defaultJurisdiction;

    try {

      /**
       * Preferred registry API:
       *
       * registry.resolve({
       *   tenantId,
       *   jurisdiction,
       *   reportType
       * })
       */
      if (
        typeof registry.resolve ===
        'function'
      ) {

        const adapter =
          await registry.resolve({
            tenantId,
            jurisdiction:
              resolvedJurisdiction,
            reportType,
          });

        if (adapter) {
          return adapter;
        }
      }

      /**
       * Alternative registry API:
       *
       * registry.get(jurisdiction)
       */
      if (
        typeof registry.get ===
        'function'
      ) {

        const adapter =
          await registry.get(
            resolvedJurisdiction
          );

        if (adapter) {
          return adapter;
        }
      }

      /**
       * Alternative registry API:
       *
       * registry.getAdapter(...)
       */
      if (
        typeof registry.getAdapter ===
        'function'
      ) {

        const adapter =
          await registry.getAdapter(
            resolvedJurisdiction
          );

        if (adapter) {
          return adapter;
        }
      }

      /**
       * Static registry:
       *
       * registry.adapters[ jurisdiction ]
       */
      if (
        registry.adapters &&
        registry.adapters[
          resolvedJurisdiction
        ]
      ) {

        return registry.adapters[
          resolvedJurisdiction
        ];
      }

      return null;

    } catch (error) {

      this.logError(
        'Regulatory adapter resolution failed',
        error
      );

      if (
        this.config.failOnAdapterError
      ) {
        throw error;
      }

      return null;
    }
  }

  /**
   * ==========================================================================
   * TENANT JURISDICTION RESOLUTION
   * ==========================================================================
   */

  async resolveTenantJurisdiction(
    tenantId
  ) {

    const resolver =
      this.config
        .tenantJurisdictionResolver;

    if (
      typeof resolver ===
      'function'
    ) {

      return resolver(
        tenantId
      );
    }

    if (
      resolver &&
      typeof resolver ===
      'object'
    ) {

      return (
        resolver[tenantId] ||
        this.config.defaultJurisdiction
      );
    }

    /**
     * Optional database-backed tenant lookup.
     *
     * This remains defensive because different projects
     * may expose different tenant repositories.
     */
    try {

      const tenants =
        this.db.tenants;

      if (
        tenants &&
        typeof tenants.findOne ===
        'function'
      ) {

        const tenant =
          await tenants.findOne({
            id: tenantId,
          });

        if (
          tenant &&
          (
            tenant.jurisdiction ||
            tenant.countryCode
          )
        ) {

          return (
            tenant.jurisdiction ||
            tenant.countryCode
          );
        }
      }

    } catch (error) {

      this.logError(
        'Tenant jurisdiction lookup failed',
        error
      );
    }

    return this.config.defaultJurisdiction;
  }

  /**
   * ==========================================================================
   * ADAPTER CAPABILITY HELPERS
   * ==========================================================================
   */

  isRegulatoryAdapterEnabled() {

    return Boolean(
      this.config.regulatoryAdapterEnabled &&
      (
        this.regulatoryAdapter ||
        this.regulatoryAdapterRegistry
      )
    );
  }

  async adapterSupportsReportType(
    adapter,
    type
  ) {

    if (
      !adapter
    ) {
      return true;
    }

    if (
      typeof adapter.supportsReportType ===
      'function'
    ) {

      return Boolean(
        await adapter.supportsReportType(
          type
        )
      );
    }

    if (
      typeof adapter.getSupportedReportTypes ===
      'function'
    ) {

      const types =
        await adapter.getSupportedReportTypes();

      if (
        Array.isArray(types)
      ) {

        return types.includes(type);
      }
    }

    if (
      Array.isArray(
        adapter.supportedReportTypes
      )
    ) {

      return adapter.supportedReportTypes
        .includes(type);
    }

    return true;
  }

  /**
   * ==========================================================================
   * ADAPTER RULES
   * ==========================================================================
   */

  async getRegulatoryRules({
    tenantId,
    jurisdiction = null,
    reportType = null,
  } = {}) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId,
        jurisdiction,
        reportType,
      });

    if (
      !adapter
    ) {
      return {};
    }

    if (
      typeof adapter.getRules ===
      'function'
    ) {

      return (
        await adapter.getRules({
          tenantId,
          jurisdiction,
          reportType,
        })
      ) || {};
    }

    if (
      typeof adapter.getReportingRules ===
      'function'
    ) {

      return (
        await adapter.getReportingRules({
          tenantId,
          jurisdiction,
          reportType,
        })
      ) || {};
    }

    if (
      adapter.rules &&
      typeof adapter.rules ===
      'object'
    ) {

      return adapter.rules;
    }

    return {};
  }

  /**
   * ==========================================================================
   * ADAPTER THRESHOLD
   * ==========================================================================
   */

  async getTransactionReportingThreshold({
    tenantId,
    reportType = 'CTR',
    jurisdiction = null,
  } = {}) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId,
        jurisdiction,
        reportType,
      });

    if (
      adapter &&
      typeof adapter.getTransactionReportingThreshold ===
      'function'
    ) {

      const threshold =
        await adapter.getTransactionReportingThreshold({
          tenantId,
          reportType,
          jurisdiction,
        });

      if (
        threshold !== undefined &&
        threshold !== null
      ) {
        return threshold;
      }
    }

    if (
      adapter &&
      typeof adapter.getThreshold ===
      'function'
    ) {

      const threshold =
        await adapter.getThreshold({
          tenantId,
          reportType,
          jurisdiction,
        });

      if (
        threshold !== undefined &&
        threshold !== null
      ) {
        return threshold;
      }
    }

    /**
     * Backward-compatible fallback.
     */
    return this.config
      .largeTransactionThreshold;
  }

  /**
   * ==========================================================================
   * ADAPTER REPORT PREPARATION
   * ==========================================================================
   */

  async prepareReportWithAdapter({
    tenantId,
    type,
    payload,
    metadata = {},
    jurisdiction = null,
  }) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId,
        jurisdiction,
        reportType: type,
      });

    if (
      !adapter
    ) {
      return {
        payload,
        metadata,
        adapter: null,
        jurisdiction:
          jurisdiction ||
          this.config.defaultJurisdiction,
      };
    }

    const supported =
      await this.adapterSupportsReportType(
        adapter,
        type
      );

    if (!supported) {
      throw new Error(
        `Regulatory adapter does not support report type "${type}".`
      );
    }

    let preparedPayload =
      payload;

    let preparedMetadata =
      metadata;

    /**
     * Preferred API.
     */
    if (
      typeof adapter.prepareReport ===
      'function'
    ) {

      const result =
        await adapter.prepareReport({
          tenantId,
          type,
          payload,
          metadata,
          jurisdiction,
        });

      if (
        result &&
        typeof result ===
        'object'
      ) {

        preparedPayload =
          result.payload ??
          preparedPayload;

        preparedMetadata = {
          ...preparedMetadata,
          ...(result.metadata || {}),
        };
      }
    }

    /**
     * Alternative schema transformation API.
     */
    else if (
      typeof adapter.transformReport ===
      'function'
    ) {

      preparedPayload =
        await adapter.transformReport({
          tenantId,
          type,
          payload,
          metadata,
          jurisdiction,
        });
    }

    return {
      payload:
        preparedPayload,

      metadata:
        preparedMetadata,

      adapter,

      jurisdiction:
        jurisdiction ||
        await this.resolveTenantJurisdiction(
          tenantId
        ),
    };
  }

  /**
   * ==========================================================================
   * ADAPTER VALIDATION
   * ==========================================================================
   */

  async validateReportWithAdapter(
    report
  ) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId:
          report.tenantId,

        jurisdiction:
          report.metadata?.jurisdiction,

        reportType:
          report.type,
      });

    if (
      !adapter
    ) {
      return {
        valid: true,
      };
    }

    if (
      typeof adapter.validateReport ===
      'function'
    ) {

      const result =
        await adapter.validateReport(
          report
        );

      if (
        result === true
      ) {
        return {
          valid: true,
        };
      }

      if (
        result === false
      ) {
        return {
          valid: false,
          reason:
            'Regulatory adapter rejected the report.',
        };
      }

      return (
        result || {
          valid: true,
        }
      );
    }

    return {
      valid: true,
    };
  }

  /**
   * ==========================================================================
   * REPORT CREATION
   * ==========================================================================
   */

  async createReport({
    tenantId,
    type,
    generatedBy,
    payload = {},
    metadata = {},
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateTenantId(
      tenantId
    );

    this.validateReportType(
      type
    );

    this.validateActor(
      generatedBy
    );

    if (
      idempotencyKey
    ) {

      const existing =
        await this.findIdempotentReport(
          tenantId,
          idempotencyKey
        );

      if (
        existing
      ) {
        return existing;
      }
    }

    const prepared =
      await this.prepareReportWithAdapter({
        tenantId,
        type,
        payload,
        metadata,
        jurisdiction,
      });

    const sanitizedPayload =
      this.sanitizePayload(
        prepared.payload
      );

    this.assertPayloadSize(
      sanitizedPayload
    );

    const now =
      new Date();

    const report = {

      id:
        crypto.randomUUID(),

      tenantId,

      type,

      status:
        this.config.statuses.PENDING,

      version: 1,

      payload:
        sanitizedPayload,

      metadata: {
        ...prepared.metadata,

        jurisdiction:
          prepared.jurisdiction,
      },

      generatedBy,

      idempotencyKey,

      createdAt: now,

      updatedAt: now,
    };

    /**
     * Adapter-level validation occurs before persistence.
     */
    const validation =
      await this.validateReportWithAdapter(
        report
      );

    if (
      validation &&
      validation.valid === false
    ) {

      throw new Error(
        validation.reason ||
        'Regulatory adapter rejected report validation.'
      );
    }

    report.integrityHash =
      this.calculateIntegrityHash(
        report
      );

    await this.db.regulatoryReports.create(
      report
    );

    await this.audit(
      tenantId,
      null,
      'REGULATORY_REPORT_CREATED',
      {
        reportId:
          report.id,

        type:
          report.type,

        generatedBy,

        jurisdiction:
          report.metadata?.jurisdiction,

        integrityHash:
          report.integrityHash,
      }
    );

    this.emit(
      'regulatory.report.created',
      report
    );

    this.incrementMetric(
      'regulatory_reports_created'
    );

    return report;
  }

  /**
   * ==========================================================================
   * CTR REPORT
   * ==========================================================================
   */

  async generateCTR({
    tenantId,
    from,
    to,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateDateRange(
      from,
      to
    );

    const threshold =
      await this.getTransactionReportingThreshold({
        tenantId,
        reportType: 'CTR',
        jurisdiction,
      });

    const transactions =
      await this.findTransactions({
        tenantId,

        amount: {
          $gte:
            threshold,
        },

        createdAt: {
          $gte: from,
          $lte: to,
        },
      });

    const report =
      await this.createReport({
        tenantId,

        type:
          'CTR',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          from,
          to,

          threshold,

          transactionCount:
            transactions.length,

          transactions,
        },

        metadata: {
          reportCategory:
            'CASH_TRANSACTION_REPORT',

          threshold,

          generatedAt:
            new Date().toISOString(),
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * STR REPORT
   * ==========================================================================
   */

  async generateSTR({
    tenantId,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateTenantId(
      tenantId
    );

    const alerts =
      await this.findRecords(
        'amlAlerts',
        {
          tenantId,
          status: 'open',
        }
      );

    const report =
      await this.createReport({
        tenantId,

        type:
          'STR',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          alertCount:
            alerts.length,

          alerts,
        },

        metadata: {
          reportCategory:
            'SUSPICIOUS_TRANSACTION_REPORT',
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * SAR REPORT
   * ==========================================================================
   */

  async generateSAR({
    tenantId,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateTenantId(
      tenantId
    );

    const cases =
      await this.findRecords(
        'amlCases',
        {
          tenantId,
        }
      );

    const report =
      await this.createReport({
        tenantId,

        type:
          'SAR',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          caseCount:
            cases.length,

          cases,
        },

        metadata: {
          reportCategory:
            'SUSPICIOUS_ACTIVITY_REPORT',
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * KYC COMPLIANCE REPORT
   * ==========================================================================
   */

  async generateKYCReport({
    tenantId,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateTenantId(
      tenantId
    );

    const profiles =
      await this.findRecords(
        'kycProfiles',
        {
          tenantId,
        }
      );

    const report =
      await this.createReport({
        tenantId,

        type:
          'KYC_COMPLIANCE',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          profileCount:
            profiles.length,

          profiles,
        },

        metadata: {
          reportCategory:
            'KYC_COMPLIANCE',
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * FRAUD REPORT
   * ==========================================================================
   */

  async generateFraudReport({
    tenantId,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateTenantId(
      tenantId
    );

    const alerts =
      await this.findRecords(
        'fraudAlerts',
        {
          tenantId,
        }
      );

    const report =
      await this.createReport({
        tenantId,

        type:
          'FRAUD',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          alertCount:
            alerts.length,

          alerts,
        },

        metadata: {
          reportCategory:
            'FRAUD_MONITORING',
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * TRANSACTION REPORT
   * ==========================================================================
   */

  async generateTransactionReport({
    tenantId,
    from,
    to,
    generatedBy,
    idempotencyKey = null,
    jurisdiction = null,
  } = {}) {

    this.validateDateRange(
      from,
      to
    );

    const transactions =
      await this.findTransactions({
        tenantId,

        createdAt: {
          $gte: from,
          $lte: to,
        },
      });

    const report =
      await this.createReport({
        tenantId,

        type:
          'TRANSACTION',

        generatedBy,

        idempotencyKey,

        jurisdiction,

        payload: {
          from,
          to,

          transactionCount:
            transactions.length,

          transactions,
        },
      });

    return this.exportReport(
      report
    );
  }

  /**
   * ==========================================================================
   * EXPORT REPORT
   * ==========================================================================
   */

  async exportReport(
    report,
    format = 'json'
  ) {

    if (!report) {
      throw new Error(
        'Report is required.'
      );
    }

    this.validateReportType(
      report.type
    );

    format =
      String(format)
        .trim()
        .toLowerCase();

    this.validateExportFormat(
      format
    );

    await this.initialize();

    if (
      report.status ===
      this.config.statuses.SUBMITTED
    ) {

      throw new Error(
        'Submitted regulatory reports cannot be modified.'
      );
    }

    const validation =
      await this.validateReportWithAdapter(
        report
      );

    if (
      validation &&
      validation.valid === false
    ) {

      throw new Error(
        validation.reason ||
        'Regulatory adapter rejected report validation.'
      );
    }

    const fileName =
      `${report.id}.${format}`;

    const filePath =
      this.resolveSafeReportPath(
        fileName
      );

    const exportPayload =
      this.sanitizePayload(
        report.payload
      );

    const exportData =
      await this.buildExportData(
        report,
        exportPayload,
        format
      );

    this.assertPayloadSize(
      exportData
    );

    try {

      await this.atomicWrite(
        filePath,
        exportData
      );

      const integrityHash =
        this.calculateBufferHash(
          exportData
        );

      report.status =
        this.config.statuses.GENERATED;

      report.filePath =
        filePath;

      report.fileName =
        fileName;

      report.exportFormat =
        format;

      report.exportHash =
        integrityHash;

      report.generatedAt =
        new Date();

      report.updatedAt =
        new Date();

      report.version =
        Number(
          report.version || 1
        ) + 1;

      report.integrityHash =
        this.calculateIntegrityHash(
          report
        );

      await this.db.regulatoryReports.update(
        report.id,
        report
      );

      await this.audit(
        report.tenantId,
        null,
        'REGULATORY_REPORT_EXPORTED',
        {
          reportId:
            report.id,

          type:
            report.type,

          format,

          jurisdiction:
            report.metadata?.jurisdiction,

          exportHash:
            integrityHash,
        }
      );

      this.emit(
        'regulatory.report.generated',
        report
      );

      this.incrementMetric(
        'regulatory_reports_exported'
      );

      return report;

    } catch (error) {

      await this.markReportFailed(
        report,
        error
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * EXPORT DATA BUILDER
   * ==========================================================================
   */

  async buildExportData(
    report,
    payload,
    format
  ) {

    /**
     * If an external export service exists,
     * allow it to own format-specific rendering.
     */
    if (
      this.reportExportService &&
      typeof this.reportExportService.export ===
      'function'
    ) {

      const result =
        await this.reportExportService.export({
          report,
          payload,
          format,
        });

      if (
        typeof result === 'string' ||
        Buffer.isBuffer(result)
      ) {
        return result;
      }
    }

    switch (format) {

      case 'csv':
        return this.exportCSV(
          report,
          payload
        );

      case 'xml':
        return this.exportXML(
          report,
          payload
        );

      case 'json':
      default:
        return JSON.stringify(
          payload,
          this.jsonReplacer.bind(this),
          2
        );
    }
  }

  /**
   * ==========================================================================
   * CSV EXPORT
   * ==========================================================================
   */

  async exportCSV(
    report,
    payload
  ) {

    const rows = [];

    rows.push([
      'report_id',
      'report_type',
      'tenant_id',
      'jurisdiction',
      'generated_at',
      'key',
      'value',
    ]);

    const flatten =
      this.flattenObject(
        payload
      );

    for (
      const [
        key,
        value,
      ]
      of Object.entries(flatten)
    ) {

      rows.push([
        report.id,
        report.type,
        report.tenantId,
        report.metadata?.jurisdiction ||
          '',
        new Date().toISOString(),
        key,
        this.csvSafeValue(
          value
        ),
      ]);
    }

    return rows
      .map(
        (row) =>
          row
            .map(
              (value) =>
                this.escapeCSV(
                  value
                )
            )
            .join(',')
      )
      .join('\n');
  }

  /**
   * ==========================================================================
   * XML EXPORT
   * ==========================================================================
   */

  async exportXML(
    report,
    payload
  ) {

    const body =
      this.objectToXML(
        payload,
        'payload'
      );

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<report>',

      `<id>${this.escapeXML(
        report.id
      )}</id>`,

      `<type>${this.escapeXML(
        report.type
      )}</type>`,

      `<tenantId>${this.escapeXML(
        report.tenantId
      )}</tenantId>`,

      `<jurisdiction>${this.escapeXML(
        report.metadata?.jurisdiction ||
        ''
      )}</jurisdiction>`,

      `<generatedAt>${this.escapeXML(
        new Date().toISOString()
      )}</generatedAt>`,

      body,

      '</report>',
    ].join('');
  }

  /**
   * ==========================================================================
   * APPROVAL WORKFLOW
   * ==========================================================================
   */

  async approveReport(
    reportId,
    approvedBy,
    tenantId = null
  ) {

    this.validateActor(
      approvedBy
    );

    const report =
      await this.getReport(
        reportId,
        tenantId
      );

    if (!report) {
      throw new Error(
        'Report not found.'
      );
    }

    if (
      report.status !==
      this.config.statuses.GENERATED
    ) {

      throw new Error(
        `Report cannot be approved from status "${report.status}".`
      );
    }

    if (
      report.generatedBy &&
      report.generatedBy ===
        approvedBy
    ) {

      throw new Error(
        'Maker-checker control violation: the report generator cannot approve the same report.'
      );
    }

    const integrityValid =
      this.verifyReportIntegrity(
        report
      );

    if (!integrityValid) {
      throw new Error(
        'Regulatory report integrity verification failed.'
      );
    }

    const adapterValidation =
      await this.validateReportWithAdapter(
        report
      );

    if (
      adapterValidation &&
      adapterValidation.valid === false
    ) {

      throw new Error(
        adapterValidation.reason ||
        'Regulatory adapter rejected the report.'
      );
    }

    report.status =
      this.config.statuses.APPROVED;

    report.approvedBy =
      approvedBy;

    report.approvedAt =
      new Date();

    report.updatedAt =
      new Date();

    report.version =
      Number(
        report.version || 1
      ) + 1;

    report.integrityHash =
      this.calculateIntegrityHash(
        report
      );

    await this.db.regulatoryReports.update(
      report.id,
      report
    );

    await this.audit(
      report.tenantId,
      null,
      'REGULATORY_REPORT_APPROVED',
      {
        reportId,
        approvedBy,
        jurisdiction:
          report.metadata?.jurisdiction,
      }
    );

    this.emit(
      'regulatory.report.approved',
      report
    );

    this.incrementMetric(
      'regulatory_reports_approved'
    );

    return report;
  }

  /**
   * ==========================================================================
   * SUBMISSION
   * ==========================================================================
   */

  async submitReport(
    reportId,
    tenantId = null,
    submittedBy = null
  ) {

    const report =
      await this.getReport(
        reportId,
        tenantId
      );

    if (!report) {
      throw new Error(
        'Report not found.'
      );
    }

    if (
      this.config
        .preventDuplicateSubmission &&
      report.status ===
        this.config.statuses.SUBMITTED
    ) {

      return report;
    }

    if (
      this.config
        .requireApprovalBeforeSubmission &&
      report.status !==
        this.config.statuses.APPROVED
    ) {

      throw new Error(
        'Report must be approved before submission.'
      );
    }

    /**
     * Recalculate integrity before submission.
     */
    const expectedHash =
      this.calculateIntegrityHash(
        report
      );

    if (
      report.integrityHash &&
      report.integrityHash !==
        expectedHash
    ) {

      throw new Error(
        'Regulatory report integrity verification failed.'
      );
    }

    /**
     * Validate against jurisdiction-specific adapter.
     */
    const validation =
      await this.validateReportWithAdapter(
        report
      );

    if (
      validation &&
      validation.valid === false
    ) {

      throw new Error(
        validation.reason ||
        'Regulatory adapter rejected report submission.'
      );
    }

    /**
     * --------------------------------------------------------------
     * Regulatory adapter submission
     * --------------------------------------------------------------
     *
     * The adapter is responsible for:
     *
     * - jurisdiction-specific payload
     * - filing endpoint
     * - authentication
     * - transmission
     * - acknowledgement
     * - regulatory reference
     */
    const submission =
      await this.submitThroughAdapter(
        report,
        submittedBy
      );

    report.status =
      this.config.statuses.SUBMITTED;

    report.submittedBy =
      submittedBy;

    report.submittedAt =
      new Date();

    report.updatedAt =
      new Date();

    report.version =
      Number(
        report.version || 1
      ) + 1;

    /**
     * Preserve normalized submission information
     * without storing secrets.
     */
    if (
      submission
    ) {

      report.submission = {
        ...this.sanitizePayload(
          submission
        ),
      };
    }

    report.integrityHash =
      this.calculateIntegrityHash(
        report
      );

    await this.db.regulatoryReports.update(
      report.id,
      report
    );

    await this.audit(
      report.tenantId,
      null,
      'REGULATORY_REPORT_SUBMITTED',
      {
        reportId,
        submittedBy,

        jurisdiction:
          report.metadata?.jurisdiction,

        submittedAt:
          report.submittedAt,

        regulatoryReference:
          submission?.regulatoryReference ||
          submission?.submissionReference ||
          null,
      }
    );

    await this.sendSubmissionNotification(
      report
    );

    this.emit(
      'regulatory.report.submitted',
      report
    );

    this.incrementMetric(
      'regulatory_reports_submitted'
    );

    return report;
  }

  /**
   * ==========================================================================
   * ADAPTER SUBMISSION
   * ==========================================================================
   */

  async submitThroughAdapter(
    report,
    submittedBy = null
  ) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId:
          report.tenantId,

        jurisdiction:
          report.metadata?.jurisdiction,

        reportType:
          report.type,
      });

    /**
     * Backward compatibility:
     *
     * No adapter means local lifecycle submission,
     * exactly as the previous service behaved.
     */
    if (!adapter) {

      return {
        submitted: true,

        mode:
          'internal',

        jurisdiction:
          report.metadata?.jurisdiction ||
          this.config.defaultJurisdiction,
      };
    }

    /**
     * Preferred API.
     */
    if (
      typeof adapter.submitReport ===
      'function'
    ) {

      const result =
        await adapter.submitReport({
          report,
          tenantId:
            report.tenantId,
          reportType:
            report.type,
          submittedBy,
          jurisdiction:
            report.metadata?.jurisdiction,
        });

      return this.normalizeSubmissionResult(
        result
      );
    }

    /**
     * Alternative API.
     */
    if (
      typeof adapter.submit ===
      'function'
    ) {

      const result =
        await adapter.submit({
          report,
          tenantId:
            report.tenantId,
          reportType:
            report.type,
          submittedBy,
          jurisdiction:
            report.metadata?.jurisdiction,
        });

      return this.normalizeSubmissionResult(
        result
      );
    }

    /**
     * Adapter exists but does not support
     * external submission.
     *
     * Preserve compatibility while clearly
     * identifying internal submission mode.
     */
    return {
      submitted: true,

      mode:
        'internal',

      adapter:
        adapter.name ||
        adapter.providerName ||
        'REGULATORY_ADAPTER',

      jurisdiction:
        report.metadata?.jurisdiction ||
        this.config.defaultJurisdiction,
    };
  }

  /**
   * ==========================================================================
   * SUBMISSION RESULT NORMALIZATION
   * ==========================================================================
   */

  normalizeSubmissionResult(
    result
  ) {

    if (!result) {

      return {
        submitted: true,
      };
    }

    if (
      typeof result === 'boolean'
    ) {

      return {
        submitted:
          result,
      };
    }

    if (
      typeof result !== 'object'
    ) {

      return {
        submitted: true,
        result,
      };
    }

    return {
      submitted:
        result.submitted !== false,

      status:
        result.status ||
        result.state ||
        'submitted',

      regulatoryReference:
        result.regulatoryReference ||
        result.submissionReference ||
        result.reference ||
        null,

      acknowledgement:
        result.acknowledgement ||
        result.acknowledgment ||
        null,

      receivedAt:
        result.receivedAt ||
        new Date().toISOString(),

      provider:
        result.provider ||
        result.adapter ||
        null,

      message:
        result.message ||
        null,
    };
  }

  /**
   * ==========================================================================
   * SCHEDULING
   * ==========================================================================
   */

  async scheduleReport(
    payload,
    runAt
  ) {

    if (!this.queueService) {
      throw new Error(
        'Queue service is not configured.'
      );
    }

    if (!runAt) {
      throw new Error(
        'runAt is required.'
      );
    }

    const executionTime =
      new Date(runAt).getTime();

    if (
      Number.isNaN(
        executionTime
      )
    ) {

      throw new Error(
        'Invalid report execution date.'
      );
    }

    const delay =
      Math.max(
        0,
        executionTime -
          Date.now()
      );

    const jobPayload = {
      ...payload,

      scheduledAt:
        new Date().toISOString(),

      runAt:
        new Date(
          executionTime
        ).toISOString(),

      jobId:
        crypto.randomUUID(),
    };

    return this.queueService.enqueue(
      'regulatory-report',
      jobPayload,
      {
        delay,

        attempts:
          this.config
            .retryAttempts,
      }
    );
  }

  /**
   * ==========================================================================
   * REGULATORY CALENDAR
   * ==========================================================================
   */

  async getReportingCalendar({
    tenantId,
    from = null,
    to = null,
    jurisdiction = null,
  } = {}) {

    const adapter =
      await this.resolveRegulatoryAdapter({
        tenantId,
        jurisdiction,
      });

    if (
      !adapter
    ) {

      return [];
    }

    if (
      typeof adapter.getReportingCalendar ===
      'function'
    ) {

      return (
        await adapter.getReportingCalendar({
          tenantId,
          jurisdiction,
          from,
          to,
        })
      ) || [];
    }

    if (
      typeof adapter.getCalendar ===
      'function'
    ) {

      return (
        await adapter.getCalendar({
          tenantId,
          jurisdiction,
          from,
          to,
        })
      ) || [];
    }

    return [];
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  async getMetrics(
    tenantId = null
  ) {

    const scope =
      tenantId
        ? { tenantId }
        : {};

    const [
      total,
      pending,
      generated,
      approved,
      submitted,
      failed,
    ] = await Promise.all([

      this.db.regulatoryReports.count(
        scope
      ),

      this.db.regulatoryReports.count({
        ...scope,

        status:
          this.config.statuses.PENDING,
      }),

      this.db.regulatoryReports.count({
        ...scope,

        status:
          this.config.statuses.GENERATED,
      }),

      this.db.regulatoryReports.count({
        ...scope,

        status:
          this.config.statuses.APPROVED,
      }),

      this.db.regulatoryReports.count({
        ...scope,

        status:
          this.config.statuses.SUBMITTED,
      }),

      this.db.regulatoryReports.count({
        ...scope,

        status:
          this.config.statuses.FAILED,
      }),
    ]);

    return {
      total,
      pending,
      generated,
      approved,
      submitted,
      failed,

      adapterEnabled:
        this.isRegulatoryAdapterEnabled(),
    };
  }

  /**
   * ==========================================================================
   * REPORT RETRIEVAL
   * ==========================================================================
   */

  async getReport(
    reportId,
    tenantId = null
  ) {

    if (!reportId) {
      throw new Error(
        'Report ID is required.'
      );
    }

    const query = {
      id:
        reportId,
    };

    if (tenantId) {
      query.tenantId =
        tenantId;
    }

    if (
      this.db.regulatoryReports.findOne
    ) {

      return this.db
        .regulatoryReports
        .findOne(query);
    }

    return this.db
      .regulatoryReports
      .findById(
        reportId
      );
  }

  /**
   * ==========================================================================
   * INTEGRITY VERIFICATION
   * ==========================================================================
   */

  verifyReportIntegrity(
    report
  ) {

    if (
      !report ||
      !report.integrityHash
    ) {
      return false;
    }

    const expected =
      this.calculateIntegrityHash(
        report
      );

    const actualBuffer =
      Buffer.from(
        String(
          report.integrityHash
        ),
        'utf8'
      );

    const expectedBuffer =
      Buffer.from(
        String(expected),
        'utf8'
      );

    if (
      actualBuffer.length !==
      expectedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer
    );
  }

  /**
   * ==========================================================================
   * DATABASE HELPERS
   * ==========================================================================
   */

  async findTransactions(
    query
  ) {

    return this.findRecords(
      'transactions',
      query
    );
  }

  async findRecords(
    collectionName,
    query
  ) {

    const collection =
      this.db[
        collectionName
      ];

    if (!collection) {
      throw new Error(
        `Database collection "${collectionName}" is unavailable.`
      );
    }

    let result =
      await collection.find(
        query
      );

    /**
     * Support both direct arrays and
     * query-builder style implementations.
     */
    if (
      result &&
      typeof result.limit ===
      'function'
    ) {

      result =
        await result
          .limit(
            this.config
              .maxReportRecords
          )
          .exec();
    }

    if (
      !Array.isArray(result)
    ) {

      result = [];
    }

    if (
      result.length >
      this.config.maxReportRecords
    ) {

      throw new Error(
        `Report exceeds maximum supported record count of ${this.config.maxReportRecords}.`
      );
    }

    return result;
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY
   * ==========================================================================
   */

  async findIdempotentReport(
    tenantId,
    idempotencyKey
  ) {

    if (
      !idempotencyKey ||
      !this.db.regulatoryReports
    ) {
      return null;
    }

    const query = {
      tenantId,
      idempotencyKey,
    };

    if (
      typeof this.db
        .regulatoryReports
        .findOne ===
      'function'
    ) {

      return this.db
        .regulatoryReports
        .findOne(
          query
        );
    }

    return null;
  }

  /**
   * ==========================================================================
   * REPORT FAILURE
   * ==========================================================================
   */

  async markReportFailed(
    report,
    error
  ) {

    try {

      report.status =
        this.config.statuses.FAILED;

      report.failureReason =
        this.safeErrorMessage(
          error
        );

      report.failedAt =
        new Date();

      report.updatedAt =
        new Date();

      report.version =
        Number(
          report.version || 1
        ) + 1;

      report.integrityHash =
        this.calculateIntegrityHash(
          report
        );

      await this.db.regulatoryReports.update(
        report.id,
        report
      );

      await this.audit(
        report.tenantId,
        null,
        'REGULATORY_REPORT_FAILED',
        {
          reportId:
            report.id,

          error:
            report.failureReason,
        }
      );

      this.incrementMetric(
        'regulatory_reports_failed'
      );

    } catch (auditError) {

      this.logError(
        'Failed to mark regulatory report as failed',
        auditError
      );
    }
  }

  /**
   * ==========================================================================
   * ATOMIC FILE WRITE
   * ==========================================================================
   */

  async atomicWrite(
    filePath,
    content
  ) {

    const directory =
      path.dirname(
        filePath
      );

    await fs.mkdir(
      directory,
      {
        recursive: true,
        mode: 0o750,
      }
    );

    if (
      !this.config.atomicWrites
    ) {

      await fs.writeFile(
        filePath,
        content,
        {
          encoding:
            'utf8',

          mode:
            0o640,
        }
      );

      return;
    }

    const temporaryPath =
      `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

    try {

      await fs.writeFile(
        temporaryPath,
        content,
        {
          encoding:
            'utf8',

          mode:
            0o640,
        }
      );

      await fs.rename(
        temporaryPath,
        filePath
      );

    } catch (error) {

      try {
        await fs.unlink(
          temporaryPath
        );
      } catch (_) {
        // Ignore cleanup failure.
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * PAYLOAD SANITIZATION
   * ==========================================================================
   */

  sanitizePayload(
    value,
    seen = new WeakSet()
  ) {

    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      typeof value ===
      'string'
    ) {
      return value;
    }

    if (
      typeof value ===
      'number' ||
      typeof value ===
      'boolean'
    ) {
      return value;
    }

    if (
      value instanceof Date
    ) {
      return value.toISOString();
    }

    if (
      Buffer.isBuffer(
        value
      )
    ) {

      return value.toString(
        'base64'
      );
    }

    if (
      typeof value !==
      'object'
    ) {

      return String(
        value
      );
    }

    if (
      seen.has(value)
    ) {

      return '[Circular]';
    }

    seen.add(value);

    if (
      Array.isArray(value)
    ) {

      return value.map(
        (item) =>
          this.sanitizePayload(
            item,
            seen
          )
      );
    }

    const output = {};

    for (
      const [
        key,
        nestedValue,
      ]
      of Object.entries(value)
    ) {

      if (
        this.isSensitiveField(
          key
        )
      ) {

        output[key] =
          '[REDACTED]';

        continue;
      }

      output[key] =
        this.sanitizePayload(
          nestedValue,
          seen
        );
    }

    return output;
  }

  /**
   * ==========================================================================
   * SENSITIVE FIELD DETECTION
   * ==========================================================================
   */

  isSensitiveField(
    field
  ) {

    const normalized =
      String(field)
        .toLowerCase();

    return this.config
      .sensitiveFields
      .some(
        (sensitiveField) =>
          normalized ===
          String(
            sensitiveField
          ).toLowerCase()
      );
  }

  /**
   * ==========================================================================
   * JSON REPLACER
   * ==========================================================================
   */

  jsonReplacer(
    key,
    value
  ) {

    if (
      this.isSensitiveField(
        key
      )
    ) {

      return '[REDACTED]';
    }

    if (
      value instanceof Date
    ) {

      return value.toISOString();
    }

    return value;
  }

  /**
   * ==========================================================================
   * FLATTEN OBJECT
   * ==========================================================================
   */

  flattenObject(
    object,
    prefix = '',
    result = {}
  ) {

    if (
      object === null ||
      object === undefined
    ) {

      result[prefix] =
        object;

      return result;
    }

    if (
      typeof object !==
      'object' ||
      object instanceof Date
    ) {

      result[prefix] =
        object;

      return result;
    }

    if (
      Array.isArray(object)
    ) {

      object.forEach(
        (value, index) => {

          this.flattenObject(
            value,
            `${prefix}[${index}]`,
            result
          );
        }
      );

      return result;
    }

    for (
      const [
        key,
        value,
      ]
      of Object.entries(object)
    ) {

      const nextPrefix =
        prefix
          ? `${prefix}.${key}`
          : key;

      if (
        value !== null &&
        typeof value ===
        'object' &&
        !(value instanceof Date)
      ) {

        this.flattenObject(
          value,
          nextPrefix,
          result
        );

      } else {

        result[nextPrefix] =
          value;
      }
    }

    return result;
  }

  /**
   * ==========================================================================
   * XML SERIALIZATION
   * ==========================================================================
   */

  objectToXML(
    value,
    nodeName
  ) {

    const safeNode =
      this.sanitizeXMLNodeName(
        nodeName
      );

    if (
      value === null ||
      value === undefined
    ) {

      return `<${safeNode}></${safeNode}>`;
    }

    if (
      typeof value !==
      'object'
    ) {

      return `<${safeNode}>${this.escapeXML(
        value
      )}</${safeNode}>`;
    }

    if (
      Array.isArray(value)
    ) {

      return value
        .map(
          (item) =>
            this.objectToXML(
              item,
              safeNode
            )
        )
        .join('');
    }

    const children =
      Object.entries(value)
        .map(
          ([
            key,
            nested,
          ]) =>
            this.objectToXML(
              nested,
              key
            )
        )
        .join('');

    return `<${safeNode}>${children}</${safeNode}>`;
  }

  /**
   * ==========================================================================
   * XML NODE NAME SANITIZATION
   * ==========================================================================
   */

  sanitizeXMLNodeName(
    value
  ) {

    let name =
      String(value)
        .replace(
          /[^a-zA-Z0-9_.-]/g,
          '_'
        );

    if (
      /^[0-9.-]/.test(
        name
      )
    ) {

      name =
        `field_${name}`;
    }

    return (
      name ||
      'field'
    );
  }

  /**
   * ==========================================================================
   * XML / CSV ESCAPING
   * ==========================================================================
   */

  escapeXML(
    value
  ) {

    return String(value)
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&apos;'
      );
  }

  escapeCSV(
    value
  ) {

    const stringValue =
      value === null ||
      value === undefined
        ? ''
        : String(value);

    return `"${stringValue.replace(
      /"/g,
      '""'
    )}"`;
  }

  csvSafeValue(
    value
  ) {

    if (
      value === null ||
      value === undefined
    ) {

      return '';
    }

    if (
      typeof value ===
      'object'
    ) {

      return JSON.stringify(
        value
      );
    }

    return value;
  }

  /**
   * ==========================================================================
   * INTEGRITY HASHING
   * ==========================================================================
   */

  calculateIntegrityHash(
    report
  ) {

    const canonical =
      JSON.stringify({
        id:
          report.id,

        tenantId:
          report.tenantId,

        type:
          report.type,

        status:
          report.status,

        version:
          report.version,

        payload:
          report.payload,

        metadata:
          report.metadata,

        generatedBy:
          report.generatedBy,

        approvedBy:
          report.approvedBy,

        submittedBy:
          report.submittedBy,

        submission:
          report.submission,
      });

    return crypto
      .createHash(
        'sha256'
      )
      .update(
        canonical
      )
      .digest('hex');
  }

  calculateBufferHash(
    content
  ) {

    return crypto
      .createHash(
        'sha256'
      )
      .update(
        content
      )
      .digest('hex');
  }

  /**
   * ==========================================================================
   * PATH SECURITY
   * ==========================================================================
   */

  resolveSafeReportPath(
    fileName
  ) {

    const safeName =
      path.basename(
        fileName
      );

    const base =
      path.resolve(
        this.config
          .reportsDirectory
      );

    const resolved =
      path.resolve(
        base,
        safeName
      );

    if (
      !resolved.startsWith(
        `${base}${path.sep}`
      )
    ) {

      throw new Error(
        'Invalid report file path.'
      );
    }

    return resolved;
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validateTenantId(
    tenantId
  ) {

    if (
      !tenantId ||
      typeof tenantId !==
      'string'
    ) {

      throw new Error(
        'tenantId is required.'
      );
    }
  }

  validateActor(
    actor
  ) {

    if (
      !actor ||
      typeof actor !==
      'string'
    ) {

      throw new Error(
        'A valid actor is required.'
      );
    }
  }

  validateReportType(
    type
  ) {

    if (
      !this.config
        .allowedReportTypes
        .includes(type)
    ) {

      throw new Error(
        `Unsupported regulatory report type: ${type}`
      );
    }
  }

  validateExportFormat(
    format
  ) {

    if (
      !this.config
        .exportFormats
        .includes(format)
    ) {

      throw new Error(
        `Unsupported report export format: ${format}`
      );
    }
  }

  validateDateRange(
    from,
    to
  ) {

    const start =
      new Date(from);

    const end =
      new Date(to);

    if (
      Number.isNaN(
        start.getTime()
      ) ||
      Number.isNaN(
        end.getTime()
      )
    ) {

      throw new Error(
        'Valid from and to dates are required.'
      );
    }

    if (
      start > end
    ) {

      throw new Error(
        'Report start date cannot be after the end date.'
      );
    }
  }

  assertPayloadSize(
    payload
  ) {

    const serialized =
      typeof payload ===
      'string'
        ? payload
        : JSON.stringify(
            payload
          );

    const bytes =
      Buffer.byteLength(
        serialized || '',
        'utf8'
      );

    if (
      bytes >
      this.config.maxPayloadBytes
    ) {

      throw new Error(
        `Report payload exceeds maximum size of ${this.config.maxPayloadBytes} bytes.`
      );
    }
  }

  /**
   * ==========================================================================
   * NOTIFICATIONS
   * ==========================================================================
   */

  async sendSubmissionNotification(
    report
  ) {

    if (
      !this.notificationService ||
      typeof this
        .notificationService
        .send !==
      'function'
    ) {

      return;
    }

    try {

      await this.notificationService.send(
        {
          tenantId:
            report.tenantId,

          type:
            'regulatory_report_submitted',

          channel:
            'in_app',

          subject:
            'Regulatory Report Submitted',

          message:
            `${report.type} report submitted successfully.`,

          metadata: {
            reportId:
              report.id,

            jurisdiction:
              report.metadata?.jurisdiction,
          },
        }
      );

    } catch (error) {

      this.logError(
        'Regulatory report notification failed',
        error
      );
    }
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async audit(
    tenantId,
    customerId,
    action,
    payload
  ) {

    if (
      !this.auditService
    ) {

      return;
    }

    try {

      await this.auditService.log(
        {
          tenantId,

          customerId,

          action,

          payload,

          timestamp:
            new Date(),
        }
      );

    } catch (error) {

      this.logError(
        'Regulatory report audit failed',
        error
      );
    }
  }

  /**
   * ==========================================================================
   * METRICS ADAPTER
   * ==========================================================================
   */

  incrementMetric(
    name,
    value = 1
  ) {

    try {

      if (
        !this.metricsService
      ) {
        return;
      }

      if (
        typeof this
          .metricsService
          .increment ===
        'function'
      ) {

        this.metricsService.increment(
          name,
          value
        );

        return;
      }

      if (
        typeof this
          .metricsService
          .inc ===
        'function'
      ) {

        this.metricsService.inc(
          name,
          value
        );
      }

    } catch (error) {

      this.logError(
        'Regulatory reporting metric update failed',
        error
      );
    }
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  logInfo(
    message,
    metadata = {}
  ) {

    try {

      if (
        typeof this.logger
          ?.info ===
        'function'
      ) {

        this.logger.info(
          message,
          metadata
        );

        return;
      }

      console.info(
        message,
        metadata
      );

    } catch (_) {
      // Logging must never break regulatory processing.
    }
  }

  logError(
    message,
    error
  ) {

    try {

      const payload = {
        message,

        error:
          this.safeErrorMessage(
            error
          ),
      };

      if (
        typeof this.logger
          ?.error ===
        'function'
      ) {

        this.logger.error(
          message,
          payload
        );

        return;
      }

      console.error(
        message,
        payload
      );

    } catch (_) {
      // Logging must never break regulatory processing.
    }
  }

  safeErrorMessage(
    error
  ) {

    if (!error) {
      return 'Unknown error';
    }

    return (
      error.message ||
      String(error)
    );
  }
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  RegulatoryReportingService;
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Module Index
 * ============================================================================
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Enterprise entry point for the MTN Settlement & Reconciliation subsystem.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * • Centralize exports for all settlement components
 * • Provide a stable public module surface
 * • Support dependency injection
 * • Enable tree-shake friendly imports
 * • Preserve backward compatibility
 * • Validate module loading during bootstrap
 * • Expose version/build metadata
 *
 * This module intentionally contains NO business logic.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                     Settlement Engine
 *                             │
 *          ┌──────────────────┼──────────────────┐
 *          │                  │                  │
 *          ▼                  ▼                  ▼
 *   Statement Import    Repository        Ledger Reconciler
 *          │                  │                  │
 *          └──────────────┬───┴──────────────────┘
 *                         ▼
 *                 Settlement Matcher
 *                         │
 *                         ▼
 *                 Variance Detector
 *                         │
 *                         ▼
 *                 Recovery Manager
 *                         │
 *                         ▼
 *                Settlement Report
 *                         │
 *                         ▼
 *            Audit / Metrics / Scheduler
 *
 * Public Exports
 * ----------------------------------------------------------------------------
 * Core
 *  • SettlementEngine
 *  • SettlementRepository
 *
 * Matching
 *  • SettlementMatcher
 *  • VarianceDetector
 *
 * Reporting
 *  • SettlementReport
 *  • ReconciliationAudit
 *  • ReconciliationMetrics
 *
 * Policies
 *  • ReconciliationPolicy
 *  • SettlementConstants
 *  • SettlementErrors
 *
 * Integration
 *  • ProviderStatementImporter
 *  • LedgerReconciler
 *  • RecoveryManager
 *
 * Scheduling
 *  • SettlementScheduler
 *
 * Enterprise Characteristics
 * ----------------------------------------------------------------------------
 * • Production-grade
 * • Tenant-aware
 * • Observable
 * • Auditable
 * • Backward compatible
 * • Dependency Injection friendly
 * • Immutable exports
 * • Circular dependency resistant
 * ============================================================================
 */

const path = require('path');

/**
 * ============================================================================
 * Internal Loader
 * ============================================================================
 */

function load(moduleName) {
    try {
        return require(path.join(__dirname, moduleName));
    } catch (error) {
        error.message =
            `Failed to load settlement module "${moduleName}". ${error.message}`;
        throw error;
    }
}

/**
 * ============================================================================
 * Core
 * ============================================================================
 */

const SettlementEngine = load('./settlementEngine');
const SettlementRepository = load('./settlementRepository');

/**
 * ============================================================================
 * Matching & Reconciliation
 * ============================================================================
 */

const SettlementMatcher = load('./settlementMatcher');
const VarianceDetector = load('./varianceDetector');
const LedgerReconciler = load('./ledgerReconciler');

/**
 * ============================================================================
 * Import & Recovery
 * ============================================================================
 */

const ProviderStatementImporter = load('./providerStatementImporter');
const RecoveryManager = load('./recoveryManager');

/**
 * ============================================================================
 * Reporting
 * ============================================================================
 */

const SettlementReport = load('./settlementReport');
const ReconciliationAudit = load('./reconciliationAudit');
const ReconciliationMetrics = load('./reconciliationMetrics');

/**
 * ============================================================================
 * Scheduling
 * ============================================================================
 */

const SettlementScheduler = load('./settlementScheduler');

/**
 * ============================================================================
 * Policies / Constants / Errors
 * ============================================================================
 */

const ReconciliationPolicy = load('./reconciliationPolicy');
const SettlementConstants = load('./settlementConstants');
const SettlementErrors = load('./settlementErrors');

/**
 * ============================================================================
 * Version Metadata
 * ============================================================================
 */

const MODULE_NAME = 'payment.mtn.settlement';
const MODULE_VERSION = '1.0.0';

/**
 * ============================================================================
 * Health Helper
 * ============================================================================
 */

function health() {
    return {
        module: MODULE_NAME,
        version: MODULE_VERSION,
        status: 'UP',
        timestamp: new Date().toISOString()
    };
}

/**
 * ============================================================================
 * Module Registry
 * ============================================================================
 */

const registry = Object.freeze({

    core: Object.freeze({
        SettlementEngine,
        SettlementRepository
    }),

    reconciliation: Object.freeze({
        SettlementMatcher,
        VarianceDetector,
        LedgerReconciler
    }),

    reporting: Object.freeze({
        SettlementReport,
        ReconciliationAudit,
        ReconciliationMetrics
    }),

    integration: Object.freeze({
        ProviderStatementImporter,
        RecoveryManager
    }),

    scheduling: Object.freeze({
        SettlementScheduler
    }),

    configuration: Object.freeze({
        ReconciliationPolicy,
        SettlementConstants,
        SettlementErrors
    })

});

/**
 * ============================================================================
 * Public Exports
 * ============================================================================
 */

module.exports = Object.freeze({

    /**
     * Metadata
     */
    MODULE_NAME,
    MODULE_VERSION,
    health,

    /**
     * Registry
     */
    registry,

    /**
     * Core
     */
    SettlementEngine,
    SettlementRepository,

    /**
     * Matching & Variance
     */
    SettlementMatcher,
    VarianceDetector,
    LedgerReconciler,

    /**
     * Reporting
     */
    SettlementReport,
    ReconciliationAudit,
    ReconciliationMetrics,

    /**
     * Policies
     */
    ReconciliationPolicy,
    SettlementConstants,
    SettlementErrors,

    /**
     * Import & Recovery
     */
    ProviderStatementImporter,
    RecoveryManager,

    /**
     * Scheduling
     */
    SettlementScheduler

});
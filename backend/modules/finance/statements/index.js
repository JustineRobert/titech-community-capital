'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ============================================================================
 *
 * Statement Intelligence & Financial Statement Processing Public API
 *
 * File:
 *   backend/modules/finance/statements/index.js
 *
 * Purpose:
 *   Central public entry point for the statement-processing subsystem.
 *
 * Design goals:
 *   - Enterprise production readiness
 *   - Stable public API
 *   - Lazy module loading
 *   - Circular dependency protection
 *   - Explicit module registry
 *   - No silent dependency failures
 *   - Clear subsystem boundaries
 *   - Backward-compatible CommonJS exports
 *   - Operational diagnostics
 *
 * Architectural domains exposed:
 *
 *   statements
 *      ├── processing
 *      ├── reconciliation
 *      ├── repair
 *      ├── forecasting
 *      ├── ai
 *      ├── fraud
 *      ├── operations
 *      ├── reporting
 *      └── models
 *
 * IMPORTANT:
 *   This file is intentionally an API boundary.
 *
 *   Internal modules should NOT import this index when they need to
 *   communicate with one another. They should import their concrete
 *   dependencies directly to minimize circular dependencies.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Runtime Metadata
 * ============================================================================
 */

const MODULE_NAME = 'finance-statements';

const MODULE_VERSION = '1.0.0';

const MODULE_STATUS = 'production';

const MODULE_PATH =
    'backend/modules/finance/statements';

/**
 * ============================================================================
 * Module Registry
 * ============================================================================
 *
 * Every exposed module is declared explicitly.
 *
 * Lazy loading is used so importing this index does not immediately execute
 * every AI, fraud, forecasting, reporting, or operational engine.
 *
 * This is especially important for:
 *
 *   - application startup
 *   - worker processes
 *   - CLI processes
 *   - unit tests
 *   - migration scripts
 *   - health checks
 *   - isolated background jobs
 *
 * The registry intentionally contains paths relative to this file.
 * ============================================================================
 */

const MODULE_DEFINITIONS = Object.freeze({

    /**
     * ------------------------------------------------------------------------
     * Core Statement Processing
     * ------------------------------------------------------------------------
     */

    StatementProcessor: './StatementProcessor',

    StatementReconciliationService:
        './StatementReconciliationService',

    StatementRepairService:
        './StatementRepairService',

    /**
     * ------------------------------------------------------------------------
     * Forecasting
     * ------------------------------------------------------------------------
     */

    RepairForecastEngine:
        './forecasting/RepairForecastEngine',

    SettlementReliabilityEngine:
        './forecasting/SettlementReliabilityEngine',

    PredictiveRepairScheduler:
        './forecasting/PredictiveRepairScheduler',

    ForecastModels:
        './forecasting/ForecastModels',

    /**
     * ------------------------------------------------------------------------
     * AI / Intelligent Repair
     * ------------------------------------------------------------------------
     */

    AIConfidenceScorer:
        './ai/AIConfidenceScorer',

    AIRepairClassifier:
        './ai/AIRepairClassifier',

    AIRepairRecommendationEngine:
        './ai/AIRepairRecommendationEngine',

    FeatureExtractor:
        './ai/FeatureExtractor',

    ModelRegistry:
        './ai/ModelRegistry',

    PromptTemplates:
        './ai/PromptTemplates',

    /**
     * ------------------------------------------------------------------------
     * Fraud Intelligence
     * ------------------------------------------------------------------------
     */

    CrossAccountAnalyzer:
        './fraud/CrossAccountAnalyzer',

    FraudAlertService:
        './fraud/FraudAlertService',

    FraudCorrelationEngine:
        './fraud/FraudCorrelationEngine',

    FraudPatternDetector:
        './fraud/FraudPatternDetector',

    SuspiciousRepairScorer:
        './fraud/SuspiciousRepairScorer',

    /**
     * ------------------------------------------------------------------------
     * Operational Intelligence
     * ------------------------------------------------------------------------
     */

    BranchPerformanceAnalyzer:
        './operations/BranchPerformanceAnalyzer',

    CapacityPlanner:
        './operations/CapacityPlanner',

    OperationalBenchmarkService:
        './operations/OperationalBenchmarkService',

    TeamPerformanceAnalyzer:
        './operations/TeamPerformanceAnalyzer',

    WorkloadBalancer:
        './operations/WorkloadBalancer',

    /**
     * ------------------------------------------------------------------------
     * Reporting
     * ------------------------------------------------------------------------
     */

    BoardReportingService:
        './reporting/BoardReportingService',

    DashboardAggregator:
        './reporting/DashboardAggregator',

    ExecutiveReportingExporter:
        './reporting/ExecutiveReportingExporter',

    KPIReportGenerator:
        './reporting/KPIReportGenerator',

    RegulatoryReportingService:
        './reporting/RegulatoryReportingService',

    /**
     * ------------------------------------------------------------------------
     * Models
     * ------------------------------------------------------------------------
     */

    BenchmarkResult:
        './models/BenchmarkResult',

    FraudCorrelation:
        './models/FraudCorrelation',

    OperationalMetrics:
        './models/OperationalMetrics',

    RepairAnalyticsSnapshot:
        './models/RepairAnalyticsSnapshot',

    RepairForecast:
        './models/RepairForecast'

});

/**
 * ============================================================================
 * Namespace Definitions
 * ============================================================================
 *
 * These namespaces provide a clean API for consumers that prefer grouped
 * access over flat imports.
 *
 * Example:
 *
 *   const {
 *       forecasting
 *   } = require('./finance/statements');
 *
 *   const engine =
 *       new forecasting.RepairForecastEngine();
 *
 * ============================================================================
 */

const NAMESPACE_DEFINITIONS = Object.freeze({

    processing: Object.freeze([
        'StatementProcessor',
        'StatementReconciliationService',
        'StatementRepairService'
    ]),

    forecasting: Object.freeze([
        'RepairForecastEngine',
        'SettlementReliabilityEngine',
        'PredictiveRepairScheduler',
        'ForecastModels'
    ]),

    ai: Object.freeze([
        'AIConfidenceScorer',
        'AIRepairClassifier',
        'AIRepairRecommendationEngine',
        'FeatureExtractor',
        'ModelRegistry',
        'PromptTemplates'
    ]),

    fraud: Object.freeze([
        'CrossAccountAnalyzer',
        'FraudAlertService',
        'FraudCorrelationEngine',
        'FraudPatternDetector',
        'SuspiciousRepairScorer'
    ]),

    operations: Object.freeze([
        'BranchPerformanceAnalyzer',
        'CapacityPlanner',
        'OperationalBenchmarkService',
        'TeamPerformanceAnalyzer',
        'WorkloadBalancer'
    ]),

    reporting: Object.freeze([
        'BoardReportingService',
        'DashboardAggregator',
        'ExecutiveReportingExporter',
        'KPIReportGenerator',
        'RegulatoryReportingService'
    ]),

    models: Object.freeze([
        'BenchmarkResult',
        'FraudCorrelation',
        'OperationalMetrics',
        'RepairAnalyticsSnapshot',
        'RepairForecast'
    ])

});

/**
 * ============================================================================
 * Internal Module Cache
 * ============================================================================
 *
 * The cache prevents repeated require() calls and provides deterministic
 * singleton module loading for CommonJS exports.
 * ============================================================================
 */

const moduleCache = new Map();

/**
 * ============================================================================
 * Internal Validation
 * ============================================================================
 */

function assertModuleName(moduleName) {

    if (
        typeof moduleName !== 'string' ||
        moduleName.trim() === ''
    ) {
        throw new TypeError(
            'Statement module name must be a non-empty string.'
        );
    }

}

/**
 * ============================================================================
 * Load Module
 * ============================================================================
 *
 * Loads a registered module lazily.
 *
 * Errors are intentionally NOT swallowed.
 *
 * If a production dependency is malformed, missing, or throws during module
 * initialization, the caller must receive the original failure rather than
 * silently receiving an incomplete subsystem.
 *
 * ============================================================================
 */

function loadModule(moduleName) {

    assertModuleName(moduleName);

    const definition =
        MODULE_DEFINITIONS[moduleName];

    if (!definition) {

        const available =
            Object.keys(
                MODULE_DEFINITIONS
            ).join(', ');

        throw new Error(
            `Unknown finance statements module "${moduleName}". ` +
            `Available modules: ${available}`
        );

    }

    if (
        moduleCache.has(moduleName)
    ) {
        return moduleCache.get(moduleName);
    }

    let loadedModule;

    try {

        loadedModule =
            require(definition);

    } catch (error) {

        const wrappedError =
            new Error(
                `Failed to load finance statements module ` +
                `"${moduleName}" from "${definition}": ` +
                `${error.message}`
            );

        wrappedError.code =
            'FINANCE_STATEMENTS_MODULE_LOAD_ERROR';

        wrappedError.moduleName =
            moduleName;

        wrappedError.modulePath =
            definition;

        wrappedError.cause =
            error;

        throw wrappedError;
    }

    moduleCache.set(
        moduleName,
        loadedModule
    );

    return loadedModule;

}

/**
 * ============================================================================
 * Public Module Resolver
 * ============================================================================
 *
 * Allows infrastructure components, tests, diagnostics, and workers to
 * resolve a module without bypassing the public registry.
 *
 * Example:
 *
 *   const statements =
 *       require('./finance/statements');
 *
 *   const Engine =
 *       statements.getModule(
 *           'RepairForecastEngine'
 *       );
 *
 * ============================================================================
 */

function getModule(moduleName) {

    return loadModule(
        moduleName
    );

}

/**
 * ============================================================================
 * Module Availability
 * ============================================================================
 *
 * Checks whether a module is registered.
 *
 * This does NOT load the module.
 *
 * ============================================================================
 */

function hasModule(moduleName) {

    if (
        typeof moduleName !== 'string'
    ) {
        return false;
    }

    return Object.prototype.hasOwnProperty.call(
        MODULE_DEFINITIONS,
        moduleName
    );

}

/**
 * ============================================================================
 * List Registered Modules
 * ============================================================================
 */

function listModules() {

    return Object.keys(
        MODULE_DEFINITIONS
    );

}

/**
 * ============================================================================
 * List Namespaces
 * ============================================================================
 */

function listNamespaces() {

    return Object.keys(
        NAMESPACE_DEFINITIONS
    );

}

/**
 * ============================================================================
 * Get Namespace Members
 * ============================================================================
 */

function getNamespaceMembers(
    namespace
) {

    if (
        typeof namespace !== 'string' ||
        namespace.trim() === ''
    ) {
        throw new TypeError(
            'Statement namespace must be a non-empty string.'
        );
    }

    const members =
        NAMESPACE_DEFINITIONS[
            namespace
        ];

    if (!members) {

        throw new Error(
            `Unknown finance statements namespace "${namespace}".`
        );

    }

    return [
        ...members
    ];

}

/**
 * ============================================================================
 * Namespace Builder
 * ============================================================================
 *
 * Builds lazy namespaces.
 *
 * Example:
 *
 *   statements.fraud.FraudCorrelationEngine
 *
 * The actual module is loaded only when the property is accessed.
 * ============================================================================
 */

function createLazyNamespace(
    namespace
) {

    const members =
        getNamespaceMembers(
            namespace
        );

    const namespaceObject = {};

    for (
        const moduleName of members
    ) {

        Object.defineProperty(
            namespaceObject,
            moduleName,
            {
                enumerable: true,

                configurable: false,

                get() {

                    return loadModule(
                        moduleName
                    );

                }
            }
        );

    }

    Object.defineProperty(
        namespaceObject,
        'namespace',
        {
            enumerable: false,
            configurable: false,
            writable: false,
            value: namespace
        }
    );

    Object.defineProperty(
        namespaceObject,
        'listModules',
        {
            enumerable: false,
            configurable: false,
            writable: false,
            value() {

                return [
                    ...members
                ];

            }
        }
    );

    return Object.freeze(
        namespaceObject
    );

}

/**
 * ============================================================================
 * Namespace Cache
 * ============================================================================
 */

const namespaceCache =
    new Map();

/**
 * ============================================================================
 * Get Namespace
 * ============================================================================
 */

function getNamespace(
    namespace
) {

    if (
        namespaceCache.has(
            namespace
        )
    ) {
        return namespaceCache.get(
            namespace
        );
    }

    const namespaceObject =
        createLazyNamespace(
            namespace
        );

    namespaceCache.set(
        namespace,
        namespaceObject
    );

    return namespaceObject;

}

/**
 * ============================================================================
 * Build Public API
 * ============================================================================
 *
 * The public API is constructed with lazy getters.
 *
 * This means:
 *
 *   const statements =
 *       require('./finance/statements');
 *
 * does NOT load all 30+ intelligence modules immediately.
 *
 * ============================================================================
 */

const publicAPI = {};

/**
 * ---------------------------------------------------------------------------
 * Metadata
 * ---------------------------------------------------------------------------
 */

Object.defineProperties(
    publicAPI,
    {

        moduleName: {
            enumerable: true,
            configurable: false,
            writable: false,
            value: MODULE_NAME
        },

        version: {
            enumerable: true,
            configurable: false,
            writable: false,
            value: MODULE_VERSION
        },

        status: {
            enumerable: true,
            configurable: false,
            writable: false,
            value: MODULE_STATUS
        },

        path: {
            enumerable: true,
            configurable: false,
            writable: false,
            value: MODULE_PATH
        }

    }
);

/**
 * ---------------------------------------------------------------------------
 * Public Module Getters
 * ---------------------------------------------------------------------------
 */

for (
    const moduleName of
    Object.keys(
        MODULE_DEFINITIONS
    )
) {

    Object.defineProperty(
        publicAPI,
        moduleName,
        {

            enumerable: true,

            configurable: false,

            get() {

                return loadModule(
                    moduleName
                );

            }

        }
    );

}

/**
 * ---------------------------------------------------------------------------
 * Public Namespaces
 * ---------------------------------------------------------------------------
 */

for (
    const namespace of
    Object.keys(
        NAMESPACE_DEFINITIONS
    )
) {

    Object.defineProperty(
        publicAPI,
        namespace,
        {

            enumerable: true,

            configurable: false,

            get() {

                return getNamespace(
                    namespace
                );

            }

        }
    );

}

/**
 * ============================================================================
 * Public Utility API
 * ============================================================================
 */

Object.defineProperties(
    publicAPI,
    {

        getModule: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: getModule
        },

        hasModule: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: hasModule
        },

        listModules: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: listModules
        },

        listNamespaces: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: listNamespaces
        },

        getNamespaceMembers: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: getNamespaceMembers
        },

        getNamespace: {
            enumerable: false,
            configurable: false,
            writable: false,
            value: getNamespace
        }

    }
);

/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 *
 * Returns operational information without forcing every registered module to
 * load.
 *
 * This is intentionally lightweight enough for health/readiness diagnostics.
 * ============================================================================
 */

Object.defineProperty(
    publicAPI,
    'getDiagnostics',
    {

        enumerable: false,

        configurable: false,

        writable: false,

        value() {

            const registeredModules =
                listModules();

            const loadedModules =
                registeredModules.filter(
                    (moduleName) =>
                        moduleCache.has(
                            moduleName
                        )
                );

            return {

                moduleName:
                    MODULE_NAME,

                version:
                    MODULE_VERSION,

                status:
                    MODULE_STATUS,

                path:
                    MODULE_PATH,

                registeredModuleCount:
                    registeredModules.length,

                loadedModuleCount:
                    loadedModules.length,

                registeredModules,

                loadedModules,

                namespaces:
                    listNamespaces(),

                cache:
                    {
                        enabled: true
                    },

                lazyLoading:
                    true

            };

        }

    }
);

/**
 * ============================================================================
 * Module Cache Control
 * ============================================================================
 *
 * Primarily intended for:
 *
 *   - controlled test isolation
 *   - worker lifecycle management
 *   - administrative diagnostics
 *
 * It should NOT normally be called during normal request processing.
 * ============================================================================
 */

Object.defineProperty(
    publicAPI,
    'clearCache',
    {

        enumerable: false,

        configurable: false,

        writable: false,

        value(moduleName) {

            if (
                moduleName === undefined ||
                moduleName === null
            ) {

                moduleCache.clear();

                return true;

            }

            assertModuleName(
                moduleName
            );

            if (
                !hasModule(
                    moduleName
                )
            ) {

                throw new Error(
                    `Cannot clear cache for unknown ` +
                    `finance statements module "${moduleName}".`
                );

            }

            return moduleCache.delete(
                moduleName
            );

        }

    }
);

/**
 * ============================================================================
 * Freeze Public API
 * ============================================================================
 *
 * The API object itself is frozen after all lazy properties have been defined.
 *
 * Individual modules remain owned by their respective implementations.
 * ============================================================================
 */

module.exports =
    Object.freeze(
        publicAPI
    );
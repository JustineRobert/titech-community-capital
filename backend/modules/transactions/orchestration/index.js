"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Transaction Orchestration Module
 * ============================================================================
 *
 * File:
 * backend/modules/transactions/orchestration/index.js
 *
 * Enterprise Transaction Orchestration Registry
 * ============================================================================
 *
 * PURPOSE
 * ----------------------------------------------------------------------------
 * Central entry point for the transaction orchestration subsystem.
 *
 * This module provides a stable integration boundary for:
 *
 *   • AuditCorrelationManager
 *   • CompensationOrchestrator
 *   • ConsistencyValidator
 *
 * It deliberately does NOT own financial transaction processing.
 *
 * Financial authority remains with the appropriate transaction / ledger
 * services. This module coordinates orchestration concerns only.
 *
 * ============================================================================
 * DESIGN PRINCIPLES
 * ----------------------------------------------------------------------------
 *
 * 1. Preserve existing CommonJS architecture.
 * 2. Preserve singleton service compatibility.
 * 3. Expose named classes where available.
 * 4. Avoid creating duplicate service instances.
 * 5. Keep orchestration modules independently testable.
 * 6. Prevent hidden side effects during module loading.
 * 7. Provide deterministic service discovery.
 * 8. Provide runtime health/introspection.
 * 9. Avoid swallowing initialization failures.
 * 10. Never mutate financial records directly.
 *
 * ============================================================================
 * INTEGRATION BOUNDARY
 * ----------------------------------------------------------------------------
 *
 * Expected structure:
 *
 * backend/modules/transactions/
 *
 * ├── orchestration/
 * │   ├── AuditCorrelationManager.js
 * │   ├── CompensationOrchestrator.js
 * │   ├── ConsistencyValidator.js
 * │   └── index.js
 * │
 * ├── DistributedTransactionManager.js
 * └── ...
 *
 * ============================================================================
 */

const MODULE_NAME =
    "TITech Community Capital Transaction Orchestration";

const MODULE_VERSION = "1.0.0";

const COMPONENT_NAMES = Object.freeze({
    AUDIT_CORRELATION_MANAGER: "AuditCorrelationManager",
    COMPENSATION_ORCHESTRATOR: "CompensationOrchestrator",
    CONSISTENCY_VALIDATOR: "ConsistencyValidator",
});

const COMPONENT_STATUS = Object.freeze({
    READY: "READY",
    UNAVAILABLE: "UNAVAILABLE",
    FAILED: "FAILED",
});

/**
 * ============================================================================
 * SAFE MODULE LOADER
 * ============================================================================
 *
 * Required orchestration modules must exist.
 *
 * We intentionally do not silently replace missing production components with
 * mock implementations. That behavior can hide deployment defects.
 *
 * ============================================================================
 */

function loadRequiredModule(modulePath, componentName) {
    try {
        const loadedModule = require(modulePath);

        if (!loadedModule) {
            const error = new Error(
                `${componentName} loaded but returned an empty module`
            );

            error.code = "ORCHESTRATION_MODULE_EMPTY";
            error.component = componentName;

            throw error;
        }

        return loadedModule;
    } catch (error) {
        if (!error.code) {
            error.code = "ORCHESTRATION_MODULE_LOAD_FAILED";
        }

        error.component =
            error.component || componentName;

        error.modulePath =
            error.modulePath || modulePath;

        throw error;
    }
}

/**
 * ============================================================================
 * COMPONENT LOADING
 * ============================================================================
 */

const AuditCorrelationManager = loadRequiredModule(
    "./AuditCorrelationManager",
    COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER
);

const CompensationOrchestrator = loadRequiredModule(
    "./CompensationOrchestrator",
    COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR
);

const ConsistencyValidator = loadRequiredModule(
    "./ConsistencyValidator",
    COMPONENT_NAMES.CONSISTENCY_VALIDATOR
);

/**
 * ============================================================================
 * COMPONENT NORMALIZATION
 * ============================================================================
 *
 * Existing services may export:
 *
 *   module.exports = new Service()
 *
 * or:
 *
 *   module.exports = Service
 *
 * or:
 *
 *   module.exports = {
 *       Service,
 *       ...
 *   }
 *
 * This registry preserves compatibility with all of those patterns.
 * ============================================================================
 */

function resolveDefaultExport(moduleValue, preferredName) {
    if (!moduleValue) {
        return null;
    }

    if (
        moduleValue[preferredName] &&
        typeof moduleValue[preferredName] === "function"
    ) {
        return moduleValue[preferredName];
    }

    if (
        moduleValue.default &&
        (
            typeof moduleValue.default === "function" ||
            typeof moduleValue.default === "object"
        )
    ) {
        return moduleValue.default;
    }

    return moduleValue;
}

const auditCorrelationManager = resolveDefaultExport(
    AuditCorrelationManager,
    COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER
);

const compensationOrchestrator = resolveDefaultExport(
    CompensationOrchestrator,
    COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR
);

const consistencyValidator = resolveDefaultExport(
    ConsistencyValidator,
    COMPONENT_NAMES.CONSISTENCY_VALIDATOR
);

/**
 * ============================================================================
 * COMPONENT VALIDATION
 * ============================================================================
 */

function validateComponent(
    component,
    componentName
) {
    if (!component) {
        throw new Error(
            `${componentName} is unavailable`
        );
    }

    const isObject =
        typeof component === "object";

    const isFunction =
        typeof component === "function";

    if (!isObject && !isFunction) {
        throw new TypeError(
            `${componentName} must export an object or constructor`
        );
    }

    return true;
}

validateComponent(
    auditCorrelationManager,
    COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER
);

validateComponent(
    compensationOrchestrator,
    COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR
);

validateComponent(
    consistencyValidator,
    COMPONENT_NAMES.CONSISTENCY_VALIDATOR
);

/**
 * ============================================================================
 * COMPONENT REGISTRY
 * ============================================================================
 *
 * Frozen registry prevents accidental runtime replacement of orchestration
 * authorities.
 * ============================================================================
 */

const registry = Object.freeze({
    [COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER]:
        auditCorrelationManager,

    [COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR]:
        compensationOrchestrator,

    [COMPONENT_NAMES.CONSISTENCY_VALIDATOR]:
        consistencyValidator,
});

/**
 * ============================================================================
 * COMPONENT METADATA
 * ============================================================================
 */

const componentMetadata = Object.freeze({
    [COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER]:
        Object.freeze({
            name:
                COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER,
            responsibility:
                "Correlates transaction, audit, risk, fraud, compliance, and operational events.",
            financialAuthority: false,
            stateMutationAuthority: false,
        }),

    [COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR]:
        Object.freeze({
            name:
                COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR,
            responsibility:
                "Coordinates compensating actions for failed or partially completed workflows.",
            financialAuthority: false,
            stateMutationAuthority: true,
        }),

    [COMPONENT_NAMES.CONSISTENCY_VALIDATOR]:
        Object.freeze({
            name:
                COMPONENT_NAMES.CONSISTENCY_VALIDATOR,
            responsibility:
                "Validates transactional and orchestration consistency before completion.",
            financialAuthority: false,
            stateMutationAuthority: false,
        }),
});

/**
 * ============================================================================
 * SERVICE HEALTH
 * ============================================================================
 */

function getComponentStatus(component) {
    if (!component) {
        return COMPONENT_STATUS.UNAVAILABLE;
    }

    return COMPONENT_STATUS.READY;
}

function getHealth() {
    const components = {};

    for (const componentName of Object.values(
        COMPONENT_NAMES
    )) {
        components[componentName] = {
            status: getComponentStatus(
                registry[componentName]
            ),
            ...componentMetadata[componentName],
        };
    }

    const statuses = Object.values(components)
        .map((component) => component.status);

    const healthy = statuses.every(
        (status) =>
            status === COMPONENT_STATUS.READY
    );

    return {
        module: MODULE_NAME,
        version: MODULE_VERSION,
        status: healthy
            ? COMPONENT_STATUS.READY
            : COMPONENT_STATUS.FAILED,
        healthy,
        components,
        timestamp: new Date().toISOString(),
    };
}

/**
 * ============================================================================
 * COMPONENT ACCESS
 * ============================================================================
 */

function getComponent(componentName) {
    if (!componentName) {
        throw new TypeError(
            "componentName is required"
        );
    }

    const component =
        registry[componentName];

    if (!component) {
        const error = new Error(
            `Unknown orchestration component: ${componentName}`
        );

        error.code =
            "ORCHESTRATION_COMPONENT_NOT_FOUND";

        throw error;
    }

    return component;
}

/**
 * ============================================================================
 * REGISTRY INSPECTION
 * ============================================================================
 */

function listComponents() {
    return Object.freeze(
        Object.values(COMPONENT_NAMES).map(
            (componentName) => ({
                name: componentName,
                status: getComponentStatus(
                    registry[componentName]
                ),
                ...componentMetadata[
                    componentName
                ],
            })
        )
    );
}

/**
 * ============================================================================
 * ORCHESTRATION CONTEXT FACTORY
 * ============================================================================
 *
 * Provides a consistent dependency object for higher-level orchestration
 * services without creating duplicate instances.
 *
 * ============================================================================
 */

function createContext(overrides = {}) {
    if (
        overrides === null ||
        typeof overrides !== "object" ||
        Array.isArray(overrides)
    ) {
        throw new TypeError(
            "Orchestration context overrides must be an object"
        );
    }

    return Object.freeze({
        auditCorrelationManager:
            overrides.auditCorrelationManager ||
            auditCorrelationManager,

        compensationOrchestrator:
            overrides.compensationOrchestrator ||
            compensationOrchestrator,

        consistencyValidator:
            overrides.consistencyValidator ||
            consistencyValidator,

        metadata: Object.freeze({
            module: MODULE_NAME,
            version: MODULE_VERSION,
            createdAt:
                new Date().toISOString(),
        }),

        ...overrides,
    });
}

/**
 * ============================================================================
 * LIFECYCLE HOOK
 * ============================================================================
 *
 * The orchestration registry itself is intentionally lightweight.
 *
 * Individual services may optionally expose:
 *
 *   initialize()
 *   start()
 *
 * This function calls those hooks only when explicitly available.
 *
 * No background workers are automatically started during require().
 *
 * ============================================================================
 */

async function initialize(options = {}) {
    const initialized = [];
    const failed = [];

    const components = [
        {
            name:
                COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER,
            instance:
                auditCorrelationManager,
        },
        {
            name:
                COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR,
            instance:
                compensationOrchestrator,
        },
        {
            name:
                COMPONENT_NAMES.CONSISTENCY_VALIDATOR,
            instance:
                consistencyValidator,
        },
    ];

    for (const component of components) {
        const service = component.instance;

        try {
            if (
                service &&
                typeof service.initialize ===
                    "function"
            ) {
                await service.initialize(options);
            } else if (
                service &&
                typeof service.start ===
                    "function"
            ) {
                await service.start(options);
            }

            initialized.push(component.name);
        } catch (error) {
            failed.push({
                component: component.name,
                error: error.message,
                code:
                    error.code ||
                    "ORCHESTRATION_INITIALIZATION_FAILED",
            });
        }
    }

    if (failed.length > 0) {
        const error = new Error(
            "Transaction orchestration initialization failed"
        );

        error.code =
            "ORCHESTRATION_INITIALIZATION_FAILED";

        error.initialized = initialized;
        error.failed = failed;

        throw error;
    }

    return {
        success: true,
        initialized,
        timestamp: new Date().toISOString(),
    };
}

/**
 * ============================================================================
 * GRACEFUL SHUTDOWN
 * ============================================================================
 *
 * Components are stopped in reverse dependency order.
 * ============================================================================
 */

async function shutdown(options = {}) {
    const stopped = [];
    const failed = [];

    const components = [
        {
            name:
                COMPONENT_NAMES.CONSISTENCY_VALIDATOR,
            instance:
                consistencyValidator,
        },
        {
            name:
                COMPONENT_NAMES.COMPENSATION_ORCHESTRATOR,
            instance:
                compensationOrchestrator,
        },
        {
            name:
                COMPONENT_NAMES.AUDIT_CORRELATION_MANAGER,
            instance:
                auditCorrelationManager,
        },
    ];

    for (const component of components) {
        const service = component.instance;

        try {
            if (
                service &&
                typeof service.shutdown ===
                    "function"
            ) {
                await service.shutdown(options);
            } else if (
                service &&
                typeof service.stop ===
                    "function"
            ) {
                await service.stop(options);
            }

            stopped.push(component.name);
        } catch (error) {
            failed.push({
                component: component.name,
                error: error.message,
                code:
                    error.code ||
                    "ORCHESTRATION_SHUTDOWN_FAILED",
            });
        }
    }

    if (failed.length > 0) {
        const error = new Error(
            "Transaction orchestration shutdown completed with errors"
        );

        error.code =
            "ORCHESTRATION_SHUTDOWN_FAILED";

        error.stopped = stopped;
        error.failed = failed;

        throw error;
    }

    return {
        success: true,
        stopped,
        timestamp: new Date().toISOString(),
    };
}

/**
 * ============================================================================
 * PUBLIC API
 * ============================================================================
 *
 * Both named and singleton-compatible exports are provided.
 *
 * Existing consumers can therefore use:
 *
 *   const orchestration = require("./orchestration");
 *
 * or:
 *
 *   const {
 *       auditCorrelationManager,
 *       compensationOrchestrator,
 *       consistencyValidator
 *   } = require("./orchestration");
 *
 * or:
 *
 *   const {
 *       AuditCorrelationManager,
 *       CompensationOrchestrator,
 *       ConsistencyValidator
 *   } = require("./orchestration");
 *
 * ============================================================================
 */

const orchestration = {
    MODULE_NAME,
    MODULE_VERSION,

    COMPONENT_NAMES,
    COMPONENT_STATUS,

    registry,

    componentMetadata,

    auditCorrelationManager,
    compensationOrchestrator,
    consistencyValidator,

    getComponent,
    listComponents,
    getHealth,
    createContext,

    initialize,
    shutdown,
};

/**
 * ============================================================================
 * COMMONJS EXPORTS
 * ============================================================================
 */

module.exports = orchestration;

/**
 * Named component exports
 */
module.exports.AuditCorrelationManager =
    AuditCorrelationManager;

module.exports.CompensationOrchestrator =
    CompensationOrchestrator;

module.exports.ConsistencyValidator =
    ConsistencyValidator;

/**
 * Singleton service exports
 */
module.exports.auditCorrelationManager =
    auditCorrelationManager;

module.exports.compensationOrchestrator =
    compensationOrchestrator;

module.exports.consistencyValidator =
    consistencyValidator;

/**
 * Registry helpers
 */
module.exports.getComponent =
    getComponent;

module.exports.listComponents =
    listComponents;

module.exports.getHealth =
    getHealth;

module.exports.createContext =
    createContext;

module.exports.initialize =
    initialize;

module.exports.shutdown =
    shutdown;
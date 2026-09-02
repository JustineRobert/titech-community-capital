"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File: backend/middleware/resilience/bootstrap.js
 *
 * Enterprise Resilience Bootstrap Facade
 * -----------------------------------------------------------------------------
 * Responsibilities
 * -----------------------------------------------------------------------------
 * ✓ Enterprise resilience startup
 * ✓ Runtime bootstrap delegation
 * ✓ Idempotent initialization
 * ✓ Dependency validation
 * ✓ Health reporting
 * ✓ Graceful shutdown
 * ✓ Runtime diagnostics
 * ✓ Bootstrap state tracking
 * =============================================================================
 */

const EventEmitter = require("events");

/* ============================================================================
 * Runtime Bootstrap
 * ========================================================================== */

const {
    bootstrapResilience: runtimeBootstrap
} = require("./runtime/resilienceBootstrap");

/* ============================================================================
 * Bootstrap State
 * ========================================================================== */

const bootstrapState = {

    initialized: false,

    initializing: false,

    healthy: false,

    startedAt: null,

    completedAt: null,

    shutdownAt: null,

    initializationCount: 0,

    lastError: null

};

/* ============================================================================
 * Enterprise Events
 * ========================================================================== */

const bootstrapEvents = new EventEmitter({

    captureRejections: true

});

bootstrapEvents.setMaxListeners(100);

/* ============================================================================
 * Enterprise Logger
 * ========================================================================== */

const logger = console;

/* ============================================================================
 * Bootstrap
 * ========================================================================== */

async function bootstrapResilience(options = {}) {

    if (bootstrapState.initialized) {

        logger.info(
            "[RESILIENCE] Bootstrap already initialized."
        );

        return getBootstrapStatus();

    }

    if (bootstrapState.initializing) {

        logger.info(
            "[RESILIENCE] Bootstrap already running."
        );

        return getBootstrapStatus();

    }

    bootstrapState.initializing = true;

    bootstrapState.initializationCount++;

    bootstrapState.startedAt = new Date();

    bootstrapEvents.emit(
        "bootstrap.starting",
        bootstrapState
    );

    try {

        const runtime = await runtimeBootstrap(options);

        bootstrapState.initialized = true;

        bootstrapState.initializing = false;

        bootstrapState.healthy = true;

        bootstrapState.completedAt = new Date();

        bootstrapState.lastError = null;

        bootstrapEvents.emit(
            "bootstrap.completed",
            bootstrapState
        );

        logger.info(
            "[RESILIENCE] Enterprise resilience initialized."
        );

        return {

            runtime,

            state: getBootstrapStatus()

        };

    } catch (error) {

        bootstrapState.initializing = false;

        bootstrapState.healthy = false;

        bootstrapState.lastError = error;

        bootstrapEvents.emit(
            "bootstrap.failed",
            error
        );

        logger.error(
            "[RESILIENCE] Bootstrap failed.",
            error
        );

        throw error;

    }

}

/* ============================================================================
 * Shutdown
 * ========================================================================== */

async function shutdownResilience() {

    if (!bootstrapState.initialized) {

        return;

    }

    bootstrapState.shutdownAt = new Date();

    bootstrapState.initialized = false;

    bootstrapState.healthy = false;

    bootstrapEvents.emit(
        "bootstrap.shutdown",
        bootstrapState
    );

    logger.info(
        "[RESILIENCE] Shutdown completed."
    );

}

/* ============================================================================
 * Status
 * ========================================================================== */

function getBootstrapStatus() {

    return Object.freeze({

        initialized:
            bootstrapState.initialized,

        initializing:
            bootstrapState.initializing,

        healthy:
            bootstrapState.healthy,

        startedAt:
            bootstrapState.startedAt,

        completedAt:
            bootstrapState.completedAt,

        shutdownAt:
            bootstrapState.shutdownAt,

        initializationCount:
            bootstrapState.initializationCount,

        lastError:
            bootstrapState.lastError
                ? bootstrapState.lastError.message
                : null

    });

}

/* ============================================================================
 * Helpers
 * ========================================================================== */

function isInitialized() {

    return bootstrapState.initialized;

}

function isHealthy() {

    return bootstrapState.healthy;

}

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports = Object.freeze({

    bootstrapResilience,

    shutdownResilience,

    getBootstrapStatus,

    isInitialized,

    isHealthy,

    bootstrapEvents

});
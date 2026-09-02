"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * African Community Finance Operating System (ACFOS)
 * =============================================================================
 *
 * File:
 *   backend/app.js
 *
 * Purpose:
 *   Enterprise Express application foundation and runtime context.
 *
 * Architectural Boundary
 * =============================================================================
 *
 *   process.env
 *       ↓
 *   backend/config/index.js
 *       ↓
 *   backend/app.js
 *       ↓
 *   Express application
 *       ↓
 *   backend/bootstrap/*
 *
 * This module creates the application object only.
 *
 * =============================================================================
 *
 * Responsibilities
 * =============================================================================
 *
 *   ✓ Strict runtime
 *   ✓ Node.js compatibility verification
 *   ✓ Centralized configuration consumption
 *   ✓ Package/build metadata
 *   ✓ Runtime metadata
 *   ✓ Deployment metadata
 *   ✓ Immutable application metadata
 *   ✓ Express application factory
 *   ✓ Runtime context exposure through app.locals
 *   ✓ Safe diagnostics helpers
 *   ✓ Health/readiness/liveness state access
 *
 * =============================================================================
 *
 * NOT INCLUDED
 * =============================================================================
 *
 *   ✗ Express middleware registration
 *   ✗ Route registration
 *   ✗ MongoDB connection
 *   ✗ Redis connection
 *   ✗ Queue startup
 *   ✗ Socket.IO startup
 *   ✗ HTTP server startup
 *   ✗ Graceful shutdown execution
 *   ✗ Business services
 *
 * Those responsibilities belong to the bootstrap pipeline.
 *
 * =============================================================================
 */

const path =
    require("path");

const fs =
    require("fs");

const os =
    require("os");

const crypto =
    require("crypto");

const express =
    require("express");

const configuration =
    require("./config");

const {
    BOOTSTRAP_PHASES,
    getApplicationState,
    getHealthState,
    isReady,
    isLive
} = require("./runtime/state");

// =============================================================================
// Runtime Compatibility
// =============================================================================

const MINIMUM_NODE_MAJOR =
    20;

const NODE_VERSION =
    process.versions.node;

const NODE_MAJOR =
    Number(
        NODE_VERSION.split(".")[0]
    );

if (
    Number.isNaN(
        NODE_MAJOR
    )
) {

    throw new Error(
        "Unable to determine installed Node.js version."
    );

}

if (
    NODE_MAJOR <
    MINIMUM_NODE_MAJOR
) {

    throw new Error(
        [
            "",
            "============================================================",
            " Unsupported Node.js Runtime",
            "------------------------------------------------------------",
            ` Installed : ${NODE_VERSION}`,
            ` Required  : >= ${MINIMUM_NODE_MAJOR}.0.0`,
            "============================================================",
            ""
        ].join("\n")
    );

}

// =============================================================================
// Application Root
// =============================================================================

const APPLICATION_ROOT =
    Object.freeze({

        root:
            process.cwd(),

        backend:
            __dirname,

        config:
            path.join(
                __dirname,
                "config"
            ),

        bootstrap:
            path.join(
                __dirname,
                "bootstrap"
            ),

        runtime:
            path.join(
                __dirname,
                "runtime"
            ),

        middleware:
            path.join(
                __dirname,
                "middleware"
            ),

        routes:
            path.join(
                __dirname,
                "routes"
            ),

        controllers:
            path.join(
                __dirname,
                "controllers"
            ),

        services:
            path.join(
                __dirname,
                "services"
            ),

        repositories:
            path.join(
                __dirname,
                "repositories"
            ),

        models:
            path.join(
                __dirname,
                "models"
            ),

        modules:
            path.join(
                __dirname,
                "modules"
            ),

        jobs:
            path.join(
                __dirname,
                "jobs"
            ),

        queues:
            path.join(
                __dirname,
                "queues"
            ),

        realtime:
            path.join(
                __dirname,
                "realtime"
            ),

        docs:
            path.join(
                process.cwd(),
                "docs"
            ),

        logs:
            path.join(
                process.cwd(),
                "logs"
            ),

        uploads:
            path.join(
                process.cwd(),
                "uploads"
            )

    });

// =============================================================================
// Package Metadata
// =============================================================================

function loadPackageMetadata() {

    const packagePath =
        path.resolve(
            process.cwd(),
            "package.json"
        );

    const fallback =
        {

            name:
                "titech-community-capital",

            version:
                configuration.version ||
                "1.0.0",

            description:
                "African Community Finance Operating System",

            license:
                "Proprietary"

        };

    try {

        if (
            !fs.existsSync(
                packagePath
            )
        ) {

            return Object.freeze(
                fallback
            );

        }

        const parsed =
            JSON.parse(
                fs.readFileSync(
                    packagePath,
                    "utf8"
                )
            );

        return Object.freeze({

            ...fallback,

            ...parsed

        });

    } catch (
        error
    ) {

        /*
         * Package metadata is diagnostic metadata.
         *
         * It must never prevent application initialization.
         */

        return Object.freeze(
            fallback
        );

    }

}

const packageJson =
    loadPackageMetadata();

// =============================================================================
// Build Information
// =============================================================================

const BUILD_INFORMATION =
    Object.freeze({

        application:

            packageJson.name ||
            "titech-community-capital",

        version:

            packageJson.version ||
            configuration.version ||
            "1.0.0",

        description:

            packageJson.description ||
            "African Community Finance Operating System",

        author:

            packageJson.author ||
            "TITech Community Capital LTD",

        license:

            packageJson.license ||
            "Proprietary",

        homepage:

            packageJson.homepage ||
            null,

        repository:

            packageJson.repository ||
            null,

        gitCommit:

            process.env.GIT_COMMIT ||
            process.env.GITHUB_SHA ||
            "unknown",

        gitBranch:

            process.env.GIT_BRANCH ||
            process.env.GITHUB_REF_NAME ||
            "unknown",

        buildNumber:

            process.env.BUILD_NUMBER ||
            "local",

        buildDate:

            process.env.BUILD_DATE ||
            new Date().toISOString()

    });

// =============================================================================
// Runtime Information
// =============================================================================

const RUNTIME =
    Object.freeze({

        nodeVersion:
            process.version,

        nodeMajor:
            NODE_MAJOR,

        platform:
            process.platform,

        architecture:
            process.arch,

        pid:
            process.pid,

        ppid:
            process.ppid,

        hostname:
            os.hostname(),

        cpuCount:
            os.cpus().length,

        totalMemory:
            os.totalmem(),

        freeMemory:
            os.freemem(),

        timezone:
            Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone,

        locale:
            Intl.DateTimeFormat()
                .resolvedOptions()
                .locale,

        startupTime:
            new Date().toISOString()

    });

// =============================================================================
// Deployment Information
// =============================================================================

const DEPLOYMENT =
    Object.freeze({

        environment:
            configuration.environment,

        isProduction:
            configuration.production,

        isDevelopment:
            configuration.development,

        isTesting:
            configuration.test,

        isDocker:
            fs.existsSync(
                "/.dockerenv"
            ),

        isKubernetes:
            Boolean(
                process.env.KUBERNETES_SERVICE_HOST
            ),

        isPM2:
            Boolean(
                process.env.pm_id
            ),

        isCI:
            Boolean(
                process.env.CI
            ),

        podName:
            process.env.POD_NAME ||
            null,

        namespace:
            process.env.POD_NAMESPACE ||
            process.env.K8S_NAMESPACE ||
            null,

        nodeName:
            process.env.NODE_NAME ||
            null,

        region:
            process.env.REGION ||
            process.env.AWS_REGION ||
            "unknown"

    });

// =============================================================================
// Enterprise Application Constants
// =============================================================================

const APPLICATION =
    Object.freeze({

        company:
            "TITech Community Capital LTD",

        platform:
            "African Community Finance Operating System",

        acronym:
            "TITech",

        serviceName:
            configuration.serviceName,

        apiPrefix:
            "/api",

        apiVersion:
            "v1",

        defaultEncoding:
            "utf8",

        requestIdHeader:
            "x-request-id",

        correlationIdHeader:
            "x-correlation-id",

        transactionIdHeader:
            "x-transaction-id",

        tenantHeader:
            "x-tenant-id",

        deviceHeader:
            "x-device-id"

    });

// =============================================================================
// Runtime Fingerprint
// =============================================================================
//
// Diagnostic only.
//
// Never include secrets in the fingerprint.
// =============================================================================

const RUNTIME_FINGERPRINT =
    Object.freeze({

        identifier:
            crypto
                .createHash(
                    "sha256"
                )
                .update(
                    JSON.stringify({

                        application:
                            BUILD_INFORMATION.application,

                        version:
                            BUILD_INFORMATION.version,

                        environment:
                            configuration.environment,

                        node:
                            NODE_VERSION,

                        platform:
                            process.platform,

                        architecture:
                            process.arch,

                        gitCommit:
                            BUILD_INFORMATION.gitCommit

                    })
                )
                .digest(
                    "hex"
                ),

        generatedAt:
            new Date().toISOString()

    });

// =============================================================================
// Bootstrap Metadata
// =============================================================================

const BOOTSTRAP =
    Object.freeze({

        applicationRoot:
            APPLICATION_ROOT.root,

        environment:
            configuration.environment,

        startedAt:
            new Date(
                Date.now() -
                process.uptime() *
                1000
            ).toISOString(),

        environmentFile:
            process.env.ENV_FILE ||
            ".env",

        runtimeFingerprint:
            RUNTIME_FINGERPRINT.identifier,

        canonicalPhaseOrder:
            Object.freeze([

                BOOTSTRAP_PHASES.ENVIRONMENT,

                BOOTSTRAP_PHASES.CONFIGURATION,

                BOOTSTRAP_PHASES.LOGGER,

                BOOTSTRAP_PHASES.OBSERVABILITY,

                BOOTSTRAP_PHASES.RESILIENCE,

                BOOTSTRAP_PHASES.DATABASE,

                BOOTSTRAP_PHASES.MIDDLEWARE,

                BOOTSTRAP_PHASES.ROUTES,

                BOOTSTRAP_PHASES.SERVER,

                BOOTSTRAP_PHASES.READY

            ])

    });

// =============================================================================
// Runtime Context
// =============================================================================

const runtimeContext =
    Object.freeze({

        application:
            APPLICATION,

        build:
            BUILD_INFORMATION,

        runtime:
            RUNTIME,

        deployment:
            DEPLOYMENT,

        bootstrap:
            BOOTSTRAP,

        configuration,
        
        applicationRoot:
            APPLICATION_ROOT,

        runtimeFingerprint:
            RUNTIME_FINGERPRINT

    });

// =============================================================================
// Diagnostics
// =============================================================================
//
// Never expose:
//   - JWT secrets
//   - MoMo tokens
//   - database credentials
//   - Redis credentials
//   - cookies
//   - authorization headers
// =============================================================================

function getDiagnostics() {

    const state =
        getApplicationState();

    return {

        application: {

            name:
                BUILD_INFORMATION.application,

            version:
                BUILD_INFORMATION.version,

            service:
                configuration.serviceName

        },

        runtime: {

            node:
                RUNTIME.nodeVersion,

            platform:
                RUNTIME.platform,

            architecture:
                RUNTIME.architecture,

            pid:
                RUNTIME.pid,

            hostname:
                RUNTIME.hostname,

            uptime:
                process.uptime()

        },

        deployment: {

            environment:
                DEPLOYMENT.environment,

            docker:
                DEPLOYMENT.isDocker,

            kubernetes:
                DEPLOYMENT.isKubernetes,

            ci:
                DEPLOYMENT.isCI,

            region:
                DEPLOYMENT.region

        },

        bootstrap: {

            phase:
                state.bootstrapPhase,

            completedPhases:
                state.completedPhases

        },

        process: {

            memory:
                process.memoryUsage(),

            activeHandles:
                typeof process.getActiveResourcesInfo ===
                    "function"
                    ? process.getActiveResourcesInfo().length
                    : undefined

        },

        fingerprint:
            RUNTIME_FINGERPRINT.identifier

    };

}

// =============================================================================
// Health Snapshot
// =============================================================================

function getHealthSnapshot() {

    return {

        ...getHealthState(),

        application:
            configuration.serviceName,

        version:
            configuration.version,

        environment:
            configuration.environment,

        uptime:
            process.uptime()

    };

}

// =============================================================================
// Runtime Snapshot
// =============================================================================

function getRuntimeSnapshot() {

    return {

        application:
            APPLICATION,

        build:
            BUILD_INFORMATION,

        runtime: {

            ...RUNTIME,

            freeMemory:
                os.freemem(),

            uptime:
                process.uptime()

        },

        deployment:
            DEPLOYMENT,

        bootstrap:
            BOOTSTRAP,

        health:
            getHealthSnapshot(),

        fingerprint:
            RUNTIME_FINGERPRINT.identifier

    };

}

// =============================================================================
// Enterprise Context
// =============================================================================

const ENTERPRISE_CONTEXT =
    Object.freeze({

        application:
            APPLICATION,

        build:
            BUILD_INFORMATION,

        runtime:
            RUNTIME,

        deployment:
            DEPLOYMENT,

        bootstrap:
            BOOTSTRAP,

        configuration,

        applicationRoot:
            APPLICATION_ROOT,

        runtimeContext

    });

// =============================================================================
// Express Application Factory
// =============================================================================
//
// IMPORTANT:
//
// createApp() creates only the Express instance.
//
// Middleware, routes, database connections and server startup are deliberately
// excluded.
//
// =============================================================================

function createApp() {

    const app =
        express();

    // =========================================================================
    // Express Foundation
    // =========================================================================

    app.disable(
        "x-powered-by"
    );

    app.set(
        "trust proxy",
        configuration.trustProxy
    );

    app.set(
        "applicationName",
        BUILD_INFORMATION.application
    );

    app.set(
        "applicationVersion",
        BUILD_INFORMATION.version
    );

    app.set(
        "serviceName",
        configuration.serviceName
    );

    app.set(
        "environment",
        configuration.environment
    );

    app.set(
        "runtimeFingerprint",
        RUNTIME_FINGERPRINT.identifier
    );

    app.set(
        "startedAt",
        new Date()
    );

    // =========================================================================
    // Runtime Locals
    // =========================================================================
    //
    // These are safe application references.
    //
    // Secrets remain inside centralized configuration and should not be sent
    // through diagnostic endpoints.
    // =========================================================================

    app.locals.application =
        APPLICATION;

    app.locals.build =
        BUILD_INFORMATION;

    app.locals.runtime =
        RUNTIME;

    app.locals.deployment =
        DEPLOYMENT;

    app.locals.bootstrap =
        BOOTSTRAP;

    app.locals.configuration =
        configuration;

    app.locals.applicationRoot =
        APPLICATION_ROOT;

    app.locals.runtimeContext =
        runtimeContext;

    // =========================================================================
    // Runtime Accessors
    // =========================================================================

    app.getRuntimeContext =
        () =>
            runtimeContext;

    app.getApplicationState =
        () =>
            getApplicationState();

    app.getConfiguration =
        () =>
            configuration;

    app.getBuildInformation =
        () =>
            BUILD_INFORMATION;

    app.getDeploymentInformation =
        () =>
            DEPLOYMENT;

    app.getRuntimeInformation =
        () =>
            RUNTIME;

    app.getBootstrapInformation =
        () =>
            BOOTSTRAP;

    // =========================================================================
    // Health / Readiness / Liveness Helpers
    // =========================================================================

    app.isReady =
        () =>
            isReady();

    app.isLive =
        () =>
            isLive();

    app.getHealthSnapshot =
        () =>
            getHealthSnapshot();

    // =========================================================================
    // Diagnostics
    // =========================================================================

    app.getDiagnostics =
        () =>
            getDiagnostics();

    app.getRuntimeSnapshot =
        () =>
            getRuntimeSnapshot();

    // =========================================================================
    // Environment Helpers
    // =========================================================================

    app.isProduction =
        () =>
            DEPLOYMENT.isProduction;

    app.isDevelopment =
        () =>
            DEPLOYMENT.isDevelopment;

    app.isTesting =
        () =>
            DEPLOYMENT.isTesting;

    app.isDocker =
        () =>
            DEPLOYMENT.isDocker;

    app.isKubernetes =
        () =>
            DEPLOYMENT.isKubernetes;

    // =========================================================================
    // Enterprise Context
    // =========================================================================

    app.locals.enterprise =
        ENTERPRISE_CONTEXT;

    // =========================================================================
    // Factory Marker
    // =========================================================================

    app.locals.isEnterpriseApp =
        true;

    return app;

}

// =============================================================================
// Singleton Application
// =============================================================================
//
// Exporting a single application instance preserves compatibility with code
// such as:
//
//     const app = require("./app");
//
// while createApp() remains available for testing and isolated application
// instances.
//
// =============================================================================

const app =
    createApp();

// =============================================================================
// Application Metadata
// =============================================================================
//
// Attach non-secret immutable metadata.
//
// =============================================================================

app.application =
    APPLICATION;

app.buildInformation =
    BUILD_INFORMATION;

app.runtimeInformation =
    RUNTIME;

app.deploymentInformation =
    DEPLOYMENT;

app.bootstrapInformation =
    BOOTSTRAP;

app.runtimeContext =
    runtimeContext;

app.applicationRoot =
    APPLICATION_ROOT;

app.runtimeFingerprint =
    RUNTIME_FINGERPRINT;

// =============================================================================
// Factory
// =============================================================================

app.createApp =
    createApp;

// =============================================================================
// Export
// =============================================================================

module.exports = app;

// =============================================================================
// Named Exports
// =============================================================================

module.exports.createApp =
    createApp;

module.exports.configuration =
    configuration;

module.exports.APPLICATION =
    APPLICATION;

module.exports.APPLICATION_ROOT =
    APPLICATION_ROOT;

module.exports.BUILD_INFORMATION =
    BUILD_INFORMATION;

module.exports.RUNTIME =
    RUNTIME;

module.exports.DEPLOYMENT =
    DEPLOYMENT;

module.exports.BOOTSTRAP =
    BOOTSTRAP;

module.exports.RUNTIME_FINGERPRINT =
    RUNTIME_FINGERPRINT;

module.exports.runtimeContext =
    runtimeContext;

module.exports.getDiagnostics =
    getDiagnostics;

module.exports.getHealthSnapshot =
    getHealthSnapshot;

module.exports.getRuntimeSnapshot =
    getRuntimeSnapshot;
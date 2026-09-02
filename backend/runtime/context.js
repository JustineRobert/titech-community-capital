'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Context
 * ============================================================================
 *
 * File:
 *   backend/runtime/context.js
 *
 * Purpose:
 *   Central runtime metadata and lifecycle context for the TITech Community
 *   Capital backend.
 *
 * Responsibilities:
 *   ✓ Application identity
 *   ✓ Build/version metadata
 *   ✓ Runtime/process metadata
 *   ✓ Deployment metadata
 *   ✓ Infrastructure detection
 *   ✓ Runtime fingerprint
 *   ✓ Bootstrap paths
 *   ✓ Request/correlation/transaction/tenant conventions
 *   ✓ Application lifecycle state integration
 *   ✓ Runtime snapshots for diagnostics/health endpoints
 *   ✓ Safe environment metadata exposure
 *   ✓ Backward-compatible CommonJS exports
 *
 * Non-responsibilities:
 *   ✗ Business logic
 *   ✗ Database connections
 *   ✗ Redis connections
 *   ✗ Authentication
 *   ✗ Tenant authorization
 *   ✗ Secrets management
 *
 * Security principle:
 *   Runtime diagnostics MUST NEVER expose raw secrets, tokens, credentials,
 *   private keys, database connection strings, or arbitrary environment data.
 *
 * ============================================================================
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const configuration =
    require('../config');

const {
    file: ENV_FILE
} = require('../config/env');

const {
    createFingerprint
} = require('./fingerprint');

const runtimeEvents =
    require('./events');

const stateModule =
    require('./state');

const {
    applicationState,
    BOOTSTRAP_PHASES,
    getApplicationState,
    markApplicationStarted,
    markApplicationReady,
    markApplicationShutdown,
    markApplicationStopped,
    updateBootstrapPhase,
    incrementActiveRequests,
    decrementActiveRequests,
    incrementSocketConnections,
    decrementSocketConnections
} = stateModule;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SERVICE_NAME =
    process.env.SERVICE_NAME ||
    'titech-community-capital-backend';

const COMPANY_NAME =
    'TITech Community Capital LTD';

const PLATFORM_NAME =
    'TITech Community Capital';

const APPLICATION_DESCRIPTION =
    'TITech Community Capital Community Finance Operating System';

const DEFAULT_API_PREFIX =
    '/api';

const DEFAULT_API_VERSION =
    'v1';

const DEFAULT_ENVIRONMENT =
    process.env.NODE_ENV ||
    'development';

const DEFAULT_DEPLOYMENT_MODE =
    process.env.DEPLOYMENT_MODE ||
    'standalone';

const DEFAULT_TIMEZONE =
    process.env.TZ ||
    detectTimezone();

const DEFAULT_LOCALE =
    process.env.LOCALE ||
    detectLocale();

const BOOT_TIME =
    Date.now() -
    (
        process.uptime() *
        1000
    );

const PROCESS_STARTED_AT =
    new Date(
        BOOT_TIME
    );

const CONTEXT_KEY_NAMES =
    Object.freeze({
        REQUEST_ID:
            process.env.REQUEST_ID_HEADER ||
            'x-request-id',

        CORRELATION_ID:
            process.env.CORRELATION_ID_HEADER ||
            'x-correlation-id',

        TRANSACTION_ID:
            process.env.TRANSACTION_ID_HEADER ||
            'x-transaction-id',

        TENANT_ID:
            process.env.TENANT_ID_HEADER ||
            'x-tenant-id',

        USER_ID:
            process.env.USER_ID_HEADER ||
            'x-user-id'
    });

/**
 * ============================================================================
 * PACKAGE METADATA
 * ============================================================================
 */

function loadPackageJson() {
    const candidates = [
        path.resolve(
            process.cwd(),
            'package.json'
        ),

        path.resolve(
            __dirname,
            '../../package.json'
        ),

        path.resolve(
            __dirname,
            '../package.json'
        )
    ];

    for (
        const packagePath of candidates
    ) {
        try {
            if (
                !fs.existsSync(
                    packagePath
                )
            ) {
                continue;
            }

            const raw =
                fs.readFileSync(
                    packagePath,
                    'utf8'
                );

            const parsed =
                JSON.parse(raw);

            if (
                parsed &&
                typeof parsed === 'object'
            ) {
                return Object.freeze({
                    ...parsed
                });
            }
        } catch (error) {
            /*
             * Continue to the next candidate.
             *
             * Package metadata is diagnostic information and must never prevent
             * the application from starting merely because one package file
             * cannot be read.
             */
            console.warn(
                '[TITech.Runtime] Unable to read package metadata:',
                error.message
            );
        }
    }

    return Object.freeze({
        name:
            'titech-community-capital',

        version:
            '1.0.0',

        description:
            APPLICATION_DESCRIPTION,

        license:
            'Proprietary',

        author:
            COMPANY_NAME
    });
}

const packageJson =
    loadPackageJson();

/**
 * ============================================================================
 * SAFE PRIMITIVE HELPERS
 * ============================================================================
 */

function detectTimezone() {
    try {
        return (
            Intl.DateTimeFormat()
                .resolvedOptions()
                .timeZone
        ) || 'UTC';
    } catch {
        return 'UTC';
    }
}

function detectLocale() {
    try {
        return (
            Intl.DateTimeFormat()
                .resolvedOptions()
                .locale
        ) || 'en-US';
    } catch {
        return 'en-US';
    }
}

function toBoolean(
    value
) {
    if (
        typeof value === 'boolean'
    ) {
        return value;
    }

    return String(
        value || ''
    ).toLowerCase() === 'true';
}

function firstDefined(
    ...values
) {
    return values.find(
        value =>
            value !== undefined &&
            value !== null &&
            value !== ''
    ) || null;
}

function safeString(
    value,
    fallback = null
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return fallback;
    }

    return String(value);
}

function safePositiveInteger(
    value,
    fallback = 0
) {
    const numeric =
        Number(value);

    return Number.isFinite(
        numeric
    ) &&
        numeric >= 0
        ? Math.floor(numeric)
        : fallback;
}

/**
 * ============================================================================
 * BUILD METADATA
 * ============================================================================
 */

const buildMetadata =
    Object.freeze({

        serviceName:
            SERVICE_NAME,

        applicationName:
            packageJson.name ||
            'titech-community-capital',

        displayName:
            process.env.APP_NAME ||
            PLATFORM_NAME,

        company:
            COMPANY_NAME,

        version:
            packageJson.version ||
            '1.0.0',

        description:
            packageJson.description ||
            APPLICATION_DESCRIPTION,

        author:
            packageJson.author ||
            COMPANY_NAME,

        license:
            packageJson.license ||
            'Proprietary',

        homepage:
            packageJson.homepage ||
            null,

        repository:
            normalizeRepository(
                packageJson.repository
            ),

        buildNumber:
            process.env.BUILD_NUMBER ||
            process.env.BUILD_ID ||
            'local',

        buildDate:
            process.env.BUILD_DATE ||
            null,

        gitCommit:
            process.env.GIT_COMMIT ||
            process.env.GITHUB_SHA ||
            process.env.BUILD_SOURCEVERSION ||
            'unknown',

        gitBranch:
            process.env.GIT_BRANCH ||
            process.env.GITHUB_REF_NAME ||
            process.env.BRANCH_NAME ||
            'unknown',

        release:
            process.env.RELEASE_VERSION ||
            process.env.APP_VERSION ||
            packageJson.version ||
            '1.0.0'
    });

function normalizeRepository(
    repository
) {
    if (
        !repository
    ) {
        return null;
    }

    if (
        typeof repository === 'string'
    ) {
        return repository;
    }

    if (
        typeof repository === 'object'
    ) {
        return (
            repository.url ||
            repository.directory ||
            null
        );
    }

    return null;
}

/**
 * ============================================================================
 * RUNTIME METADATA
 * ============================================================================
 */

function buildRuntimeMetadata() {
    let cpuCount = 1;

    try {
        cpuCount =
            Math.max(
                1,
                os.cpus().length
            );
    } catch {
        cpuCount = 1;
    }

    return Object.freeze({

        processId:
            process.pid,

        parentProcessId:
            process.ppid,

        processTitle:
            process.title,

        nodeVersion:
            process.version,

        nodeMajorVersion:
            Number(
                process.versions?.node?.split('.')[0]
            ) || null,

        nodeVersions:
            Object.freeze({
                ...process.versions
            }),

        nodeArchitecture:
            process.arch,

        operatingSystem:
            process.platform,

        osRelease:
            os.release(),

        hostname:
            os.hostname(),

        timezone:
            DEFAULT_TIMEZONE,

        locale:
            DEFAULT_LOCALE,

        cpuCount,

        totalMemory:
            safePositiveInteger(
                os.totalmem()
            ),

        freeMemory:
            safePositiveInteger(
                os.freemem()
            ),

        bootTimestamp:
            PROCESS_STARTED_AT
                .toISOString(),

        processStartedAt:
            PROCESS_STARTED_AT
                .toISOString()
    });
}

const runtimeMetadata =
    buildRuntimeMetadata();

/**
 * ============================================================================
 * INFRASTRUCTURE DETECTION
 * ============================================================================
 */

const infrastructure =
    Object.freeze({

        docker:
            detectDocker(),

        kubernetes:
            Boolean(
                process.env.KUBERNETES_SERVICE_HOST
            ),

        pm2:
            Boolean(
                process.env.pm_id ||
                process.env.PM2_HOME
            ),

        cluster:
            Boolean(
                process.env.TITech_CLUSTER ||
                process.env.NODE_UNIQUE_ID
            ),

        ci:
            Boolean(
                process.env.CI
            ),

        githubActions:
            toBoolean(
                process.env.GITHUB_ACTIONS
            ),

        gitlabCi:
            toBoolean(
                process.env.GITLAB_CI
            ),

        jenkins:
            Boolean(
                process.env.JENKINS_URL
            ),

        azure:
            Boolean(
                process.env.WEBSITE_INSTANCE_ID
            ),

        aws:
            Boolean(
                process.env.AWS_REGION ||
                process.env.AWS_EXECUTION_ENV
            ),

        gcp:
            Boolean(
                process.env.GOOGLE_CLOUD_PROJECT ||
                process.env.GCP_PROJECT
            ),

        railway:
            Boolean(
                process.env.RAILWAY_ENVIRONMENT
            ),

        render:
            Boolean(
                process.env.RENDER
            ),

        vercel:
            Boolean(
                process.env.VERCEL
            ),

        fly:
            Boolean(
                process.env.FLY_APP_NAME
            ),

        cloudflare:
            Boolean(
                process.env.CF_PAGES ||
                process.env.CF_PAGES_URL
            ),

        development:
            DEFAULT_ENVIRONMENT ===
            'development',

        production:
            DEFAULT_ENVIRONMENT ===
            'production',

        test:
            DEFAULT_ENVIRONMENT ===
            'test'
    });

function detectDocker() {
    try {
        return fs.existsSync(
            '/.dockerenv'
        );
    } catch {
        return false;
    }
}

/**
 * ============================================================================
 * DEPLOYMENT METADATA
 * ============================================================================
 */

const deploymentMetadata =
    Object.freeze({

        environment:
            DEFAULT_ENVIRONMENT,

        environmentName:
            process.env.APP_ENVIRONMENT ||
            process.env.ENVIRONMENT ||
            DEFAULT_ENVIRONMENT,

        deploymentMode:
            DEFAULT_DEPLOYMENT_MODE,

        region:
            firstDefined(
                process.env.REGION,
                process.env.AWS_REGION,
                process.env.AWS_DEFAULT_REGION,
                process.env.FLY_REGION,
                process.env.RAILWAY_REGION,
                process.env.GCP_REGION,
                'unknown'
            ),

        availabilityZone:
            process.env.AVAILABILITY_ZONE ||
            process.env.AWS_AVAILABILITY_ZONE ||
            'unknown',

        cluster:
            process.env.CLUSTER_NAME ||
            process.env.K8S_CLUSTER_NAME ||
            'default',

        namespace:
            process.env.K8S_NAMESPACE ||
            process.env.NAMESPACE ||
            'default',

        pod:
            process.env.POD_NAME ||
            process.env.HOSTNAME ||
            null,

        node:
            process.env.NODE_NAME ||
            null,

        instance:
            process.env.INSTANCE_ID ||
            process.env.ECS_CONTAINER_INSTANCE_ID ||
            runtimeMetadata.hostname,

        containerId:
            process.env.CONTAINER_ID ||
            null,

        serviceRevision:
            process.env.SERVICE_REVISION ||
            process.env.GIT_COMMIT ||
            null,

        tenantMode:
            resolveTenantMode(),

        clusterWorkerId:
            process.env.NODE_UNIQUE_ID ||
            null,

        processManager:
            resolveProcessManager()
    });

function resolveTenantMode() {
    if (
        String(
            process.env.MULTI_TENANT_MODE ||
            ''
        ).toLowerCase() ===
        'false'
    ) {
        return 'single';
    }

    return (
        process.env.TENANCY_MODE ||
        process.env.MULTI_TENANT_STRATEGY ||
        'multi'
    );
}

function resolveProcessManager() {
    if (
        infrastructure.pm2
    ) {
        return 'pm2';
    }

    if (
        infrastructure.kubernetes
    ) {
        return 'kubernetes';
    }

    if (
        infrastructure.docker
    ) {
        return 'docker';
    }

    return 'standalone';
}

/**
 * ============================================================================
 * APPLICATION IDENTITY
 * ============================================================================
 */

const APPLICATION =
    Object.freeze({

        company:
            COMPANY_NAME,

        legalName:
            COMPANY_NAME,

        product:
            PLATFORM_NAME,

        platform:
            PLATFORM_NAME,

        acronym:
            'TITech',

        service:
            SERVICE_NAME,

        apiPrefix:
            process.env.API_PREFIX ||
            DEFAULT_API_PREFIX,

        apiVersion:
            process.env.API_VERSION ||
            DEFAULT_API_VERSION,

        defaultEncoding:
            'utf8',

        requestIdHeader:
            CONTEXT_KEY_NAMES.REQUEST_ID,

        correlationIdHeader:
            CONTEXT_KEY_NAMES.CORRELATION_ID,

        transactionIdHeader:
            CONTEXT_KEY_NAMES.TRANSACTION_ID,

        tenantHeader:
            CONTEXT_KEY_NAMES.TENANT_ID,

        userHeader:
            CONTEXT_KEY_NAMES.USER_ID
    });

/**
 * ============================================================================
 * RUNTIME FINGERPRINT
 * ============================================================================
 */

const RUNTIME_FINGERPRINT =
    Object.freeze({

        identifier:
            createFingerprint({

                application:
                    buildMetadata
                        .applicationName,

                version:
                    buildMetadata.version,

                release:
                    buildMetadata.release,

                node:
                    runtimeMetadata.nodeVersion,

                platform:
                    runtimeMetadata.operatingSystem,

                architecture:
                    runtimeMetadata.nodeArchitecture,

                environment:
                    deploymentMetadata.environment,

                deployment:
                    deploymentMetadata.deploymentMode,

                gitCommit:
                    buildMetadata.gitCommit
            }),

        generatedAt:
            new Date().toISOString()
    });

/**
 * ============================================================================
 * BOOTSTRAP METADATA
 * ============================================================================
 */

const BOOTSTRAP =
    Object.freeze({

        initializedAt:
            new Date(),

        processStartedAt:
            PROCESS_STARTED_AT,

        applicationRoot:
            process.cwd(),

        backendRoot:
            path.resolve(
                __dirname,
                '..'
            ),

        runtimeDirectory:
            __dirname,

        environmentFile:
            ENV_FILE ||
            null,

        runtimeFingerprint:
            RUNTIME_FINGERPRINT.identifier
    });

/**
 * ============================================================================
 * IMMUTABLE BASE RUNTIME CONTEXT
 * ============================================================================
 */

const runtimeContext =
    Object.freeze({

        application:
            APPLICATION,

        build:
            buildMetadata,

        runtime:
            runtimeMetadata,

        deployment:
            deploymentMetadata,

        infrastructure,

        bootstrap:
            BOOTSTRAP,

        configuration,

        fingerprint:
            RUNTIME_FINGERPRINT.identifier
    });

/**
 * ============================================================================
 * RUNTIME SNAPSHOT
 * ============================================================================
 *
 * Creates a point-in-time representation rather than exposing the static
 * metadata object alone.
 * ============================================================================
 */

function buildRuntimeSnapshot(
    options = {}
) {
    const includeConfiguration =
        options.includeConfiguration === true;

    const memory =
        process.memoryUsage();

    const resourceUsage =
        typeof process.resourceUsage ===
        'function'
            ? process.resourceUsage()
            : null;

    const state =
        safeApplicationState();

    const snapshot = {

        application:
            buildMetadata.applicationName,

        displayName:
            buildMetadata.displayName,

        company:
            COMPANY_NAME,

        service:
            SERVICE_NAME,

        version:
            buildMetadata.version,

        release:
            buildMetadata.release,

        environment:
            deploymentMetadata.environment,

        deployment:
            deploymentMetadata.deploymentMode,

        processManager:
            deploymentMetadata.processManager,

        hostname:
            runtimeMetadata.hostname,

        processId:
            runtimeMetadata.processId,

        parentProcessId:
            runtimeMetadata.parentProcessId,

        nodeVersion:
            runtimeMetadata.nodeVersion,

        nodeArchitecture:
            runtimeMetadata.nodeArchitecture,

        platform:
            runtimeMetadata.operatingSystem,

        uptimeSeconds:
            Number(
                process.uptime()
                    .toFixed(3)
            ),

        memory: {
            rss:
                memory.rss,

            heapTotal:
                memory.heapTotal,

            heapUsed:
                memory.heapUsed,

            external:
                memory.external,

            arrayBuffers:
                memory.arrayBuffers ??
                null
        },

        resourceUsage,

        activeRequests:
            state.activeRequests,

        activeSocketConnections:
            state.socketConnections,

        bootstrapPhase:
            state.bootstrapPhase,

        applicationState:
            state.applicationState,

        fingerprint:
            RUNTIME_FINGERPRINT.identifier,

        timestamp:
            new Date().toISOString()
    };

    if (
        includeConfiguration
    ) {
        snapshot.configuration =
            sanitizeConfigurationForDiagnostics(
                configuration
            );
    }

    return snapshot;
}

/**
 * ============================================================================
 * APPLICATION STATE SAFE READER
 * ============================================================================
 */

function safeApplicationState() {
    try {
        const state =
            getApplicationState?.();

        return {
            applicationState:
                state?.status ||
                state?.applicationState ||
                state?.state ||
                'unknown',

            bootstrapPhase:
                state?.bootstrapPhase ||
                state?.phase ||
                'unknown',

            activeRequests:
                safePositiveInteger(
                    state?.activeRequests ||
                    state?.metrics?.activeRequests
                ),

            socketConnections:
                safePositiveInteger(
                    state?.socketConnections ||
                    state?.metrics?.socketConnections
                )
        };
    } catch {
        return {
            applicationState:
                'unknown',

            bootstrapPhase:
                'unknown',

            activeRequests:
                0,

            socketConnections:
                0
        };
    }
}

/**
 * ============================================================================
 * CONFIGURATION SANITIZATION
 * ============================================================================
 *
 * Diagnostics may optionally include configuration, but secret-like fields
 * are aggressively removed/redacted.
 * ============================================================================
 */

const SECRET_KEY_PATTERN =
    /password|passwd|secret|token|authorization|cookie|private.?key|client.?secret|access.?key|api.?key|credential|connection.?string|database.?url|mongodb.?uri|redis.?url/i;

function sanitizeConfigurationForDiagnostics(
    value,
    depth = 0
) {
    if (
        depth > 5
    ) {
        return '[TRUNCATED]';
    }

    if (
        value === null ||
        value === undefined
    ) {
        return value;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value.toISOString();
    }

    if (
        Array.isArray(value)
    ) {
        return value
            .slice(0, 100)
            .map(
                item =>
                    sanitizeConfigurationForDiagnostics(
                        item,
                        depth + 1
                    )
            );
    }

    if (
        typeof value !== 'object'
    ) {
        return String(value);
    }

    const output = {};

    for (
        const [
            key,
            entry
        ] of Object.entries(value)
    ) {
        if (
            SECRET_KEY_PATTERN.test(
                key
            )
        ) {
            output[key] =
                '[REDACTED]';

            continue;
        }

        output[key] =
            sanitizeConfigurationForDiagnostics(
                entry,
                depth + 1
            );
    }

    return output;
}

/**
 * ============================================================================
 * LIFECYCLE HELPERS
 * ============================================================================
 *
 * These wrappers preserve the existing state module API while providing one
 * central runtime surface for consumers.
 * ============================================================================
 */

function startApplication() {
    return markApplicationStarted();
}

function readyApplication() {
    return markApplicationReady();
}

function shutdownApplication() {
    return markApplicationShutdown();
}

function stopApplication() {
    return markApplicationStopped();
}

function setBootstrapPhase(
    phase
) {
    return updateBootstrapPhase(
        phase
    );
}

/**
 * ============================================================================
 * REQUEST/RESOURCE COUNTERS
 * ============================================================================
 */

function requestStarted() {
    return incrementActiveRequests();
}

function requestFinished() {
    return decrementActiveRequests();
}

function socketConnected() {
    return incrementSocketConnections();
}

function socketDisconnected() {
    return decrementSocketConnections();
}

/**
 * ============================================================================
 * ENVIRONMENT METADATA
 * ============================================================================
 *
 * Returns safe, allow-listed deployment metadata only.
 * ============================================================================
 */

function getEnvironmentMetadata() {
    return Object.freeze({

        environment:
            deploymentMetadata.environment,

        deploymentMode:
            deploymentMetadata.deploymentMode,

        region:
            deploymentMetadata.region,

        availabilityZone:
            deploymentMetadata.availabilityZone,

        cluster:
            deploymentMetadata.cluster,

        namespace:
            deploymentMetadata.namespace,

        pod:
            deploymentMetadata.pod,

        node:
            deploymentMetadata.node,

        instance:
            deploymentMetadata.instance,

        processManager:
            deploymentMetadata.processManager,

        tenantMode:
            deploymentMetadata.tenantMode
    });
}

/**
 * ============================================================================
 * RUNTIME IDENTITY
 * ============================================================================
 */

function getRuntimeIdentity() {
    return Object.freeze({

        service:
            SERVICE_NAME,

        application:
            buildMetadata.applicationName,

        version:
            buildMetadata.version,

        release:
            buildMetadata.release,

        buildNumber:
            buildMetadata.buildNumber,

        gitCommit:
            buildMetadata.gitCommit,

        gitBranch:
            buildMetadata.gitBranch,

        environment:
            deploymentMetadata.environment,

        fingerprint:
            RUNTIME_FINGERPRINT.identifier,

        processId:
            runtimeMetadata.processId,

        hostname:
            runtimeMetadata.hostname,

        nodeVersion:
            runtimeMetadata.nodeVersion
    });
}

/**
 * ============================================================================
 * RUNTIME CAPABILITIES
 * ============================================================================
 */

function getRuntimeCapabilities() {
    return Object.freeze({

        nodeCluster:
            Boolean(
                infrastructure.cluster
            ),

        docker:
            infrastructure.docker,

        kubernetes:
            infrastructure.kubernetes,

        pm2:
            infrastructure.pm2,

        ci:
            infrastructure.ci,

        production:
            infrastructure.production,

        development:
            infrastructure.development,

        test:
            infrastructure.test,

        multiTenant:
            deploymentMetadata.tenantMode !==
            'single'
    });
}

/**
 * ============================================================================
 * EVENT HELPERS
 * ============================================================================
 */

function emitRuntimeEvent(
    eventName,
    payload = {}
) {
    if (
        !runtimeEvents ||
        typeof runtimeEvents.emit !==
        'function'
    ) {
        return false;
    }

    runtimeEvents.emit(
        eventName,
        {
            service:
                SERVICE_NAME,

            fingerprint:
                RUNTIME_FINGERPRINT.identifier,

            timestamp:
                new Date().toISOString(),

            ...payload
        }
    );

    return true;
}

/**
 * ============================================================================
 * INITIALIZATION EVENT
 * ============================================================================
 */

try {
    emitRuntimeEvent(
        'runtime:initialized',
        {
            environment:
                deploymentMetadata.environment,

            processId:
                runtimeMetadata.processId
        }
    );
} catch {
    /*
     * Runtime initialization metadata is non-critical.
     */
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 *
 * Existing exports are retained for compatibility.
 * Additional helpers provide a stronger enterprise runtime API.
 * ============================================================================
 */

module.exports = Object.freeze({

    // -------------------------------------------------------------------------
    // Identity
    // -------------------------------------------------------------------------

    APPLICATION,

    buildMetadata,

    runtimeMetadata,

    infrastructure,

    deploymentMetadata,

    BOOTSTRAP,

    RUNTIME_FINGERPRINT,

    runtimeContext,

    packageJson,

    configuration,

    // -------------------------------------------------------------------------
    // Runtime diagnostics
    // -------------------------------------------------------------------------

    buildRuntimeSnapshot,

    getEnvironmentMetadata,

    getRuntimeIdentity,

    getRuntimeCapabilities,

    emitRuntimeEvent,

    // -------------------------------------------------------------------------
    // Runtime events / state
    // -------------------------------------------------------------------------

    runtimeEvents,

    applicationState,

    BOOTSTRAP_PHASES,

    getApplicationState,

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    markApplicationStarted,

    markApplicationReady,

    markApplicationShutdown,

    markApplicationStopped,

    updateBootstrapPhase,

    startApplication,

    readyApplication,

    shutdownApplication,

    stopApplication,

    setBootstrapPhase,

    // -------------------------------------------------------------------------
    // Request/socket accounting
    // -------------------------------------------------------------------------

    incrementActiveRequests,

    decrementActiveRequests,

    incrementSocketConnections,

    decrementSocketConnections,

    requestStarted,

    requestFinished,

    socketConnected,

    socketDisconnected,

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    SERVICE_NAME,

    COMPANY_NAME,

    PLATFORM_NAME,

    CONTEXT_KEY_NAMES
});
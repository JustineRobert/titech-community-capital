"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Runtime Startup Banner
 * =============================================================================
 *
 * File:
 *   backend/runtime/startupBanner.js
 *
 * Purpose:
 *   Production-grade startup banner and runtime identity presentation for the
 *   TITech Community Capital backend.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 *   ✓ Consistent TITech application identity
 *   ✓ Build/version/environment information
 *   ✓ Process/runtime information
 *   ✓ Network binding information
 *   ✓ Deployment/runtime metadata
 *   ✓ Multi-tenant runtime visibility
 *   ✓ Optional custom fields
 *   ✓ Structured output support
 *   ✓ Safe environment-aware presentation
 *   ✓ Test-friendly API
 *
 * Design Principles
 * -----------------------------------------------------------------------------
 *   - Startup output must be useful to operators.
 *   - Secrets and credentials must never be printed.
 *   - Runtime metadata should be deterministic and readable.
 *   - The banner must not make application startup fail.
 *   - Compatible with ServerRuntime and bootstrap orchestration.
 *
 * =============================================================================
 */

const os = require("os");

// =============================================================================
// Defaults
// =============================================================================

const DEFAULTS = Object.freeze({

    NAME:
        process.env.APP_NAME ||
        "TITech Community Capital",

    VERSION:
        process.env.APP_VERSION ||
        "1.0.0",

    ENVIRONMENT:
        process.env.NODE_ENV ||
        "development",

    PORT:
        process.env.PORT ||
        null,

    HOST:
        process.env.HOST ||
        "0.0.0.0",

    API_PREFIX:
        process.env.API_PREFIX ||
        "/api",

    API_VERSION:
        process.env.API_VERSION ||
        "v1",

    TENANCY_MODE:
        process.env.TENANCY_MODE ||
        process.env.MULTI_TENANT_MODE ||
        "SCHEMA",

    DEPLOYMENT_MODE:
        process.env.DEPLOYMENT_MODE ||
        "standalone",

    LOG_PREFIX:
        "[TITech]",

    SHOW_HOSTNAME:
        process.env.STARTUP_BANNER_SHOW_HOSTNAME !==
        "false",

    SHOW_RUNTIME:
        process.env.STARTUP_BANNER_SHOW_RUNTIME !==
        "false",

    SHOW_BUILD:
        process.env.STARTUP_BANNER_SHOW_BUILD !==
        "false",

    SHOW_INFRASTRUCTURE:
        process.env.STARTUP_BANNER_SHOW_INFRASTRUCTURE !==
        "false",

    USE_ANSI:
        process.env.STARTUP_BANNER_ANSI !==
        "false"

});

// =============================================================================
// Helpers
// =============================================================================

function normalizeString(
    value,
    fallback = ""
) {

    if (
        value === undefined ||
        value === null
    ) {

        return fallback;

    }

    const normalized =
        String(value).trim();

    return normalized ||
        fallback;

}

function normalizeEnvironment(
    value
) {

    return normalizeString(
        value,
        "development"
    ).toLowerCase();

}

function formatMemory(
    bytes
) {

    if (
        !Number.isFinite(
            Number(bytes)
        )
    ) {

        return "unknown";

    }

    const mb =
        Number(bytes) /
        1024 /
        1024;

    return `${mb.toFixed(1)} MB`;

}

function detectInfrastructure() {

    return {

        docker:
            Boolean(
                process.env.KUBERNETES_SERVICE_HOST
            ) ||
            (() => {

                try {

                    return require("fs")
                        .existsSync(
                            "/.dockerenv"
                        );

                } catch {

                    return false;

                }

            })(),

        kubernetes:
            Boolean(
                process.env.KUBERNETES_SERVICE_HOST
            ),

        pm2:
            Boolean(
                process.env.pm_id
            ),

        cluster:
            Boolean(
                process.env.NODE_UNIQUE_ID
            ),

        ci:
            Boolean(
                process.env.CI
            ),

        githubActions:
            Boolean(
                process.env.GITHUB_ACTIONS
            ),

        aws:
            Boolean(
                process.env.AWS_REGION
            ),

        gcp:
            Boolean(
                process.env.GOOGLE_CLOUD_PROJECT
            )

    };

}

// =============================================================================
// Banner Data Builder
// =============================================================================

function buildStartupBannerData(
    options = {}
) {

    const environment =
        normalizeEnvironment(
            options.environment ??
            DEFAULTS.ENVIRONMENT
        );

    const startedAt =
        options.startedAt ||
        new Date();

    const version =
        normalizeString(
            options.version,
            DEFAULTS.VERSION
        );

    const name =
        normalizeString(
            options.name,
            DEFAULTS.NAME
        );

    const host =
        normalizeString(
            options.host,
            DEFAULTS.HOST
        );

    const port =
        options.port ??
        DEFAULTS.PORT;

    const buildNumber =
        normalizeString(
            options.buildNumber,
            process.env.BUILD_NUMBER ||
            "local"
        );

    const buildDate =
        normalizeString(
            options.buildDate,
            process.env.BUILD_DATE ||
            null
        );

    const gitCommit =
        normalizeString(
            options.gitCommit,
            process.env.GIT_COMMIT ||
            process.env.GITHUB_SHA ||
            "unknown"
        );

    const gitBranch =
        normalizeString(
            options.gitBranch,
            process.env.GIT_BRANCH ||
            process.env.GITHUB_REF_NAME ||
            "unknown"
        );

    const infrastructure =
        options.infrastructure ||
        detectInfrastructure();

    return {

        application: {

            name,

            version,

            environment,

            apiPrefix:
                normalizeString(
                    options.apiPrefix,
                    DEFAULTS.API_PREFIX
                ),

            apiVersion:
                normalizeString(
                    options.apiVersion,
                    DEFAULTS.API_VERSION
                )

        },

        process: {

            pid:
                process.pid,

            parentPid:
                process.ppid,

            platform:
                process.platform,

            architecture:
                process.arch,

            nodeVersion:
                process.version,

            hostname:
                os.hostname(),

            cpuCount:
                os.cpus().length,

            uptime:
                process.uptime(),

            memory: {

                rss:
                    formatMemory(
                        process.memoryUsage()
                            .rss
                    ),

                heapUsed:
                    formatMemory(
                        process.memoryUsage()
                            .heapUsed
                    ),

                heapTotal:
                    formatMemory(
                        process.memoryUsage()
                            .heapTotal
                    )

            }

        },

        network: {

            host,

            port,

            protocol:
                options.protocol ||
                (
                    process.env.ENABLE_HTTPS ===
                    "true"
                        ? "https"
                        : "http"
                )

        },

        tenancy: {

            mode:
                normalizeString(
                    options.tenancyMode,
                    DEFAULTS.TENANCY_MODE
                ).toUpperCase(),

            multiTenant:
                options.multiTenant !==
                undefined
                    ? Boolean(
                        options.multiTenant
                    )
                    : true

        },

        deployment: {

            mode:
                normalizeString(
                    options.deploymentMode,
                    DEFAULTS.DEPLOYMENT_MODE
                ),

            region:
                normalizeString(
                    options.region,
                    process.env.REGION ||
                    process.env.AWS_REGION ||
                    "unknown"
                ),

            availabilityZone:
                normalizeString(
                    options.availabilityZone,
                    process.env.AVAILABILITY_ZONE ||
                    "unknown"
                ),

            namespace:
                normalizeString(
                    options.namespace,
                    process.env.K8S_NAMESPACE ||
                    process.env.NAMESPACE ||
                    "default"
                ),

            pod:
                normalizeString(
                    options.pod,
                    process.env.POD_NAME ||
                    null
                ),

            instance:
                normalizeString(
                    options.instance,
                    process.env.INSTANCE_ID ||
                    os.hostname()
                )

        },

        build: {

            number:
                buildNumber,

            date:
                buildDate,

            commit:
                gitCommit,

            branch:
                gitBranch

        },

        infrastructure,

        lifecycle: {

            startedAt:
                new Date(
                    startedAt
                ).toISOString(),

            generatedAt:
                new Date()
                    .toISOString()

        }

    };

}

// =============================================================================
// ANSI Helpers
// =============================================================================

function ansi(
    code,
    value,
    enabled
) {

    if (
        !enabled
    ) {

        return value;

    }

    return `\u001b[${code}m${value}\u001b[0m`;

}

// =============================================================================
// Text Renderer
// =============================================================================

function renderStartupBanner(
    data,
    options = {}
) {

    const ansiEnabled =
        options.useAnsi ??
        DEFAULTS.USE_ANSI;

    const width =
        Math.max(
            Number(
                options.width ||
                76
            ),
            60
        );

    const line =
        "=".repeat(
            width
        );

    const title =
        `${data.application.name}`;

    const rows = [

        `${data.application.name}`,

        `Version       : ${data.application.version}`,

        `Environment   : ${data.application.environment}`,

        `API           : ${data.application.apiPrefix}/${data.application.apiVersion}`,

        `Server        : ${data.network.protocol}://${data.network.host}:${data.network.port ?? "auto"}`,

        `PID           : ${data.process.pid}`,

        `Node          : ${data.process.nodeVersion}`,

        `Platform      : ${data.process.platform} ${data.process.architecture}`,

        `Hostname      : ${data.process.hostname}`,

        `Tenancy       : ${data.tenancy.mode}`,

        `Deployment    : ${data.deployment.mode}`,

        `Region        : ${data.deployment.region}`,

        `Started       : ${data.lifecycle.startedAt}`

    ];

    if (
        options.showRuntime ??
        DEFAULTS.SHOW_RUNTIME
    ) {

        rows.push(
            `Memory RSS    : ${data.process.memory.rss}`
        );

        rows.push(
            `CPU Count     : ${data.process.cpuCount}`
        );

    }

    if (
        options.showBuild ??
        DEFAULTS.SHOW_BUILD
    ) {

        rows.push(
            `Build         : ${data.build.number}`
        );

        rows.push(
            `Git Commit    : ${data.build.commit}`
        );

        rows.push(
            `Git Branch    : ${data.build.branch}`
        );

    }

    if (
        options.showInfrastructure ??
        DEFAULTS.SHOW_INFRASTRUCTURE
    ) {

        const activeInfrastructure =
            Object.entries(
                data.infrastructure
            )
                .filter(
                    ([, active]) =>
                        Boolean(active)
                )
                .map(
                    ([name]) =>
                        name
                );

        rows.push(
            `Infrastructure: ${
                activeInfrastructure.length
                    ? activeInfrastructure.join(", ")
                    : "standalone"
            }`
        );

    }

    const renderedTitle =
        ansi(
            "1;36",
            title,
            ansiEnabled
        );

    const renderedEnvironment =
        ansi(
            "1;33",
            data.application.environment
                .toUpperCase(),
            ansiEnabled
        );

    const renderedRows =
        rows.map(
            row =>
                row.startsWith(
                    data.application.name
                )
                    ? ` ${ansi(
                        "1;36",
                        row,
                        ansiEnabled
                    )}`
                    : ` ${row.replace(
                        data.application.environment,
                        renderedEnvironment
                    )}`
        );

    return [

        "",

        line,

        ` ${renderedTitle}`,

        line,

        ...renderedRows,

        line,

        ""

    ].join(
        "\n"
    );

}

// =============================================================================
// JSON Renderer
// =============================================================================

function renderStartupJson(
    data
) {

    return JSON.stringify(
        {

            event:
                "titech.startup",

            ...data

        },
        null,
        2
    );

}

// =============================================================================
// Main Display Function
// =============================================================================

function displayStartupBanner(
    options = {}
) {

    try {

        const data =
            buildStartupBannerData(
                options
            );

        const format =
            options.format ||
            process.env.STARTUP_BANNER_FORMAT ||
            "text";

        if (
            format ===
            "json"
        ) {

            console.log(
                renderStartupJson(
                    data
                )
            );

        } else {

            console.log(
                renderStartupBanner(
                    data,
                    options
                )
            );

        }

        return data;

    } catch (error) {

        /*
         * Startup observability must never become a startup dependency.
         */

        try {

            console.warn(
                `${DEFAULTS.LOG_PREFIX} startup banner failed:`,
                error.message
            );

        } catch {
            // Deliberately ignore secondary console failures.
        }

        return null;

    }

}

// =============================================================================
// Logger Adapter
// =============================================================================

function createStartupBannerLogger(
    options = {}
) {

    return {

        display() {

            return displayStartupBanner(
                options
            );

        },

        data() {

            return buildStartupBannerData(
                options
            );

        },

        text() {

            return renderStartupBanner(
                buildStartupBannerData(
                    options
                ),
                options
            );

        },

        json() {

            return renderStartupJson(
                buildStartupBannerData(
                    options
                )
            );

        }

    };

}

// =============================================================================
// Public API
// =============================================================================

module.exports =
    Object.freeze({

        displayStartupBanner,

        buildStartupBannerData,

        renderStartupBanner,

        renderStartupJson,

        createStartupBannerLogger,

        DEFAULTS

    });
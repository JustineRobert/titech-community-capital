"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/src/infrastructure/monitoring/uptime.service.js
 * Enterprise Uptime Service
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * ✓ Process Uptime Tracking
 * ✓ Availability Monitoring
 * ✓ Service Health Status
 * ✓ Restart Detection
 * ✓ SLA Monitoring
 * ✓ Kubernetes Readiness Support
 * ✓ Prometheus Ready
 * ============================================================================
 */

const os = require("os");

class UptimeService {

    constructor() {

        this.startedAt =
            new Date();

        this.processStartTime =
            Date.now();

        this.totalChecks = 0;

        this.successfulChecks = 0;

        this.failedChecks = 0;

        this.lastFailureAt = null;

        this.lastSuccessAt = null;

        this.version =
            process.env.APP_VERSION ||
            "1.0.0";
    }

    /* ===================================================================== */
    /* RECORD HEALTH CHECK                                                   */
    /* ===================================================================== */

    recordSuccess() {

        this.totalChecks += 1;

        this.successfulChecks += 1;

        this.lastSuccessAt =
            new Date();
    }

    recordFailure(
        error = null
    ) {

        this.totalChecks += 1;

        this.failedChecks += 1;

        this.lastFailureAt =
            new Date();

        this.lastFailureReason =
            error
                ? error.message
                : null;
    }

    /* ===================================================================== */
    /* UPTIME                                                                */
    /* ===================================================================== */

    getUptimeSeconds() {

        return Math.floor(
            process.uptime()
        );
    }

    getUptimeMinutes() {

        return Number(
            (
                process.uptime() / 60
            ).toFixed(2)
        );
    }

    getUptimeHours() {

        return Number(
            (
                process.uptime() /
                3600
            ).toFixed(2)
        );
    }

    getUptimeDays() {

        return Number(
            (
                process.uptime() /
                86400
            ).toFixed(2)
        );
    }

    /* ===================================================================== */
    /* AVAILABILITY                                                          */
    /* ===================================================================== */

    getAvailabilityPercentage() {

        if (
            this.totalChecks === 0
        ) {

            return 100;
        }

        return Number(

            (
                (
                    this.successfulChecks /
                    this.totalChecks
                ) * 100
            ).toFixed(4)
        );
    }

    /* ===================================================================== */
    /* MEMORY                                                                */
    /* ===================================================================== */

    getMemoryUsage() {

        const memory =
            process.memoryUsage();

        return {

            rss:
                memory.rss,

            heapTotal:
                memory.heapTotal,

            heapUsed:
                memory.heapUsed,

            external:
                memory.external,

            arrayBuffers:
                memory.arrayBuffers
        };
    }

    /* ===================================================================== */
    /* SYSTEM                                                                */
    /* ===================================================================== */

    getSystemInfo() {

        return {

            hostname:
                os.hostname(),

            platform:
                os.platform(),

            architecture:
                os.arch(),

            cpuCores:
                os.cpus().length,

            loadAverage:
                os.loadavg(),

            totalMemory:
                os.totalmem(),

            freeMemory:
                os.freemem()
        };
    }

    /* ===================================================================== */
    /* HEALTH STATUS                                                         */
    /* ===================================================================== */

    getHealthStatus() {

        const availability =
            this.getAvailabilityPercentage();

        if (
            availability >= 99.9
        ) {

            return "HEALTHY";
        }

        if (
            availability >= 95
        ) {

            return "DEGRADED";
        }

        return "UNHEALTHY";
    }

    /* ===================================================================== */
    /* DIAGNOSTICS                                                           */
    /* ===================================================================== */

    getDiagnostics() {

        return {

            service:
                "uptime-service",

            version:
                this.version,

            status:
                this.getHealthStatus(),

            startedAt:
                this.startedAt,

            uptime: {

                seconds:
                    this.getUptimeSeconds(),

                minutes:
                    this.getUptimeMinutes(),

                hours:
                    this.getUptimeHours(),

                days:
                    this.getUptimeDays()
            },

            availability: {

                percentage:
                    this.getAvailabilityPercentage(),

                totalChecks:
                    this.totalChecks,

                successfulChecks:
                    this.successfulChecks,

                failedChecks:
                    this.failedChecks
            },

            lastEvents: {

                lastSuccessAt:
                    this.lastSuccessAt,

                lastFailureAt:
                    this.lastFailureAt,

                lastFailureReason:
                    this.lastFailureReason ||
                    null
            },

            process: {

                pid:
                    process.pid,

                nodeVersion:
                    process.version,

                environment:
                    process.env.NODE_ENV
            },

            memory:
                this.getMemoryUsage(),

            system:
                this.getSystemInfo(),

            timestamp:
                new Date().toISOString()
        };
    }

    /* ===================================================================== */
    /* SLA                                                                   */
    /* ===================================================================== */

    getSlaReport() {

        return {

            uptimePercentage:
                this.getAvailabilityPercentage(),

            target:
                "99.9%",

            compliant:
                this.getAvailabilityPercentage() >= 99.9
        };
    }

    /* ===================================================================== */
    /* RESTART DETECTION                                                     */
    /* ===================================================================== */

    getRestartInfo() {

        return {

            startedAt:
                this.startedAt,

            processStartTime:
                this.processStartTime,

            uptimeSeconds:
                process.uptime()
        };
    }
}

/* ============================================================================
 * EXPORTS
 * ========================================================================== */

const uptimeService =
    new UptimeService();

module.exports =
    uptimeService;

module.exports.UptimeService =
    UptimeService;
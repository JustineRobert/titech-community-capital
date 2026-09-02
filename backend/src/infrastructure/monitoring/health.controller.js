"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Health Controller
 * Infrastructure Monitoring
 * ============================================================================
 */

const os = require("os");
const mongoose = require("mongoose");

const prometheusService =
    require("./prometheus.service");

let redisClient = null;

try {

    redisClient =
        require("../../config/redis");

} catch (_) {

    redisClient = null;
}

/* ============================================================================
 * Health Controller
 * ========================================================================== */

class HealthController {

    constructor() {

        this.startedAt =
            new Date();

        this.version =
            process.env.APP_VERSION || "1.0.0";
    }

    /* ===================================================================== */
    /* BASIC HEALTH                                                         */
    /* ===================================================================== */

    async health(
        req,
        res
    ) {

        return res.status(200).json({

            success: true,

            status:
                "healthy",

            service:
                "TITech Platform",

            version:
                this.version,

            timestamp:
                new Date().toISOString()
        });
    }

    /* ===================================================================== */
    /* LIVENESS                                                             */
    /* ===================================================================== */

    async live(
        req,
        res
    ) {

        return res.status(200).json({

            alive: true,

            timestamp:
                new Date().toISOString()
        });
    }

    /* ===================================================================== */
    /* READINESS                                                            */
    /* ===================================================================== */

    async ready(
        req,
        res
    ) {

        try {

            const checks =
                await this.getDependencyChecks();

            const healthy =
                Object.values(checks)
                    .every(
                        item => item.status === "UP"
                    );

            return res
                .status(
                    healthy
                        ? 200
                        : 503
                )
                .json({

                    ready:
                        healthy,

                    checks,

                    timestamp:
                        new Date().toISOString()
                });

        } catch (error) {

            return res.status(503).json({

                ready: false,

                error:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* DETAILED HEALTH                                                      */
    /* ===================================================================== */

    async details(
        req,
        res
    ) {

        try {

            const dependencies =
                await this.getDependencyChecks();

            const memory =
                this.getMemoryUsage();

            const cpu =
                this.getCpuInfo();

            const uptime =
                process.uptime();

            const eventLoop =
                this.getEventLoopStatus();

            return res.status(200).json({

                success: true,

                service:
                    "TITech Platform",

                version:
                    this.version,

                startedAt:
                    this.startedAt,

                uptimeSeconds:
                    uptime,

                environment:
                    process.env.NODE_ENV,

                dependencies,

                memory,

                cpu,

                eventLoop,

                timestamp:
                    new Date().toISOString()
            });

        } catch (error) {

            return res.status(500).json({

                success: false,

                message:
                    error.message
            });
        }
    }

    /* ===================================================================== */
    /* PROMETHEUS                                                           */
    /* ===================================================================== */

    async metrics(
        req,
        res
    ) {

        res.set(

            "Content-Type",

            prometheusService
                .contentType()
        );

        return res.end(

            await prometheusService
                .metrics()
        );
    }

    /* ===================================================================== */
    /* DEPENDENCIES                                                         */
    /* ===================================================================== */

    async getDependencyChecks() {

        return {

            mongodb:
                await this.mongoStatus(),

            redis:
                await this.redisStatus(),

            process: {

                status:
                    "UP"
            }
        };
    }

    async mongoStatus() {

        try {

            const state =
                mongoose.connection.readyState;

            return {

                status:
                    state === 1
                        ? "UP"
                        : "DOWN",

                readyState:
                    state
            };

        } catch (error) {

            return {

                status:
                    "DOWN",

                error:
                    error.message
            };
        }
    }

    async redisStatus() {

        try {

            if (!redisClient) {

                return {

                    status:
                        "NOT_CONFIGURED"
                };
            }

            return {

                status:
                    "UP"
            };

        } catch (error) {

            return {

                status:
                    "DOWN",

                error:
                    error.message
            };
        }
    }

    /* ===================================================================== */
    /* MEMORY                                                               */
    /* ===================================================================== */

    getMemoryUsage() {

        const usage =
            process.memoryUsage();

        return {

            rss:
                usage.rss,

            heapTotal:
                usage.heapTotal,

            heapUsed:
                usage.heapUsed,

            external:
                usage.external
        };
    }

    /* ===================================================================== */
    /* CPU                                                                  */
    /* ===================================================================== */

    getCpuInfo() {

        return {

            cores:
                os.cpus().length,

            loadAverage:
                os.loadavg(),

            architecture:
                os.arch(),

            platform:
                os.platform()
        };
    }

    /* ===================================================================== */
    /* EVENT LOOP                                                           */
    /* ===================================================================== */

    getEventLoopStatus() {

        return {

            pid:
                process.pid,

            uptime:
                process.uptime()
        };
    }
}

/* ============================================================================
 * EXPORT
 * ========================================================================== */

const healthController =
    new HealthController();

module.exports =
    healthController;

module.exports.HealthController =
    HealthController;
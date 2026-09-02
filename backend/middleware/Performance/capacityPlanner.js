'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/performance/capacityPlanner.js
 *
 * Enterprise Capacity Planning Middleware
 *
 * =============================================================================
 *
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Enterprise capacity planning engine responsible for continuously evaluating
 * infrastructure utilization, workload growth, database capacity,
 * storage consumption, and SaaS tenant expansion.
 *
 * Rather than scaling infrastructure directly, this component produces
 * intelligent recommendations that may be consumed by:
 *
 * • Kubernetes HPA/VPA
 * • Cluster Autoscaler
 * • Terraform
 * • GitHub Actions
 * • Grafana
 * • Prometheus
 * • Executive dashboards
 * • Operations Center
 *
 * =============================================================================
 */

const os = require('os');

/* ============================================================================
 * Optional Enterprise Dependencies
 * ========================================================================== */

function optionalRequire(path) {

    try {

        return require(path);

    } catch (_) {

        return null;

    }

}

const EventBus =
    optionalRequire('../../shared/events/EventBus');

const TraceContext =
    optionalRequire('../../shared/tracing/TraceContext');

const MetricsRegistry =
    optionalRequire('../../shared/metrics/MetricsRegistry');

const StructuredLogger =
    optionalRequire('../../shared/logging/StructuredLogger');

/* ============================================================================
 * Component Identity
 * ========================================================================== */

const COMPONENT_NAME =
    'capacityPlanner';

const COMPONENT_VERSION =
    '1.0.0';

/* ============================================================================
 * Enterprise Defaults
 * ========================================================================== */

const DEFAULT_POLICY = Object.freeze({

    historySize: 720,

    planningHorizonDays: 30,

    cpuTarget: 65,

    memoryTarget: 70,

    databaseTarget: 75,

    storageTarget: 80,

    tenantGrowthThreshold: 15,

    scaleRecommendationThreshold: 80

});

/* ============================================================================
 * Runtime State
 * ========================================================================== */

const STATE = Object.seal({

    initialized: false,

    initializedAt: null,

    lastEvaluation: null,

    evaluations: 0,

    recommendationsGenerated: 0

});

/* ============================================================================
 * Historical Capacity Store
 * ========================================================================== */

const HISTORY = [];

/* ============================================================================
 * Utility
 * ========================================================================== */

function average(values) {

    if (!values.length) {

        return 0;

    }

    return values.reduce(

        (a, b) => a + b,

        0

    ) / values.length;

}

function percentile(values, p) {

    if (!values.length) {

        return 0;

    }

    const sorted =
        [...values].sort((a, b) => a - b);

    const index =
        Math.floor(

            (sorted.length - 1) * p

        );

    return sorted[index];

}

/* ============================================================================
 * Snapshot Collection
 * ========================================================================== */

function collectSnapshot(snapshot = {}) {

    const item = Object.freeze({

        timestamp:
            Date.now(),

        cpu:
            snapshot.cpu || 0,

        memory:
            snapshot.memory || 0,

        requests:
            snapshot.requests || 0,

        tenants:
            snapshot.tenants || 0,

        database:
            snapshot.database || {},

        storage:
            snapshot.storage || {}

    });

    HISTORY.push(item);

    while (

        HISTORY.length >

        DEFAULT_POLICY.historySize

    ) {

        HISTORY.shift();

    }

    return item;

}

/* ============================================================================
 * Tenant Growth Forecast
 * ========================================================================== */

function forecastTenantGrowth() {

    if (

        HISTORY.length < 2

    ) {

        return {

            current: 0,

            projected30Days: 0,

            monthlyGrowthPercent: 0

        };

    }

    const first =
        HISTORY[0];

    const last =
        HISTORY[HISTORY.length - 1];

    const growth =
        Math.max(

            0,

            last.tenants -

            first.tenants

        );

    const percent =

        first.tenants > 0

            ?

            (growth / first.tenants) * 100

            :

            0;

    return {

        current:
            last.tenants,

        projected30Days:

            Math.round(

                last.tenants *

                (1 + percent / 100)

            ),

        monthlyGrowthPercent:

            Number(

                percent.toFixed(2)

            )

    };

}

/* ============================================================================
 * Database Capacity Forecast
 * ========================================================================== */

function forecastDatabaseCapacity() {

    const utilization =

        average(

            HISTORY.map(

                h =>

                    h.database.utilization || 0

            )

        );

    return {

        averageUtilization:

            utilization,

        projectedUtilization:

            Math.min(

                utilization * 1.15,

                100

            ),

        recommendation:

            utilization >

            DEFAULT_POLICY.databaseTarget

                ?

                'SCALE_DATABASE'

                :

                'SUFFICIENT'

    };

}

/* ============================================================================
 * Storage Forecast
 * ========================================================================== */

function forecastStorage() {

    const usage =

        average(

            HISTORY.map(

                h =>

                    h.storage.usedPercent || 0

            )

        );

    return {

        currentUsage:

            usage,

        projectedUsage:

            Math.min(

                usage * 1.12,

                100

            ),

        recommendation:

            usage >

            DEFAULT_POLICY.storageTarget

                ?

                'EXPAND_STORAGE'

                :

                'SUFFICIENT'

    };

}

/* ============================================================================
 * Infrastructure Capacity
 * ========================================================================== */

function infrastructurePlan() {

    const cpu =

        average(

            HISTORY.map(

                h =>

                    h.cpu

            )

        );

    const memory =

        average(

            HISTORY.map(

                h =>

                    h.memory

            )

        );

    return {

        averageCPU:
            cpu,

        averageMemory:
            memory,

        cpu95:

            percentile(

                HISTORY.map(

                    h =>

                        h.cpu

                ),

                0.95

            ),

        memory95:

            percentile(

                HISTORY.map(

                    h =>

                        h.memory

                ),

                0.95

            ),

        recommendation:

            cpu >

                DEFAULT_POLICY.cpuTarget ||

            memory >

                DEFAULT_POLICY.memoryTarget

                ?

                'ADD_APPLICATION_NODES'

                :

                'CURRENT_CAPACITY_OK'

    };

}

/* ============================================================================
 * SaaS Scaling Strategy
 * ========================================================================== */

function scalingStrategy() {

    const tenant =
        forecastTenantGrowth();

    const infrastructure =
        infrastructurePlan();

    const database =
        forecastDatabaseCapacity();

    const storage =
        forecastStorage();

    return Object.freeze({

        planningHorizonDays:

            DEFAULT_POLICY

                .planningHorizonDays,

        tenant,

        infrastructure,

        database,

        storage

    });

}

/* ============================================================================
 * Recommendation Engine
 * ========================================================================== */

function generateRecommendations() {

    const strategy =
        scalingStrategy();

    const recommendations = [];

    if (

        strategy.infrastructure

            .recommendation !==

        'CURRENT_CAPACITY_OK'

    ) {

        recommendations.push({

            priority: 'HIGH',

            action:

                'Increase Kubernetes application replicas.'

        });

    }

    if (

        strategy.database

            .recommendation ===

        'SCALE_DATABASE'

    ) {

        recommendations.push({

            priority: 'HIGH',

            action:

                'Increase MongoDB cluster capacity.'

        });

    }

    if (

        strategy.storage

            .recommendation ===

        'EXPAND_STORAGE'

    ) {

        recommendations.push({

            priority: 'MEDIUM',

            action:

                'Provision additional storage.'

        });

    }

    if (

        strategy.tenant

            .monthlyGrowthPercent >

        DEFAULT_POLICY

            .tenantGrowthThreshold

    ) {

        recommendations.push({

            priority: 'MEDIUM',

            action:

                'Review SaaS tenant growth plan.'

        });

    }

    STATE.recommendationsGenerated++;

    return recommendations;

}

/* ============================================================================
 * Middleware
 * ========================================================================== */

function capacityPlanner() {

    STATE.initialized = true;

    STATE.initializedAt ||=

        new Date()

            .toISOString();

    return function capacityPlannerMiddleware(

        req,

        res,

        next

    ) {

        res.once(

            'finish',

            () => {

                STATE.evaluations++;

                STATE.lastEvaluation =

                    new Date()

                        .toISOString();

                MetricsRegistry

                    ?.record?.(

                        'capacity.evaluations',

                        1

                    );

                EventBus

                    ?.publish?.(

                        'capacity.evaluated',

                        {

                            traceId:

                                TraceContext

                                    ?.getTraceId?.(),

                            requestId:

                                req.id

                        }

                    );

            }

        );

        next();

    };

}

/* ============================================================================
 * Health
 * ========================================================================== */

async function healthCheck() {

    return {

        healthy: true,

        component:

            COMPONENT_NAME

    };

}

async function readinessCheck() {

    return {

        ready: true

    };

}

/* ============================================================================
 * Diagnostics
 * ========================================================================== */

function diagnostics() {

    return Object.freeze({

        metadata,

        runtime: {

            hostname:

                os.hostname(),

            pid:

                process.pid,

            uptime:

                process.uptime()

        },

        state:

            {

                ...STATE

            },

        history:

            HISTORY.length,

        strategy:

            scalingStrategy(),

        recommendations:

            generateRecommendations()

    });

}

/* ============================================================================
 * Metadata
 * ========================================================================== */

const metadata = Object.freeze({

    name:

        COMPONENT_NAME,

    version:

        COMPONENT_VERSION,

    category:

        'performance',

    phase:

        'capacity',

    priority:

        510,

    critical:

        false,

    description:

        'Enterprise infrastructure and SaaS capacity planning engine.'

});

/* ============================================================================
 * Public API
 * ========================================================================== */

module.exports = Object.freeze({

    create:

        capacityPlanner,

    capacityPlanner,

    collectSnapshot,

    forecastTenantGrowth,

    forecastDatabaseCapacity,

    forecastStorage,

    infrastructurePlan,

    scalingStrategy,

    generateRecommendations,

    healthCheck,

    readinessCheck,

    diagnostics,

    metadata,

    policy:

        DEFAULT_POLICY

});
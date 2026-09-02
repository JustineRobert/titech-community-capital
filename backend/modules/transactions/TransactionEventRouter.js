'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Transaction Event Router
 * ============================================================================
 *
 * File:
 *   backend/modules/transactions/TransactionEventRouter.js
 *
 * Purpose
 * -------
 * Enterprise deterministic routing layer for transaction-domain events.
 *
 * Responsibilities
 * ----------------
 * • Resolve event destination
 * • Tenant-isolated routing
 * • Aggregate ordering
 * • Provider routing
 * • Event-type routing
 * • Operation routing
 * • Deterministic partition keys
 * • Transport-safe topic/routing-key normalization
 * • Route validation
 * • Backward-compatible route configuration
 *
 * Supported Infrastructure
 * ------------------------
 * • Kafka
 * • RabbitMQ
 * • Redis Streams
 * • AWS SNS/SQS
 *
 * Design Principles
 * -----------------
 * • Deterministic routing
 * • No mutation of incoming events
 * • Tenant isolation
 * • Aggregate ordering preservation
 * • Provider-aware routing
 * • Safe defaults
 * • Strict-mode validation support
 * • Framework independent
 *
 * IMPORTANT
 * ---------
 * Routing does not publish events.
 *
 * It only calculates deterministic transport metadata.
 *
 * ============================================================================
 */

const crypto = require('crypto');


/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_TOPIC =
    'transactions.events';


const DEFAULT_MAX_TOPIC_LENGTH =
    249;


const DEFAULT_MAX_ROUTING_KEY_LENGTH =
    512;


const ROUTE_MATCH_TYPES = Object.freeze({

    EVENT:
        'EVENT',

    PROVIDER:
        'PROVIDER',

    AGGREGATE:
        'AGGREGATE',

    OPERATION:
        'OPERATION',

    DEFAULT:
        'DEFAULT'

});


/**
 * ============================================================================
 * Deep Clone / Freeze
 * ============================================================================
 *
 * Route configuration should not be mutated after construction.
 * ============================================================================
 */

function deepClone(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return value;

    }


    if (
        Array.isArray(value)
    ) {

        return value.map(
            deepClone
        );

    }


    if (
        typeof value !== 'object'
    ) {

        return value;

    }


    return Object.keys(value)
        .reduce(

            (
                output,
                key
            ) => {

                output[key] =
                    deepClone(
                        value[key]
                    );

                return output;

            },

            {}

        );

}


function deepFreeze(
    value,
    seen = new WeakSet()
) {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return value;

    }


    if (
        seen.has(value)
    ) {

        return value;

    }


    seen.add(value);


    for (
        const key
        of Reflect.ownKeys(value)
    ) {

        deepFreeze(
            value[key],
            seen
        );

    }


    return Object.freeze(
        value
    );

}


/**
 * ============================================================================
 * Router
 * ============================================================================
 */

class TransactionEventRouter {

    constructor(
        options = {}
    ) {

        this.routes =
            deepFreeze(
                deepClone(
                    options.routes &&
                    typeof options.routes === 'object'
                        ? options.routes
                        : {}
                )
            );


        this.defaultTopic =
            this.normalizeTopic(
                options.defaultTopic ||
                DEFAULT_TOPIC
            );


        this.defaultRoute =
            this.normalizeRoute(
                options.defaultRoute ||
                null
            );


        this.requireTenant =
            options.requireTenant !== false;


        this.requireAggregate =
            options.requireAggregate === true;


        this.strict =
            options.strict === true;


        this.includeTenantInPartitionKey =
            options.includeTenantInPartitionKey !== false;


        this.includeProviderInPartitionKey =
            options.includeProviderInPartitionKey === true;


        this.maxTopicLength =
            Number(
                options.maxTopicLength ||
                DEFAULT_MAX_TOPIC_LENGTH
            );


        this.maxRoutingKeyLength =
            Number(
                options.maxRoutingKeyLength ||
                DEFAULT_MAX_ROUTING_KEY_LENGTH
            );


        this.hashFallbackRouting =
            options.hashFallbackRouting !== false;


        this.hashAlgorithm =
            options.hashAlgorithm ||
            'sha256';

    }


    /**
     * =========================================================================
     * Resolve Route
     * =========================================================================
     */

    resolve(
        event
    ) {

        this.validateEvent(
            event
        );


        const route =
            this.resolveRouteDefinition(
                event
            );


        const provider =
            this.resolveProvider(
                event
            );


        const tenantRoutingKey =
            this.tenantRoutingKey(
                event
            );


        const aggregateRoutingKey =
            this.aggregateRoutingKey(
                event
            );


        const routingKey =
            this.resolvePartitionKey(
                event
            );


        return {

            topic:
                this.extractTopic(
                    route
                ),

            route:
                this.extractRoute(
                    route
                ),

            tenantId:
                event.tenantId ||
                null,

            provider,

            aggregate:
                this.normalizeAggregate(
                    event.aggregate
                ),

            eventType:
                this.normalizeEventType(
                    event.eventType
                ),

            operation:
                this.resolveOperation(
                    event
                ),

            routingKey,

            partitionKey:
                routingKey,

            tenantRoutingKey,

            aggregateRoutingKey,

            providerRoutingKey:
                this.providerRoutingKey(
                    event
                ),

            eventRoutingKey:
                this.eventRoutingKey(
                    event
                )

        };

    }


    /**
     * =========================================================================
     * Complete Route Definition Resolution
     * =========================================================================
     *
     * Priority:
     *
     * 1. Explicit event-type route
     * 2. Operation-specific route
     * 3. Provider-specific route
     * 4. Aggregate-type route
     * 5. Default route
     */

    resolveRouteDefinition(
        event
    ) {

        const eventType =
            this.normalizeEventType(
                event.eventType
            );


        const direct =
            this.lookupEventRoute(
                eventType
            );


        if (
            direct
        ) {

            return direct;

        }


        const operationRoute =
            this.lookupOperationRoute(
                event
            );


        if (
            operationRoute
        ) {

            return operationRoute;

        }


        const providerRoute =
            this.resolveProviderRoute(
                event
            );


        if (
            providerRoute
        ) {

            return providerRoute;

        }


        const aggregateRoute =
            this.resolveAggregateRoute(
                event
            );


        if (
            aggregateRoute
        ) {

            return aggregateRoute;

        }


        return {

            topic:
                this.defaultTopic,

            route:
                this.defaultRoute,

            matchType:
                ROUTE_MATCH_TYPES.DEFAULT

        };

    }


    /**
     * =========================================================================
     * Topic Resolution
     * =========================================================================
     */

    resolveTopic(
        event
    ) {

        this.validateEvent(
            event
        );


        const route =
            this.resolveRouteDefinition(
                event
            );


        return this.extractTopic(
            route
        );

    }


    /**
     * =========================================================================
     * Route Resolution
     * =========================================================================
     */

    resolveRoute(
        event
    ) {

        this.validateEvent(
            event
        );


        const route =
            this.resolveRouteDefinition(
                event
            );


        return this.extractRoute(
            route
        );

    }


    /**
     * =========================================================================
     * Event-Type Route
     * =========================================================================
     */

    lookupEventRoute(
        eventType
    ) {

        if (
            !eventType
        ) {

            return null;

        }


        const routes =
            this.routes.eventTypes ||
            this.routes.events ||
            null;


        const nestedRoute =
            routes &&
            typeof routes === 'object'
                ? (
                    routes[eventType] ||
                    routes[
                        eventType.toUpperCase()
                    ] ||
                    routes[
                        eventType.toLowerCase()
                    ]
                )
                : null;


        if (
            nestedRoute
        ) {

            return {

                ...this.normalizeRouteDefinition(
                    nestedRoute
                ),

                matchType:
                    ROUTE_MATCH_TYPES.EVENT

            };

        }


        /**
         * Backward compatibility:
         *
         * routes: {
         *   "TRANSACTION.CREATED": "transactions.created"
         * }
         */

        const direct =
            this.routes[eventType];


        if (
            direct
        ) {

            return {

                ...this.normalizeRouteDefinition(
                    direct
                ),

                matchType:
                    ROUTE_MATCH_TYPES.EVENT

            };

        }


        return null;

    }


    /**
     * =========================================================================
     * Operation Route
     * =========================================================================
     */

    lookupOperationRoute(
        event
    ) {

        const operation =
            this.resolveOperation(
                event
            );


        if (
            !operation
        ) {

            return null;

        }


        const operationRoutes =
            this.routes.operations;


        if (
            !operationRoutes ||
            typeof operationRoutes !== 'object'
        ) {

            return null;

        }


        const route =
            operationRoutes[operation] ||
            operationRoutes[
                operation.toUpperCase()
            ] ||
            null;


        if (
            !route
        ) {

            return null;

        }


        return {

            ...this.normalizeRouteDefinition(
                route
            ),

            matchType:
                ROUTE_MATCH_TYPES.OPERATION

        };

    }


    /**
     * =========================================================================
     * Provider Resolution
     * =========================================================================
     */

    resolveProvider(
        event
    ) {

        const provider =

            event.provider ||

            event.providerId ||

            event.metadata?.provider ||

            event.metadata?.providerId ||

            event.context?.provider ||

            null;


        if (
            provider === null ||
            provider === undefined
        ) {

            return null;

        }


        return String(
            provider
        )
            .trim()
            .toUpperCase();

    }


    /**
     * =========================================================================
     * Provider Route
     * =========================================================================
     */

    resolveProviderRoute(
        event
    ) {

        const provider =
            this.resolveProvider(
                event
            );


        if (
            !provider
        ) {

            return null;

        }


        const providerRoutes =
            this.routes.providers;


        if (
            !providerRoutes ||
            typeof providerRoutes !== 'object'
        ) {

            return null;

        }


        const route =
            providerRoutes[provider] ||
            providerRoutes[
                provider.toLowerCase()
            ] ||
            null;


        if (
            !route
        ) {

            return null;

        }


        return {

            ...this.normalizeRouteDefinition(
                route
            ),

            matchType:
                ROUTE_MATCH_TYPES.PROVIDER

        };

    }


    /**
     * =========================================================================
     * Aggregate Route
     * =========================================================================
     */

    resolveAggregateRoute(
        event
    ) {

        const aggregateType =
            event.aggregate?.type;


        if (
            !aggregateType
        ) {

            return null;

        }


        const aggregateRoutes =
            this.routes.aggregates;


        if (
            aggregateRoutes &&
            typeof aggregateRoutes === 'object'
        ) {

            const normalized =
                this.normalizeSegment(
                    aggregateType
                );


            const route =
                aggregateRoutes[
                    aggregateType
                ] ||
                aggregateRoutes[
                    normalized
                ] ||
                aggregateRoutes[
                    normalized.toUpperCase()
                ] ||
                null;


            if (
                route
            ) {

                return {

                    ...this.normalizeRouteDefinition(
                        route
                    ),

                    matchType:
                        ROUTE_MATCH_TYPES.AGGREGATE

                };

            }

        }


        /**
         * Backward-compatible aggregate default.
         */

        return {

            topic:
                this.normalizeTopic(

                    `aggregate.${this.normalizeSegment(
                        aggregateType
                    )}`

                ),

            route:
                this.defaultRoute,

            matchType:
                ROUTE_MATCH_TYPES.AGGREGATE

        };

    }


    /**
     * =========================================================================
     * Provider Routing Key
     * =========================================================================
     */

    providerRoutingKey(
        event
    ) {

        const provider =
            this.resolveProvider(
                event
            );


        if (
            !provider
        ) {

            return null;

        }


        return this.buildCompositeRoutingKey([

            'provider',

            provider

        ]);

    }


    /**
     * =========================================================================
     * Tenant Routing Key
     * =========================================================================
     */

    tenantRoutingKey(
        event
    ) {

        if (
            !event.tenantId
        ) {

            return null;

        }


        return this.buildCompositeRoutingKey([

            'tenant',

            event.tenantId

        ]);

    }


    /**
     * =========================================================================
     * Aggregate Ordering Key
     * =========================================================================
     *
     * IMPORTANT:
     *
     * Tenant identity is included by default.
     *
     * This prevents:
     *
     * tenant-a / transaction-123
     *
     * from sharing the same partition key as:
     *
     * tenant-b / transaction-123
     */

    aggregateRoutingKey(
        event
    ) {

        const type =
            event.aggregate?.type;


        const id =
            event.aggregate?.id;


        if (
            !type ||
            !id
        ) {

            return null;

        }


        const segments = [];


        if (
            this.includeTenantInPartitionKey &&
            event.tenantId
        ) {

            segments.push(
                'tenant',
                event.tenantId
            );

        }


        if (
            this.includeProviderInPartitionKey
        ) {

            const provider =
                this.resolveProvider(
                    event
                );


            if (
                provider
            ) {

                segments.push(
                    'provider',
                    provider
                );

            }

        }


        segments.push(

            this.normalizeSegment(
                type
            ),

            this.normalizeSegment(
                id
            )

        );


        return this.buildCompositeRoutingKey(
            segments
        );

    }


    /**
     * =========================================================================
     * Event Routing Key
     * =========================================================================
     */

    eventRoutingKey(
        event
    ) {

        const eventType =
            this.normalizeEventType(
                event.eventType
            );


        const segments = [];


        if (
            this.includeTenantInPartitionKey &&
            event.tenantId
        ) {

            segments.push(
                'tenant',
                event.tenantId
            );

        }


        if (
            this.includeProviderInPartitionKey
        ) {

            const provider =
                this.resolveProvider(
                    event
                );


            if (
                provider
            ) {

                segments.push(
                    'provider',
                    provider
                );

            }

        }


        segments.push(

            'event',

            eventType ||
            'unknown'

        );


        return this.buildCompositeRoutingKey(
            segments
        );

    }


    /**
     * =========================================================================
     * Resolve Partition Key
     * =========================================================================
     *
     * Aggregate identity wins because it preserves ordering for a single
     * transaction/account/loan.
     *
     * Tenant identity is always incorporated into the key by default.
     */

    resolvePartitionKey(
        event
    ) {

        this.validateEvent(
            event
        );


        return (

            this.aggregateRoutingKey(
                event
            ) ||

            this.eventRoutingKey(
                event
            )

        );

    }


    /**
     * =========================================================================
     * Routing Metadata
     * =========================================================================
     */

    resolveRoutingMetadata(
        event
    ) {

        const resolved =
            this.resolve(
                event
            );


        return {

            topic:
                resolved.topic,

            route:
                resolved.route,

            routingKey:
                resolved.routingKey,

            partitionKey:
                resolved.partitionKey,

            tenantRoutingKey:
                resolved.tenantRoutingKey,

            aggregateRoutingKey:
                resolved.aggregateRoutingKey,

            providerRoutingKey:
                resolved.providerRoutingKey,

            eventRoutingKey:
                resolved.eventRoutingKey,

            tenantId:
                resolved.tenantId,

            provider:
                resolved.provider,

            aggregate:
                resolved.aggregate,

            eventType:
                resolved.eventType,

            operation:
                resolved.operation

        };

    }


    /**
     * =========================================================================
     * Event Validation
     * =========================================================================
     */

    validateEvent(
        event
    ) {

        if (
            !event ||
            typeof event !== 'object' ||
            Array.isArray(event)
        ) {

            throw new TypeError(
                'TransactionEventRouter: event must be an object'
            );

        }


        if (
            !event.eventType
        ) {

            throw new TypeError(
                'TransactionEventRouter: event.eventType is required'
            );

        }


        if (
            this.requireTenant &&
            !event.tenantId
        ) {

            const error =
                new TypeError(
                    'TransactionEventRouter: event.tenantId is required'
                );


            if (
                this.strict
            ) {

                throw error;

            }

        }


        if (
            this.requireAggregate &&
            (
                !event.aggregate ||
                !event.aggregate.type ||
                !event.aggregate.id
            )
        ) {

            const error =
                new TypeError(
                    'TransactionEventRouter: valid event.aggregate is required'
                );


            if (
                this.strict
            ) {

                throw error;

            }

        }


        if (
            event.aggregate &&
            (
                event.aggregate.type &&
                !event.aggregate.id
            )
        ) {

            if (
                this.strict
            ) {

                throw new TypeError(
                    'TransactionEventRouter: aggregate.id is required when aggregate.type is present'
                );

            }

        }


        return true;

    }


    /**
     * =========================================================================
     * Normalize Route Definition
     * =========================================================================
     */

    normalizeRouteDefinition(
        route
    ) {

        if (
            typeof route === 'string'
        ) {

            return {

                topic:
                    this.normalizeTopic(
                        route
                    ),

                route:
                    this.defaultRoute

            };

        }


        if (
            !route ||
            typeof route !== 'object'
        ) {

            return {

                topic:
                    this.defaultTopic,

                route:
                    this.defaultRoute

            };

        }


        return {

            topic:
                route.topic
                    ? this.normalizeTopic(
                        route.topic
                    )
                    : this.defaultTopic,

            route:
                route.route
                    ? this.normalizeRoute(
                        route.route
                    )
                    : this.defaultRoute

        };

    }


    /**
     * =========================================================================
     * Extract Topic
     * =========================================================================
     */

    extractTopic(
        route
    ) {

        if (
            typeof route === 'string'
        ) {

            return this.normalizeTopic(
                route
            );

        }


        if (
            route &&
            typeof route === 'object' &&
            route.topic
        ) {

            return this.normalizeTopic(
                route.topic
            );

        }


        return this.defaultTopic;

    }


    /**
     * =========================================================================
     * Extract Route
     * =========================================================================
     */

    extractRoute(
        route
    ) {

        if (
            typeof route === 'string'
        ) {

            return this.defaultRoute;

        }


        if (
            route &&
            typeof route === 'object' &&
            route.route
        ) {

            return this.normalizeRoute(
                route.route
            );

        }


        return this.defaultRoute;

    }


    /**
     * =========================================================================
     * Operation Resolution
     * =========================================================================
     */

    resolveOperation(
        event
    ) {

        const operation =

            event.operation ||

            event.operationType ||

            event.metadata?.operation ||

            event.metadata?.operationType ||

            event.context?.operation ||

            null;


        if (
            !operation
        ) {

            return null;

        }


        return String(
            operation
        )
            .trim()
            .toUpperCase();

    }


    /**
     * =========================================================================
     * Event Type Normalization
     * =========================================================================
     */

    normalizeEventType(
        eventType
    ) {

        if (
            eventType === undefined ||
            eventType === null
        ) {

            return '';

        }


        return String(
            eventType
        )
            .trim()
            .toUpperCase();

    }


    /**
     * =========================================================================
     * Aggregate Normalization
     * =========================================================================
     */

    normalizeAggregate(
        aggregate
    ) {

        if (
            !aggregate ||
            typeof aggregate !== 'object'
        ) {

            return null;

        }


        return {

            type:
                aggregate.type
                    ? this.normalizeSegment(
                        aggregate.type
                    )
                    : null,

            id:
                aggregate.id
                    ? this.normalizeSegment(
                        aggregate.id
                    )
                    : null

        };

    }


    /**
     * =========================================================================
     * Topic Normalization
     * =========================================================================
     */

    normalizeTopic(
        topic
    ) {

        const normalized =
            String(
                topic ||
                DEFAULT_TOPIC
            )
                .trim()
                .replace(
                    /\s+/g,
                    '.'
                )
                .replace(
                    /\/+/g,
                    '.'
                )
                .replace(
                    /\.{2,}/g,
                    '.'
                )
                .replace(
                    /^\.+|\.+$/g,
                    ''
                );


        const safe =
            normalized ||
            DEFAULT_TOPIC;


        if (
            safe.length <=
            this.maxTopicLength
        ) {

            return safe;

        }


        if (
            this.hashFallbackRouting
        ) {

            return this.truncateWithHash(
                safe,
                this.maxTopicLength
            );

        }


        return safe.slice(
            0,
            this.maxTopicLength
        );

    }


    /**
     * =========================================================================
     * Routing Segment Normalization
     * =========================================================================
     */

    normalizeSegment(
        value
    ) {

        if (
            value === undefined ||
            value === null
        ) {

            return '';

        }


        return String(
            value
        )
            .trim()
            .replace(
                /\s+/g,
                '_'
            )
            .replace(
                /[^a-zA-Z0-9._:-]/g,
                '_'
            );

    }


    /**
     * =========================================================================
     * Route Normalization
     * =========================================================================
     */

    normalizeRoute(
        route
    ) {

        if (
            route === null ||
            route === undefined
        ) {

            return null;

        }


        return String(
            route
        )
            .trim()
            .replace(
                /\s+/g,
                '.'
            )
            .replace(
                /[^a-zA-Z0-9._:-]/g,
                '_'
            ) ||
            null;

    }


    /**
     * =========================================================================
     * Composite Routing Key
     * =========================================================================
     */

    buildCompositeRoutingKey(
        segments
    ) {

        const normalized =
            segments
                .map(
                    this.normalizeSegment.bind(
                        this
                    )
                )
                .filter(
                    Boolean
                )
                .join(':');


        if (
            normalized.length <=
            this.maxRoutingKeyLength
        ) {

            return normalized;

        }


        if (
            this.hashFallbackRouting
        ) {

            return this.truncateWithHash(
                normalized,
                this.maxRoutingKeyLength
            );

        }


        return normalized.slice(
            0,
            this.maxRoutingKeyLength
        );

    }


    /**
     * =========================================================================
     * Truncate With Stable Hash
     * =========================================================================
     */

    truncateWithHash(
        value,
        maxLength
    ) {

        const digest =
            crypto
                .createHash(
                    this.hashAlgorithm
                )
                .update(
                    String(
                        value
                    ),
                    'utf8'
                )
                .digest(
                    'hex'
                )
                .slice(
                    0,
                    16
                );


        const separator =
            ':';


        const available =
            Math.max(
                1,
                maxLength -
                separator.length -
                digest.length
            );


        return (

            String(
                value
            ).slice(
                0,
                available
            ) +

            separator +

            digest

        );

    }


    /**
     * =========================================================================
     * Stable Event Identity
     * =========================================================================
     *
     * Useful for event deduplication/outbox systems.
     */

    eventIdentity(
        event
    ) {

        this.validateEvent(
            event
        );


        const identity = [

            event.tenantId ||
                'global',

            event.eventId ||
                '',

            this.normalizeEventType(
                event.eventType
            ),

            event.transactionId ||
                '',

            event.correlationId ||
                ''

        ].join('|');


        return crypto
            .createHash(
                this.hashAlgorithm
            )
            .update(
                identity,
                'utf8'
            )
            .digest(
                'hex'
            );

    }


    /**
     * =========================================================================
     * Routing Decision Diagnostics
     * =========================================================================
     */

    explain(
        event
    ) {

        const resolved =
            this.resolve(
                event
            );


        let matchType =
            ROUTE_MATCH_TYPES.DEFAULT;


        const route =
            this.resolveRouteDefinition(
                event
            );


        if (
            route?.matchType
        ) {

            matchType =
                route.matchType;

        }


        return {

            matchType,

            topic:
                resolved.topic,

            route:
                resolved.route,

            routingKey:
                resolved.routingKey,

            partitionKey:
                resolved.partitionKey,

            tenantId:
                resolved.tenantId,

            provider:
                resolved.provider,

            aggregate:
                resolved.aggregate,

            eventType:
                resolved.eventType,

            operation:
                resolved.operation

        };

    }


    /**
     * =========================================================================
     * Static Factory
     * =========================================================================
     */

    static create(
        options = {}
    ) {

        return new TransactionEventRouter(
            options
        );

    }

}


TransactionEventRouter.RouteMatchTypes =
    ROUTE_MATCH_TYPES;


module.exports =
    TransactionEventRouter;


module.exports.TransactionEventRouter =
    TransactionEventRouter;


module.exports.ROUTE_MATCH_TYPES =
    ROUTE_MATCH_TYPES;
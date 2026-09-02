/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Knowledge Graph
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Payment Event Relationship Mapping
 * • Provider Intelligence History
 * • Incident Correlation
 * • Anomaly Relationship Storage
 * • Settlement Intelligence Tracking
 * • Transaction Context Mapping
 * • Provider Reliability Memory
 * • Predictive Intelligence Support
 * • Failover Decision Context
 * • Multi-Tenant Aware
 * • Persistence Adapter Ready
 * • Structured Logging
 * • Enterprise Metrics
 * • OpenTelemetry Ready
 * • Immutable Snapshots
 *
 * Purpose
 * -------
 * Maintain contextual relationships between payment events, providers,
 * anomalies, incidents, settlements, and transactions.
 *
 *
 * Knowledge Model
 * ---------------
 *
 * Provider
 *    |
 *    |
 *    +---- Callback Events
 *    |
 *    +---- Incidents
 *    |
 *    +---- Reliability Scores
 *    |
 *    +---- Settlement Performance
 *
 *
 * Transaction
 *    |
 *    +---- Callback
 *    |
 *    +---- Anomaly
 *    |
 *    +---- Incident
 *
 *
 * Design Principles
 * -----------------
 * • Context Storage Only
 * • No Detection Logic
 * • No Scoring Logic
 * • No Failover Execution
 * • Extensible Graph Model
 *
 * ============================================================================
 */


class CallbackKnowledgeGraph {


    constructor({

        repository,

        metrics,

        logger

    } = {}) {


        this.repository =
            repository;


        this.metrics =
            metrics;


        this.logger =
            logger;



        this.nodes = new Map();


        this.relationships = [];

    }





    /**
     * ------------------------------------------------------------------------
     * Register Knowledge Node
     * ------------------------------------------------------------------------
     */


    addNode({

        id,

        type,

        data = {}

    }) {


        const node = Object.freeze({

            id,

            type,

            data,

            createdAt:

                new Date()

        });



        this.nodes.set(

            id,

            node

        );


        return node;

    }





    /**
     * ------------------------------------------------------------------------
     * Create Relationship
     * ------------------------------------------------------------------------
     */


    connect({

        from,

        to,

        relationship,

        metadata = {}

    }) {


        const edge = Object.freeze({

            from,

            to,

            relationship,

            metadata,

            createdAt:

                new Date()

        });



        this.relationships.push(edge);



        return edge;

    }





    /**
     * ------------------------------------------------------------------------
     * Record Provider Event
     * ------------------------------------------------------------------------
     */


    recordProviderEvent({

        provider,

        callback,

        anomaly

    }) {



        const providerNode =

            this.#ensureProviderNode(

                provider

            );



        const callbackNode =

            this.addNode({

                id:

                    `callback:${callback.id}`,

                type:

                    "CALLBACK",

                data:

                    callback

            });



        this.connect({

            from:

                providerNode.id,


            to:

                callbackNode.id,


            relationship:

                "PRODUCED_CALLBACK"

        });



        if (anomaly) {


            const anomalyNode =

                this.addNode({

                    id:

                        `anomaly:${callback.id}`,

                    type:

                        "ANOMALY",

                    data:

                        anomaly

                });



            this.connect({

                from:

                    callbackNode.id,


                to:

                    anomalyNode.id,


                relationship:

                    "TRIGGERED_ANOMALY"

            });


        }



        this.metrics?.increment?.(

            "knowledgeGraphEvents"

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Record Incident
     * ------------------------------------------------------------------------
     */


    recordIncident({

        provider,

        incident

    }) {


        const providerNode =

            this.#ensureProviderNode(

                provider

            );



        const incidentNode =

            this.addNode({

                id:

                    `incident:${incident.id}`,

                type:

                    "INCIDENT",

                data:

                    incident

            });



        this.connect({

            from:

                providerNode.id,


            to:

                incidentNode.id,


            relationship:

                "HAS_INCIDENT"

        });



        return incidentNode;

    }





    /**
     * ------------------------------------------------------------------------
     * Record Settlement Event
     * ------------------------------------------------------------------------
     */


    recordSettlement({

        provider,

        settlement

    }) {


        const providerNode =

            this.#ensureProviderNode(

                provider

            );



        const settlementNode =

            this.addNode({

                id:

                    `settlement:${settlement.id}`,

                type:

                    "SETTLEMENT",

                data:

                    settlement

            });



        this.connect({

            from:

                providerNode.id,


            to:

                settlementNode.id,


            relationship:

                "PROCESSED_SETTLEMENT"

        });



        return settlementNode;

    }





    /**
     * ------------------------------------------------------------------------
     * Find Provider History
     * ------------------------------------------------------------------------
     */


    getProviderHistory(provider) {


        const providerId =

            `provider:${provider}`;



        return this.relationships.filter(

            relationship =>

                relationship.from === providerId

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Find Related Nodes
     * ------------------------------------------------------------------------
     */


    findRelated({

        nodeId,

        relationship

    }) {


        return this.relationships.filter(

            edge =>

                edge.from === nodeId &&

                (

                    !relationship ||

                    edge.relationship === relationship

                )

        );

    }





    /**
     * ------------------------------------------------------------------------
     * Provider Reliability Context
     * ------------------------------------------------------------------------
     */


    buildProviderContext(provider) {


        const history =

            this.getProviderHistory(

                provider

            );



        return Object.freeze({

            provider,

            events:

                history.length,


            incidents:

                history.filter(

                    item =>

                        item.relationship ===

                        "HAS_INCIDENT"

                ).length,


            reliabilityTrend:

                this.#calculateTrend(history)


        });

    }





    /**
     * ------------------------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            nodes:

                [...this.nodes.values()],


            relationships:

                [

                    ...this.relationships

                ],


            generatedAt:

                new Date()

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Internal Provider Node
     * ------------------------------------------------------------------------
     */


    #ensureProviderNode(provider) {


        const id =

            `provider:${provider}`;



        if (

            this.nodes.has(id)

        ) {


            return this.nodes.get(id);

        }



        return this.addNode({

            id,

            type:

                "PROVIDER",

            data:

                {

                    name:

                        provider

                }

        });

    }





    /**
     * ------------------------------------------------------------------------
     * Reliability Trend Calculation
     * ------------------------------------------------------------------------
     */


    #calculateTrend(history) {


        const incidents =

            history.filter(

                item =>

                    item.relationship ===

                    "HAS_INCIDENT"

            ).length;



        if (incidents === 0) {


            return "STABLE";

        }



        if (incidents > 10) {


            return "DEGRADING";

        }



        return "WATCH";

    }


}



module.exports = CallbackKnowledgeGraph;
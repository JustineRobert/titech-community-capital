/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Dependency Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Dependency Graph Construction
 * • Service Startup Ordering
 * • Circular Dependency Detection
 * • Runtime Dependency Validation
 * • Service Prerequisite Management
 * • Initialization Coordination
 * • Dynamic Dependency Updates
 * • Platform Topology Validation
 * • Dependency Health Visualization
 * • Distributed Service Awareness
 * • Runtime Orchestration Support
 * • Enterprise Architecture Governance
 *
 *
 * Purpose
 * -------
 * Manage the dependency topology of the payment reliability intelligence
 * platform and ensure services initialize safely in the correct order.
 *
 *
 * Dependency Flow
 * ---------------
 *
 * Service Registry
 *
 *        |
 *        ▼
 *
 * Dependency Manager
 *
 *        |
 *        ├───────────────┐
 *        ▼               ▼
 *
 * Dependency Graph   Validation Engine
 *
 *        |
 *        ▼
 *
 * Startup Execution Plan
 *
 *
 *
 * Example Dependency Chain
 * ------------------------
 *
 * Configuration Registry
 *
 *          ↓
 *
 * Policy Engine
 *
 *          ↓
 *
 * Reliability Engine
 *
 *          ↓
 *
 * Failover Engine
 *
 *          ↓
 *
 * Incident Manager
 *
 *
 *
 * Design Principles
 * -----------------
 * • Dependency Driven Startup
 * • No Business Logic
 * • Topology First Architecture
 * • Runtime Safe Changes
 * • Distributed System Ready
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityDependencyManager {


    constructor({

        serviceRegistry,

        logger,

        auditLogger

    } = {}) {


        this.serviceRegistry =
            serviceRegistry;


        this.logger =
            logger;


        this.auditLogger =
            auditLogger;



        this.graph = new Map();



        this.startupOrder = [];



        this.initialized = new Set();



        this.dependencies = new Map();


    }





    /**
     * ------------------------------------------------------------------------
     * Register Dependency Definition
     * ------------------------------------------------------------------------
     */


    registerDependency({

        service,

        requires = []

    }) {


        this.dependencies.set(

            service,

            [

                ...requires

            ]

        );



        this.#buildGraph();



        return {

            service,

            requires

        };

    }





    /**
     * ------------------------------------------------------------------------
     * Build Dependency Graph
     * ------------------------------------------------------------------------
     */


    #buildGraph() {


        this.graph.clear();



        for (

            const [

                service,

                dependencies

            ]

            of this.dependencies

        ) {


            if (

                !this.graph.has(service)

            ) {


                this.graph.set(

                    service,

                    []

                );

            }



            for (

                const dependency

                of dependencies

            ) {


                this.graph

                    .get(service)

                    .push(dependency);


            }


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Detect Circular Dependencies
     * ------------------------------------------------------------------------
     */


    detectCircularDependencies() {


        const visited = new Set();



        const recursionStack = new Set();



        const cycles = [];



        const visit = (node) => {


            if (

                recursionStack.has(node)

            ) {


                cycles.push(node);

                return true;

            }



            if (

                visited.has(node)

            ) {


                return false;

            }



            visited.add(node);



            recursionStack.add(node);



            const children =

                this.graph.get(node)

                ||

                [];



            for (

                const child

                of children

            ) {


                visit(child);

            }



            recursionStack.delete(node);


            return false;

        };



        for (

            const node

            of this.graph.keys()

        ) {


            visit(node);

        }



        return cycles;

    }





    /**
     * ------------------------------------------------------------------------
     * Resolve Startup Order
     * ------------------------------------------------------------------------
     */


    resolveStartupOrder() {


        const visited = new Set();



        const result = [];



        const visit = (service) => {


            if (

                visited.has(service)

            ) {


                return;

            }



            visited.add(service);



            const dependencies =

                this.graph.get(service)

                ||

                [];



            for (

                const dependency

                of dependencies

            ) {


                visit(dependency);

            }



            result.push(service);

        };



        for (

            const service

            of this.graph.keys()

        ) {


            visit(service);

        }



        this.startupOrder = result;



        return result;

    }





    /**
     * ------------------------------------------------------------------------
     * Validate Topology
     * ------------------------------------------------------------------------
     */


    validateTopology() {


        const cycles =

            this.detectCircularDependencies();



        return Object.freeze({

            healthy:

                cycles.length === 0,


            circularDependencies:

                cycles,


            services:

                this.graph.size

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Initialize Platform Services
     * ------------------------------------------------------------------------
     */


    async initializeServices() {


        const order =

            this.resolveStartupOrder();



        for (

            const serviceName

            of order

        ) {


            const service =

                this.serviceRegistry.resolve(

                    serviceName

                );



            if (!service) {


                throw new Error(

                    `Missing dependency ${serviceName}`

                );

            }



            if (

                typeof service.start ===

                "function"

            ) {


                await service.start();

            }



            this.initialized.add(

                serviceName

            );


        }



        await this.#audit({

            action:

                "DEPENDENCY_INITIALIZATION_COMPLETED",


            services:

                order

        });



        return order;

    }





    /**
     * ------------------------------------------------------------------------
     * Add Runtime Dependency
     * ------------------------------------------------------------------------
     */


    addRuntimeDependency({

        service,

        dependency

    }) {


        const current =

            this.dependencies.get(

                service

            )

            ||

            [];



        current.push(

            dependency

        );



        this.dependencies.set(

            service,

            current

        );



        this.#buildGraph();



        return this.validateTopology();

    }





    /**
     * ------------------------------------------------------------------------
     * Remove Dependency
     * ------------------------------------------------------------------------
     */


    removeDependency({

        service,

        dependency

    }) {


        const current =

            this.dependencies.get(

                service

            )

            ||

            [];



        this.dependencies.set(

            service,

            current.filter(

                item =>

                    item !== dependency

            )

        );



        this.#buildGraph();


        return true;

    }





    /**
     * ------------------------------------------------------------------------
     * Dependency Health Visualization
     * ------------------------------------------------------------------------
     */


    dependencyMap() {


        const output = {};



        for (

            const [

                service,

                dependencies

            ]

            of this.graph

        ) {


            output[service] = {


                dependencies,


                initialized:

                    this.initialized.has(

                        service

                    )

            };


        }



        return Object.freeze(output);

    }





    /**
     * ------------------------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            id:

                randomUUID(),


            services:

                this.graph.size,


            startupOrder:

                this.startupOrder,


            initialized:

                [

                    ...this.initialized

                ]

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */


    async #audit(event) {


        if (

            !this.auditLogger

        ) {


            return;

        }



        await this.auditLogger.log(

            event

        );


    }


}



module.exports =
    PaymentReliabilityDependencyManager;
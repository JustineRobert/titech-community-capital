/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Service Registry
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Dynamic Intelligence Service Registration
 * • Runtime Service Discovery
 * • Dependency Management
 * • Service Contract Validation
 * • Plugin Extension Support
 * • Runtime Module Registration
 * • Service Version Compatibility
 * • Service Health Tracking
 * • Lifecycle Management
 * • Capability Discovery
 * • Dependency Graph Resolution
 * • Multi-Tenant Platform Ready
 * • Enterprise Observability Ready
 *
 *
 * Purpose
 * -------
 * Provide the runtime service discovery and extensibility foundation for the
 * payment reliability intelligence ecosystem.
 *
 *
 * Registry Flow
 * -------------
 *
 * Service Module
 *
 *        |
 *        ▼
 *
 * Service Registry
 *
 *        |
 *        ├───────────────┐
 *        ▼               ▼
 *
 * Contract Check     Dependency Check
 *
 *        |
 *        ▼
 *
 * Service Activated
 *
 *
 *
 * Registered Services
 * -------------------
 *
 * Anomaly Detector
 * Reliability Engine
 * Failover Engine
 * Incident Manager
 * Workflow Engine
 * Metrics Collector
 * Alert Manager
 * Notification Gateway
 * Policy Engine
 *
 *
 * Design Principles
 * -----------------
 * • Plugin Based Architecture
 * • Loose Coupling
 * • Runtime Extensibility
 * • Dependency Awareness
 * • Contract Driven Integration
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityServiceRegistry {


    constructor({

        healthChecker,

        auditLogger,

        logger

    } = {}) {


        this.healthChecker =
            healthChecker;


        this.auditLogger =
            auditLogger;


        this.logger =
            logger;



        this.services = new Map();



        this.dependencies = new Map();



        this.capabilities = new Map();



        this.plugins = new Map();



    }





    /**
     * ------------------------------------------------------------------------
     * Register Service
     * ------------------------------------------------------------------------
     */


    async register({

        name,

        service,

        version = "1.0.0",

        type = "CORE",

        dependencies = [],

        capabilities = [],

        contract = {}

    }) {


        this.#validateService({

            service,

            contract

        });



        const record = {


            id:

                randomUUID(),


            name,


            version,


            type,


            service,


            dependencies,


            capabilities,


            contract,


            status:

                "REGISTERED",


            registeredAt:

                new Date()


        };



        this.services.set(

            name,

            record

        );



        this.dependencies.set(

            name,

            dependencies

        );



        this.capabilities.set(

            name,

            capabilities

        );



        await this.#audit({

            action:

                "SERVICE_REGISTERED",


            service:

                name

        });



        return record;

    }





    /**
     * ------------------------------------------------------------------------
     * Resolve Service
     * ------------------------------------------------------------------------
     */


    resolve(name) {


        const service =

            this.services.get(

                name

            );



        if (!service) {


            return null;

        }



        return service.service;

    }





    /**
     * ------------------------------------------------------------------------
     * Discover Services
     * ------------------------------------------------------------------------
     */


    discover({

        capability

    } = {}) {


        const results = [];



        for (

            const service

            of this.services.values()

        ) {


            if (

                !capability

                ||

                service.capabilities.includes(

                    capability

                )

            ) {


                results.push({

                    name:

                        service.name,


                    version:

                        service.version,


                    status:

                        service.status

                });


            }


        }



        return results;

    }





    /**
     * ------------------------------------------------------------------------
     * Dependency Validation
     * ------------------------------------------------------------------------
     */


    validateDependencies(name) {


        const required =

            this.dependencies.get(

                name

            )

            ||

            [];



        return required.map(

            dependency =>

            ({

                dependency,


                available:

                    this.services.has(

                        dependency

                    )

            })

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Activate Service
     * ------------------------------------------------------------------------
     */


    async activate(name) {


        const record =

            this.services.get(

                name

            );



        if (!record) {


            throw new Error(

                "Service not found"

            );

        }



        const dependencies =

            this.validateDependencies(

                name

            );



        const unavailable =

            dependencies.filter(

                item =>

                    !item.available

            );



        if (

            unavailable.length

        ) {


            throw new Error(

                "Service dependencies unavailable"

            );

        }



        if (

            typeof record.service.start ===

            "function"

        ) {


            await record.service.start();

        }



        record.status =

            "ACTIVE";



        return record;

    }





    /**
     * ------------------------------------------------------------------------
     * Runtime Plugin Registration
     * ------------------------------------------------------------------------
     */


    registerPlugin({

        name,

        module,

        version

    }) {


        const plugin = {


            name,


            module,


            version,


            registeredAt:

                new Date()

        };



        this.plugins.set(

            name,

            plugin

        );



        return plugin;

    }





    /**
     * ------------------------------------------------------------------------
     * Version Compatibility Check
     * ------------------------------------------------------------------------
     */


    checkCompatibility({

        requiredVersion,

        installedVersion

    }) {


        const requiredMajor =

            Number(

                requiredVersion.split(".")[0]

            );



        const installedMajor =

            Number(

                installedVersion.split(".")[0]

            );



        return (

            requiredMajor ===

            installedMajor

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Service Health
     * ------------------------------------------------------------------------
     */


    async health() {


        const results = {};



        for (

            const [

                name,

                service

            ]

            of this.services

        ) {


            if (

                this.healthChecker

            ) {


                results[name] =

                    await this.healthChecker.check(

                        service.service

                    );


            }

            else {


                results[name] = {


                    status:

                        service.status

                };


            }


        }



        return Object.freeze(results);

    }





    /**
     * ------------------------------------------------------------------------
     * Remove Service
     * ------------------------------------------------------------------------
     */


    async unregister(name) {


        const removed =

            this.services.delete(

                name

            );



        this.dependencies.delete(

            name

        );


        this.capabilities.delete(

            name

        );



        return removed;

    }





    /**
     * ------------------------------------------------------------------------
     * Contract Validation
     * ------------------------------------------------------------------------
     */


    #validateService({

        service,

        contract

    }) {


        if (

            !service

            ||

            typeof service !== "object"

        ) {


            throw new TypeError(

                "Invalid service instance"

            );

        }



        for (

            const method

            of Object.keys(contract)

        ) {


            if (

                typeof service[method]

                !==

                "function"

            ) {


                throw new Error(

                    `Service contract missing method ${method}`

                );

            }


        }


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





    /**
     * ------------------------------------------------------------------------
     * Registry Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            services:

                this.services.size,


            plugins:

                this.plugins.size,


            capabilities:

                this.capabilities.size


        });


    }


}



module.exports =
    PaymentReliabilityServiceRegistry;
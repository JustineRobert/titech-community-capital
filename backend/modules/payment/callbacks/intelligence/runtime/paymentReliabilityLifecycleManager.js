/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Lifecycle Manager
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Service Lifecycle State Management
 * • Startup Phase Coordination
 * • Shutdown Orchestration
 * • Graceful Recovery Workflows
 * • Failed Service Restart
 * • Degraded Runtime Handling
 * • Lifecycle Event History
 * • Rolling Upgrade Coordination
 * • Health Check Integration
 * • Runtime State Tracking
 * • Service Availability Management
 * • Enterprise Resilience Operations
 *
 *
 * Purpose
 * -------
 * Manage the operational lifecycle of all payment reliability intelligence
 * services and maintain continuous platform availability.
 *
 *
 * Lifecycle Flow
 * --------------
 *
 * CREATED
 *
 *    |
 *    ▼
 *
 * INITIALIZING
 *
 *    |
 *    ▼
 *
 * READY
 *
 *    |
 *    ▼
 *
 * RUNNING
 *
 *    |
 *    ├──────────────┐
 *    ▼              ▼
 *
 * DEGRADED       FAILED
 *
 *    |              |
 *    ▼              ▼
 *
 * RECOVERING  RESTARTING
 *
 *    |
 *    ▼
 *
 * RUNNING
 *
 *
 *
 * Managed Components
 * ------------------
 *
 * Service Registry
 * Dependency Manager
 * Health Checker
 * Runtime Coordinator
 * Intelligence Services
 *
 *
 * Design Principles
 * -----------------
 * • Continuous Availability
 * • Graceful Failure Handling
 * • Controlled State Transitions
 * • Observable Runtime
 * • Production Resilience
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityLifecycleManager {


    constructor({

        serviceRegistry,

        dependencyManager,

        healthChecker,

        logger,

        auditLogger

    } = {}) {


        this.serviceRegistry =
            serviceRegistry;


        this.dependencyManager =
            dependencyManager;


        this.healthChecker =
            healthChecker;


        this.logger =
            logger;


        this.auditLogger =
            auditLogger;



        this.services = new Map();



        this.history = [];



        this.runtimeState =

        {

            status:

                "CREATED",


            startedAt:

                null,


            stoppedAt:

                null

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Register Managed Service
     * ------------------------------------------------------------------------
     */


    registerService({

        name,

        instance,

        version = "1.0.0"

    }) {


        this.services.set(

            name,

            {

                name,

                instance,

                version,

                state:

                    "CREATED",

                registeredAt:

                    new Date()

            }

        );



        return this.services.get(name);

    }





    /**
     * ------------------------------------------------------------------------
     * Startup Lifecycle
     * ------------------------------------------------------------------------
     */


    async start() {


        this.#transition(

            "STARTING"

        );



        const order =

            this.dependencyManager

                ?.resolveStartupOrder()

            ||

            [

                ...this.services.keys()

            ];



        for (

            const serviceName

            of order

        ) {


            await this.#startService(

                serviceName

            );

        }



        this.#transition(

            "RUNNING"

        );



        this.runtimeState.startedAt =

            new Date();



        await this.#audit({

            action:

                "LIFECYCLE_STARTED"

        });



        return this.status();

    }





    /**
     * ------------------------------------------------------------------------
     * Start Individual Service
     * ------------------------------------------------------------------------
     */


    async #startService(name) {


        const service =

            this.services.get(

                name

            );



        if (!service) {


            return;

        }



        this.#setServiceState(

            name,

            "INITIALIZING"

        );



        try {


            if (

                typeof service.instance.start ===

                "function"

            ) {


                await service.instance.start();

            }



            this.#setServiceState(

                name,

                "READY"

            );


        }

        catch(error) {


            this.#setServiceState(

                name,

                "FAILED"

            );


            throw error;

        }


    }





    /**
     * ------------------------------------------------------------------------
     * Shutdown Lifecycle
     * ------------------------------------------------------------------------
     */


    async stop() {


        this.#transition(

            "STOPPING"

        );



        const services =

            [

                ...

                this.services.values()

            ]

            .reverse();



        for (

            const service

            of services

        ) {


            if (

                typeof service.instance.stop ===

                "function"

            ) {


                await service.instance.stop();

            }



            service.state =

                "STOPPED";

        }



        this.runtimeState.status =

            "STOPPED";


        this.runtimeState.stoppedAt =

            new Date();



        await this.#audit({

            action:

                "LIFECYCLE_STOPPED"

        });



        return this.status();

    }





    /**
     * ------------------------------------------------------------------------
     * Health Monitoring
     * ------------------------------------------------------------------------
     */


    async checkHealth() {


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

                        service.instance

                    );


            }

            else {


                results[name] =

                {

                    state:

                        service.state

                };

            }


        }



        return results;

    }





    /**
     * ------------------------------------------------------------------------
     * Detect Degraded Runtime
     * ------------------------------------------------------------------------
     */


    async evaluateRuntimeHealth() {


        const health =

            await this.checkHealth();



        const unhealthy =

            Object.values(

                health

            )

            .filter(

                item =>

                    item.healthy === false

            );



        if (

            unhealthy.length

        ) {


            this.#transition(

                "DEGRADED"

            );


        }


        else {


            this.#transition(

                "RUNNING"

            );

        }



        return {

            state:

                this.runtimeState.status,


            health

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Recovery Workflow
     * ------------------------------------------------------------------------
     */


    async recover(serviceName) {


        const service =

            this.services.get(

                serviceName

            );



        if (!service) {


            throw new Error(

                "Service not registered"

            );

        }



        this.#setServiceState(

            serviceName,

            "RECOVERING"

        );



        await this.restart(

            serviceName

        );



        return service;

    }





    /**
     * ------------------------------------------------------------------------
     * Restart Failed Service
     * ------------------------------------------------------------------------
     */


    async restart(serviceName) {


        const service =

            this.services.get(

                serviceName

            );



        if (!service) {


            throw new Error(

                "Service unavailable"

            );

        }



        this.#setServiceState(

            serviceName,

            "RESTARTING"

        );



        if (

            typeof service.instance.stop ===

            "function"

        ) {


            await service.instance.stop();

        }



        if (

            typeof service.instance.start ===

            "function"

        ) {


            await service.instance.start();

        }



        this.#setServiceState(

            serviceName,

            "READY"

        );



        return service;

    }





    /**
     * ------------------------------------------------------------------------
     * Rolling Upgrade
     * ------------------------------------------------------------------------
     */


    async rollingUpgrade({

        serviceName,

        newVersion

    }) {


        const service =

            this.services.get(

                serviceName

            );



        if (!service) {


            throw new Error(

                "Service not found"

            );

        }



        const previousVersion =

            service.version;



        service.version =

            newVersion;



        this.history.push({

            event:

                "ROLLING_UPGRADE",


            service:

                serviceName,


            from:

                previousVersion,


            to:

                newVersion,


            timestamp:

                new Date()

        });



        return service;

    }





    /**
     * ------------------------------------------------------------------------
     * Lifecycle State Transition
     * ------------------------------------------------------------------------
     */


    #transition(state) {


        this.runtimeState.status =

            state;



        this.history.push({

            state,

            timestamp:

                new Date()

        });


    }





    #setServiceState(

        name,

        state

    ) {


        const service =

            this.services.get(

                name

            );



        if (!service) {


            return;

        }



        service.state =

            state;



        this.history.push({

            service:

                name,


            state,


            timestamp:

                new Date()

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Status Snapshot
     * ------------------------------------------------------------------------
     */


    status() {


        return Object.freeze({

            runtime:

                this.runtimeState,


            services:

                [

                    ...this.services.values()

                ],


            history:

                this.history

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */


    async #audit(event) {


        if (

            this.auditLogger

        ) {


            await this.auditLogger.log(

                event

            );

        }


    }


}



module.exports =
    PaymentReliabilityLifecycleManager;
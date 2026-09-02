"use strict";

/**
 * TITech Community Capital LTD
 * Enterprise Middleware Registry
 *
 * Central governance layer for HTTP middleware.
 *
 * Responsibilities:
 *
 * - Register middleware components
 * - Maintain middleware metadata
 * - Control execution eligibility
 * - Support dependency resolution
 * - Provide diagnostics
 * - Track lifecycle state
 * - Support enterprise operations
 *
 */


const {
    MiddlewareBootstrapError
} = require("./errors");



class MiddlewareRegistry {


    constructor({

        environment =
            process.env.NODE_ENV || "development",

        featureFlags = {},

        logger = null

    } = {}) {


        this.environment =
            environment;


        this.featureFlags =
            featureFlags;


        this.logger =
            logger;



        /**
         * Middleware storage
         */
        this.registry =
            new Map();



        /**
         * Audit history
         */
        this.auditLog =
            [];



        /**
         * Registry metadata
         */
        this.metadata = Object.freeze({

            createdAt:
                new Date(),

            environment:
                this.environment,

            version:
                "1.0.0"

        });


    }





    /**
     * Register middleware component
     */
    register(definition = {}) {


        this.validate(definition);



        if(
            this.registry.has(
                definition.name
            )
        ) {


            throw new MiddlewareBootstrapError(

                `Middleware already registered: ${definition.name}`

            );

        }



        const middleware = {


            /**
             * Identity
             */
            name:
                definition.name,


            version:
                definition.version || "1.0.0",


            description:
                definition.description || null,



            /**
             * Classification
             */
            category:
                definition.category || "general",


            critical:
                definition.critical === true,



            /**
             * Execution ordering
             */
            phase:
                definition.phase || "default",


            priority:
                Number.isInteger(
                    definition.priority
                )

                ?

                definition.priority

                :

                100,



            executionGroup:
                definition.executionGroup ||
                "default",



            /**
             * Runtime control
             */
            enabled:
                definition.enabled !== false,


            environments:
                definition.environments || null,


            featureFlag:
                definition.featureFlag || null,



            /**
             * Dependencies
             */
            dependencies:

                Array.isArray(
                    definition.dependencies
                )

                ?

                [...definition.dependencies]

                :

                [],



            optionalDependencies:

                Array.isArray(
                    definition.optionalDependencies
                )

                ?

                [...definition.optionalDependencies]

                :

                [],




            /**
             * Factory
             */
            factory:
                definition.factory,



            /**
             * Lifecycle
             */
            hooks:
                definition.hooks || {},



            /**
             * Health
             */
            healthCheck:
                definition.healthCheck || null,



            status:
                "registered",



            registeredAt:
                new Date(),



            metadata: Object.freeze({

                owner:
                    definition.owner || "platform",


                source:
                    definition.source || "internal",


                tags:
                    definition.tags || []

            })


        };



        this.registry.set(

            middleware.name,

            middleware

        );



        this.recordAudit(

            "REGISTER",

            middleware.name

        );



        return this;


    }






    /**
     * Validate middleware definition
     */
    validate(definition) {


        if(
            !definition ||
            typeof definition !== "object"
        ) {

            throw new MiddlewareBootstrapError(

                "Invalid middleware definition"

            );

        }



        if(
            !definition.name
        ) {

            throw new MiddlewareBootstrapError(

                "Middleware name is required"

            );

        }



        if(
            typeof definition.factory !==
            "function"
        ) {

            throw new MiddlewareBootstrapError(

                `Middleware factory missing: ${definition.name}`

            );

        }


    }






    /**
     * Retrieve middleware
     */
    get(name) {


        return this.registry.get(
            name
        );


    }





    /**
     * Check existence
     */
    has(name) {


        return this.registry.has(
            name
        );

    }





    /**
     * Remove middleware
     */
    remove(name) {


        const removed =
            this.registry.delete(
                name
            );



        if(removed) {

            this.recordAudit(

                "REMOVE",

                name

            );

        }



        return removed;


    }





    /**
     * Enable middleware
     */
    enable(name) {


        const middleware =
            this.get(name);



        if(!middleware) {

            return false;

        }



        middleware.enabled =
            true;



        this.recordAudit(

            "ENABLE",

            name

        );


        return true;


    }





    /**
     * Disable middleware
     */
    disable(name) {


        const middleware =
            this.get(name);



        if(!middleware) {

            return false;

        }



        middleware.enabled =
            false;



        this.recordAudit(

            "DISABLE",

            name

        );


        return true;


    }





    /**
     * Update runtime status
     */
    updateStatus(

        name,

        status

    ) {


        const middleware =
            this.get(name);



        if(!middleware) {

            throw new MiddlewareBootstrapError(

                `Unknown middleware ${name}`

            );

        }



        middleware.status =
            status;


        return middleware;


    }






    /**
     * Environment validation
     */
    allowedEnvironment(middleware) {


        if(
            !middleware.environments
        ) {

            return true;

        }



        return middleware.environments.includes(

            this.environment

        );


    }






    /**
     * Feature flag validation
     */
    featureEnabled(middleware) {


        if(
            !middleware.featureFlag
        ) {

            return true;

        }



        return Boolean(

            this.featureFlags[
                middleware.featureFlag
            ]

        );


    }







    /**
     * Return executable middleware
     */
    getExecutable() {


        return this.list()

            .filter(

                middleware =>

                    middleware.enabled &&

                    this.allowedEnvironment(
                        middleware
                    ) &&

                    this.featureEnabled(
                        middleware
                    )

            )

            .sort(

                (a,b) =>

                    a.priority -
                    b.priority

            );


    }







    /**
     * Return all middleware
     */
    list() {


        return Array.from(

            this.registry.values()

        );


    }






    /**
     * Find by phase
     */
    findByPhase(phase) {


        return this.list()

            .filter(

                item =>
                    item.phase === phase

            );


    }






    /**
     * Find critical middleware
     */
    criticalMiddleware() {


        return this.list()

            .filter(

                item =>
                    item.critical

            );


    }






    /**
     * Build dependency graph
     */
    dependencyGraph() {


        const graph = {};



        for(
            const middleware
            of this.list()
        ) {


            graph[
                middleware.name
            ] =
                middleware.dependencies;


        }



        return graph;


    }






    /**
     * Registry health
     */
    health() {


        const failed =
            this.list()

            .filter(

                middleware =>
                    middleware.status ===
                    "failed"

            );



        return {


            healthy:
                failed.length === 0,


            total:
                this.registry.size,


            failed:
                failed.map(

                    item =>
                        item.name

                )


        };


    }







    /**
     * Diagnostics
     */
    diagnostics() {


        return {


            metadata:
                this.metadata,


            environment:
                this.environment,


            count:
                this.registry.size,


            executable:
                this.getExecutable()
                    .map(
                        item =>
                            item.name
                    ),


            health:
                this.health(),


            auditEntries:
                this.auditLog.length


        };


    }







    /**
     * Audit registry changes
     */
    recordAudit(

        action,

        middleware

    ) {


        this.auditLog.push({

            action,

            middleware,

            timestamp:
                new Date()


        });


    }






    /**
     * Export snapshot
     */
    snapshot() {


        return {


            metadata:
                this.metadata,


            middleware:
                this.list(),


            audit:
                this.auditLog


        };


    }






    /**
     * Clear registry
     */
    clear() {


        this.registry.clear();



        this.recordAudit(

            "CLEAR",

            "ALL"

        );


    }


}



module.exports =
    MiddlewareRegistry;
'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 * File: backend/shared/logging/LoggerFactory.js
 * =============================================================================
 *
 * Enterprise Logger Factory
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * Creates request-scoped StructuredLogger instances.
 *
 * Example:
 *
 * const logger =
 *     LoggerFactory.create(req.context);
 *
 *
 * Automatically enriches logs with:
 *
 * {
 *    requestId,
 *    correlationId,
 *    tenant,
 *    user,
 *    service,
 *    hostname
 * }
 *
 * =============================================================================
 */

const os = require('os');

const StructuredLogger =
    require('./StructuredLogger');



/**
 * Default enterprise service name.
 */
const DEFAULT_SERVICE =
    'titech-community-capital';



/**
 * Logger Factory
 *
 * Creates immutable,
 * context-aware loggers.
 */
class LoggerFactory {


    /**
     * @param {Object} options
     *
     * @param {Object} options.transport
     * @param {String} options.service
     * @param {String} options.environment
     * @param {String} options.level
     */
    constructor({

        transport = null,

        service =
            DEFAULT_SERVICE,

        environment =
            process.env.NODE_ENV ||
            'development',

        level =
            process.env.LOG_LEVEL ||
            'info'


    } = {}) {


        this.transport =
            transport;


        this.service =
            service;


        this.environment =
            environment;


        this.level =
            level;



        Object.freeze(this);

    }





    /**
     * Create request logger.
     *
     * @param {Object} context
     *
     * @returns {StructuredLogger}
     */
    create(context = {}) {


        const metadata =
            this.extractContext(
                context
            );


        return new StructuredLogger({

            transport:
                this.transport ||
                undefined,


            service:
                this.service,


            environment:
                this.environment,


            level:
                this.level,


            context:
                metadata

        });


    }





    /**
     * Extract enterprise logging metadata.
     *
     * @private
     */
    extractContext(context) {


        return {


            /**
             * Distributed tracing
             */
            requestId:
                context.requestId ||
                null,


            correlationId:
                context.correlationId ||
                null,



            /**
             * Multi-tenancy
             */
            tenant:
                this.resolveTenant(
                    context.tenant
                ),



            /**
             * Identity
             */
            user:
                this.resolveUser(
                    context.user
                ),



            /**
             * Runtime metadata
             */
            service:
                this.service,


            hostname:
                os.hostname()

        };


    }





    /**
     * Normalize tenant information.
     *
     * Prevents logging unnecessary
     * sensitive tenant data.
     *
     * @private
     */
    resolveTenant(tenant) {


        if (!tenant) {

            return null;

        }


        if (
            typeof tenant === 'string'
        ) {

            return tenant;

        }


        return {

            id:
                tenant.id ||
                tenant._id ||
                null,


            name:
                tenant.name ||
                null

        };

    }





    /**
     * Normalize user information.
     *
     * @private
     */
    resolveUser(user) {


        if (!user) {

            return null;

        }


        if (
            typeof user === 'string'
        ) {

            return user;

        }


        return {


            id:
                user.id ||
                user._id ||
                null,


            role:
                user.role ||
                null

        };


    }





    /**
     * Create system logger.
     *
     * Used outside HTTP lifecycle:
     *
     * - Workers
     * - Jobs
     * - CLI
     * - Schedulers
     *
     */
    createSystemLogger(metadata = {}) {


        return new StructuredLogger({

            transport:
                this.transport ||
                undefined,


            service:
                this.service,


            environment:
                this.environment,


            level:
                this.level,


            context:
                {

                    service:
                        this.service,


                    hostname:
                        os.hostname(),


                    ...metadata

                }

        });


    }


}



/**
 * Static convenience API.
 *
 * Allows:
 *
 * LoggerFactory.create(context)
 */
LoggerFactory.create =
function create(context, options = {}) {


    const factory =
        new LoggerFactory(options);


    return factory.create(context);

};



/**
 * Prevent prototype mutation.
 */
Object.freeze(
    LoggerFactory.prototype
);



module.exports =
    LoggerFactory;
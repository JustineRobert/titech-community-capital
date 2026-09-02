'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Configuration Manager
 *
 * Responsibilities:
 *
 * ✓ Runtime configuration
 * ✓ Environment loading
 * ✓ Configuration updates
 * ✓ Change tracking
 *
 * =============================================================================
 */


const EventEmitter =
require('events');



class ResilienceConfigManager extends EventEmitter {


    constructor(options={})
    {

        super();


        this.config =
        {

            enabled:
                true,


            mode:
                'ACTIVE',


            circuitBreaker:
            {

                failureThreshold:
                    5,


                resetTimeout:
                    30000

            },


            retry:
            {

                enabled:
                    true,


                attempts:
                    5

            },


            degradation:
            {

                enabled:
                    true

            },


            ...options.config

        };


    }



    get(
        key
    )
    {

        return this.config[key];

    }



    getAll()
    {

        return {

            ...this.config

        };

    }



    update(
        key,
        value,
        metadata={}
    )
    {


        const previous =
            this.config[key];



        this.config[key] =
            value;



        this.emit(

            'configuration.changed',

            {

                key,

                previous,

                value,

                metadata,

                timestamp:
                    Date.now()

            }

        );


        return value;

    }



    loadEnvironment(
        env
    )
    {


        if(
            env.RESILIENCE_ENABLED
        )
        {

            this.config.enabled =
                env.RESILIENCE_ENABLED === 'true';

        }


        return this;

    }



}



module.exports =
    ResilienceConfigManager;
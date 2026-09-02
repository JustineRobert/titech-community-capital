'use strict';


/**
 * =============================================================================
 * Enterprise Resilience Administration Service
 * =============================================================================
 */


class ResilienceAdminService {


    constructor(options={})
    {

        this.controlPlane =
            options.controlPlane;


        this.runtime =
            options.runtime;


        this.audit =
            options.audit;

    }





    async updateConfiguration(
        key,
        value,
        actor
    )
    {


        const result =
            this.controlPlane
                .config
                .update(

                    key,

                    value,

                    {

                        actor

                    }

                );



        await this.audit?.record({

            action:

                'CONFIGURATION_UPDATE',


            key,


            actor

        });



        return result;

    }





    getRuntimeStatus()
    {

        return {

            runtime:

                this.runtime.health(),


            configuration:

                this.controlPlane
                    .config
                    .getAll()

        };

    }



}



module.exports =
    ResilienceAdminService;
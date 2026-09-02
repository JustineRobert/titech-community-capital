'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Command Center
 *
 * Responsibilities:
 *
 * ✓ Coordinate resilience operations
 * ✓ Aggregate reliability intelligence
 * ✓ Provide operational visibility
 * ✓ Support enterprise decisions
 *
 * =============================================================================
 */


class ResilienceCommandCenter {


    constructor(
        services
    )
    {

        this.services =
            services;

    }



    async overview()
    {


        return {


            dashboard:

                await this.services.dashboard.summary(),


            global:

                await this.services.global.snapshot(),


            incidents:

                await this.services.incidents.active(),


            sla:

                await this.services.sla.report()


        };

    }



}



module.exports =
    ResilienceCommandCenter;
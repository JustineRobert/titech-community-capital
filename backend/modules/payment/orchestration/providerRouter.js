'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise Payment Provider Router
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Central routing layer for payment provider adapters.
 *
 * Responsibilities
 * ----------------
 * • Provider adapter resolution
 * • Provider availability validation
 * • Multi-provider support
 * • Tenant-aware provider selection
 * • Provider capability checks
 * • Runtime provider registration
 * • Provider health inspection
 * • Metrics instrumentation
 * • Structured logging
 *
 * Supported Providers
 * -------------------
 * • MTN MoMo
 * • Airtel Money
 * • Banks
 * • Future payment rails
 *
 *
 * Architecture
 * ------------
 *
 * Payment Engine
 *       |
 *       ↓
 * Provider Router
 *       |
 *       ├── MTN Adapter
 *       |
 *       ├── Airtel Adapter
 *       |
 *       └── Bank Adapter
 *
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Provider authentication
 * • HTTP communication
 * • Payment execution
 * • Retry handling
 * • Ledger posting
 *
 * ==========================================================
 */


class ProviderRouter {


    constructor({

        providers = {},

        logger,

        metrics,

        healthRegistry

    } = {}) {


        this.providers = new Map();


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.healthRegistry =
            healthRegistry;



        Object.entries(providers)

            .forEach(([name, provider]) => {


                this.register(

                    name,

                    provider

                );


            });


    }





    /**
     * ------------------------------------------------------
     * Resolve provider adapter
     * ------------------------------------------------------
     */
    resolve(providerName, options = {}) {


        if (!providerName) {


            throw new Error(

                'Payment provider name required'

            );

        }



        const normalized =

            providerName
                .toLowerCase();




        const provider =

            this.providers.get(

                normalized

            );




        if (!provider) {


            this.metrics?.counter?.(

                'payment_provider_resolution_failed_total'

            );



            throw new Error(

                `Provider ${providerName} unavailable`

            );

        }



        if (

            options.operation &&

            !this.supports(

                provider,

                options.operation

            )

        ) {


            throw new Error(

                `Provider ${providerName} does not support operation ${options.operation}`

            );

        }




        this.metrics?.counter?.(

            'payment_provider_resolution_total'

        );



        return provider;


    }







    /**
     * ------------------------------------------------------
     * Register provider dynamically
     * ------------------------------------------------------
     */
    register(

        providerName,

        adapter

    ) {


        if (!providerName) {


            throw new Error(

                'Provider name required'

            );

        }



        if (!adapter) {


            throw new Error(

                'Provider adapter required'

            );

        }





        const normalized =

            providerName
                .toLowerCase();





        this.providers.set(

            normalized,

            adapter

        );




        this.logger?.info?.({

            message:

                'Payment provider registered',


            provider:

                normalized


        });



        return true;

    }







    /**
     * ------------------------------------------------------
     * Remove provider
     * ------------------------------------------------------
     */
    unregister(providerName) {


        return this.providers.delete(

            providerName.toLowerCase()

        );

    }







    /**
     * ------------------------------------------------------
     * Provider availability
     * ------------------------------------------------------
     */
    exists(providerName) {


        return this.providers.has(

            providerName.toLowerCase()

        );

    }








    /**
     * ------------------------------------------------------
     * Supported operations check
     * ------------------------------------------------------
     */
    supports(

        provider,

        operation

    ) {


        if (

            typeof provider[operation] ===

            'function'

        ) {


            return true;

        }



        if (

            provider.capabilities &&

            Array.isArray(

                provider.capabilities

            )

        ) {


            return provider.capabilities.includes(

                operation

            );

        }



        return false;


    }








    /**
     * ------------------------------------------------------
     * List providers
     * ------------------------------------------------------
     */
    list() {


        return Array.from(

            this.providers.keys()

        );

    }







    /**
     * ------------------------------------------------------
     * Provider health status
     * ------------------------------------------------------
     */
    async health() {


        const results = {};



        for (

            const [

                name,

                provider

            ]

            of this.providers.entries()

        ) {


            try {


                results[name] =

                    await provider.health?.() ||

                    {

                        status:

                            'UNKNOWN'

                    };


            }


            catch(error) {


                results[name] = {


                    status:

                        'DOWN',


                    error:

                        error.message


                };

            }


        }





        return {


            status:

                'UP',


            providers:

                results,


            count:

                this.providers.size


        };


    }






    /**
     * ------------------------------------------------------
     * Snapshot
     * ------------------------------------------------------
     */
    snapshot() {


        return {


            providers:

                this.list(),


            count:

                this.providers.size


        };

    }



}



module.exports =
    ProviderRouter;
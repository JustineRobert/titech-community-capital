'use strict';

const crypto = require('crypto');


class BalanceEngineError extends Error {

    constructor(code, message, metadata = {}) {

        super(message);

        this.name =
            'BalanceEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();
    }
}



class BalanceEngine {


    constructor({

        ledgerBalance,

        availableBalance,

        pendingBalance,

        reservedBalance,

        balanceCache,

        reconciliationEngine,

        balanceSnapshot,

        auditService,

        eventBus,

        logger,

        metrics

    } = {}) {


        this.ledgerBalance =
            ledgerBalance;


        this.availableBalance =
            availableBalance;


        this.pendingBalance =
            pendingBalance;


        this.reservedBalance =
            reservedBalance;


        this.balanceCache =
            balanceCache;


        this.reconciliationEngine =
            reconciliationEngine;


        this.balanceSnapshot =
            balanceSnapshot;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.logger =
            logger;


        this.metrics =
            metrics;

    }




    /**
     * --------------------------------------------------
     * GET BALANCE
     *
     * Reads authoritative financial position
     * --------------------------------------------------
     */
    async getBalance({

        tenantId,

        accountId,

        forceRefresh = false

    }) {


        const cacheKey =
            this.generateCacheKey(
                tenantId,
                accountId
            );



        if(!forceRefresh){


            const cached =
                await this.balanceCache
                    ?.get(cacheKey);



            if(cached){

                return cached;

            }

        }



        return this.calculate({

            tenantId,

            accountId

        });

    }







    /**
     * --------------------------------------------------
     * CALCULATE BALANCE
     *
     * Ledger truth calculation
     * --------------------------------------------------
     */
    async calculate({

        tenantId,

        accountId

    }) {


        const ledger =
            await this.ledgerBalance
                .calculate({

                    tenantId,

                    accountId

                });



        const pending =
            await this.pendingBalance
                .calculate({

                    tenantId,

                    accountId

                });



        const reserved =
            await this.reservedBalance
                .calculate({

                    tenantId,

                    accountId

                });



        const available =
            await this.availableBalance
                .calculate({

                    ledger,

                    pending,

                    reserved

                });





        const result = {


            tenantId,


            accountId,


            ledgerBalance:
                ledger,


            pendingBalance:
                pending,


            reservedBalance:
                reserved,


            availableBalance:
                available,


            calculatedAt:
                new Date(),


            version:
                crypto.randomUUID()

        };




        await this.balanceCache
            ?.set(

                this.generateCacheKey(
                    tenantId,
                    accountId
                ),

                result

            );



        return result;

    }







    /**
     * --------------------------------------------------
     * REBUILD
     *
     * Reconstruct balances from ledger
     * --------------------------------------------------
     */
    async rebuild({

        tenantId,

        accountId

    }) {


        const result =
            await this.calculate({

                tenantId,

                accountId

            });



        await this.auditService
            ?.record({

                action:
                    'BALANCE_REBUILT',

                entity:
                    result

            });



        await this.eventBus
            ?.publish({

                type:
                    'BalanceRebuilt',

                payload:
                    result

            });



        return result;

    }







    /**
     * --------------------------------------------------
     * VERIFY
     *
     * Ledger vs balance verification
     * --------------------------------------------------
     */
    async verify({

        tenantId,

        accountId

    }) {


        const result =
            await this.reconciliationEngine
                .verify({

                    tenantId,

                    accountId

                });



        if(!result.valid){


            this.logger?.error?.(

                'Balance verification failed',

                result

            );

        }



        return result;

    }







    /**
     * --------------------------------------------------
     * RECONCILE
     * --------------------------------------------------
     */
    async reconcile({

        tenantId,

        accountId

    }) {


        return this.reconciliationEngine
            .reconcile({

                tenantId,

                accountId

            });

    }





    generateCacheKey(
        tenantId,
        accountId
    ){

        return `balance:${tenantId}:${accountId}`;

    }


}



module.exports = {

    BalanceEngine,

    BalanceEngineError

};
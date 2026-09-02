'use strict';


class ReconciliationEngine {


    constructor({

        ledgerBalance,

        balanceEngine

    }={}){


        this.ledgerBalance =
            ledgerBalance;


        this.balanceEngine =
            balanceEngine;

    }





    async verify({

        tenantId,

        accountId

    }){


        const ledger =
            await this.ledgerBalance
                .calculate({

                    tenantId,

                    accountId

                });



        const balance =
            await this.balanceEngine
                .getBalance({

                    tenantId,

                    accountId,

                    forceRefresh:true

                });



        return {


            valid:
                ledger ===
                balance.ledgerBalance,


            ledger,

            balance:
                balance.ledgerBalance


        };

    }



    async reconcile(data){

        return this.verify(data);

    }


}


module.exports =
    ReconciliationEngine;
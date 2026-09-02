'use strict';


class MonthlySnapshot {


    constructor({

        balanceEngine

    }={}){


        this.balanceEngine =
            balanceEngine;

    }





    async generate({

        tenantId,

        snapshotId,

        period

    }){


        const financialState =
            await this.balanceEngine
                .generateTenantSnapshot({

                    tenantId

                });



        return {


            id:
                snapshotId,


            tenantId,


            type:
                'MONTHLY',


            period,


            financialState,


            generatedAt:
                new Date()


        };

    }


}



module.exports =
    MonthlySnapshot;
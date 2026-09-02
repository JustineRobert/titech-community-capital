'use strict';


class DailySnapshot {


    constructor({

        balanceEngine

    }={}){


        this.balanceEngine =
            balanceEngine;

    }





    async generate({

        tenantId,

        period,

        snapshotId

    }){


        const balances =
            await this.balanceEngine
                .generateTenantSnapshot({

                    tenantId

                });



        return {


            id:
                snapshotId,


            tenantId,


            type:
                'DAILY',


            date:
                new Date(),


            balances,


            status:
                'GENERATED'

        };

    }


}



module.exports =
    DailySnapshot;
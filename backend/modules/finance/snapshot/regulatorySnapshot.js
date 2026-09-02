'use strict';


class RegulatorySnapshot {


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


        const financialPosition =
            await this.balanceEngine
                .generateTenantSnapshot({

                    tenantId

                });



        return {


            id:
                snapshotId,


            tenantId,


            type:
                'REGULATORY',


            period,


            financialPosition,


            complianceReady:true,


            generatedAt:
                new Date()

        };

    }


}



module.exports =
    RegulatorySnapshot;
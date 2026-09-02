'use strict';


class SettlementAgent {


    constructor({

        settlementService,

        predictionEngine

    } = {}) {


        this.settlementService =
            settlementService;


        this.predictionEngine =
            predictionEngine;


    }



    async predict(batch) {


        return this.predictionEngine.predictSettlement({

            batch

        });


    }



    async recover() {


        return this.settlementService.recoverFailedSettlements();


    }


}



module.exports = SettlementAgent;
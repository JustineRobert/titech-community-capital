'use strict';


class ReconciliationAgent {


    constructor({

        reconciliationService,

        repairEngine

    } = {}) {


        this.reconciliationService =
            reconciliationService;


        this.repairEngine =
            repairEngine;


    }



    async repair({

        mismatch

    }) {


        return this.repairEngine.repair({

            mismatch

        });


    }



    async executeDaily() {


        return this.reconciliationService.run();


    }


}



module.exports = ReconciliationAgent;
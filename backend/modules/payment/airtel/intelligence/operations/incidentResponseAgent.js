'use strict';


class IncidentResponseAgent {


    constructor({

        alertService,

        recoveryEngine,

        logger

    } = {}) {


        this.alertService =
            alertService;


        this.recoveryEngine =
            recoveryEngine;


        this.logger =
            logger;


    }



    async create({

        incident

    }) {


        return this.alertService.create({

            id:

                crypto.randomUUID(),

            severity:

                'HIGH',

            incident


        });


    }



    async recover({

        incident

    }) {


        return this.recoveryEngine.recover({

            incident

        });


    }


}



module.exports = IncidentResponseAgent;
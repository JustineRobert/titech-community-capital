'use strict';


class RegulatoryReportingAgent {


    constructor({

        reportingEngine

    } = {}) {


        this.reportingEngine =
            reportingEngine;


    }



    async generate({

        period

    }) {


        return this.reportingEngine.generate({

            provider:

                'AIRTEL',

            period

        });


    }


}



module.exports = RegulatoryReportingAgent;
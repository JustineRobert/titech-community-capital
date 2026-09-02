"use strict";


class RetryHealthChecks {



    constructor(options={}){


        this.registry =
            options.registry;


    }





    async check(){


        return {


            status:
                "healthy",


            service:
                "retry-framework",


            policies:
                this.registry?.listPolicies?.()
                ||
                [],


            timestamp:
                new Date()


        };


    }


}



module.exports={

    RetryHealthChecks

};
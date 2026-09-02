"use strict";


class RetryFraudIntegration {



    constructor(options={}){


        this.engine =
            options.engine;


    }





    async evaluate(context){


        if(
            this.engine
        ){

            return this.engine.score(
                context
            );

        }


        return {

            risk:"LOW"

        };


    }


}


module.exports={

    RetryFraudIntegration

};
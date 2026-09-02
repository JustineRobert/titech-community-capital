"use strict";


class RetryRateLimitCoordinator {



    constructor(options={}){

        this.limiter =
            options.limiter;

    }




    async check(context){


        if(
            this.limiter
        ){

            return this.limiter.consume(
                context.tenantId
            );

        }


        return true;


    }


}



module.exports={

    RetryRateLimitCoordinator

};
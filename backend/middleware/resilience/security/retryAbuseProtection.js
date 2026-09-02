"use strict";


class RetryAbuseProtection {


    constructor(){

        this.requests =
            new Map();

    }



    allow(context){


        const key =
            context.tenantId;


        const count =
            this.requests.get(key)
            ||
            0;



        if(
            count > 1000
        ){

            return false;

        }



        this.requests.set(
            key,
            count + 1
        );


        return true;


    }


}



module.exports={

    RetryAbuseProtection

};
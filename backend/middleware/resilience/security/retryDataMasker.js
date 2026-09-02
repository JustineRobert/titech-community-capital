"use strict";


class RetryDataMasker {


    constructor(){


        this.fields=[

            "password",

            "token",

            "secret",

            "authorization",

            "cardNumber",

            "cvv",

            "accountNumber"

        ];

    }



    mask(payload){


        if(
            !payload
            ||
            typeof payload !== "object"
        ){

            return payload;

        }



        const clone =
            JSON.parse(
                JSON.stringify(payload)
            );



        for(
            const field of this.fields
        ){

            if(
                clone[field]
            ){

                clone[field]="***MASKED***";

            }

        }



        return clone;


    }


}


module.exports={

    RetryDataMasker

};
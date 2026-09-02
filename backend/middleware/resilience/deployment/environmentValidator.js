"use strict";


class RetryEnvironmentValidator {



    validate(){


        const required=[


            "NODE_ENV"


        ];



        const missing =
            required.filter(
                key =>
                !process.env[key]
            );



        if(
            missing.length
        ){

            throw new Error(

                `Missing environment values: ${missing.join(",")}`

            );

        }



        return true;


    }



}



module.exports={

    RetryEnvironmentValidator

};
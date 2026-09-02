"use strict";


const crypto =
    require("crypto");



class RetryAuditIntegrity {



    constructor(){

        this.previousHash =
            null;

    }





    createHash(event){


        const payload =
            JSON.stringify({

                previousHash:
                    this.previousHash,


                event


            });



        const hash =
            crypto
            .createHash("sha256")
            .update(payload)
            .digest("hex");



        this.previousHash =
            hash;



        return hash;


    }





    async record(event){


        return {


            timestamp:
                new Date(),


            hash:
                this.createHash(event)


        };


    }


}



module.exports = {

    RetryAuditIntegrity

};
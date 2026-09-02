"use strict";


class RetryReadinessProbe {



    constructor(options={}){


        this.service =
            options.service;


    }





    async check(){


        return {


            ready:
                Boolean(
                    this.service
                ),


            timestamp:
                new Date()


        };


    }



}



module.exports={

    RetryReadinessProbe

};
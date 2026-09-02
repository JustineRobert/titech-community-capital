"use strict";


class RetryLivenessProbe {



    async check(){


        return {


            alive:true,


            timestamp:
                new Date()


        };


    }


}



module.exports={

    RetryLivenessProbe

};
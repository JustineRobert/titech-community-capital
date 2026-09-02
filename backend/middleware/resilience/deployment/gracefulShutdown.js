"use strict";


class RetryGracefulShutdown {



    constructor(options={}) {


        this.services =
            [];


        this.timeout =
            options.timeout
            ||
            30000;


        this.shuttingDown =
            false;


    }




    register(service){


        this.services.push(
            service
        );


    }





    async shutdown(){


        if(
            this.shuttingDown
        ){

            return;

        }


        this.shuttingDown =
            true;



        for(
            const service of this.services
        ){

            await service.shutdown?.();

        }


    }



}



module.exports={

    RetryGracefulShutdown

};
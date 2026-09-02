"use strict";


class RetryServiceRegistry {



    constructor(){


        this.services =
            new Map();


    }





    register(
        name,
        service
    ){


        this.services.set(

            name,

            service

        );


        return this;


    }





    resolve(name){


        return this.services.get(
            name
        );


    }





    list(){


        return [

            ...this.services.keys()

        ];


    }





    async shutdown(){


        for(
            const service of this.services.values()
        ){

            await service.shutdown?.();

        }


    }



}



const retryServiceRegistry =
    new RetryServiceRegistry();



module.exports={

    RetryServiceRegistry,

    retryServiceRegistry

};
"use strict";


class RetryDeploymentDiagnostics {



    constructor(options={}){


        this.kubernetes =
            options.kubernetes;


        this.registry =
            options.registry;


    }





    inspect(){


        return {


            runtime:{

                node:
                    process.version,


                environment:
                    process.env.NODE_ENV


            },


            kubernetes:
                this.kubernetes?.metadata(),


            services:
                this.registry?.list()


        };


    }


}



module.exports={

    RetryDeploymentDiagnostics

};
"use strict";

/**
 * Enterprise Kubernetes Integration
 *
 * Handles:
 *
 * - Pod lifecycle awareness
 * - Shutdown signals
 * - Probe registration
 * - Deployment metadata
 */


class KubernetesIntegration {


    constructor(options={}) {


        this.serviceName =
            options.serviceName
            ||
            "retry-service";


        this.namespace =
            process.env.KUBERNETES_NAMESPACE
            ||
            "default";


        this.shutdown =
            false;


    }



    initialize(){


        process.once(
            "SIGTERM",
            ()=>{

                this.shutdown = true;

            }
        );


        process.once(
            "SIGINT",
            ()=>{

                this.shutdown = true;

            }
        );


    }





    isShuttingDown(){


        return this.shutdown;


    }




    metadata(){


        return {

            service:
                this.serviceName,


            namespace:
                this.namespace,


            pod:

                process.env.HOSTNAME

        };


    }


}



module.exports = {

    KubernetesIntegration

};
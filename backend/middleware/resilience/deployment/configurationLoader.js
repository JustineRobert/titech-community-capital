"use strict";


class RetryConfigurationLoader {



    load(){


        return {


            enabled:
                process.env.RETRY_ENABLED !== "false",


            environment:
                process.env.NODE_ENV
                ||
                "development",


            shutdownTimeout:

                Number(
                    process.env.RETRY_SHUTDOWN_TIMEOUT
                    ||
                    30000
                )


        };


    }


}



module.exports={

    RetryConfigurationLoader

};
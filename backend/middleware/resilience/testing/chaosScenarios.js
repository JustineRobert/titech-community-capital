'use strict';


module.exports = {


    DATABASE_TIMEOUT:

    async(context)=>{


        context.injector.inject(

            'DATABASE',

            new Error(

                'Database timeout'

            )

        );


    },



    MTN_PROVIDER_FAILURE:

    async(context)=>{


        context.injector.inject(

            'MTN_MOMO',

            new Error(

                'MTN unavailable'

            )

        );

    },



    REDIS_FAILURE:

    async(context)=>{


        context.injector.inject(

            'REDIS',

            new Error(

                'Redis unavailable'

            )

        );

    }



};
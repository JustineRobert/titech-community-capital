'use strict';


class ResilienceLoadTester {


    async execute(
        operation,
        requests=100
    )
    {


        const results =
            await Promise.allSettled(

                Array.from(

                    {

                        length:requests

                    },

                    ()=>operation()

                )

            );



        return {


            total:

                requests,


            successful:

                results.filter(

                    r=>r.status==='fulfilled'

                ).length,


            failed:

                results.filter(

                    r=>r.status==='rejected'

                ).length


        };

    }



}



module.exports =
    ResilienceLoadTester;
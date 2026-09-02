'use strict';


/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * Enterprise Resilience Test Runner
 *
 * Responsibilities:
 *
 * ✓ Execute resilience tests
 * ✓ Collect results
 * ✓ Track failures
 * ✓ Generate reports
 *
 * =============================================================================
 */


class ResilienceTestRunner {


    constructor()
    {

        this.results = [];

    }



    async execute(
        name,
        test
    )
    {


        const started =
            Date.now();


        try {


            const result =
                await test();



            const record =
            {

                name,

                status:
                    'PASSED',

                duration:

                    Date.now() - started,


                result

            };


            this.results.push(record);


            return record;


        }
        catch(error)
        {


            const record =
            {

                name,

                status:
                    'FAILED',


                error:

                    error.message,


                duration:

                    Date.now() - started

            };


            this.results.push(record);


            return record;

        }

    }



    report()
    {

        return [

            ...this.results

        ];

    }


}



module.exports =
    ResilienceTestRunner;
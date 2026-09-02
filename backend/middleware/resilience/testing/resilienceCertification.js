'use strict';


class ResilienceCertification {


    certify(
        results
    )
    {


        const failed =
            results.filter(

                r=>r.status==='FAILED'

            );



        return {


            certified:

                failed.length === 0,


            passed:

                results.length - failed.length,


            failed:

                failed.length,


            timestamp:

                new Date()

        };

    }


}



module.exports =
    ResilienceCertification;
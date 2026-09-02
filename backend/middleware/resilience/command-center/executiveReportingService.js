'use strict';


class ExecutiveReportingService {


    generate(
        metrics
    )
    {


        return {


            availability:

                metrics.availability,


            reliabilityGrade:

                metrics.score,


            incidents:

                metrics.incidents,


            generatedAt:

                new Date()

        };

    }



}



module.exports =
    ExecutiveReportingService;
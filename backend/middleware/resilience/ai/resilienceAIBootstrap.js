'use strict';


const ResilienceAIEngine =
require('./resilienceAIEngine');


const FailurePredictionEngine =
require('./failurePredictionEngine');


const AnomalyDetectionEngine =
require('./anomalyDetectionEngine');


const ResilienceScoreEngine =
require('./resilienceScoreEngine');



function bootstrapResilienceAI()
{


    return new ResilienceAIEngine({

        prediction:

            new FailurePredictionEngine(),


        anomaly:

            new AnomalyDetectionEngine(),


        score:

            new ResilienceScoreEngine()

    });


}



module.exports =
{

    bootstrapResilienceAI

};
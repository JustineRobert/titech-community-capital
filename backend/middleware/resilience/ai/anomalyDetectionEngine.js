'use strict';


class AnomalyDetectionEngine {


    detect(
        telemetry
    )
    {


        const abnormal =

            telemetry.latency >

            telemetry.expectedLatency * 2;



        return {


            anomaly:

                abnormal,


            severity:

                abnormal

                    ? 'HIGH'

                    : 'NORMAL'

        };


    }



}



module.exports =
    AnomalyDetectionEngine;
'use strict';


const ResilienceCommandCenter =
require('./resilienceCommandCenter');


const ResilienceDashboardService =
require('./resilienceDashboardService');


const GlobalResilienceView =
require('./globalResilienceView');


const IncidentCommandEngine =
require('./incidentCommandEngine');


const SlaSloManager =
require('./slaSloManager');



function bootstrapCommandCenter(
    runtime
)
{


    const dashboard =
        new ResilienceDashboardService(

            runtime

        );



    const global =
        new GlobalResilienceView();



    const incidents =
        new IncidentCommandEngine();



    const sla =
        new SlaSloManager();



    return new ResilienceCommandCenter({

        dashboard,

        global,

        incidents,

        sla

    });


}



module.exports =
{

    bootstrapCommandCenter

};
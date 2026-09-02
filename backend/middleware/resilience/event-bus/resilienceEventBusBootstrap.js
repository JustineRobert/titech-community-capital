'use strict';


const ResilienceEventBus =
require('./resilienceEventBus');


const ResilienceEventFactory =
require('./resilienceEventFactory');


const ResilienceRecoveryCoordinator =
require('./resilienceRecoveryCoordinator');



function bootstrapResilienceEventBus(
    options={}
)
{


    const bus =
        new ResilienceEventBus();



    const factory =
        new ResilienceEventFactory();



    const coordinator =
        new ResilienceRecoveryCoordinator(

            bus,

            options.orchestrator

        );



    return {

        bus,

        factory,

        coordinator

    };

}



module.exports =
{

    bootstrapResilienceEventBus

};
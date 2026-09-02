'use strict';


const AutonomousResilienceEngine =
require('./autonomousResilienceEngine');


const SelfHealingWorkflowEngine =
require('./selfHealingWorkflowEngine');


const HealingActionExecutor =
require('./healingActionExecutor');


function bootstrapAutonomousResilience()
{


    const workflows =
        new SelfHealingWorkflowEngine();



    const healer =
        new HealingActionExecutor(

            workflows

        );



    const engine =
        new AutonomousResilienceEngine({

            healer,


            agent:

            {

                analyze:

                    async()=>({

                        action:

                            'SELF_HEAL'

                    })

            }

        });



    return engine;

}



module.exports =
{

    bootstrapAutonomousResilience

};
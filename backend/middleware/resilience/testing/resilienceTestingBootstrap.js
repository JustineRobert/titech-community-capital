'use strict';


const ResilienceTestRunner =
require('./resilienceTestRunner');


const FailureInjector =
require('./failureInjector');


const DependencySimulator =
require('./dependencySimulator');


const ResilienceScenarioRegistry =
require('./resilienceScenarioRegistry');



function bootstrapResilienceTesting()
{


    const injector =
        new FailureInjector();



    return {


        runner:

            new ResilienceTestRunner(),



        injector,


        simulator:

            new DependencySimulator(

                injector

            ),



        scenarios:

            new ResilienceScenarioRegistry()

    };


}



module.exports =
{

    bootstrapResilienceTesting

};
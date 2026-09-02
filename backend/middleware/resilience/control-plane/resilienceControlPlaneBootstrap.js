'use strict';


const ResilienceConfigManager =
require('./resilienceConfigManager');


const ResilienceFeatureFlags =
require('./resilienceFeatureFlags');


const ResilienceTenantProfiles =
require('./resilienceTenantProfiles');



function bootstrapControlPlane(
    options={}
)
{


    return {


        config:

            new ResilienceConfigManager(

                options

            ),



        features:

            new ResilienceFeatureFlags(),



        tenants:

            new ResilienceTenantProfiles()

    };

}



module.exports =
{

    bootstrapControlPlane

};
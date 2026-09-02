'use strict';


const express =
require('express');


const router =
express.Router();



const {

requirePermission,

RESILIENCE_PERMISSIONS

}
=
require('./resilienceAdminAuthorization');



module.exports =
function(
controllers
)
{


router.get(

'/diagnostics',

requirePermission(

RESILIENCE_PERMISSIONS.VIEW

),

controllers.diagnostics.health.bind(

controllers.diagnostics

)

);



router.get(

'/dashboard',

requirePermission(

RESILIENCE_PERMISSIONS.VIEW

),

controllers.dashboard.overview.bind(

controllers.dashboard

)

);



router.post(

'/policies/:name',

requirePermission(

RESILIENCE_PERMISSIONS.MANAGE_POLICY

),

async(req,res)=>{


const result =
controllers.policy.create(

req.params.name,

req.body

);


res.json(result);


}

);



return router;

};
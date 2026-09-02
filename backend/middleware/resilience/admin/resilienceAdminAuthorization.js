'use strict';


/**
 * =============================================================================
 * Enterprise Resilience Administration Authorization
 *
 * Responsibilities:
 *
 * ✓ Admin RBAC
 * ✓ Permission validation
 * ✓ Operational protection
 *
 * =============================================================================
 */


const RESILIENCE_PERMISSIONS =
Object.freeze({

    VIEW:

        'RESILIENCE_VIEW',


    MANAGE_POLICY:

        'RESILIENCE_POLICY_MANAGE',


    MANAGE_CIRCUIT:

        'RESILIENCE_CIRCUIT_MANAGE',


    MANAGE_STRATEGY:

        'RESILIENCE_STRATEGY_MANAGE',


    MANAGE_TENANT:

        'RESILIENCE_TENANT_MANAGE'

});



function requirePermission(
    permission
)
{


    return (
        req,
        res,
        next
    )=>{


        const user =
            req.user;



        if(
            !user
            ||
            !user.permissions
            ||
            !user.permissions.includes(permission)
        )
        {

            return res.status(403)
                .json({

                    error:
                        'Insufficient resilience permission'

                });

        }



        next();

    };

}



module.exports =
{

    RESILIENCE_PERMISSIONS,

    requirePermission

};
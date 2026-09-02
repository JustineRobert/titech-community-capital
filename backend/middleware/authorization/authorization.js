'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/security/authorization.js
 *
 * Enterprise Authorization Engine
 *
 * =============================================================================
 *
 * Responsibilities:
 *
 * • RBAC enforcement
 * • ABAC policy evaluation
 * • Permission registry
 * • Tenant scoped authorization
 * • Resource ownership checks
 * • Financial operation protection
 * • Maker/checker workflow enforcement
 * • Authorization decision logging
 *
 * =============================================================================
 */


const COMPONENT_NAME =
    'EnterpriseAuthorizationEngine';


const COMPONENT_VERSION =
    '1.0.0';



/**
 * ============================================================================
 * Optional Dependencies
 * ============================================================================
 */

let StructuredLogger;
let LoggerFactory;
let TraceContext;
let RequestMetrics;
let EventBus;
let AuditService;



try {

    StructuredLogger =
        require('../../shared/logging/StructuredLogger');

}

catch (_) {}



try {

    LoggerFactory =
        require('../../shared/logging/LoggerFactory');

}

catch (_) {}



try {

    TraceContext =
        require('../../shared/tracing/TraceContext');

}

catch (_) {}



try {

    RequestMetrics =
        require('../../shared/metrics/RequestMetrics');

}

catch (_) {}



try {

    EventBus =
        require('../../shared/events/EventBus');

}

catch (_) {}



try {

    AuditService =
        require('../../shared/audit/AuditService');

}

catch (_) {}



/**
 * ============================================================================
 * Permission Registry
 * ============================================================================
 */


const PERMISSIONS = Object.freeze({


    /*
     * Tenant Administration
     */

    TENANT_VIEW:

        'tenant:view',


    TENANT_MANAGE:

        'tenant:manage',



    /*
     * User Management
     */

    USER_CREATE:

        'user:create',


    USER_UPDATE:

        'user:update',


    USER_DELETE:

        'user:delete',



    /*
     * Savings
     */

    SAVINGS_CREATE:

        'savings:create',


    SAVINGS_APPROVE:

        'savings:approve',



    /*
     * Loans
     */

    LOAN_CREATE:

        'loan:create',


    LOAN_APPROVE:

        'loan:approve',


    LOAN_DISBURSE:

        'loan:disburse',



    /*
     * Financial Ledger
     */

    LEDGER_VIEW:

        'ledger:view',


    LEDGER_POST:

        'ledger:post',


    LEDGER_REVERSE:

        'ledger:reverse',



    /*
     * Reports
     */

    REPORT_VIEW:

        'report:view'


});



/**
 * ============================================================================
 * Role Hierarchy
 * ============================================================================
 */


const ROLE_HIERARCHY = Object.freeze({


    MEMBER:

        [

            'savings:view'

        ],



    OFFICER:

        [

            'savings:create',

            'loan:create'

        ],



    MANAGER:

        [

            'loan:approve',

            'report:view'

        ],



    ADMIN:

        Object.values(PERMISSIONS)



});





/**
 * ============================================================================
 * Authorization Error
 * ============================================================================
 */


class AuthorizationError
    extends Error {


    constructor(

        message,

        details = {}

    ) {


        super(message);


        this.name =
            'AuthorizationError';


        this.code =
            'AUTHORIZATION_DENIED';


        this.statusCode =
            403;


        this.details =
            details;


        this.operational =
            true;


    }


}




/**
 * ============================================================================
 * Permission Resolution
 * ============================================================================
 */


function resolveUserPermissions(user) {


    const permissions = new Set();



    const roles =

        user.roles || [];



    roles.forEach(role => {


        const granted =

            ROLE_HIERARCHY[role] || [];



        granted.forEach(permission => {


            permissions.add(permission);


        });


    });



    return permissions;


}





/**
 * ============================================================================
 * RBAC Evaluation
 * ============================================================================
 */


function evaluateRBAC(

    req,

    requiredPermission

) {


    const user =

        req.user;



    if (!user) {


        throw new AuthorizationError(

            'Missing authenticated user.'

        );


    }



    const permissions =

        resolveUserPermissions(user);



    return permissions.has(

        requiredPermission

    );


}




/**
 * ============================================================================
 * ABAC Evaluation
 * ============================================================================
 */


function evaluateABAC(

    req,

    policy

) {


    if (!policy) {

        return true;

    }



    return policy({

        user:

            req.user,


        tenant:

            req.tenantContext,


        resource:

            req.resource,


        request:

            req

    });


}





/**
 * ============================================================================
 * Resource Ownership Check
 * ============================================================================
 */


function verifyResourceOwnership(

    req,

    resource

) {


    if (!resource) {

        return true;

    }



    if (

        resource.tenantId !==

        req.tenantContext.tenantId

    ) {


        throw new AuthorizationError(

            'Resource belongs to another tenant.'

        );


    }



    return true;


}





/**
 * ============================================================================
 * Decision Logging
 * ============================================================================
 */


async function logDecision(data) {


    await AuditService?.record?.({

        action:

            'AUTHORIZATION_DECISION',


        ...data

    });



    await EventBus?.publish?.(

        'security.authorization.decision',

        data

    );


}






/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */


function createAuthorizationMiddleware(options = {}) {


    const permission =

        options.permission;



    const policy =

        options.policy;



    return async function authorizationMiddleware(

        req,

        res,

        next

    ) {


        try {



            const allowedByRole =

                evaluateRBAC(

                    req,

                    permission

                );



            const allowedByPolicy =

                evaluateABAC(

                    req,

                    policy

                );



            const allowed =

                allowedByRole &&

                allowedByPolicy;



            await logDecision({

                allowed,

                permission,

                userId:

                    req.user?.id,

                tenantId:

                    req.tenantContext?.tenantId

            });



            if (!allowed) {


                throw new AuthorizationError(

                    'Permission denied.',

                    {

                        permission

                    }

                );


            }



            TraceContext?.setAttributes?.({

                authorization:

                    'granted',

                permission

            });



            RequestMetrics?.increment?.(

                'authorization.allowed'

            );



            next();



        }

        catch(error) {


            StructuredLogger?.error?.(

                'Authorization failed',

                {

                    error

                }

            );


            RequestMetrics?.increment?.(

                'authorization.denied'

            );


            next(error);


        }


    };


}





/**
 * ============================================================================
 * Diagnostics
 * ============================================================================
 */


function diagnostics() {


    return Object.freeze({

        component:

            COMPONENT_NAME,


        version:

            COMPONENT_VERSION,


        permissions:

            Object.keys(PERMISSIONS)


    });


}



const registration = Object.freeze({


    name:

        COMPONENT_NAME,


    priority:

        70,


    phase:

        'security',


    after:

        [

            'tenantSecurityOrchestrator'

        ]

});





module.exports = Object.freeze({


    createAuthorizationMiddleware,


    middleware:

        createAuthorizationMiddleware,


    permissions:

        PERMISSIONS,


    roles:

        ROLE_HIERARCHY,


    AuthorizationError,


    diagnostics,


    registration


});
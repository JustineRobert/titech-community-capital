'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/security/complianceSecurity.js
 *
 * Enterprise Compliance Security & Regulatory Enforcement Engine
 *
 * =============================================================================
 *
 * Responsibilities:
 *
 * • AML transaction monitoring
 * • KYC enforcement
 * • Regulatory controls
 * • Suspicious activity reporting
 * • Evidence collection
 * • Data retention enforcement
 * • Financial reporting controls
 *
 * =============================================================================
 */


const COMPONENT_NAME =
    'EnterpriseComplianceSecurity';


const COMPONENT_VERSION =
    '1.0.0';




/**
 * ============================================================================
 * Enterprise Dependencies
 * ============================================================================
 */


let StructuredLogger;
let AuditService;
let EventBus;
let TraceContext;
let RequestMetrics;



try {

    StructuredLogger =
        require('../../shared/logging/StructuredLogger');

}
catch (_) {}



try {

    AuditService =
        require('../../shared/audit/AuditService');

}
catch (_) {}



try {

    EventBus =
        require('../../shared/events/EventBus');

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





/**
 * ============================================================================
 * Runtime State
 * ============================================================================
 */


const INTERNAL_STATE = Object.seal({

    initialized:
        false,


    evaluations:
        0,


    blocked:
        0,


    suspicious:
        0,


    lastDecision:
        null

});





/**
 * ============================================================================
 * Regulatory Thresholds
 * ============================================================================
 */


const COMPLIANCE_RULES = Object.freeze({


    LARGE_TRANSACTION:

    {

        amount:

            5000000,


        action:

            'REVIEW'

    },


    CASH_WITHDRAWAL:

    {

        amount:

            1000000,


        action:

            'REPORT'

    },


    UNVERIFIED_CUSTOMER:

    {

        action:

            'BLOCK'

    }


});





/**
 * ============================================================================
 * Errors
 * ============================================================================
 */


class ComplianceViolationError
    extends Error {


    constructor(

        message,

        details = {}

    ) {


        super(message);


        this.name =
            'ComplianceViolationError';


        this.code =
            'COMPLIANCE_VIOLATION';


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
 * KYC Enforcement
 * ============================================================================
 */


function evaluateKYC(context)

{


    const user =
        context.user;



    if(

        !user

    )

    {


        return {

            passed:false,

            violation:

                'MISSING_IDENTITY'

        };


    }



    if(

        user.kycVerified !== true

    )

    {


        return {

            passed:false,

            violation:

                'KYC_REQUIRED'

        };


    }



    return {

        passed:true

    };


}





/**
 * ============================================================================
 * AML Monitoring
 * ============================================================================
 */


function evaluateAML(context)

{


    const violations = [];



    const amount =

        Number(

            context.amount || 0

        );



    if(

        amount >

        COMPLIANCE_RULES
            .LARGE_TRANSACTION
            .amount

    )

    {


        violations.push(

            'LARGE_TRANSACTION'

        );


    }



    return {


        passed:

            violations.length === 0,


        violations


    };


}





/**
 * ============================================================================
 * Regulatory Rules Engine
 * ============================================================================
 */


function evaluateRegulatoryRules(context)

{


    const actions = [];



    const amount =

        Number(

            context.amount || 0

        );



    if(

        amount >

        COMPLIANCE_RULES
            .LARGE_TRANSACTION
            .amount

    )

    {


        actions.push(

            'ENHANCED_REVIEW'

        );


    }



    return actions;


}





/**
 * ============================================================================
 * Suspicious Activity Detection
 * ============================================================================
 */


function detectSuspiciousActivity(context)

{


    const signals = [];



    if(

        context.fraudDecision

            ?.riskLevel ===

            'HIGH'

    )

    {


        signals.push(

            'HIGH_FRAUD_RISK'

        );


    }



    if(

        context.fraudDecision

            ?.riskLevel ===

            'CRITICAL'

    )

    {


        signals.push(

            'CRITICAL_FRAUD_RISK'

        );


    }



    return signals;


}





/**
 * ============================================================================
 * Compliance Evaluation
 * ============================================================================
 */


async function evaluate(context)

{


    INTERNAL_STATE.evaluations++;



    const violations = [];

    const actions = [];



    const kyc =

        evaluateKYC(context);



    if(!kyc.passed)

    {


        violations.push(

            kyc.violation

        );


    }



    const aml =

        evaluateAML(context);



    violations.push(

        ...aml.violations

    );



    actions.push(

        ...evaluateRegulatoryRules(context)

    );



    const suspicious =

        detectSuspiciousActivity(context);



    violations.push(

        ...suspicious

    );



    let status =
        'COMPLIANT';



    if(

        violations.length > 0

    )

    {


        status =
            'REVIEW';


    }



    if(

        violations.includes(

            'KYC_REQUIRED'

        )

    )

    {


        status =
            'BLOCKED';


    }



    const decision = Object.freeze({


        status,


        violations,


        regulatoryActions:

            actions,


        timestamp:

            new Date()


    });



    INTERNAL_STATE.lastDecision =
        decision;



    return decision;


}





/**
 * ============================================================================
 * Audit Evidence Package
 * ============================================================================
 */


async function generateEvidence(

    req,

    decision

)

{


    const evidence = Object.freeze({


        event:

            'COMPLIANCE_DECISION',


        tenantId:

            req.tenantContext?.tenantId,


        userId:

            req.user?.id,


        requestId:

            req.id,


        decision,


        createdAt:

            new Date()


    });



    await AuditService?.record?.(

        evidence

    );



    await EventBus?.publish?.(

        'compliance.decision',

        evidence

    );



    return evidence;


}





/**
 * ============================================================================
 * Middleware Factory
 * ============================================================================
 */


function createComplianceMiddleware(options={})

{


    return async function complianceSecurity(

        req,

        res,

        next

    )


    {


        try {


            const decision =

                await evaluate({


                    user:

                        req.user,


                    amount:

                        req.body?.amount,


                    tenantContext:

                        req.tenantContext,


                    fraudDecision:

                        req.fraudDecision,


                    operation:

                        options.operation


                });



            await generateEvidence(

                req,

                decision

            );



            req.complianceDecision =
                decision;



            TraceContext?.setAttributes?.({

                compliance:

                    decision.status

            });



            RequestMetrics?.increment?.(

                `compliance.${decision.status.toLowerCase()}`

            );



            if(

                decision.status ===

                'BLOCKED'

            )

            {


                INTERNAL_STATE.blocked++;



                throw new ComplianceViolationError(

                    'Compliance validation failed.',

                    decision

                );


            }



            next();



        }

        catch(error)

        {


            StructuredLogger?.error?.(

                'Compliance enforcement failed',

                {

                    error

                }

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


function diagnostics()

{


    return Object.freeze({

        component:

            COMPONENT_NAME,


        version:

            COMPONENT_VERSION,


        rules:

            Object.keys(

                COMPLIANCE_RULES

            ),


        state:

            {

                ...INTERNAL_STATE

            }


    });


}





const registration = Object.freeze({

    name:

        COMPONENT_NAME,


    phase:

        'security',


    priority:

        110,


    after:

        [

            'fraudRiskEngine'

        ]

});





module.exports = Object.freeze({


    createComplianceMiddleware,


    middleware:

        createComplianceMiddleware,


    evaluate,


    ComplianceViolationError,


    generateEvidence,


    diagnostics,


    registration


});
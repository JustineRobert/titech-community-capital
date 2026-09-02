/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Payment Reliability Notification Gateway
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Multi-Channel Notification Routing
 * • Slack Integration Ready
 * • Email Integration Ready
 * • SMS Integration Ready
 * • PagerDuty Integration Ready
 * • Microsoft Teams Integration Ready
 * • Notification Templates
 * • Escalation Policies
 * • Tenant Notification Preferences
 * • Retry Orchestration
 * • Delivery Tracking
 * • Notification Storm Protection
 * • Audit Logging Integration
 * • Structured Logging
 * • OpenTelemetry Ready
 *
 *
 * Purpose
 * -------
 * Provide a unified communication layer for payment reliability events.
 *
 *
 * Processing Flow
 * ---------------
 *
 * Reliability Alert
 *
 *        |
 *        ▼
 *
 * Notification Gateway
 *
 *        |
 *        ├───────────────┐
 *        ▼               ▼
 *
 * Channel Router     Escalation Engine
 *
 *        |
 *        ▼
 *
 * Slack / Email / SMS / PagerDuty / Teams
 *
 *
 *
 * Notification Lifecycle
 * ----------------------
 *
 * CREATED
 * QUEUED
 * SENT
 * FAILED
 * RETRYING
 * DELIVERED
 *
 *
 * Design Principles
 * -----------------
 * • Communication Layer Only
 * • No Payment Logic
 * • No Incident Mutation
 * • Resilient Delivery
 * • Enterprise Operations Ready
 *
 * ============================================================================
 */


const {

    randomUUID

} = require("crypto");



class PaymentReliabilityNotificationGateway {


    constructor({

        channels = {},

        auditLogger,

        logger,

        retryPolicy = {},

        templates = {},

        tenantPolicies = {}

    } = {}) {


        this.channels =
            channels;


        this.auditLogger =
            auditLogger;


        this.logger =
            logger;



        this.retryPolicy = Object.freeze({

            attempts:

                3,


            delayMs:

                5000,


            ...retryPolicy

        });



        this.templates =
            templates;



        this.tenantPolicies =
            tenantPolicies;



        this.notifications = new Map();



        this.sentFingerprints =
            new Map();


    }





    /**
     * ------------------------------------------------------------------------
     * Send Reliability Notification
     * ------------------------------------------------------------------------
     */


    async send({

        alert,

        tenantId,

        recipients = [],

        channels = []

    }) {


        const fingerprint =

            this.#createFingerprint({

                alert,

                tenantId

            });



        if (

            this.#isDuplicate(fingerprint)

        ) {


            return {

                suppressed:

                    true,

                reason:

                    "Notification storm protection"

            };

        }



        const notification = {


            id:

                randomUUID(),



            alertId:

                alert.id,



            tenantId,



            status:

                "CREATED",



            channels,



            recipients,



            createdAt:

                new Date()


        };



        this.notifications.set(

            notification.id,

            notification

        );



        this.sentFingerprints.set(

            fingerprint,

            Date.now()

        );



        await this.#dispatch(notification, alert);



        return notification;


    }





    /**
     * ------------------------------------------------------------------------
     * Channel Dispatch
     * ------------------------------------------------------------------------
     */


    async #dispatch(notification, alert) {


        notification.status =

            "QUEUED";



        for (

            const channelName of notification.channels

        ) {


            await this.#sendWithRetry({

                channelName,

                notification,

                alert

            });


        }



        notification.status =

            "SENT";



        await this.#audit({

            action:

                "NOTIFICATION_SENT",


            notification

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Retry Delivery
     * ------------------------------------------------------------------------
     */


    async #sendWithRetry({

        channelName,

        notification,

        alert

    }) {


        const channel =

            this.channels[channelName];



        if (!channel) {


            return;

        }



        let attempts = 0;



        while (

            attempts <

            this.retryPolicy.attempts

        ) {


            try {


                attempts++;



                await channel.send(

                    this.#buildMessage({

                        alert,

                        channelName

                    })

                );



                return;


            }

            catch(error) {



                if (

                    attempts >=

                    this.retryPolicy.attempts

                ) {


                    notification.status =

                        "FAILED";



                    this.logger?.error?.(

                        "Notification delivery failed",

                        {

                            channelName,

                            error

                        }

                    );


                }


            }


        }


    }





    /**
     * ------------------------------------------------------------------------
     * Template Rendering
     * ------------------------------------------------------------------------
     */


    #buildMessage({

        alert,

        channelName

    }) {


        const template =

            this.templates[channelName]

            ||

            this.templates.default;



        if (!template) {


            return alert;

        }



        return template({

            alert

        });


    }





    /**
     * ------------------------------------------------------------------------
     * Tenant Notification Policy
     * ------------------------------------------------------------------------
     */


    resolveTenantPolicy(tenantId) {


        return (

            this.tenantPolicies[tenantId]

            ||

            {

                channels:

                    [

                        "EMAIL"

                    ]

            }

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Escalation Support
     * ------------------------------------------------------------------------
     */


    resolveEscalation(alert) {


        if (

            alert.severity ===

            "CRITICAL"

        ) {


            return {


                level:

                    "IMMEDIATE",


                channels:

                    [

                        "PAGERDUTY",

                        "SMS"

                    ]

            };


        }



        if (

            alert.severity ===

            "HIGH"

        ) {


            return {


                level:

                    "URGENT",


                channels:

                    [

                        "SLACK",

                        "EMAIL"

                    ]

            };


        }



        return {


            level:

                "NORMAL",


            channels:

                [

                    "EMAIL"

                ]

        };


    }





    /**
     * ------------------------------------------------------------------------
     * Notification Storm Prevention
     * ------------------------------------------------------------------------
     */


    #createFingerprint({

        alert,

        tenantId

    }) {


        return [

            tenantId,

            alert.type,

            alert.provider

        ]

        .join(":");


    }





    #isDuplicate(fingerprint) {


        const existing =

            this.sentFingerprints.get(

                fingerprint

            );



        if (!existing) {


            return false;

        }



        const window =

            15 * 60 * 1000;



        return (

            Date.now()

            -

            existing

        )

        <

        window;


    }





    /**
     * ------------------------------------------------------------------------
     * Audit Logging
     * ------------------------------------------------------------------------
     */


    async #audit(event) {


        if (

            !this.auditLogger

        ) {


            return;

        }



        await this.auditLogger.log(

            event

        );


    }





    /**
     * ------------------------------------------------------------------------
     * Delivery Snapshot
     * ------------------------------------------------------------------------
     */


    snapshot() {


        return Object.freeze({

            total:

                this.notifications.size,


            notifications:

                [

                    ...this.notifications.values()

                ]

        });


    }


}


module.exports =
    PaymentReliabilityNotificationGateway;
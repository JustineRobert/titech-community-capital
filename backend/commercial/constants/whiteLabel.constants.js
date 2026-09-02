"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * White-Label Platform Constants
 * backend/commercial/constants/whiteLabel.constants.js
 * =============================================================================
 */

const WHITE_LABEL_STATUS =
    Object.freeze({

        DRAFT:
            "DRAFT",

        ACTIVE:
            "ACTIVE",

        SUSPENDED:
            "SUSPENDED",

        TERMINATED:
            "TERMINATED",

    });


const DOMAIN_STATUS =
    Object.freeze({

        PENDING:
            "PENDING",

        VERIFYING:
            "VERIFYING",

        VERIFIED:
            "VERIFIED",

        FAILED:
            "FAILED",

        DISABLED:
            "DISABLED",

    });


const BRAND_ASSET_TYPES =
    Object.freeze({

        LOGO:
            "LOGO",

        ICON:
            "ICON",

        FAVICON:
            "FAVICON",

        EMAIL_LOGO:
            "EMAIL_LOGO",

        LOGIN_BACKGROUND:
            "LOGIN_BACKGROUND",

    });


const WHITE_LABEL_BILLING_COMPONENTS =
    Object.freeze({

        SETUP:
            "SETUP",

        PLATFORM:
            "PLATFORM",

        USAGE:
            "USAGE",

        API:
            "API",

        SUPPORT:
            "SUPPORT",

        SLA:
            "SLA",

        CUSTOMIZATION:
            "CUSTOMIZATION",

    });


module.exports =
    Object.freeze({

        WHITE_LABEL_STATUS,

        DOMAIN_STATUS,

        BRAND_ASSET_TYPES,

        WHITE_LABEL_BILLING_COMPONENTS,

    });
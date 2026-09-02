"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise API Constants
 * backend/commercial/constants/api.constants.js
 * =============================================================================
 */

const API_ENVIRONMENTS =
    Object.freeze({

        SANDBOX:
            "SANDBOX",

        PRODUCTION:
            "PRODUCTION",

    });


const API_CLIENT_STATUS =
    Object.freeze({

        PENDING:
            "PENDING",

        ACTIVE:
            "ACTIVE",

        SUSPENDED:
            "SUSPENDED",

        REVOKED:
            "REVOKED",

    });


const API_CREDENTIAL_STATUS =
    Object.freeze({

        ACTIVE:
            "ACTIVE",

        REVOKED:
            "REVOKED",

        EXPIRED:
            "EXPIRED",

    });


const API_SCOPES =
    Object.freeze({

        GROUPS_READ:
            "groups:read",

        GROUPS_WRITE:
            "groups:write",

        MEMBERS_READ:
            "members:read",

        MEMBERS_WRITE:
            "members:write",

        SAVINGS_READ:
            "savings:read",

        SAVINGS_WRITE:
            "savings:write",

        CONTRIBUTIONS_READ:
            "contributions:read",

        CONTRIBUTIONS_WRITE:
            "contributions:write",

        LOANS_READ:
            "loans:read",

        LOANS_WRITE:
            "loans:write",

        PAYMENTS_READ:
            "payments:read",

        PAYMENTS_CREATE:
            "payments:create",

        REPORTS_READ:
            "reports:read",

        WEBHOOKS_MANAGE:
            "webhooks:manage",

    });


const API_RATE_LIMIT_UNITS =
    Object.freeze({

        REQUEST:
            "REQUEST",

        TRANSACTION:
            "TRANSACTION",

        API_CALL:
            "API_CALL",

    });


module.exports =
    Object.freeze({

        API_ENVIRONMENTS,

        API_CLIENT_STATUS,

        API_CREDENTIAL_STATUS,

        API_SCOPES,

        API_RATE_LIMIT_UNITS,

    });
'use strict';

/**
 * Legacy authorization entry point mapped to the canonical authorization
 * middleware factory. Existing route callers can continue requiring this
 * path while the repository converges on middleware/authorization/.
 */
const authorization = require('./authorization/authorization.js');

module.exports = authorization.middleware;
module.exports.createAuthorizationMiddleware = authorization.createAuthorizationMiddleware;
module.exports.AuthorizationError = authorization.AuthorizationError;
module.exports.permissions = authorization.permissions;
module.exports.roles = authorization.roles;

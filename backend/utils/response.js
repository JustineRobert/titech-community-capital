function success(res, data = null, traceId = null) {
  return res.json({ success: true, data, traceId });
}

function error(res, code = 'ERROR', message = 'An error occurred', status = 500, traceId = null) {
  return res.status(status).json({ success: false, error: { code, message }, traceId });
}

module.exports = { success, error };
// utils/response.js
'use strict';

const errorCodes = require('./errorCodes');

/**
 * Send a standardized success response
 * @param {object} res - Express response object
 * @param {any} data - Payload data
 * @param {string} [message="Success"] - Optional message
 */
exports.successResponse = (res, data, message = "Success") => {
  return res.status(200).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send a standardized error response
 * @param {object} res - Express response object
 * @param {Error|AppError} error - Error object
 */
exports.errorResponse = (res, error) => {
  const statusCode = error.statusCode || 500;
  const errorCode = error.errorCode || errorCodes.INTERNAL_ERROR;

  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: error.message || "An unexpected error occurred",
    },
  });
};

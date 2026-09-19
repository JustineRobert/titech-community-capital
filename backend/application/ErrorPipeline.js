"use strict";

/**
 * TITech Community Capital LTD
 * Canonical Express error pipeline registration.
 *
 * Responsibility: translate application errors into stable, safe HTTP
 * responses while preserving request/correlation identifiers.
 * Non-responsibility: domain business rules, persistence, or payment logic.
 */

function resolveStatus(error) {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  if (Number.isInteger(error?.status)) return error.status;
  return 500;
}

function resolveCode(error, status) {
  return (
    error?.code ||
    (status === 404 ? "NOT_FOUND" : "INTERNAL_SERVER_ERROR")
  );
}

function registerErrorPipeline(app, options = {}) {
  if (!app || typeof app.use !== "function") {
    throw new TypeError("Express application instance is required");
  }

  const logger = options.logger || console;
  const exposeDetails = Boolean(options.exposeDetails && options.environment !== "production");

  app.use((req, res) => {
    const requestId = req.id || req.requestId || req.headers?.["x-request-id"];
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Resource not found.",
        requestId,
      },
    });
  });

  app.use((error, req, res, _next) => {
    const status = resolveStatus(error);
    const code = resolveCode(error, status);
    const requestId = req.id || req.requestId || req.headers?.["x-request-id"];

    logger?.error?.({
      err: error,
      requestId,
      code,
      status,
    }, "Unhandled application error");

    const body = {
      success: false,
      error: {
        code,
        message: status >= 500 ? "An unexpected error occurred." : (error?.message || "Request failed."),
        requestId,
      },
    };

    if (exposeDetails && error?.details !== undefined) {
      body.error.details = error.details;
    }

    if (res.headersSent) return undefined;
    return res.status(status).json(body);
  });

  return app;
}

module.exports = registerErrorPipeline;
module.exports.registerErrorPipeline = registerErrorPipeline;
module.exports.default = registerErrorPipeline;

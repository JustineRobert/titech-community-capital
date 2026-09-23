'use strict';

/**
 * Dependency-light validation for middleware pipeline stage descriptors.
 */

function validate(stage) {
  const errors = [];

  if (!stage || typeof stage !== 'object') {
    errors.push('stage must be an object');
    return { valid: false, errors };
  }

  if (!stage.id || typeof stage.id !== 'string') {
    errors.push('stage.id must be a non-empty string');
  }

  if (!Number.isFinite(Number(stage.order))) {
    errors.push('stage.order must be numeric');
  }

  if (
    typeof stage.middleware !== 'function' &&
    !stage.middleware
  ) {
    errors.push('stage.middleware is required');
  }

  if (stage.dependencies !== undefined && !Array.isArray(stage.dependencies)) {
    errors.push('stage.dependencies must be an array');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = Object.freeze({
  validate,
  assertValid(stage) {
    const result = validate(stage);
    if (!result.valid) {
      const error = new Error(`Invalid middleware stage: ${result.errors.join('; ')}`);
      error.code = 'MIDDLEWARE_STAGE_INVALID';
      error.details = result.errors;
      throw error;
    }
    return stage;
  },
});

module.exports.default = module.exports;

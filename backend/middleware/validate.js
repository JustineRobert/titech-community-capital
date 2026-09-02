// middleware/validate.js
'use strict';

const { validationResult } = require('express-validator');

/**
 * Middleware to handle validation results from express-validator
 * @param {Array} validations - array of validation chains
 */
function validate(validations) {
  return async (req, res, next) => {
    // Run all validations
    for (let validation of validations) {
      await validation.run(req);
    }

    // Collect results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    next();
  };
}

module.exports = validate;

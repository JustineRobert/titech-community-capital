'use strict';

// Queue workers historically imported this path. Re-export the canonical
// application email service instead of maintaining a second implementation.
module.exports = require('../services/emailService.js');

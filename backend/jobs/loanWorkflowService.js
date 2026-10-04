'use strict';

// Queue workers historically imported this path. Re-export the canonical loan
// workflow service instead of maintaining a second implementation.
module.exports = require('../services/loanWorkflowService.js');

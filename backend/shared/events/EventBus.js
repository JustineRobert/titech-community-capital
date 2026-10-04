'use strict';

// Canonical EventBus lives under shared/tracing/events. This path is retained
// solely for older middleware/repository imports during the ESM/CJS migration.
module.exports = require('../tracing/events/EventBus.js');

'use strict';

/**
 * Compatibility facade to the canonical shared EventBus.
 * The application retains one event-bus implementation.
 */

const EventBus = require('../shared/tracing/events/EventBus.js');

const eventBus = EventBus.globalEventBus || new EventBus();

module.exports = eventBus;

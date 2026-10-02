/**
 * TITech Community Capital — Canonical bootstrap compatibility facade.
 *
 * The application bootstrap implementation is owned exclusively by
 * `ApplicationBootstrap.js`. This file exists only so older internal imports
 * resolve to the canonical implementation instead of maintaining a second
 * lifecycle orchestrator.
 */

export {
  ApplicationBootstrap,
  ApplicationBootstrapError,
  createApplicationBootstrap,
  getApplicationBootstrap,
  startApplication,
  shutdownApplication,
  getApplication,
  getBootstrapState,
  DEFAULT_APPLICATION_NAME,
  DEFAULT_SERVICE_NAME,
  COMPONENT,
  VERSION,
  DEFAULTS,
  DEFAULT_PHASES,
} from './ApplicationBootstrap.js';

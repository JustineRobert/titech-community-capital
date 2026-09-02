"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/bootstrap/context/index.js
 *
 * Purpose:
 *   Canonical public entry point for the TITech BootstrapContext lifecycle
 *   contract.
 *
 * Architectural Role:
 *   This file is intentionally a minimal, side-effect-free CommonJS barrel.
 *
 * Canonical public contract:
 *
 *   const {
 *     BootstrapContext,
 *   } = require("./context");
 *
 * The barrel exposes ONLY the canonical BootstrapContext constructor.
 *
 * This prevents the context directory from becoming a second public API for:
 *   - lifecycle constants;
 *   - factories;
 *   - runtime state;
 *   - configuration;
 *   - infrastructure;
 *   - application startup;
 *   - shutdown orchestration.
 *
 * All lifecycle behavior remains owned by:
 *
 *   ./BootstrapContext
 *
 * =============================================================================
 *
 * DESIGN PRINCIPLES
 * =============================================================================
 *
 *   ✓ Single canonical BootstrapContext export.
 *   ✓ No context instance is created here.
 *   ✓ No startup logic is executed here.
 *   ✓ No shutdown logic is executed here.
 *   ✓ No infrastructure is initialized here.
 *   ✓ No MongoDB / Redis / network connections are created here.
 *   ✓ No middleware or routes are registered here.
 *   ✓ No global runtime state is mutated here.
 *   ✓ No duplicate lifecycle contract is introduced here.
 *   ✓ CommonJS compatible.
 *   ✓ Side-effect free.
 *   ✓ Safe for unit-test imports.
 *   ✓ Stable public import surface.
 *   ✓ TITech terminology only.
 *
 * =============================================================================
 *
 * IMPORTANT LIFECYCLE CONTRACT
 * =============================================================================
 *
 * BootstrapContext itself owns the canonical lifecycle state:
 *
 *   context.state
 *   context.getState()
 *
 * Both return the same primitive string, for example:
 *
 *   "created"
 *   "starting"
 *   "ready"
 *   "failed"
 *   "shutting_down"
 *   "stopped"
 *
 * This barrel deliberately does not expose another state representation.
 *
 * =============================================================================
 */

const BootstrapContext = require("./BootstrapContext");

/* =============================================================================
 * PUBLIC CONTRACT VALIDATION
 * =============================================================================
 *
 * Validate only the imported constructor contract.
 *
 * This validation MUST remain side-effect free:
 *
 *   - no instance creation;
 *   - no lifecycle execution;
 *   - no dependency initialization;
 *   - no infrastructure connection;
 *   - no runtime mutation.
 *
 * Fail-fast module loading is intentional. If BootstrapContext.js does not
 * expose a valid constructor, consumers should discover the contract error at
 * import time rather than during application bootstrap.
 * =============================================================================
 */

if (typeof BootstrapContext !== "function") {
  throw new TypeError(
    "TITech bootstrap context contract error: " +
      "BootstrapContext must be a constructor function.",
  );
}

/* =============================================================================
 * PUBLIC API
 * =============================================================================
 *
 * Object.freeze() protects the barrel export object from accidental mutation.
 *
 * The BootstrapContext implementation itself remains owned by:
 *
 *   ./BootstrapContext
 *
 * Therefore this module remains a pure API boundary and never becomes a second
 * lifecycle state container.
 * =============================================================================
 */

module.exports = Object.freeze({
  /**
   * Canonical TITech bootstrap lifecycle context.
   *
   * Consumers should instantiate it directly when a new lifecycle context is
   * required:
   *
   *   const {
   *     BootstrapContext,
   *   } = require("./context");
   *
   *   const context = new BootstrapContext();
   */
  BootstrapContext,
});
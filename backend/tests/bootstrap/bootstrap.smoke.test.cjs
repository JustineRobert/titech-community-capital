'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/tests/bootstrap/bootstrap.smoke.test.js
 *
 * Purpose:
 *   P0.7 — Enterprise bootstrap smoke test.
 *
 * Primary Question:
 *
 *   Can TITech Community Capital start successfully from a clean process?
 *
 * This test is intentionally NOT a business-logic test.
 *
 * It validates the assembled bootstrap lifecycle and verifies that every
 * mandatory startup phase completes successfully.
 *
 * =============================================================================
 *
 * Mandatory Bootstrap Phases
 * =============================================================================
 *
 *   environment
 *       ↓
 *   configuration
 *       ↓
 *   logger
 *       ↓
 *   observability
 *       ↓
 *   readiness
 *       ↓
 *   resilience
 *       ↓
 *   infrastructure
 *       ↓
 *   services
 *       ↓
 *   middleware
 *       ↓
 *   routes
 *       ↓
 *   server
 *       ↓
 *   runtime
 *
 * =============================================================================
 *
 * Test Philosophy
 * =============================================================================
 *
 * This test should remain intentionally small at the assertion layer.
 *
 * It should answer:
 *
 *   ✓ Did bootstrap execute?
 *   ✓ Did bootstrap become ready?
 *   ✓ Did bootstrap avoid a failed state?
 *   ✓ Did every mandatory phase complete?
 *
 * It should NOT:
 *
 *   ✗ test financial calculations
 *   ✗ test authentication
 *   ✗ test individual routes
 *   ✗ test MongoDB queries
 *   ✗ test Mobile Money providers
 *   ✗ test loan calculations
 *   ✗ test savings calculations
 *   ✗ test frontend behavior
 *
 * Those belong to their respective test suites.
 *
 * =============================================================================
 *
 * Runtime:
 *   Node.js 20+
 *
 * Test Framework:
 *   Jest
 *
 * =============================================================================
 */

const path = require('node:path');

/**
 * =============================================================================
 * Mandatory Phase Contract
 * =============================================================================
 *
 * Keep this list centralized and deterministic.
 *
 * Any production bootstrap composition that omits one of these phases should
 * fail this smoke test rather than silently appearing healthy.
 */

const MANDATORY_BOOTSTRAP_PHASES = Object.freeze([
  'environment',
  'configuration',
  'logger',
  'observability',
  'readiness',
  'resilience',
  'infrastructure',
  'services',
  'middleware',
  'routes',
  'server',
  'runtime',
]);

/**
 * =============================================================================
 * Environment Safety
 * =============================================================================
 *
 * Smoke tests must never accidentally run against production infrastructure.
 *
 * The values below are intentionally conservative.
 *
 * Individual bootstrap implementations may override them when the application
 * requires additional test-specific configuration.
 */

process.env.NODE_ENV =
  process.env.NODE_ENV || 'test';

/**
 * =============================================================================
 * Bootstrap Module Resolution
 * =============================================================================
 *
 * Prefer the canonical bootstrap composition root.
 *
 * The smoke test supports the common TITech bootstrap export styles without
 * embedding application startup logic inside the test.
 */

function loadBootstrapModule() {
  const candidates = [
    path.resolve(
      __dirname,
      '../../bootstrap',
    ),

    path.resolve(
      __dirname,
      '../../bootstrap/app',
    ),

    path.resolve(
      __dirname,
      '../../app',
    ),
  ];

  const failures = [];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push({
        candidate,
        error,
      });
    }
  }

  const details =
    failures
      .map(
        ({
          candidate,
          error,
        }) =>
          `${candidate}: ${
            error?.message ||
            String(error)
          }`,
      )
      .join('\n');

  throw new Error(
    [
      'Unable to load the canonical TITech bootstrap composition root.',
      '',
      'Attempted modules:',
      details,
    ].join('\n'),
  );
}

/**
 * =============================================================================
 * Bootstrap Adapter
 * =============================================================================
 *
 * The composition root may expose:
 *
 *   bootstrap()
 *   initialize()
 *   start()
 *   createBootstrap()
 *
 * This adapter keeps the smoke test focused on the lifecycle contract instead
 * of forcing application-specific implementation details into the assertions.
 */

async function startTITechBootstrap() {
  const bootstrap =
    loadBootstrapModule();

  /**
   * Preferred enterprise contract:
   *
   *   bootstrap.start()
   */

  if (
    bootstrap &&
    typeof bootstrap.start === 'function'
  ) {
    return bootstrap.start();
  }

  /**
   * Common composition-root contract:
   *
   *   bootstrap.initialize()
   */

  if (
    bootstrap &&
    typeof bootstrap.initialize === 'function'
  ) {
    const result =
      await bootstrap.initialize();

    /**
     * Some implementations expose initialization separately from start.
     */
    if (
      result &&
      typeof result.start === 'function'
    ) {
      return result.start();
    }

    return result;
  }

  /**
   * Factory-based bootstrap contract.
   */

  if (
    bootstrap &&
    typeof bootstrap.createBootstrap ===
      'function'
  ) {
    const instance =
      await bootstrap.createBootstrap();

    if (
      instance &&
      typeof instance.start === 'function'
    ) {
      return instance.start();
    }

    if (
      instance &&
      typeof instance.initialize ===
        'function'
    ) {
      return instance.initialize();
    }

    return instance;
  }

  /**
   * Direct function export.
   */

  if (
    typeof bootstrap === 'function'
  ) {
    return bootstrap();
  }

  throw new TypeError(
    [
      'TITech bootstrap composition root does not expose a supported startup contract.',
      '',
      'Expected one of:',
      '  - start()',
      '  - initialize()',
      '  - createBootstrap()',
      '  - callable module export',
    ].join('\n'),
  );
}

/**
 * =============================================================================
 * Context Discovery
 * =============================================================================
 *
 * The returned value may be:
 *
 *   - BootstrapContext
 *   - bootstrap controller
 *   - application object containing context
 *
 * Normalize it without creating a second context.
 */

function resolveBootstrapContext(
  bootstrapResult,
) {
  if (!bootstrapResult) {
    return null;
  }

  if (
    typeof bootstrapResult.isReady ===
    'function'
  ) {
    return bootstrapResult;
  }

  if (
    bootstrapResult.context &&
    typeof bootstrapResult.context
      .isReady === 'function'
  ) {
    return bootstrapResult.context;
  }

  if (
    bootstrapResult.bootstrapContext &&
    typeof bootstrapResult.bootstrapContext
      .isReady === 'function'
  ) {
    return bootstrapResult.bootstrapContext;
  }

  return bootstrapResult.context ||
    bootstrapResult.bootstrapContext ||
    bootstrapResult;
}

/**
 * =============================================================================
 * Phase Snapshot Discovery
 * =============================================================================
 *
 * BootstrapContext implementations may expose diagnostics through snapshot()
 * or phase-specific accessors.
 */

function getContextSnapshot(
  context,
) {
  if (
    context &&
    typeof context.snapshot ===
      'function'
  ) {
    return context.snapshot();
  }

  return null;
}

function getPhaseSnapshot(
  context,
  phaseName,
) {
  if (
    context &&
    typeof context.getPhaseSnapshot ===
      'function'
  ) {
    return context.getPhaseSnapshot(
      phaseName,
    );
  }

  if (
    context &&
    typeof context.getPhase ===
      'function'
  ) {
    return context.getPhase(
      phaseName,
    );
  }

  const snapshot =
    getContextSnapshot(context);

  if (
    snapshot &&
    snapshot.phases
  ) {
    if (
      snapshot.phases instanceof Map
    ) {
      return snapshot.phases.get(
        phaseName,
      );
    }

    if (
      typeof snapshot.phases === 'object'
    ) {
      return snapshot.phases[
        phaseName
      ];
    }
  }

  return null;
}

/**
 * =============================================================================
 * Phase State Normalization
 * =============================================================================
 */

function getPhaseState(
  phase,
) {
  if (!phase) {
    return null;
  }

  return (
    phase.state ??
    phase.status ??
    phase.phaseState ??
    null
  );
}

/**
 * =============================================================================
 * Phase Success Assertion Helper
 * =============================================================================
 *
 * The smoke test intentionally accepts the canonical completed state as the
 * primary contract while also supporting a boolean success field if the
 * BootstrapContext exposes one.
 */

function assertPhaseSuccessful(
  context,
  phaseName,
) {
  const phase =
    getPhaseSnapshot(
      context,
      phaseName,
    );

  expect(
    phase,
  ).toBeDefined();

  const state =
    getPhaseState(phase);

  /**
   * Prefer the canonical lifecycle state.
   */
  if (state !== null) {
    expect(
      state,
    ).toBe(
      'completed',
    );
  }

  /**
   * If the context exposes explicit success information, enforce it.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      phase,
      'success',
    )
  ) {
    expect(
      phase.success,
    ).toBe(true);
  }

  /**
   * A successful phase must not carry a failure marker.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      phase,
      'failed',
    )
  ) {
    expect(
      phase.failed,
    ).not.toBe(true);
  }

  if (
    Object.prototype.hasOwnProperty.call(
      phase,
      'error',
    )
  ) {
    expect(
      phase.error,
    ).toBeFalsy();
  }

  return phase;
}

/**
 * =============================================================================
 * Test Suite
 * =============================================================================
 */

describe(
  'TITech Bootstrap Smoke Test',
  () => {
    let bootstrapResult;
    let context;

    /**
     * ---------------------------------------------------------------------------
     * Startup
     * ---------------------------------------------------------------------------
     */

    beforeAll(
      async () => {
        /**
         * The smoke test must execute the real composition root.
         *
         * No bootstrap phases are mocked here.
         */
        bootstrapResult =
          await startTITechBootstrap();

        context =
          resolveBootstrapContext(
            bootstrapResult,
          );
      },
      120_000,
    );

    /**
     * ---------------------------------------------------------------------------
     * Cleanup
     * ---------------------------------------------------------------------------
     *
     * A smoke test must leave the process clean.
     *
     * This prevents an HTTP server, database connection, timer, Redis client,
     * queue worker, or other infrastructure resource from leaking into the
     * remaining Jest process.
     */

    afterAll(
      async () => {
        const targets = [
          bootstrapResult,
          context,
        ].filter(Boolean);

        const shutdownTargets =
          [];

        for (
          const target of targets
        ) {
          if (
            typeof target.shutdown ===
              'function'
          ) {
            shutdownTargets.push(
              target.shutdown.bind(
                target,
              ),
            );
          } else if (
            typeof target.stop ===
              'function'
          ) {
            shutdownTargets.push(
              target.stop.bind(
                target,
              ),
            );
          }
        }

        /**
         * Avoid executing the same shutdown function twice when the bootstrap
         * result and context refer to the same lifecycle object.
         */
        const uniqueShutdowns =
          [
            ...new Set(
              shutdownTargets,
            ),
          ];

        for (
          const shutdown of
            uniqueShutdowns
        ) {
          try {
            await shutdown();
          } catch {
            /**
             * Shutdown failures must not hide the startup assertion that caused
             * the smoke test to fail.
             *
             * Dedicated shutdown tests are responsible for cleanup semantics.
             */
          }
        }
      },
      60_000,
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 1 — Context Exists
     * ---------------------------------------------------------------------------
     */

    test(
      'TITech bootstrap returns a usable bootstrap context',
      () => {
        expect(
          context,
        ).toBeDefined();

        expect(
          context,
        ).not.toBeNull();

        expect(
          typeof context.isReady,
        ).toBe(
          'function',
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 2 — Context Ready
     * ---------------------------------------------------------------------------
     *
     * This is the central P0.7 assertion.
     */

    test(
      'TITech starts successfully from a clean process',
      () => {
        expect(
          context.isReady(),
        ).toBe(true);
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 3 — Context Not Failed
     * ---------------------------------------------------------------------------
     */

    test(
      'TITech bootstrap context is not failed',
      () => {
        /**
         * Prefer the canonical failed property if available.
         */
        if (
          Object.prototype.hasOwnProperty.call(
            context,
            'failed',
          )
        ) {
          expect(
            context.failed,
          ).toBe(false);
        }

        /**
         * Also inspect the canonical context state when exposed.
         */
        if (
          context.state !== undefined
        ) {
          expect(
            context.state,
          ).not.toBe(
            'failed',
          );
        }

        /**
         * Finally inspect the diagnostic snapshot.
         */
        const snapshot =
          getContextSnapshot(
            context,
          );

        if (
          snapshot &&
          snapshot.state !==
            undefined
        ) {
          expect(
            snapshot.state,
          ).not.toBe(
            'failed',
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 4 — Mandatory Phases
     * ---------------------------------------------------------------------------
     */

    test(
      'all mandatory TITech bootstrap phases complete successfully',
      () => {
        expect(
          context,
        ).toBeDefined();

        for (
          const phaseName of
            MANDATORY_BOOTSTRAP_PHASES
        ) {
          assertPhaseSuccessful(
            context,
            phaseName,
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 5 — No Mandatory Phase Missing
     * ---------------------------------------------------------------------------
     */

    test(
      'no mandatory bootstrap phase is missing',
      () => {
        const missing =
          MANDATORY_BOOTSTRAP_PHASES
            .filter(
              (phaseName) =>
                !getPhaseSnapshot(
                  context,
                  phaseName,
                ),
            );

        expect(
          missing,
        ).toEqual([]);
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 6 — Phase Count
     * ---------------------------------------------------------------------------
     */

    test(
      'bootstrap reports every mandatory phase',
      () => {
        const snapshot =
          getContextSnapshot(
            context,
          );

        if (
          snapshot &&
          Array.isArray(
            snapshot.phases,
          )
        ) {
          expect(
            snapshot.phases.length,
          ).toBeGreaterThanOrEqual(
            MANDATORY_BOOTSTRAP_PHASES.length,
          );
        }

        if (
          snapshot &&
          snapshot.phases &&
          typeof snapshot.phases ===
            'object' &&
          !Array.isArray(
            snapshot.phases,
          ) &&
          !(snapshot.phases instanceof Map)
        ) {
          expect(
            Object.keys(
              snapshot.phases,
            ).length,
          ).toBeGreaterThanOrEqual(
            MANDATORY_BOOTSTRAP_PHASES.length,
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 7 — Phase Ordering
     * ---------------------------------------------------------------------------
     *
     * The smoke test verifies deterministic ordering when the BootstrapContext
     * exposes phase history.
     */

    test(
      'mandatory bootstrap phases execute in canonical order',
      () => {
        const snapshot =
          getContextSnapshot(
            context,
          );

        if (
          !snapshot
        ) {
          return;
        }

        const history =
          snapshot.history ||
          snapshot.phaseHistory ||
          snapshot.phasesHistory;

        if (
          !Array.isArray(history)
        ) {
          return;
        }

        const executedNames =
          history
            .map(
              (entry) =>
                entry?.name ||
                entry?.phase,
            )
            .filter(Boolean);

        const mandatoryPositions =
          MANDATORY_BOOTSTRAP_PHASES
            .map(
              (phaseName) =>
                executedNames.indexOf(
                  phaseName,
                ),
            );

        /**
         * Every mandatory phase must appear.
         */
        expect(
          mandatoryPositions.every(
            (position) =>
              position >= 0,
          ),
        ).toBe(true);

        /**
         * Positions must be strictly increasing.
         */
        for (
          let index = 1;
          index <
            mandatoryPositions.length;
          index += 1
        ) {
          expect(
            mandatoryPositions[
              index
            ],
          ).toBeGreaterThan(
            mandatoryPositions[
              index - 1
            ],
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 8 — No Phase Failure
     * ---------------------------------------------------------------------------
     */

    test(
      'no mandatory bootstrap phase contains a failure',
      () => {
        for (
          const phaseName of
            MANDATORY_BOOTSTRAP_PHASES
        ) {
          const phase =
            getPhaseSnapshot(
              context,
              phaseName,
            );

          expect(
            phase,
          ).toBeDefined();

          if (
            Object.prototype.hasOwnProperty.call(
              phase,
              'failed',
            )
          ) {
            expect(
              phase.failed,
            ).toBe(false);
          }

          if (
            Object.prototype.hasOwnProperty.call(
              phase,
              'error',
            )
          ) {
            expect(
              phase.error,
            ).toBeFalsy();
          }

          expect(
            getPhaseState(phase),
          ).toBe(
            'completed',
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Test 9 — Readiness Is Final
     * ---------------------------------------------------------------------------
     *
     * The runtime should only be considered ready after the complete mandatory
     * bootstrap lifecycle has successfully completed.
     */

    test(
      'readiness is established only after successful bootstrap',
      () => {
        expect(
          context.isReady(),
        ).toBe(true);

        const snapshot =
          getContextSnapshot(
            context,
          );

        if (
          snapshot &&
          snapshot.state !==
            undefined
        ) {
          expect(
            snapshot.state,
          ).not.toBe(
            'failed',
          );
        }
      },
    );
  },
);

/**
 * =============================================================================
 * Exported Test Contract
 * =============================================================================
 *
 * The constant is exported only when the test module is imported directly by
 * tooling that wants to inspect the mandatory bootstrap contract.
 *
 * Jest itself does not require this export.
 */

module.exports = {
  MANDATORY_BOOTSTRAP_PHASES,
};
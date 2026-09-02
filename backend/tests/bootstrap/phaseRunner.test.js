'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/tests/bootstrap/phaseRunner.test.js
 *
 * Purpose:
 *   Enterprise-grade unit tests for the canonical TITech bootstrap phase
 *   runner.
 *
 * Responsibilities:
 *   - Verify successful phase execution.
 *   - Verify phase completion state.
 *   - Verify critical phase failure propagation.
 *   - Verify non-critical phase failure policy.
 *   - Verify phase metadata preservation.
 *   - Verify logger failures never replace the original phase error.
 *   - Verify phase duration recording.
 *   - Verify execution context propagation.
 *   - Verify validation failures.
 *   - Verify phase lifecycle transitions.
 *
 * Canonical Runtime:
 *   Node.js 20+
 *
 * Test Framework:
 *   Jest
 *
 * =============================================================================
 */

const {
  createBootstrapContext,
  PHASE_STATES,
  CONTEXT_STATES,
} = require('../../bootstrap/context');

const {
  runPhase,
} = require('../../bootstrap/lifecycle/phaseRunner');

/**
 * =============================================================================
 * Test Helpers
 * =============================================================================
 */

/**
 * Creates a fresh TITech bootstrap context for every test.
 *
 * Keeping context creation centralized prevents individual tests from
 * accidentally depending on state produced by another test.
 */
function createTestContext() {
  return createBootstrapContext();
}

/**
 * Extracts a phase snapshot without assuming a single accessor implementation.
 *
 * The canonical BootstrapContext is expected to expose phase diagnostics.
 * This helper intentionally supports the common accessor forms while keeping
 * the tests strict enough to detect a missing contract.
 */
function getPhaseSnapshot(context, phaseName) {
  if (
    typeof context.getPhaseSnapshot === 'function'
  ) {
    return context.getPhaseSnapshot(phaseName);
  }

  if (
    typeof context.getPhase === 'function'
  ) {
    return context.getPhase(phaseName);
  }

  if (
    context.phases &&
    typeof context.phases.get === 'function'
  ) {
    return context.phases.get(phaseName);
  }

  if (
    context.phases &&
    typeof context.phases === 'object'
  ) {
    return context.phases[phaseName];
  }

  if (
    typeof context.snapshot === 'function'
  ) {
    const snapshot = context.snapshot();

    if (
      snapshot &&
      snapshot.phases &&
      typeof snapshot.phases === 'object'
    ) {
      return snapshot.phases[phaseName];
    }
  }

  throw new Error(
    `Unable to obtain bootstrap phase snapshot for "${phaseName}".`,
  );
}

/**
 * Returns a normalized phase state from a phase snapshot.
 */
function getPhaseState(context, phaseName) {
  const phase = getPhaseSnapshot(
    context,
    phaseName,
  );

  return (
    phase?.state ??
    phase?.status ??
    phase?.phaseState ??
    null
  );
}

/**
 * =============================================================================
 * Suite
 * =============================================================================
 */

describe(
  'TITech Bootstrap Phase Runner',
  () => {
    /**
     * ---------------------------------------------------------------------------
     * Successful Phase Execution
     * ---------------------------------------------------------------------------
     */

    test(
      'successful phase completes',
      async () => {
        const context =
          createTestContext();

        const execute =
          jest.fn(async () => ({
            initialized: true,
          }));

        const result =
          await runPhase(
            context,
            {
              name:
                'configuration',

              execute,

              critical: true,

              fatal: true,
            },
          );

        expect(
          execute,
        ).toHaveBeenCalledTimes(1);

        expect(
          execute,
        ).toHaveBeenCalledWith(
          context,
        );

        expect(
          result,
        ).toEqual({
          initialized: true,
        });

        expect(
          getPhaseState(
            context,
            'configuration',
          ),
        ).toBe(
          PHASE_STATES.COMPLETED,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Critical Failure
     * ---------------------------------------------------------------------------
     */

    test(
      'failed critical phase throws',
      async () => {
        const context =
          createTestContext();

        const originalError =
          new Error(
            'Database connection failed.',
          );

        await expect(
          runPhase(
            context,
            {
              name:
                'database',

              execute:
                jest.fn(
                  async () => {
                    throw originalError;
                  },
                ),

              critical: true,

              fatal: true,
            },
          ),
        ).rejects.toBe(
          originalError,
        );

        expect(
          getPhaseState(
            context,
            'database',
          ),
        ).toBe(
          PHASE_STATES.FAILED,
        );

        expect(
          originalError.bootstrapPhase,
        ).toBe(
          'database',
        );

        expect(
          originalError.bootstrapCritical,
        ).toBe(true);

        expect(
          originalError.bootstrapFatal,
        ).toBe(true,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Non-Critical Failure
     * ---------------------------------------------------------------------------
     */

    test(
      'failed non-critical phase does not crash startup',
      async () => {
        const context =
          createTestContext();

        const originalError =
          new Error(
            'Optional observability service unavailable.',
          );

        const result =
          await runPhase(
            context,
            {
              name:
                'observability',

              execute:
                jest.fn(
                  async () => {
                    throw originalError;
                  },
                ),

              critical: false,

              fatal: false,
            },
          );

        /**
         * A non-critical phase is deliberately contained by the phase runner.
         */
        expect(
          result,
        ).toBeNull();

        expect(
          getPhaseState(
            context,
            'observability',
          ),
        ).toBe(
          PHASE_STATES.FAILED,
        );

        /**
         * The original error remains annotated for diagnostics even though
         * startup continues.
         */
        expect(
          originalError.bootstrapPhase,
        ).toBe(
          'observability',
        );

        expect(
          originalError.bootstrapCritical,
        ).toBe(false);

        expect(
          originalError.bootstrapFatal,
        ).toBe(false,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Phase Metadata
     * ---------------------------------------------------------------------------
     */

    test(
      'phase metadata is preserved',
      async () => {
        const context =
          createTestContext();

        const phaseName =
          'configuration';

        await runPhase(
          context,
          {
            name:
              phaseName,

            execute:
              async () => ({
                loaded: true,
              }),

            critical: false,

            fatal: false,
          },
        );

        const phase =
          getPhaseSnapshot(
            context,
            phaseName,
          );

        expect(
          phase,
        ).toBeDefined();

        expect(
          phase.state ??
          phase.status,
        ).toBe(
          PHASE_STATES.COMPLETED,
        );

        /**
         * Different BootstrapContext implementations may expose metadata
         * directly or inside a metadata object. Verify the contract without
         * coupling the test to an internal storage structure.
         */
        const metadata =
          phase.metadata ||
          phase.options ||
          phase;

        expect(
          metadata,
        ).toEqual(
          expect.objectContaining({
            critical: false,
            fatal: false,
          }),
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Logger Isolation
     * ---------------------------------------------------------------------------
     */

    test(
      'logger failure does not replace original error',
      async () => {
        const context =
          createTestContext();

        const originalError =
          new Error(
            'Configuration parsing failed.',
          );

        const loggerError =
          new Error(
            'Logger transport unavailable.',
          );

        const logger = {
          error: jest.fn(() => {
            throw loggerError;
          }),
        };

        let caughtError;

        try {
          await runPhase(
            context,
            {
              name:
                'configuration',

              execute:
                async () => {
                  throw originalError;
                },

              critical: true,

              fatal: true,

              logger,
            },
          );
        } catch (error) {
          caughtError = error;
        }

        /**
         * The bootstrap failure must remain authoritative.
         *
         * A broken logger must NEVER hide the actual startup failure.
         */
        expect(
          caughtError,
        ).toBe(
          originalError,
        );

        expect(
          caughtError,
        ).not.toBe(
          loggerError,
        );

        expect(
          logger.error,
        ).toHaveBeenCalledTimes(1);

        expect(
          getPhaseState(
            context,
            'configuration',
          ),
        ).toBe(
          PHASE_STATES.FAILED,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Duration
     * ---------------------------------------------------------------------------
     */

    test(
      'phase duration is recorded',
      async () => {
        const context =
          createTestContext();

        const nowSpy =
          jest
            .spyOn(
              Date,
              'now',
            )
            .mockReturnValueOnce(
              1_000,
            )
            .mockReturnValueOnce(
              1_125,
            );

        try {
          await runPhase(
            context,
            {
              name:
                'logger',

              execute:
                async () => ({
                  ready: true,
                }),

              critical: true,

              fatal: true,
            },
          );
        } finally {
          nowSpy.mockRestore();
        }

        const phase =
          getPhaseSnapshot(
            context,
            'logger',
          );

        expect(
          phase,
        ).toBeDefined();

        expect(
          phase.durationMs,
        ).toBe(
          125,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Context Propagation
     * ---------------------------------------------------------------------------
     */

    test(
      'phase runner passes the canonical context to execution',
      async () => {
        const context =
          createTestContext();

        let receivedContext;

        await runPhase(
          context,
          {
            name:
              'environment',

            execute:
              async (executionContext) => {
                receivedContext =
                  executionContext;

                return true;
              },
          },
        );

        expect(
          receivedContext,
        ).toBe(
          context,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Phase Start
     * ---------------------------------------------------------------------------
     */

    test(
      'phase starts before execution',
      async () => {
        const context =
          createTestContext();

        let observedState;

        await runPhase(
          context,
          {
            name:
              'environment',

            execute:
              async () => {
                observedState =
                  getPhaseState(
                    context,
                    'environment',
                  );

                return true;
              },
          },
        );

        expect(
          observedState,
        ).toBe(
          PHASE_STATES.STARTED,
        );

        expect(
          getPhaseState(
            context,
            'environment',
          ),
        ).toBe(
          PHASE_STATES.COMPLETED,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Failure Capture
     * ---------------------------------------------------------------------------
     */

    test(
      'phase failure records the original error',
      async () => {
        const context =
          createTestContext();

        const originalError =
          new Error(
            'Redis initialization failed.',
          );

        await expect(
          runPhase(
            context,
            {
              name:
                'resilience',

              execute:
                async () => {
                  throw originalError;
                },

              critical: true,

              fatal: true,
            },
          ),
        ).rejects.toBe(
          originalError,
        );

        const phase =
          getPhaseSnapshot(
            context,
            'resilience',
          );

        expect(
          phase,
        ).toBeDefined();

        expect(
          phase.error,
        ).toBeDefined();

        /**
         * Depending on BootstrapContext's serialization policy, the error may
         * be stored directly or normalized into diagnostic fields.
         */
        if (phase.error instanceof Error) {
          expect(
            phase.error,
          ).toBe(
            originalError,
          );
        } else {
          expect(
            phase.error.message ??
            phase.error.details?.message,
          ).toBe(
            originalError.message,
          );
        }
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Fatal Policy
     * ---------------------------------------------------------------------------
     */

    test(
      'fatal policy is preserved on critical phase failure',
      async () => {
        const context =
          createTestContext();

        const error =
          new Error(
            'Fatal bootstrap failure.',
          );

        await expect(
          runPhase(
            context,
            {
              name:
                'database',

              execute:
                async () => {
                  throw error;
                },

              critical: true,

              fatal: true,
            },
          ),
        ).rejects.toBe(
          error,
        );

        expect(
          error.bootstrapFatal,
        ).toBe(true);

        expect(
          error.bootstrapCritical,
        ).toBe(true);
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Non-Fatal Critical Phase
     * ---------------------------------------------------------------------------
     *
     * Critical and fatal are intentionally separate policy dimensions.
     * This verifies that the phase runner preserves both values rather than
     * collapsing them into one flag.
     * ---------------------------------------------------------------------------
     */

    test(
      'critical and fatal policies remain independently distinguishable',
      async () => {
        const context =
          createTestContext();

        const error =
          new Error(
            'Recoverable critical phase failure.',
          );

        await expect(
          runPhase(
            context,
            {
              name:
                'middleware',

              execute:
                async () => {
                  throw error;
                },

              critical: true,

              fatal: false,
            },
          ),
        ).rejects.toBe(
          error,
        );

        expect(
          error.bootstrapCritical,
        ).toBe(true);

        expect(
          error.bootstrapFatal,
        ).toBe(false);
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Validation
     * ---------------------------------------------------------------------------
     */

    test(
      'rejects a missing bootstrap context',
      async () => {
        await expect(
          runPhase(
            null,
            {
              name:
                'configuration',

              execute:
                async () => undefined,
            },
          ),
        ).rejects.toThrow(
          'TITech bootstrap context is required.',
        );
      },
    );

    test(
      'rejects a missing execute function',
      async () => {
        const context =
          createTestContext();

        await expect(
          runPhase(
            context,
            {
              name:
                'configuration',
            },
          ),
        ).rejects.toThrow(
          /requires an execute function/i,
        );
      },
    );

    test(
      'rejects an invalid execute function',
      async () => {
        const context =
          createTestContext();

        await expect(
          runPhase(
            context,
            {
              name:
                'configuration',

              execute:
                'not-a-function',
            },
          ),
        ).rejects.toThrow(
          /requires an execute function/i,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Phase Name Validation
     * ---------------------------------------------------------------------------
     */

    test(
      'rejects an invalid phase name through the context contract',
      async () => {
        const context =
          createTestContext();

        await expect(
          runPhase(
            context,
            {
              name:
                '',

              execute:
                async () => undefined,
            },
          ),
        ).rejects.toThrow();
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Return Value Preservation
     * ---------------------------------------------------------------------------
     */

    test(
      'preserves successful phase execution result',
      async () => {
        const context =
          createTestContext();

        const value = {
          service:
            'database',

          connected:
            true,

          version:
            '1.0.0',
        };

        const result =
          await runPhase(
            context,
            {
              name:
                'database',

              execute:
                async () => value,
            },
          );

        expect(
          result,
        ).toBe(
          value,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Non-Critical Result Policy
     * ---------------------------------------------------------------------------
     */

    test(
      'non-critical failure does not execute a second recovery path implicitly',
      async () => {
        const context =
          createTestContext();

        const execute =
          jest.fn(
            async () => {
              throw new Error(
                'Optional component failed.',
              );
            },
          );

        const result =
          await runPhase(
            context,
            {
              name:
                'optional-service',

              execute,

              critical: false,

              fatal: false,
            },
          );

        expect(
          execute,
        ).toHaveBeenCalledTimes(1);

        expect(
          result,
        ).toBeNull();

        expect(
          getPhaseState(
            context,
            'optional-service',
          ),
        ).toBe(
          PHASE_STATES.FAILED,
        );
      },
    );

    /**
     * ---------------------------------------------------------------------------
     * Context State Integrity
     * ---------------------------------------------------------------------------
     */

    test(
      'successful phase does not leave the context in a failed state',
      async () => {
        const context =
          createTestContext();

        await runPhase(
          context,
          {
            name:
              'environment',

            execute:
              async () => true,
          },
        );

        if (
          CONTEXT_STATES &&
          CONTEXT_STATES.FAILED !== undefined
        ) {
          expect(
            context.state,
          ).not.toBe(
            CONTEXT_STATES.FAILED,
          );
        }
      },
    );
  },
);
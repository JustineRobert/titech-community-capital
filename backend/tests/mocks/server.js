'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Test Mock Server
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✅ MSW Server Configuration
 * ✅ Jest Support
 * ✅ Vitest Support
 * ✅ Dynamic Handler Overrides
 * ✅ Loan Module Testing
 * ✅ Savings Module Testing
 * ✅ Shares Module Testing
 * ✅ Accounting Module Testing
 * ✅ Mobile Money Testing
 * ✅ Compliance Testing
 * ✅ Fraud Engine Testing
 * ✅ Audit Ready
 * ✅ CI/CD Compatible
 * ============================================================================
 */

const {
    setupServer
} = require(
    'msw/node'
);

const {
    handlers
} = require(
    './handlers'
);

/* ============================================================================
   MSW SERVER
============================================================================ */

const server =
    setupServer(
        ...handlers
    );

/* ============================================================================
   LIFECYCLE HELPERS
============================================================================ */

/**
 * Start mock server
 */

const startServer = () => {

    server.listen({

        onUnhandledRequest(
            request
        ) {

            const method =
                request.method;

            const url =
                request.url;

            console.warn(
                `[MSW] Unhandled ${method} request -> ${url}`
            );
        }
    });

    console.info(
        '[MSW] Mock server started'
    );
};

/**
 * Reset handlers
 */

const resetServer = () => {

    server.resetHandlers();

    console.info(
        '[MSW] Handlers reset'
    );
};

/**
 * Stop mock server
 */

const stopServer = () => {

    server.close();

    console.info(
        '[MSW] Mock server stopped'
    );
};

/* ============================================================================
   TEST UTILITIES
============================================================================ */

/**
 * Override handlers in specific test suites
 *
 * Example:
 *
 * server.use(
 *   http.get('/api/test', ...)
 * )
 */

const useHandlers = (
    ...customHandlers
) => {

    server.use(
        ...customHandlers
    );
};

/**
 * Restore original handlers
 */

const restoreHandlers =
    () => {

        server.restoreHandlers();
    };

/* ============================================================================
   JEST / VITEST HELPERS
============================================================================ */

/**
 * Call inside setupTests.js
 *
 * beforeAll(() => startServer());
 * afterEach(() => resetServer());
 * afterAll(() => stopServer());
 */

const initializeTestServer =
    () => {

        beforeAll(
            () =>
                startServer()
        );

        afterEach(
            () =>
                resetServer()
        );

        afterAll(
            () =>
                stopServer()
        );
    };

/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {

    server,

    handlers,

    startServer,

    stopServer,

    resetServer,

    useHandlers,

    restoreHandlers,

    initializeTestServer
};

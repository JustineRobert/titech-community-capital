/**
 * ============================================================================
 * TITech Community Capital
 * Test Server / MSW Node Runtime
 * frontend/src/testServer.js
 * ============================================================================
 *
 * Purpose:
 *   Provides the shared Mock Service Worker server used by Vitest.
 *
 * Architecture:
 *   - Handlers live separately from this runtime bootstrap.
 *   - The server is created once from the shared handlers.
 *   - setupTests.js controls lifecycle.
 *
 * Expected companion file:
 *   frontend/src/mocks/handlers.js
 *
 * ============================================================================
 */

import { setupServer } from "msw/node";
import { handlers } from "./mocks/handlers";

/**
 * Shared Node-side MSW server.
 *
 * IMPORTANT:
 * Keep request handlers outside this file so individual tests can override
 * handlers with server.use(...) without modifying the global test server.
 */
export const server = setupServer(...handlers);

export default server;
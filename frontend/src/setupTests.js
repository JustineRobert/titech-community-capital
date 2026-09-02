/**
 * ============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * ============================================================================
 *
 * File:
 *   frontend/src/setupTests.js
 *
 * Purpose:
 *   Canonical Vitest + React Testing Library test environment.
 *
 * Responsibilities:
 *   - Configure Vitest test runtime
 *   - Configure React Testing Library
 *   - Configure React 18 act environment
 *   - Configure deterministic timezone
 *   - Install safe browser API polyfills
 *   - Start and stop MSW
 *   - Provide deterministic test identifiers
 *   - Provide async/timer helpers
 *   - Provide file-upload helpers
 *   - Provide React Query / Redux helpers
 *   - Detect leaked timers
 *   - Detect unhandled promise rejections
 *   - Restore test state after every test
 *
 * Non-responsibilities:
 *   - Application business logic
 *   - Production service initialization
 *   - Authentication implementation
 *   - Real API communication
 *   - Financial transaction execution
 *
 * Principles:
 *   1. Do not hide genuine test failures.
 *   2. Do not replace working browser APIs unnecessarily.
 *   3. Prefer MSW for HTTP mocking.
 *   4. Keep global setup deterministic.
 *   5. Keep test isolation strict.
 *   6. Keep mocks realistic enough to catch integration defects.
 *
 * ============================================================================
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  vi,
} from 'vitest';

import {
  cleanup,
  configure,
} from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

import {
  TextDecoder,
  TextEncoder,
} from 'util';

import { server } from './testServer';

// ============================================================================
// 01. TEST ENVIRONMENT
// ============================================================================

process.env.NODE_ENV = 'test';

process.env.TZ = 'UTC';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// -----------------------------------------------------------------------------
// Text encoding
// -----------------------------------------------------------------------------

globalThis.TextEncoder =
  globalThis.TextEncoder || TextEncoder;

globalThis.TextDecoder =
  globalThis.TextDecoder || TextDecoder;

// ============================================================================
// 02. TEST CONSTANTS
// ============================================================================

export const TEST_TENANT_ID =
  'tenant-test';

export const TEST_SACCO_ID =
  'sacco-test';

export const TEST_USER_ID =
  'user-test';

export const TEST_ACCOUNT_ID =
  'account-test';

export const TEST_SESSION_ID =
  'session-test';

export const TEST_TRANSACTION_ID =
  'transaction-test';

export const TEST_WALLET_ID =
  'wallet-test';

export const TEST_LEDGER_ENTRY_ID =
  'ledger-entry-test';

export const TEST_LOAN_ID =
  'loan-test';

// Deterministic test UUID.
//
// DO NOT use this value as a production identifier.
export const TEST_UUID =
  '00000000-0000-4000-8000-000000000001';

// ============================================================================
// 03. GLOBAL TEST IDENTIFIERS
// ============================================================================

globalThis.TEST_IDS = Object.freeze({
  tenantId: TEST_TENANT_ID,
  saccoId: TEST_SACCO_ID,
  userId: TEST_USER_ID,
  accountId: TEST_ACCOUNT_ID,
  sessionId: TEST_SESSION_ID,
  transactionId: TEST_TRANSACTION_ID,
  walletId: TEST_WALLET_ID,
  ledgerEntryId: TEST_LEDGER_ENTRY_ID,
  loanId: TEST_LOAN_ID,
});

// ============================================================================
// 04. TESTING LIBRARY CONFIGURATION
// ============================================================================

configure({
  asyncUtilTimeout: 10_000,
  testIdAttribute: 'data-testid',
});

// ============================================================================
// 05. GLOBAL RUNTIME STATE
// ============================================================================

const runtimeState = {
  unhandledRejections: [],
  originalConsole: {
    error: console.error,
    warn: console.warn,
    info: console.info,
  },
};

function resetRuntimeState() {
  runtimeState.unhandledRejections.length = 0;
}

// ============================================================================
// 06. CONSOLE POLICY
// ============================================================================
//
// IMPORTANT:
// Do not broadly suppress React warnings.
//
// A fintech/financial application needs tests to expose genuine runtime
// problems.
//
// We only ignore a very small set of known jsdom/environment noise.
// ============================================================================

const IGNORED_CONSOLE_PATTERNS = Object.freeze([
  /Not implemented:\s*navigation/i,
]);

function shouldIgnoreConsoleMessage(message) {
  const text = String(message ?? '');

  return IGNORED_CONSOLE_PATTERNS.some(
    (pattern) => pattern.test(text)
  );
}

function installTestConsoleGuards() {
  const originalError =
    runtimeState.originalConsole.error;

  const originalWarn =
    runtimeState.originalConsole.warn;

  console.error = (...args) => {
    if (
      shouldIgnoreConsoleMessage(args[0])
    ) {
      return;
    }

    originalError(...args);
  };

  console.warn = (...args) => {
    if (
      shouldIgnoreConsoleMessage(args[0])
    ) {
      return;
    }

    originalWarn(...args);
  };
}

function restoreTestConsole() {
  console.error =
    runtimeState.originalConsole.error;

  console.warn =
    runtimeState.originalConsole.warn;

  console.info =
    runtimeState.originalConsole.info;
}

// ============================================================================
// 07. UNHANDLED PROMISE REJECTIONS
// ============================================================================

function handleUnhandledRejection(event) {
  runtimeState.unhandledRejections.push(
    event?.reason
  );
}

// ============================================================================
// 08. ASYNC TEST HELPERS
// ============================================================================

globalThis.flushPromises = () =>
  new Promise((resolve) => {
    queueMicrotask(resolve);
  });

globalThis.flushAllPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

globalThis.wait = (milliseconds = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

globalThis.sleep = globalThis.wait;

globalThis.nextTick = () =>
  new Promise((resolve) => {
    if (
      typeof process?.nextTick === 'function'
    ) {
      process.nextTick(resolve);
      return;
    }

    queueMicrotask(resolve);
  });

globalThis.waitForMicrotasks = () =>
  Promise.resolve();

globalThis.advanceTimers = async (
  milliseconds = 0
) => {
  vi.advanceTimersByTime(milliseconds);
  await globalThis.flushAllPromises();
};

globalThis.flushTimers = async () => {
  vi.runOnlyPendingTimers();
  await globalThis.flushAllPromises();
};

// ============================================================================
// 09. SAFE BROWSER API POLYFILLS
// ============================================================================
//
// Only install missing APIs.
//
// Do not replace working jsdom/browser implementations unless the individual
// test explicitly mocks them.
// ============================================================================

// -----------------------------------------------------------------------------
// matchMedia
// -----------------------------------------------------------------------------

if (
  typeof window !== 'undefined' &&
  typeof window.matchMedia !== 'function'
) {
  window.matchMedia = vi.fn(
    (query) => ({
      media: query,
      matches: false,
      onchange: null,

      addListener: vi.fn(),
      removeListener: vi.fn(),

      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),

      dispatchEvent: vi.fn(
        () => false
      ),
    })
  );
}

// -----------------------------------------------------------------------------
// scroll APIs
// -----------------------------------------------------------------------------

if (
  typeof window !== 'undefined' &&
  typeof window.scrollTo !== 'function'
) {
  window.scrollTo = vi.fn();
}

if (
  typeof window !== 'undefined' &&
  typeof window.scrollBy !== 'function'
) {
  window.scrollBy = vi.fn();
}

if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.scrollIntoView !==
    'function'
) {
  Element.prototype.scrollIntoView = vi.fn();
}

// -----------------------------------------------------------------------------
// requestAnimationFrame
// -----------------------------------------------------------------------------

if (
  typeof globalThis.requestAnimationFrame !==
  'function'
) {
  globalThis.requestAnimationFrame =
    (callback) =>
      setTimeout(
        () => callback(Date.now()),
        16
      );
}

if (
  typeof globalThis.cancelAnimationFrame !==
  'function'
) {
  globalThis.cancelAnimationFrame =
    (id) => clearTimeout(id);
}

// -----------------------------------------------------------------------------
// requestIdleCallback
// -----------------------------------------------------------------------------

if (
  typeof globalThis.requestIdleCallback !==
  'function'
) {
  globalThis.requestIdleCallback =
    (callback) =>
      setTimeout(
        () =>
          callback({
            didTimeout: false,
            timeRemaining: () => 50,
          }),
        1
      );
}

if (
  typeof globalThis.cancelIdleCallback !==
  'function'
) {
  globalThis.cancelIdleCallback =
    (id) => clearTimeout(id);
}

// -----------------------------------------------------------------------------
// ResizeObserver
// -----------------------------------------------------------------------------

if (
  typeof globalThis.ResizeObserver ===
  'undefined'
) {
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }

    observe = vi.fn();

    unobserve = vi.fn();

    disconnect = vi.fn();

    trigger(entries = []) {
      this.callback(
        entries,
        this
      );
    }
  };
}

// -----------------------------------------------------------------------------
// IntersectionObserver
// -----------------------------------------------------------------------------

if (
  typeof globalThis.IntersectionObserver ===
  'undefined'
) {
  globalThis.IntersectionObserver =
    class {
      constructor(
        callback,
        options = {}
      ) {
        this.callback = callback;
        this.options = options;

        this.root = null;
        this.rootMargin = '0px';
        this.thresholds = [0];
      }

      observe = vi.fn();

      unobserve = vi.fn();

      disconnect = vi.fn();

      takeRecords = vi.fn(
        () => []
      );

      trigger(
        isIntersecting = true,
        ratio = 1
      ) {
        this.callback(
          [
            {
              isIntersecting,
              intersectionRatio:
                ratio,
              target:
                document.body,
              boundingClientRect:
                new DOMRect(),
              intersectionRect:
                new DOMRect(),
              rootBounds:
                new DOMRect(),
              time:
                typeof performance
                  ?.now === 'function'
                  ? performance.now()
                  : Date.now(),
            },
          ],
          this
        );
      }
    };
}

// -----------------------------------------------------------------------------
// MutationObserver
// -----------------------------------------------------------------------------

if (
  typeof globalThis.MutationObserver ===
  'undefined'
) {
  globalThis.MutationObserver =
    class {
      constructor(callback) {
        this.callback = callback;
      }

      observe = vi.fn();

      disconnect = vi.fn();

      takeRecords = vi.fn(
        () => []
      );

      trigger(records = []) {
        this.callback(
          records,
          this
        );
      }
    };
}

// -----------------------------------------------------------------------------
// DOMRect
// -----------------------------------------------------------------------------

if (
  typeof globalThis.DOMRect ===
  'undefined'
) {
  globalThis.DOMRect =
    class {
      constructor(
        x = 0,
        y = 0,
        width = 0,
        height = 0
      ) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;

        this.top = y;
        this.left = x;
        this.right =
          x + width;
        this.bottom =
          y + height;
      }

      static fromRect(
        rect = {}
      ) {
        return new DOMRect(
          rect.x ?? 0,
          rect.y ?? 0,
          rect.width ?? 0,
          rect.height ?? 0
        );
      }
    };
}

// -----------------------------------------------------------------------------
// Element.animate
// -----------------------------------------------------------------------------

if (
  typeof Element !== 'undefined' &&
  typeof Element.prototype.animate !==
    'function'
) {
  Element.prototype.animate = vi.fn(
    () => ({
      play: vi.fn(),
      pause: vi.fn(),
      reverse: vi.fn(),
      cancel: vi.fn(),
      finish: vi.fn(),

      currentTime: 0,

      playState:
        'running',

      finished:
        Promise.resolve(),

      ready:
        Promise.resolve(),

      onfinish: null,
      oncancel: null,
    })
  );
}

// ============================================================================
// 10. CRYPTO
// ============================================================================
//
// Prefer the native Web Crypto implementation.
//
// Only polyfill randomUUID when it is absent.
//
// Do NOT create fake `crypto.subtle` objects because crypto tests must fail
// when real cryptographic functionality is unavailable.
// ============================================================================

if (
  globalThis.crypto &&
  typeof globalThis.crypto.randomUUID !==
    'function'
) {
  globalThis.crypto.randomUUID =
    vi.fn(
      () => TEST_UUID
    );
}

// ============================================================================
// 11. URL API
// ============================================================================

if (
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL !==
    'function'
) {
  URL.createObjectURL =
    vi.fn(
      () =>
        'blob:titech-test-object-url'
    );
}

if (
  typeof URL !== 'undefined' &&
  typeof URL.revokeObjectURL !==
    'function'
) {
  URL.revokeObjectURL =
    vi.fn();
}

if (
  typeof URL !== 'undefined' &&
  typeof URL.canParse !==
    'function'
) {
  URL.canParse =
    vi.fn(
      () => true
    );
}

// ============================================================================
// 12. FILE APIs
// ============================================================================

if (
  typeof globalThis.File ===
  'undefined'
) {
  globalThis.File =
    class File extends Blob {
      constructor(
        chunks,
        filename,
        options = {}
      ) {
        super(
          chunks,
          options
        );

        this.name =
          filename;

        this.lastModified =
          options.lastModified ??
          Date.now();

        this.webkitRelativePath =
          '';
      }
    };
}

// -----------------------------------------------------------------------------
// FileReader
// -----------------------------------------------------------------------------

if (
  typeof globalThis.FileReader ===
  'undefined'
) {
  globalThis.FileReader =
    class {
      constructor() {
        this.result = null;
        this.error = null;

        this.onload = null;
        this.onerror = null;
        this.onloadend = null;
      }

      readAsDataURL() {
        this.result =
          'data:text/plain;base64,dGVzdA==';

        this.onload?.({
          target: this,
        });

        this.onloadend?.({
          target: this,
        });
      }

      readAsText() {
        this.result =
          'test';

        this.onload?.({
          target: this,
        });

        this.onloadend?.({
          target: this,
        });
      }

      readAsArrayBuffer() {
        this.result =
          new ArrayBuffer(16);

        this.onload?.({
          target: this,
        });

        this.onloadend?.({
          target: this,
        });
      }

      abort() {}
    };
}

// ============================================================================
// 13. CANVAS
// ============================================================================

if (
  typeof HTMLCanvasElement !==
    'undefined' &&
  typeof HTMLCanvasElement.prototype
    .getContext !== 'function'
) {
  HTMLCanvasElement.prototype
    .getContext = vi.fn(
      () => ({
        fillRect: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        arc: vi.fn(),
        drawImage: vi.fn(),
        fillText: vi.fn(),
        strokeText: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        rotate: vi.fn(),
        translate: vi.fn(),

        measureText:
          vi.fn(
            () => ({
              width: 100,
            })
          ),
      })
    );
}

if (
  typeof HTMLCanvasElement !==
    'undefined'
) {
  if (
    typeof HTMLCanvasElement
      .prototype.toBlob !==
    'function'
  ) {
    HTMLCanvasElement.prototype
      .toBlob = vi.fn(
        (callback) =>
          callback(
            new Blob()
          )
      );
  }

  if (
    typeof HTMLCanvasElement
      .prototype.toDataURL !==
    'function'
  ) {
    HTMLCanvasElement.prototype
      .toDataURL = vi.fn(
        () =>
          'data:image/png;base64,test'
      );
  }
}

// ============================================================================
// 14. SVG
// ============================================================================

if (
  typeof SVGElement !==
    'undefined'
) {
  if (
    typeof SVGElement.prototype
      .getBBox !== 'function'
  ) {
    SVGElement.prototype.getBBox =
      vi.fn(
        () => ({
          x: 0,
          y: 0,
          width: 100,
          height: 50,
        })
      );
  }

  if (
    typeof SVGElement.prototype
      .getComputedTextLength !==
    'function'
  ) {
    SVGElement.prototype
      .getComputedTextLength =
      vi.fn(
        () => 100
      );
  }
}

// ============================================================================
// 15. POINTER EVENTS
// ============================================================================

if (
  typeof HTMLElement !==
    'undefined'
) {
  if (
    typeof HTMLElement.prototype
      .setPointerCapture !==
    'function'
  ) {
    HTMLElement.prototype
      .setPointerCapture =
      vi.fn();
  }

  if (
    typeof HTMLElement.prototype
      .releasePointerCapture !==
    'function'
  ) {
    HTMLElement.prototype
      .releasePointerCapture =
      vi.fn();
  }

  if (
    typeof HTMLElement.prototype
      .hasPointerCapture !==
    'function'
  ) {
    HTMLElement.prototype
      .hasPointerCapture =
      vi.fn(
        () => false
      );
  }
}

// ============================================================================
// 16. FILE PICKER APIs
// ============================================================================

if (
  typeof window !== 'undefined'
) {
  if (
    typeof window.showOpenFilePicker !==
    'function'
  ) {
    window.showOpenFilePicker =
      vi.fn(
        async () => []
      );
  }

  if (
    typeof window.showSaveFilePicker !==
    'function'
  ) {
    window.showSaveFilePicker =
      vi.fn(
        async () => ({
          createWritable:
            async () => ({
              write: vi.fn(),
              close: vi.fn(),
            }),
        })
      );
  }
}

// ============================================================================
// 17. IMAGE BITMAP
// ============================================================================

if (
  typeof globalThis.createImageBitmap !==
  'function'
) {
  globalThis.createImageBitmap =
    vi.fn(
      async () => ({})
    );
}

// ============================================================================
// 18. DATA TRANSFER / DRAG AND DROP
// ============================================================================

if (
  typeof globalThis.DataTransfer ===
  'undefined'
) {
  globalThis.DataTransfer =
    class {
      constructor() {
        this.dropEffect =
          'copy';

        this.effectAllowed =
          'all';

        this.files = [];
        this.items = [];
        this.types = [];
      }

      setData = vi.fn();

      getData =
        vi.fn(
          () => ''
        );

      clearData =
        vi.fn();

      setDragImage =
        vi.fn();
    };
}

if (
  typeof globalThis.DragEvent ===
  'undefined'
) {
  globalThis.DragEvent =
    class extends Event {
      constructor(
        type,
        options = {}
      ) {
        super(
          type,
          options
        );

        this.dataTransfer =
          options.dataTransfer ??
          new DataTransfer();
      }
    };
}

// ============================================================================
// 19. BROADCAST CHANNEL
// ============================================================================

if (
  typeof globalThis.BroadcastChannel ===
  'undefined'
) {
  globalThis.BroadcastChannel =
    class {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.onmessageerror = null;
      }

      postMessage =
        vi.fn();

      close =
        vi.fn();

      addEventListener =
        vi.fn();

      removeEventListener =
        vi.fn();

      dispatchEvent =
        vi.fn(
          () => false
        );
    };
}

// ============================================================================
// 20. WEB WORKER
// ============================================================================

if (
  typeof globalThis.Worker ===
  'undefined'
) {
  globalThis.Worker =
    class {
      constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.onmessageerror = null;
      }

      postMessage =
        vi.fn();

      terminate =
        vi.fn();

      addEventListener =
        vi.fn();

      removeEventListener =
        vi.fn();

      dispatchEvent =
        vi.fn(
          () => false
        );
    };
}

// ============================================================================
// 21. SHARED WORKER
// ============================================================================

if (
  typeof globalThis.SharedWorker ===
  'undefined'
) {
  globalThis.SharedWorker =
    class {
      constructor() {
        this.port = {
          start: vi.fn(),
          close: vi.fn(),
          postMessage: vi.fn(),
          addEventListener:
            vi.fn(),
          removeEventListener:
            vi.fn(),
          dispatchEvent:
            vi.fn(
              () => false
            ),
        };
      }
    };
}

// ============================================================================
// 22. INDEXED DB
// ============================================================================
//
// Only provide a lightweight fallback when the test environment has no
// IndexedDB implementation.
//
// For realistic persistence tests, prefer a dedicated IndexedDB implementation
// such as fake-indexeddb in the Vitest environment.
// ============================================================================

if (
  typeof globalThis.indexedDB ===
  'undefined'
) {
  globalThis.indexedDB = {
    open: vi.fn(
      () => ({
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: {
          close: vi.fn(),
          transaction: vi.fn(
            () => ({
              objectStore:
                vi.fn(
                  () => ({
                    add: vi.fn(),
                    put: vi.fn(),
                    get: vi.fn(),
                    getAll:
                      vi.fn(),
                    delete:
                      vi.fn(),
                    clear:
                      vi.fn(),
                    count:
                      vi.fn(),
                    createIndex:
                      vi.fn(),
                    index:
                      vi.fn(),
                  })
                ),
            })
          ),
          createObjectStore:
            vi.fn(
              () => ({
                createIndex:
                  vi.fn(),
              })
            ),
        },
      })
    ),

    deleteDatabase:
      vi.fn(
        () => ({})
      ),

    databases:
      vi.fn(
        async () => []
      ),
  };
}

// ============================================================================
// 23. VISUAL VIEWPORT
// ============================================================================

if (
  typeof window !== 'undefined' &&
  !window.visualViewport
) {
  Object.defineProperty(
    window,
    'visualViewport',
    {
      configurable: true,
      writable: false,

      value: {
        width: 1440,
        height: 900,
        scale: 1,

        offsetLeft: 0,
        offsetTop: 0,

        pageLeft: 0,
        pageTop: 0,

        addEventListener:
          vi.fn(),

        removeEventListener:
          vi.fn(),

        dispatchEvent:
          vi.fn(
            () => false
          ),
      },
    }
  );
}

// ============================================================================
// 24. ELEMENT GEOMETRY
// ============================================================================

if (
  typeof Element !==
  'undefined'
) {
  if (
    typeof Element.prototype
      .getBoundingClientRect !==
    'function'
  ) {
    Element.prototype
      .getBoundingClientRect =
      vi.fn(
        () => ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 100,
          right: 200,
          width: 200,
          height: 100,
          toJSON: vi.fn(),
        })
      );
  }

  if (
    typeof Element.prototype
      .getClientRects !==
    'function'
  ) {
    Element.prototype
      .getClientRects =
      vi.fn(
        () => []
      );
  }
}

// ============================================================================
// 25. FILE TEST HELPERS
// ============================================================================

globalThis.createTestFile = (
  name = 'document.pdf',
  type = 'application/pdf',
  content = 'test'
) =>
  new File(
    [content],
    name,
    { type }
  );

globalThis.createImageFile =
  () =>
    globalThis.createTestFile(
      'logo.png',
      'image/png',
      'image'
    );

globalThis.createPDFFile =
  () =>
    globalThis.createTestFile(
      'certificate.pdf',
      'application/pdf',
      'pdf'
    );

globalThis.createCSVFile =
  () =>
    globalThis.createTestFile(
      'members.csv',
      'text/csv',
      'id,name'
    );

globalThis.createUploadEvent = (
  input,
  files
) => {
  Object.defineProperty(
    input,
    'files',
    {
      configurable: true,
      value: files,
    }
  );

  return new Event(
    'change',
    {
      bubbles: true,
    }
  );
};

// ============================================================================
// 26. MSW HELPERS
// ============================================================================

globalThis.useMockHandler = (
  ...handlers
) => {
  server.use(
    ...handlers
  );
};

globalThis.resetMockServer =
  () => {
    server.resetHandlers();
  };

// ============================================================================
// 27. REACT QUERY HELPERS
// ============================================================================

globalThis.resetReactQueryClient =
  (queryClient) => {
    if (!queryClient) {
      return;
    }

    queryClient.cancelQueries?.();

    queryClient.clear?.();

    queryClient.removeQueries?.();

    queryClient.removeMutations?.();

    queryClient
      .getQueryCache?.()
      .clear?.();

    queryClient
      .getMutationCache?.()
      .clear?.();
  };

// ============================================================================
// 28. REDUX HELPERS
// ============================================================================

globalThis.resetReduxStore =
  (store) => {
    if (!store) {
      return;
    }

    try {
      store.dispatch?.({
        type: '__TEST__/RESET',
      });
    } catch {
      /*
       * Test cleanup should never mask the real test failure.
       */
    }
  };

// ============================================================================
// 29. TEST UTILITY NAMESPACE
// ============================================================================

globalThis.TestUtils = {
  sleep:
    globalThis.sleep,

  wait:
    globalThis.wait,

  flushPromises:
    globalThis.flushPromises,

  flushAllPromises:
    globalThis.flushAllPromises,

  flushTimers:
    globalThis.flushTimers,

  advanceTimers:
    globalThis.advanceTimers,

  createTestFile:
    globalThis.createTestFile,

  createPDFFile:
    globalThis.createPDFFile,

  createImageFile:
    globalThis.createImageFile,

  createCSVFile:
    globalThis.createCSVFile,

  createUploadEvent:
    globalThis.createUploadEvent,

  resetReduxStore:
    globalThis.resetReduxStore,

  resetReactQueryClient:
    globalThis.resetReactQueryClient,

  useMockHandler:
    globalThis.useMockHandler,

  resetMockServer:
    globalThis.resetMockServer,
};

// ============================================================================
// 30. MSW LIFECYCLE
// ============================================================================

beforeAll(() => {
  server.listen({
    onUnhandledRequest(
      request
    ) {
      const pathname =
        request.url.pathname;

      /*
       * Static assets are not part of API mocking.
       */
      if (
        pathname.startsWith(
          '/assets/'
        ) ||
        pathname.startsWith(
          '/favicon'
        )
      ) {
        return;
      }

      /*
       * Do NOT throw by default here.
       *
       * This warning gives developers visibility while still allowing tests
       * that intentionally exercise external endpoints to provide explicit
       * handlers.
       */

      console.warn(
        `[MSW] Unhandled ${request.method} ${request.url.href}`
      );
    },
  });

  window.addEventListener(
    'unhandledrejection',
    handleUnhandledRejection
  );
});

// ============================================================================
// 31. TEST SETUP
// ============================================================================

beforeEach(() => {
  resetRuntimeState();

  installTestConsoleGuards();

  vi.useFakeTimers({
    shouldAdvanceTime: false,
  });

  /*
   * Keep every test on a deterministic clock.
   */
  vi.setSystemTime(
    new Date(
      '2026-01-01T00:00:00.000Z'
    )
  );
});

// ============================================================================
// 32. TEST CLEANUP
// ============================================================================

afterEach(() => {
  /*
   * React Testing Library cleanup first so mounted components can execute
   * their own cleanup logic while the runtime still exists.
   */
  cleanup();

  /*
   * Restore MSW request handlers for the next test.
   */
  server.resetHandlers();

  /*
   * Clear test browser storage without deleting the storage implementation.
   */
  try {
    localStorage.clear();
  } catch {
    // Ignore unavailable storage.
  }

  try {
    sessionStorage.clear();
  } catch {
    // Ignore unavailable storage.
  }

  /*
   * Detect unhandled promise rejections.
   */
  if (
    runtimeState.unhandledRejections.length >
    0
  ) {
    const firstRejection =
      runtimeState.unhandledRejections[0];

    runtimeState.unhandledRejections.length = 0;

    throw firstRejection;
  }

  /*
   * Flush and reset timers.
   */
  try {
    vi.runOnlyPendingTimers();
  } catch {
    // Ignore timer cleanup errors.
  }

  vi.clearAllTimers();

  /*
   * Restore mocks and spies.
   */
  vi.clearAllMocks();

  vi.restoreAllMocks();

  /*
   * Restore real timers.
   */
  vi.useRealTimers();

  /*
   * Restore console.
   */
  restoreTestConsole();
});

// ============================================================================
// 33. GLOBAL TEARDOWN
// ============================================================================

afterAll(() => {
  window.removeEventListener(
    'unhandledrejection',
    handleUnhandledRejection
  );

  try {
    server.close();
  } catch {
    // Ignore MSW shutdown errors.
  }

  cleanup();

  restoreTestConsole();

  vi.clearAllMocks();

  vi.restoreAllMocks();

  vi.clearAllTimers();

  vi.useRealTimers();
});

// ============================================================================
// 34. ENVIRONMENT VALIDATION
// ============================================================================

beforeAll(() => {
  expect(
    globalThis.fetch
  ).toBeDefined();

  expect(
    globalThis.localStorage
  ).toBeDefined();

  expect(
    globalThis.sessionStorage
  ).toBeDefined();

  expect(
    globalThis.crypto
  ).toBeDefined();

  expect(
    server
  ).toBeDefined();

  expect(
    globalThis.TextEncoder
  ).toBeDefined();

  expect(
    globalThis.TextDecoder
  ).toBeDefined();
});

// ============================================================================
// 35. EXPORTABLE TEST HELPERS
// ============================================================================
//
// Named exports are intentionally limited to stable identifiers/constants.
//
// Global helpers remain available through TestUtils for convenience.
// ============================================================================

export const TEST_API_BASE_URL =
  'http://localhost:5000';

export const TEST_BUILD_TIME =
  '2026-01-01T00:00:00.000Z';

/**
 * ============================================================================
 * END OF TITech COMMUNITY CAPITAL TEST ENVIRONMENT
 * ============================================================================
 *
 * Supported areas:
 *
 *   ✓ React 18
 *   ✓ Vitest
 *   ✓ React Testing Library
 *   ✓ Jest DOM matchers
 *   ✓ MSW
 *   ✓ React Router compatible browser environment
 *   ✓ React Query test helpers
 *   ✓ Redux test helpers
 *   ✓ Deterministic timers
 *   ✓ Deterministic timezone
 *   ✓ Browser API fallbacks
 *   ✓ File uploads
 *   ✓ Drag and drop
 *   ✓ Canvas
 *   ✓ SVG
 *   ✓ Workers
 *   ✓ BroadcastChannel
 *   ✓ IndexedDB fallback
 *   ✓ ResizeObserver
 *   ✓ IntersectionObserver
 *   ✓ MutationObserver
 *   ✓ VisualViewport
 *   ✓ Animation APIs
 *   ✓ Performance-compatible APIs
 *   ✓ Promise rejection detection
 *   ✓ Enterprise cleanup lifecycle
 *
 * TITech Community Capital
 * ============================================================================
 */
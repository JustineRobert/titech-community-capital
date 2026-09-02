"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: backend/jest.config.js
 * Enterprise Jest Configuration
 * ============================================================================
 *
 * Features
 * ----------------------------------------------------------------------------
 * ✓ Controller Testing
 * ✓ Service Testing
 * ✓ Route Testing
 * ✓ Repository Testing
 * ✓ Coverage Gates
 * ✓ GitHub Actions Integration
 * ✓ SonarQube Integration
 * ✓ JUnit Reports
 * ✓ Enterprise Observability
 * ============================================================================
 */

module.exports = {

    displayName:
        "TITech Backend Tests",

    testEnvironment:
        "node",

    roots: [

        "<rootDir>"
    ],

    testMatch: [

        "**/__tests__/**/*.test.js",

        "**/*.test.js",

        "**/*.spec.js",

        "**/tests/**/*.test.js"
    ],

    moduleFileExtensions: [

        "js",
        "json"
    ],

    testTimeout:
        30000,

    verbose:
        true,

    bail:
        false,

    clearMocks:
        true,

    restoreMocks:
        true,

    resetMocks:
        false,

    collectCoverage:
        true,

    collectCoverageFrom: [

        "controllers/**/*.js",

        "services/**/*.js",

        "routes/**/*.js",

        "middleware/**/*.js",

        "repositories/**/*.js",

        "models/**/*.js",

        "utils/**/*.js",

        "!**/node_modules/**",

        "!**/coverage/**",

        "!**/dist/**",

        "!**/build/**",

        "!**/*.config.js",

        "!**/index.js"
    ],

    coverageDirectory:
        "coverage",

    coverageReporters: [

        "text",

        "text-summary",

        "html",

        "lcov",

        "json",

        "cobertura"
    ],

    coverageThreshold: {

        global: {

            branches: 85,

            functions: 90,

            lines: 90,

            statements: 90
        },

        "./controllers/**/*.js": {

            branches: 90,

            functions: 95,

            lines: 95,

            statements: 95
        },

        "./services/**/*.js": {

            branches: 90,

            functions: 95,

            lines: 95,

            statements: 95
        },

        "./routes/**/*.js": {

            branches: 85,

            functions: 90,

            lines: 90,

            statements: 90
        }
    },

    setupFilesAfterEnv: [

        "<rootDir>/tests/setup.js"
    ],

    testPathIgnorePatterns: [

        "/node_modules/",

        "/coverage/",

        "/dist/",

        "/build/"
    ],

    reporters: [

        "default",

        [

            "jest-junit",

            {

                outputDirectory:
                    "./test-reports",

                outputName:
                    "junit.xml",

                classNameTemplate:
                    "{classname}",

                titleTemplate:
                    "{title}",

                ancestorSeparator:
                    " › "
            }
        ]
    ],

    globals: {

        NODE_ENV:
            "test"
    },

    detectOpenHandles:
        true,

    forceExit:
        false,

    maxWorkers:
        "50%",

    notify:
        false,

    errorOnDeprecated:
        true
};

"use strict";

module.exports = {
  displayName: "TITech Backend Tests",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: [
    "**/__tests__/**/*.test.js",
    "**/*.test.js",
    "**/*.spec.js",
    "**/tests/**/*.test.js",
  ],
  moduleFileExtensions: ["js", "json"],
  testTimeout: 30000,
  verbose: true,
  bail: false,
  clearMocks: true,
  restoreMocks: true,
  resetMocks: false,
  collectCoverage: true,
  collectCoverageFrom: [
    "controllers/**/*.js",
    "services/**/*.js",
    "middleware/**/*.js",
    "models/**/*.js",
    "routes/**/*.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "json", "cobertura"],
};

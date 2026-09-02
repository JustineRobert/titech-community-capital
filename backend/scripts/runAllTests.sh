#!/bin/bash
# scripts/runAllTests.sh — Master test runner with coverage reporting

set -e

echo "=== Community Savings Backend Test Suite ==="
echo ""
echo "Starting MongoDB test instance (if not running)..."
# Assume MongoDB on localhost:27017 for testing

echo ""
echo "Step 1: Linting..."
npm run lint || true

echo ""
echo "Step 2: Unit Tests..."
npm run test:unit -- --coverage --coveragePathIgnorePatterns=integration

echo ""
echo "Step 3: Integration Tests..."
npm run test:integration -- --coverage --forceExit

echo ""
echo "Step 4: Full Coverage Report..."
npm run test:coverage

echo ""
echo "=== Test Suite Complete ==="
echo "Coverage report: ./coverage/lcov-report/index.html"

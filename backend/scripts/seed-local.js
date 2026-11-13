#!/usr/bin/env node
/**
 * Historical synthetic-data seeder intentionally disabled.
 *
 * The former script created demo users, groups, loans, repayment schedules
 * and records marked as successful mobile-money transactions. Running that
 * code against a shared or production database could fabricate financial
 * history. Use isolated test fixtures and a dedicated test database instead.
 */
console.error(
  'TITech local demo seeding is disabled: synthetic loans and successful payment records are not permitted in application databases. Use isolated automated-test fixtures against a disposable test database.',
);
process.exitCode = 1;

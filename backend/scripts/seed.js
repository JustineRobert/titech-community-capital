#!/usr/bin/env node
/**
 * Safe compatibility entry point for administrator bootstrap.
 *
 * The historical seed script embedded an administrator password, used a
 * legacy email/role, and deleted every group in the database. This entry point
 * now delegates exclusively to the environment-controlled administrator
 * bootstrap and never mutates group/member/financial records.
 */
import { run } from './seedAdmin.js';

run().catch((error) => {
  console.error('TITech administrator bootstrap failed:', error?.message || String(error));
  process.exitCode = 1;
});

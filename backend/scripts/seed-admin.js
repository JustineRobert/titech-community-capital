#!/usr/bin/env node
/**
 * Legacy administrator bootstrap entry point.
 *
 * All provisioning is delegated to the canonical environment-controlled
 * platform-admin bootstrap. No default identity, generated password,
 * command-line secret or alternate role is accepted here.
 */
import { pathToFileURL } from 'node:url';
import { run } from './seedAdmin.js';

export { run };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error('TITech administrator bootstrap failed:', error?.message || String(error));
    process.exitCode = 1;
  });
}

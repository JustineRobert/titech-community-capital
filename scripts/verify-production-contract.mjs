#!/usr/bin/env node
import { verifyProductionContract } from './lib/production-contract.mjs';

const args = process.argv.slice(2);
const modeArgument = args.find((argument) => argument.startsWith('--mode='));
const mode = modeArgument ? modeArgument.slice('--mode='.length) : (process.env.TITECH_VERIFY_MODE || 'production');
const allowedModes = new Set(['local', 'integration', 'staging', 'production']);

if (!allowedModes.has(mode)) {
  console.error('TITech transport verification failed: --mode must be local, integration, staging or production.');
  process.exitCode = 1;
} else {
  const configuredOrigin = process.env.TITECH_PRODUCTION_API_ORIGIN || process.env.TITECH_API_ORIGIN;
  try {
    const result = await verifyProductionContract({ origin: configuredOrigin, mode });
    console.log(`TITech ${mode} API transport contract: ${result.status}`);
    for (const check of result.checks) {
      console.log(`${check.endpoint}: HTTP ${check.status}; ${check.contentType}`);
    }
  } catch (error) {
    console.error(`TITech ${mode} API transport contract: FAILED`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

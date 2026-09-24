#!/usr/bin/env node
/**
 * Validate provider sandbox evidence without inventing provider results.
 * The JSON input is normally produced after real sandbox execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const defaultInput = path.join(ROOT, 'reports', 'provider-sandbox-evidence.json');
const input = process.env.TITECH_PROVIDER_EVIDENCE_FILE || defaultInput;
const output = path.join(ROOT, 'reports', 'provider-sandbox-gate.json');
const required = ['authentication', 'initiation', 'timeout', 'statusQuery', 'callback', 'duplicateCallback', 'reversal', 'reconciliation', 'failure'];
const providers = ['MTN_MOMO', 'AIRTEL_MONEY'];

const report = { schemaVersion: '1.0.0', status: 'NOT_VERIFIED', input, providers: {}, errors: [] };

if (!fs.existsSync(input)) {
  report.errors.push(`Evidence file is missing: ${input}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(input, 'utf8'));
} catch (error) {
  report.errors.push(`Evidence file is not valid JSON: ${error.message}`);
}

for (const provider of providers) {
  const entry = data?.providers?.[provider];
  const checks = {};
  if (!entry) {
    report.errors.push(`Missing provider evidence: ${provider}`);
    report.providers[provider] = { status: 'NOT_VERIFIED', checks };
    continue;
  }
  for (const name of required) {
    const item = entry.scenarios?.[name];
    checks[name] = item?.status || 'NOT_VERIFIED';
    if (checks[name] !== 'PASS') report.errors.push(`${provider}.${name} is ${checks[name]}`);
  }
  report.providers[provider] = {
    status: Object.values(checks).every((value) => value === 'PASS') ? 'PASS' : 'NOT_VERIFIED',
    checks,
  };
}

report.status = providers.every((provider) => report.providers[provider].status === 'PASS') ? 'PASS' : 'NOT_VERIFIED';
report.review = data?.review || {};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;

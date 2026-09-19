#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo 'TITech Community Capital — Evidence Gate'
echo '========================================'
echo

node scripts/enterprise-gate.mjs --syntax
node scripts/enterprise-gate.mjs --structure
node scripts/enterprise-gate.mjs --security
node scripts/postman-validate.mjs

echo
echo 'Static/structural evidence gates passed.'
echo 'This script does NOT grant production approval.'
echo 'Required outstanding gates include full Node 24.15.x dependency-backed test/build execution, security scans, provider sandbox tests, failure injection, restore testing, operational review and regulatory/compliance review.'

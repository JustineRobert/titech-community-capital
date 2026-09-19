#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

printf '%s\n' 'TITech Community Capital setup'
printf '%s\n' '============================='

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Node.js and npm are required.' >&2
  exit 1
fi

if [[ "$(cat .nvmrc)" != '24.15.0' ]]; then
  echo 'Warning: .nvmrc is not pinned to Node 24.15.0.' >&2
fi

npm ci
npm --prefix backend ci
npm --prefix frontend ci

if [[ ! -f backend/.env ]]; then
  if [[ -f backend/.env.example ]]; then
    cp backend/.env.example backend/.env
    echo 'Created backend/.env from backend/.env.example.'
    echo 'Populate secrets locally; this script never writes production credentials.'
  else
    echo 'backend/.env.example not found; configure backend environment manually.' >&2
  fi
else
  echo 'backend/.env already exists; leaving it untouched.'
fi

echo 'Setup dependencies installed. Run: npm run dev'

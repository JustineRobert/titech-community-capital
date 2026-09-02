#!/usr/bin/env bash
# Minimal bash script that runs Register -> Login -> Create Group
# Requires: curl, jq

BASE_URL=${BASE_URL:-http://localhost:5000}
NAME=${NAME:-"Local Dev"}
EMAIL=${EMAIL:-"dev@example.com"}
PASSWORD=${PASSWORD:-"Password123!"}
GROUP_NAME=${GROUP_NAME:-"Automated Created Group"}

echo "Using BASE_URL=$BASE_URL"

echo "== Registering user ($EMAIL) =="
REG_RES=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

HTTP=$(echo "$REG_RES" | tail -n1)
BODY=$(echo "$REG_RES" | sed '$d')

if [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 300 ]; then
  TOKEN=$(echo "$BODY" | jq -r '.token')
  echo "Registered. Token received (truncated): ${TOKEN:0:40}..."
else
  echo "Register response HTTP $HTTP; attempting login..."
  LOGIN_RES=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  TOKEN=$(echo "$LOGIN_RES" | jq -r '.token')
  if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
    echo "Login failed. Response: $LOGIN_RES"
    exit 1
  fi
  echo "Login successful. Token received (truncated): ${TOKEN:0:40}..."
fi

echo "== Creating group: $GROUP_NAME =="
CREATE_RES=$(curl -s -X POST "$BASE_URL/api/groups" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$GROUP_NAME\",\"description\":\"Created by script\"}")

echo "Create response:"
echo "$CREATE_RES" | jq '.'

echo "Done."

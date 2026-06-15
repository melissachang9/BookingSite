#!/usr/bin/env bash
# Send automated form reminders for confirmed bookings with pending form requirements.
# Intended to be called from cron every 15 minutes.
#
# Usage:
#   ./scripts/cron/send-form-reminders.sh
#
# Requires TEST_RESET_TOKEN to be set in the environment (same as E2E reset).

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000/api/v1}"
TOKEN="${TEST_RESET_TOKEN:-dev-reset-token}"

curl -s -X POST "${API_BASE}/testing/cron/send-form-reminders" \
  -H "X-E2E-Reset-Token: ${TOKEN}" \
  -H "Content-Type: application/json" \
  | python3 -m json.tool

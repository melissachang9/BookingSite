#!/usr/bin/env bash
# Send appointment reminders for confirmed bookings approaching their start time.
# Intended to be called from cron every 15 minutes.
#
# Usage:
#   ./scripts/cron/send-appointment-reminders.sh
#
# Requires TEST_RESET_TOKEN to be set in the environment (same as E2E reset).

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:8000/api/v1}"
TOKEN="${TEST_RESET_TOKEN:-dev-reset-token}"

curl -s -X POST "${API_BASE}/testing/cron/send-appointment-reminders" \
  -H "X-E2E-Reset-Token: ${TOKEN}" \
  -H "Content-Type: application/json" \
  | python3 -m json.tool

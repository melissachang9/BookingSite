#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
FORWARD_URL="${STRIPE_WEBHOOK_FORWARD_URL:-http://127.0.0.1:8000/api/v1/payments/webhooks/stripe}"
HEALTH_URL="${STRIPE_WEBHOOK_HEALTH_URL:-http://127.0.0.1:8000/api/v1/health/live}"
EVENTS="${STRIPE_WEBHOOK_EVENTS:-checkout.session.completed,checkout.session.expired}"
STARTUP_TIMEOUT_SECONDS="${STRIPE_WEBHOOK_STARTUP_TIMEOUT_SECONDS:-30}"
STRIPE_SECRET_KEY_VALUE=""
STRIPE_SECRET_KEY_SOURCE=""
STRIPE_WEBHOOK_SECRET=""
LOG_FILE="$(mktemp -t booking-stripe-webhooks.XXXXXX.log)"
STRIPE_PID=""
TAIL_PID=""

ensure_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        (
            umask 077
            cat <<'EOF' > "$ENV_FILE"
# Local Docker Compose environment.
# Stripe values are managed by scripts/dev/stripe-webhooks.sh.
EOF
        )
    fi

    chmod 600 "$ENV_FILE" 2>/dev/null || true
}

upsert_env_file_value() {
    local key="$1"
    local value="$2"
    local temp_file=""

    ensure_env_file
    temp_file="$(mktemp "$ROOT_DIR/.env.tmp.XXXXXX")"
    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        index($0, key "=") == 1 {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (!updated) {
                print key "=" value
            }
        }
    ' "$ENV_FILE" > "$temp_file"
    mv "$temp_file" "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
}

delete_env_file_value() {
    local key="$1"
    local temp_file=""

    if [[ ! -f "$ENV_FILE" ]]; then
        return 0
    fi

    temp_file="$(mktemp "$ROOT_DIR/.env.tmp.XXXXXX")"
    awk -v key="$key" 'index($0, key "=") != 1 { print }' "$ENV_FILE" > "$temp_file"
    mv "$temp_file" "$ENV_FILE"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
}

persist_compose_stripe_env() {
    local storefront_public_base_url="${STOREFRONT_PUBLIC_BASE_URL:-http://localhost:3001}"

    upsert_env_file_value "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY_VALUE"
    upsert_env_file_value "STOREFRONT_PUBLIC_BASE_URL" "$storefront_public_base_url"
}

persist_compose_webhook_secret() {
    upsert_env_file_value "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET"
}

cleanup() {
    if [[ -n "$STRIPE_WEBHOOK_SECRET" ]]; then
        delete_env_file_value "STRIPE_WEBHOOK_SECRET"
    fi
    if [[ -n "$TAIL_PID" ]] && kill -0 "$TAIL_PID" 2>/dev/null; then
        kill "$TAIL_PID" 2>/dev/null || true
        wait "$TAIL_PID" 2>/dev/null || true
    fi
    if [[ -n "$STRIPE_PID" ]] && kill -0 "$STRIPE_PID" 2>/dev/null; then
        kill "$STRIPE_PID" 2>/dev/null || true
        wait "$STRIPE_PID" 2>/dev/null || true
    fi
    rm -f "$LOG_FILE"
}

trap cleanup EXIT

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
}

resolve_stripe_secret_key() {
    if [[ -n "${STRIPE_SECRET_KEY:-}" ]]; then
        STRIPE_SECRET_KEY_VALUE="${STRIPE_SECRET_KEY}"
        STRIPE_SECRET_KEY_SOURCE="environment"
        return 0
    fi

    local stripe_config_key=""
    stripe_config_key="$(stripe config --list 2>/dev/null | sed -n "s/^test_mode_api_key = '\(sk_[^']*\)'$/\1/p" | head -n 1 || true)"
    if [[ -n "$stripe_config_key" ]]; then
        STRIPE_SECRET_KEY_VALUE="$stripe_config_key"
        STRIPE_SECRET_KEY_SOURCE="stripe config"
        return 0
    fi

    return 1
}

require_stripe_secret_key() {
    if ! resolve_stripe_secret_key; then
        echo "Missing STRIPE_SECRET_KEY and no Stripe CLI test_mode_api_key was found. Export your Stripe secret key before running npm run dev:stripe-webhooks." >&2
        exit 1
    fi

    if [[ "$STRIPE_SECRET_KEY_VALUE" != sk_* ]]; then
        echo "STRIPE_SECRET_KEY must look like a Stripe secret key (expected prefix sk_)." >&2
        exit 1
    fi
}

wait_for_health() {
    local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
    while (( SECONDS < deadline )); do
        if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    echo "Timed out waiting for backend health at $HEALTH_URL" >&2
    return 1
}

wait_for_secret() {
    local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
    local secret_line=""
    while (( SECONDS < deadline )); do
        if [[ -n "$STRIPE_PID" ]] && ! kill -0 "$STRIPE_PID" 2>/dev/null; then
            echo "Stripe listener exited before it reported a webhook signing secret." >&2
            return 1
        fi
        secret_line="$(grep -m1 'Your webhook signing secret is ' "$LOG_FILE" 2>/dev/null || true)"
        if [[ -n "$secret_line" ]]; then
            secret_line="${secret_line#*Your webhook signing secret is }"
            printf '%s\n' "${secret_line%% (*}"
            return 0
        fi
        sleep 1
    done
    echo "Timed out waiting for Stripe listener startup output." >&2
    return 1
}

probe_webhook_route() {
    local status_code
    status_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$FORWARD_URL" -H 'Content-Type: application/json' -d '{}' || true)"
    if [[ "$status_code" != "400" ]]; then
        echo "Expected webhook route probe to return HTTP 400, got ${status_code:-unknown}." >&2
        return 1
    fi
}

require_command stripe
require_command docker
require_command curl
require_stripe_secret_key
persist_compose_stripe_env

if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is required for Stripe webhook automation." >&2
    exit 1
fi

echo "Using Stripe secret key from $STRIPE_SECRET_KEY_SOURCE"
echo "Persisting local Stripe checkout settings to $ENV_FILE"
echo "Starting Stripe webhook forwarder for $EVENTS"
(
    cd "$ROOT_DIR"
    exec stripe listen --events "$EVENTS" --forward-to "$FORWARD_URL"
) >"$LOG_FILE" 2>&1 &
STRIPE_PID=$!

STRIPE_WEBHOOK_SECRET="$(wait_for_secret)"
persist_compose_webhook_secret

echo "Rebuilding backend with the current Stripe webhook signing secret"
(
    cd "$ROOT_DIR"
    STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY_VALUE" STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET" docker compose up --build -d backend
)

wait_for_health
probe_webhook_route

echo "Stripe webhook forwarding is active"
echo "Forwarding $EVENTS to $FORWARD_URL"
echo "Press Ctrl+C to stop the Stripe listener"

tail -n 0 -F "$LOG_FILE" &
TAIL_PID=$!

wait "$STRIPE_PID"

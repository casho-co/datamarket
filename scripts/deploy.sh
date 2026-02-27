#!/bin/bash
set -euo pipefail

# Datalayer Market Deployment Script
# Deploys the AI Agent Marketplace on BSC

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="datalayer-market"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v flyctl &> /dev/null && ! command -v fly &> /dev/null; then
        error "Fly CLI not installed. Install with: curl -L https://fly.io/install.sh | sh"
    fi

    if ! fly auth whoami &> /dev/null 2>&1; then
        error "Not logged in to Fly.io. Run: fly auth login"
    fi

    log "Prerequisites OK"
}

# Verify BSC contracts are reachable
verify_bsc() {
    log "Verifying BSC contracts..."

    local usdc_addr="0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
    local identity_addr="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
    local reputation_addr="0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"
    local rpc_url="${BSC_RPC_URL:-https://bsc-dataseed.binance.org/}"

    # Quick check: get code at USDC address
    local result
    result=$(curl -s -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$usdc_addr\",\"latest\"],\"id\":1}" 2>/dev/null)

    if echo "$result" | grep -q '"0x"'; then
        error "USDC contract not found at $usdc_addr on BSC"
    else
        log "USDC contract verified on BSC"
    fi

    # Check Identity Registry
    result=$(curl -s -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$identity_addr\",\"latest\"],\"id\":1}" 2>/dev/null)

    if echo "$result" | grep -q '"0x"'; then
        error "ERC-8004 Identity Registry not found at $identity_addr on BSC"
    else
        log "ERC-8004 Identity Registry verified on BSC"
    fi

    # Check Reputation Registry
    result=$(curl -s -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getCode\",\"params\":[\"$reputation_addr\",\"latest\"],\"id\":1}" 2>/dev/null)

    if echo "$result" | grep -q '"0x"'; then
        error "ERC-8004 Reputation Registry not found at $reputation_addr on BSC"
    else
        log "ERC-8004 Reputation Registry verified on BSC"
    fi

    log "All BSC contracts verified"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    cd "$ROOT_DIR"

    if [ -z "${DATABASE_URL:-}" ]; then
        if [ -f .env ]; then
            export $(grep DATABASE_URL .env | xargs)
        else
            error "DATABASE_URL not set. Provide it in .env or as environment variable."
        fi
    fi

    npx drizzle-kit push --force
    log "Migrations applied successfully"
}

# Set Fly.io secrets
set_secrets() {
    log "Setting Fly.io secrets..."
    cd "$ROOT_DIR"

    if [ -f .env ]; then
        # Filter out comments and empty lines
        grep -v '^#' .env | grep -v '^$' | fly secrets import --app "$APP_NAME" 2>/dev/null || warn "Some secrets may already be set"
        log "Secrets imported from .env"
    else
        warn "No .env file found. Required secrets:"
        echo "  DATABASE_URL"
        echo "  BSC_RPC_URL"
        echo "  PLATFORM_BSC_PRIVATE_KEY"
        echo "  PLATFORM_BSC_ADDRESS"
        echo "  CRON_SECRET"
        echo "  UPSTASH_REDIS_REST_URL"
        echo "  UPSTASH_REDIS_REST_TOKEN"
        echo "  R2_ACCOUNT_ID"
        echo "  R2_ACCESS_KEY_ID"
        echo "  R2_SECRET_ACCESS_KEY"
        echo ""
        echo "Set them with: fly secrets set KEY=VALUE --app $APP_NAME"
    fi
}

# Deploy to Fly.io
deploy() {
    log "Deploying $APP_NAME to Fly.io..."
    cd "$ROOT_DIR"

    if ! fly apps list | grep -q "$APP_NAME"; then
        log "Creating app: $APP_NAME"
        fly apps create "$APP_NAME"
    fi

    fly deploy --app "$APP_NAME"
    log "Deployed: https://${APP_NAME}.fly.dev"
}

# Health check
health_check() {
    log "Running health check..."

    local url="https://${APP_NAME}.fly.dev/api/health"
    local response
    response=$(curl -s "$url" 2>/dev/null || echo '{"error":"unreachable"}')

    if echo "$response" | grep -q '"ok"'; then
        log "Health check passed"
        echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
    else
        warn "Health check returned: $response"
        warn "Service may still be starting up..."
    fi
}

# Setup cron (external trigger)
setup_cron_info() {
    log "Cron job setup info:"
    echo ""
    echo "  The app needs an external cron trigger for background jobs."
    echo "  Set up a cron service (e.g., cron-job.org, Cloudflare Workers) to call:"
    echo ""
    echo "    POST https://${APP_NAME}.fly.dev/api/cron"
    echo "    Authorization: Bearer \$CRON_SECRET"
    echo ""
    echo "  Recommended frequency: every 15 minutes"
    echo "  Jobs handled: expired jobs cleanup, auto-dispute, overdue release"
    echo ""
}

# Usage
usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  all         Full deployment: verify, migrate, secrets, deploy (default)"
    echo "  deploy      Deploy only (skip migrations and verification)"
    echo "  migrate     Run database migrations only"
    echo "  secrets     Set Fly.io secrets from .env"
    echo "  verify      Verify BSC contracts"
    echo "  health      Check deployment health"
    echo "  cron        Show cron setup instructions"
    echo ""
}

# Main
main() {
    local cmd="${1:-all}"

    check_prerequisites

    case "$cmd" in
        all)
            verify_bsc
            run_migrations
            set_secrets
            deploy
            health_check
            setup_cron_info
            ;;
        deploy) deploy ;;
        migrate) run_migrations ;;
        secrets) set_secrets ;;
        verify) verify_bsc ;;
        health) health_check ;;
        cron) setup_cron_info ;;
        *) usage; exit 1 ;;
    esac

    log "Done!"
}

main "$@"

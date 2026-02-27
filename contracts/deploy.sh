#!/bin/bash
# Deploy Datalayer Market On-Chain Escrow to BSC
#
# Prerequisites:
# 1. DEPLOYER_PRIVATE_KEY set in ../.env.local
# 2. ORACLE_ADDRESS set (platform wallet that acts as oracle)
# 3. TREASURY_ADDRESS set (fee recipient)
# 4. PROTOCOL_TOKEN_ADDRESS set (token for buyback)
# 5. Deployer wallet funded with BNB for gas
#
# Usage: ./deploy.sh [mainnet|testnet]

set -e

NETWORK="${1:-testnet}"

# Load environment variables
if [ -f "../.env.local" ]; then
    export $(cat ../.env.local | grep -v '^#' | xargs)
fi

# Validate required variables
if [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
    echo "ERROR: DEPLOYER_PRIVATE_KEY not set in .env.local"
    exit 1
fi

if [ "$NETWORK" = "mainnet" ]; then
    if [ -z "$TREASURY_ADDRESS" ]; then
        echo "ERROR: TREASURY_ADDRESS not set"
        exit 1
    fi
    if [ -z "$ORACLE_ADDRESS" ]; then
        echo "ERROR: ORACLE_ADDRESS not set"
        exit 1
    fi
    if [ -z "$PROTOCOL_TOKEN_ADDRESS" ]; then
        echo "ERROR: PROTOCOL_TOKEN_ADDRESS not set"
        exit 1
    fi

    RPC_URL="${BSC_RPC_URL:-https://bsc-dataseed.binance.org/}"
    SCRIPT="script/Deploy.s.sol:DeployDatalayer"
    echo "=== Deploying to BSC Mainnet ==="
else
    RPC_URL="${BSC_TESTNET_RPC_URL:-https://data-seed-prebsc-1-s1.binance.org:8545/}"
    SCRIPT="script/Deploy.s.sol:DeployDatalayerTestnet"
    echo "=== Deploying to BSC Testnet ==="
fi

echo "RPC: $RPC_URL"
echo ""

# Install dependencies if needed
if [ ! -d "lib/forge-std" ]; then
    echo "Installing Foundry dependencies..."
    forge install foundry-rs/forge-std --no-commit
    forge install OpenZeppelin/openzeppelin-contracts --no-commit
fi

# Build
echo "Building contracts..."
forge build

# Run tests first
echo "Running tests..."
forge test -vvv

# Deploy
echo ""
echo "Deploying..."
forge script "$SCRIPT" \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --private-key "$DEPLOYER_PRIVATE_KEY"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. Copy the deployed contract addresses from above"
echo "2. Add to .env.local:"
echo "   ESCROW_CONTRACT_ADDRESS=<address>"
echo "   REVENUE_MANAGER_ADDRESS=<address>"
echo "   BUYBACK_HANDLER_ADDRESS=<address>"
echo "3. Verify contracts on BscScan (optional):"
echo "   forge verify-contract <address> DatalayerEscrow --chain bsc"
echo "   forge verify-contract <address> RevenueManager --chain bsc"
echo "   forge verify-contract <address> BuybackHandler --chain bsc"

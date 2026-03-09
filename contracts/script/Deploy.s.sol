// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DatalayerEscrow.sol";
import "../src/RevenueManager.sol";
import "../src/BuybackHandler.sol";

contract DeployDatalayer is Script {
    // BSC Mainnet USDC (18 decimals)
    address constant USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    // BSC Mainnet USDT (18 decimals)
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    // PancakeSwap V3 SwapRouter on BSC
    address constant PANCAKE_ROUTER = 0x13f4EA83D0bd40E75C8222255bc855a974568Dd4;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address oracleAddress = vm.envAddress("ORACLE_ADDRESS");
        address treasuryAddress = vm.envAddress("TREASURY_ADDRESS");
        address protocolToken = vm.envAddress("PROTOCOL_TOKEN_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy RevenueManager
        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = USDT;

        RevenueManager revManager = new RevenueManager(tokens);
        console.log("RevenueManager deployed to:", address(revManager));

        // 2. Deploy BuybackHandler
        BuybackHandler buyback = new BuybackHandler(
            PANCAKE_ROUTER,
            protocolToken,
            2500 // 0.25% pool fee
        );
        console.log("BuybackHandler deployed to:", address(buyback));

        // 3. Deploy DatalayerEscrow
        DatalayerEscrow escrow = new DatalayerEscrow(
            address(revManager),
            oracleAddress,
            100, // 1% fee
            tokens
        );
        console.log("DatalayerEscrow deployed to:", address(escrow));

        // 4. Configure RevenueManager recipients: 70% treasury, 30% buyback
        address[] memory recipients = new address[](2);
        recipients[0] = treasuryAddress;
        recipients[1] = address(buyback);
        uint256[] memory shares = new uint256[](2);
        shares[0] = 7000;
        shares[1] = 3000;
        string[] memory labels = new string[](2);
        labels[0] = "treasury";
        labels[1] = "buyback";
        revManager.setRecipients(recipients, shares, labels);

        // 5. Authorize RevenueManager to trigger buybacks
        buyback.setAuthorizedCaller(address(revManager), true);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Datalayer Market On-Chain Escrow - BSC Mainnet ===");
        console.log("DatalayerEscrow:", address(escrow));
        console.log("RevenueManager:", address(revManager));
        console.log("BuybackHandler:", address(buyback));
        console.log("Oracle:", oracleAddress);
        console.log("Treasury:", treasuryAddress);
        console.log("Fee: 1% (100 BPS)");
        console.log("Revenue Split: 70% treasury, 30% buyback");
        console.log("");
        console.log("Add to .env:");
        console.log("ESCROW_CONTRACT_ADDRESS=", address(escrow));
        console.log("REVENUE_MANAGER_ADDRESS=", address(revManager));
        console.log("BUYBACK_HANDLER_ADDRESS=", address(buyback));
    }
}

contract DeployDatalayerTestnet is Script {
    // BSC Testnet USDC (mock)
    address constant USDC = 0x64544969ed7EBf5f083679233325356EbE738930;
    // BSC Testnet USDT (mock)
    address constant USDT = 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = USDT;

        // For testnet: deployer is oracle, treasury, and owner
        RevenueManager revManager = new RevenueManager(tokens);

        DatalayerEscrow escrow = new DatalayerEscrow(
            address(revManager),
            deployer, // deployer as oracle
            100,
            tokens
        );

        // Simple recipient setup: 100% to deployer for testing
        address[] memory recipients = new address[](1);
        recipients[0] = deployer;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000;
        string[] memory labels = new string[](1);
        labels[0] = "treasury";
        revManager.setRecipients(recipients, shares, labels);

        vm.stopBroadcast();

        console.log("=== BSC Testnet Deployment ===");
        console.log("DatalayerEscrow:", address(escrow));
        console.log("RevenueManager:", address(revManager));
        console.log("Oracle (deployer):", deployer);
    }
}

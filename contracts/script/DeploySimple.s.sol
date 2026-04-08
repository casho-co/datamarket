// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/DatalayerEscrow.sol";
import "../src/RevenueManager.sol";
import "../src/BuybackHandler.sol";

/// @notice Simple mainnet deploy: 100% fees to platform treasury, no buyback
contract DeploySimple is Script {
    // BSC Mainnet USDC (18 decimals)
    address constant USDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    // BSC Mainnet USDT (18 decimals)
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy RevenueManager
        address[] memory tokens = new address[](2);
        tokens[0] = USDC;
        tokens[1] = USDT;

        RevenueManager revManager = new RevenueManager(tokens);
        console.log("RevenueManager deployed to:", address(revManager));

        // 2. Deploy DatalayerEscrow (deployer = oracle, revManager = fee recipient)
        DatalayerEscrow escrow = new DatalayerEscrow(
            address(revManager),
            deployer, // platform wallet as oracle
            100,      // 1% fee
            tokens
        );
        console.log("DatalayerEscrow deployed to:", address(escrow));

        // 3. Configure RevenueManager: 100% to deployer (platform treasury)
        address[] memory recipients = new address[](1);
        recipients[0] = deployer;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000; // 100%
        string[] memory labels = new string[](1);
        labels[0] = "treasury";
        revManager.setRecipients(recipients, shares, labels);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Datalayer Escrow - BSC Mainnet ===");
        console.log("DatalayerEscrow:", address(escrow));
        console.log("RevenueManager:", address(revManager));
        console.log("Oracle/Treasury:", deployer);
        console.log("Fee: 1% (100 BPS)");
        console.log("Revenue: 100% to treasury");
        console.log("");
        console.log("Set in Fly.io:");
        console.log("  ESCROW_CONTRACT_ADDRESS=", address(escrow));
        console.log("  REVENUE_MANAGER_ADDRESS=", address(revManager));
    }
}

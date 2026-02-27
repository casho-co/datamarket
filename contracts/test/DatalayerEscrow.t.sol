// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DatalayerEscrow.sol";
import "../src/RevenueManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Mock ERC20 for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 ether); // 18 decimals on BSC
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DatalayerEscrowTest is Test {
    DatalayerEscrow public escrow;
    RevenueManager public revenueManager;
    MockUSDC public usdc;
    MockUSDC public usdt;

    address public owner = address(this);
    address public oracle = address(0x1);
    address public treasury = address(0x2);
    address public buyer = address(0x3);
    address public seller = address(0x4);

    bytes32 public escrowId = bytes32(uint256(1));

    function setUp() public {
        usdc = new MockUSDC();
        usdt = new MockUSDC(); // Use same mock for USDT

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(usdt);

        // Deploy RevenueManager
        revenueManager = new RevenueManager(tokens);

        // Set up revenue manager recipients
        address[] memory addrs = new address[](1);
        addrs[0] = treasury;
        uint256[] memory shares = new uint256[](1);
        shares[0] = 10000; // 100% to treasury for testing
        string[] memory labels = new string[](1);
        labels[0] = "treasury";
        revenueManager.setRecipients(addrs, shares, labels);

        // Deploy Escrow
        escrow = new DatalayerEscrow(
            address(revenueManager),
            oracle,
            100, // 1% fee
            tokens
        );

        // Fund buyer
        usdc.mint(buyer, 1000 ether);
        usdt.mint(buyer, 1000 ether);
    }

    // ============ CREATE ESCROW ============

    function test_createEscrow() public {
        uint256 amount = 100 ether;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 48);
        vm.stopPrank();

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(e.buyer, buyer);
        assertEq(e.seller, seller);
        assertEq(e.token, address(usdc));
        assertEq(e.amount, amount);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.FUNDED));
        assertEq(e.disputeWindowHours, 48);
    }

    function test_createEscrow_USDT() public {
        uint256 amount = 50 ether;

        vm.startPrank(buyer);
        usdt.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdt), amount, 72, 24);
        vm.stopPrank();

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(e.token, address(usdt));
        assertEq(e.amount, amount);
    }

    function test_createEscrow_revertDuplicate() public {
        uint256 amount = 100 ether;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount * 2);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 48);

        vm.expectRevert("Escrow exists");
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 48);
        vm.stopPrank();
    }

    function test_createEscrow_revertSelfEscrow() public {
        uint256 amount = 100 ether;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        vm.expectRevert("Cannot escrow to self");
        escrow.createEscrow(escrowId, buyer, address(usdc), amount, 168, 48);
        vm.stopPrank();
    }

    function test_createEscrow_revertInvalidToken() public {
        address fakeToken = address(0x999);

        vm.startPrank(buyer);
        vm.expectRevert("Token not allowed");
        escrow.createEscrow(escrowId, seller, fakeToken, 100 ether, 168, 48);
        vm.stopPrank();
    }

    // ============ MARK DELIVERED ============

    function test_markDelivered_bySeller() public {
        _createEscrow();

        bytes32 hash = keccak256("deliverable content");

        vm.prank(seller);
        escrow.markDelivered(escrowId, hash);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.DELIVERED));
        assertEq(e.deliverableHash, hash);
        assertGt(e.deliveredAt, 0);
    }

    function test_markDelivered_byOracle() public {
        _createEscrow();

        bytes32 hash = keccak256("deliverable");

        vm.prank(oracle);
        escrow.markDelivered(escrowId, hash);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.DELIVERED));
    }

    function test_markDelivered_revertAfterDeadline() public {
        _createEscrow();

        // Fast forward past deadline
        vm.warp(block.timestamp + 169 hours);

        vm.prank(seller);
        vm.expectRevert("Deadline passed");
        escrow.markDelivered(escrowId, keccak256("late"));
    }

    // ============ RELEASE ============

    function test_release_byBuyer() public {
        _createEscrow();

        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 revMgrBefore = usdc.balanceOf(address(revenueManager));

        vm.prank(buyer);
        escrow.release(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));

        // 100 ether - 1% fee = 99 ether to seller
        assertEq(usdc.balanceOf(seller) - sellerBefore, 99 ether);
        // 1% = 1 ether to revenue manager
        assertEq(usdc.balanceOf(address(revenueManager)) - revMgrBefore, 1 ether);
    }

    function test_release_byOracleAfterDisputeWindow() public {
        _createEscrow();
        _markDelivered();

        // Fast forward past dispute window (48 hours)
        vm.warp(block.timestamp + 49 hours);

        vm.prank(oracle);
        escrow.release(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));
    }

    function test_release_revertOracleDuringDisputeWindow() public {
        _createEscrow();
        _markDelivered();

        // Still within dispute window
        vm.prank(oracle);
        vm.expectRevert("Dispute window active");
        escrow.release(escrowId);
    }

    // ============ DISPUTE ============

    function test_dispute() public {
        _createEscrow();
        _markDelivered();

        vm.prank(buyer);
        escrow.dispute(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.DISPUTED));
        assertTrue(e.disputed);
    }

    function test_dispute_revertAfterWindow() public {
        _createEscrow();
        _markDelivered();

        // Fast forward past dispute window
        vm.warp(block.timestamp + 49 hours);

        vm.prank(buyer);
        vm.expectRevert("Dispute window closed");
        escrow.dispute(escrowId);
    }

    function test_dispute_revertNotBuyer() public {
        _createEscrow();
        _markDelivered();

        vm.prank(seller);
        vm.expectRevert("Only buyer");
        escrow.dispute(escrowId);
    }

    // ============ RESOLVE DISPUTE ============

    function test_resolveDispute_releaseToSeller() public {
        _createEscrow();
        _markDelivered();
        _dispute();

        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(oracle);
        escrow.resolveDispute(escrowId, true);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));
        assertEq(usdc.balanceOf(seller) - sellerBefore, 99 ether);
    }

    function test_resolveDispute_refundToBuyer() public {
        _createEscrow();
        _markDelivered();
        _dispute();

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(oracle);
        escrow.resolveDispute(escrowId, false);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.REFUNDED));
        assertEq(usdc.balanceOf(buyer) - buyerBefore, 100 ether);
    }

    // ============ RESOLVE DISPUTE SPLIT ============

    function test_resolveDisputeSplit_5050() public {
        _createEscrow();
        _markDelivered();
        _dispute();

        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(oracle);
        escrow.resolveDisputeSplit(escrowId, 5000); // 50/50

        // Seller gets 50 ether gross, minus 1% fee = 49.5 ether
        uint256 sellerReceived = usdc.balanceOf(seller) - sellerBefore;
        assertEq(sellerReceived, 49.5 ether);

        // Buyer gets 50 ether
        uint256 buyerReceived = usdc.balanceOf(buyer) - buyerBefore;
        assertEq(buyerReceived, 50 ether);
    }

    function test_resolveDisputeSplit_fullRefund() public {
        _createEscrow();
        _markDelivered();
        _dispute();

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(oracle);
        escrow.resolveDisputeSplit(escrowId, 0); // 0% to seller = full refund

        assertEq(usdc.balanceOf(buyer) - buyerBefore, 100 ether);
    }

    // ============ REFUND ============

    function test_refund_buyerAfterDeadline() public {
        _createEscrow();

        // Fast forward past deadline
        vm.warp(block.timestamp + 169 hours);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        escrow.refund(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.REFUNDED));
        assertEq(usdc.balanceOf(buyer) - buyerBefore, 100 ether);
    }

    function test_refund_oracleAnytime() public {
        _createEscrow();

        vm.prank(oracle);
        escrow.refund(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.REFUNDED));
    }

    function test_refund_revertBuyerBeforeDeadline() public {
        _createEscrow();

        vm.prank(buyer);
        vm.expectRevert("Deadline not passed");
        escrow.refund(escrowId);
    }

    // ============ VIEW FUNCTIONS ============

    function test_isAutoReleaseReady() public {
        _createEscrow();
        _markDelivered();

        assertFalse(escrow.isAutoReleaseReady(escrowId));

        // Fast forward past dispute window
        vm.warp(block.timestamp + 49 hours);

        assertTrue(escrow.isAutoReleaseReady(escrowId));
    }

    function test_isRefundReady() public {
        _createEscrow();

        assertFalse(escrow.isRefundReady(escrowId));

        vm.warp(block.timestamp + 169 hours);

        assertTrue(escrow.isRefundReady(escrowId));
    }

    // ============ ADMIN ============

    function test_setFee() public {
        escrow.setFee(200); // 2%
        assertEq(escrow.feeBasisPoints(), 200);
    }

    function test_setFee_revertTooHigh() public {
        vm.expectRevert("Fee too high");
        escrow.setFee(600); // > MAX_FEE_BPS (500)
    }

    function test_oracleChange() public {
        address newOracle = address(0x5);

        escrow.initiateOracleChange(newOracle);
        assertEq(escrow.pendingOracle(), newOracle);

        // Can't complete before delay
        vm.expectRevert("Delay not passed");
        escrow.completeOracleChange();

        // Fast forward 24 hours
        vm.warp(block.timestamp + 25 hours);

        escrow.completeOracleChange();
        assertEq(escrow.oracle(), newOracle);
    }

    function test_pause() public {
        escrow.pause();

        vm.startPrank(buyer);
        usdc.approve(address(escrow), 100 ether);
        vm.expectRevert();
        escrow.createEscrow(escrowId, seller, address(usdc), 100 ether, 168, 48);
        vm.stopPrank();

        escrow.unpause();

        vm.startPrank(buyer);
        escrow.createEscrow(escrowId, seller, address(usdc), 100 ether, 168, 48);
        vm.stopPrank();
    }

    // ============ HELPERS ============

    function _createEscrow() internal {
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 48);
        vm.stopPrank();
    }

    function _markDelivered() internal {
        vm.prank(seller);
        escrow.markDelivered(escrowId, keccak256("deliverable"));
    }

    function _dispute() internal {
        vm.prank(buyer);
        escrow.dispute(escrowId);
    }
}

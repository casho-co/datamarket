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

    function test_createEscrow_zeroDisputeWindow() public {
        uint256 amount = 100 ether;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 0);
        vm.stopPrank();

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(e.disputeWindowHours, 0);
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

    // ============ SUBMIT WORK ============

    function test_submitWork_bySeller() public {
        _createEscrow();

        bytes32 hash = keccak256("deliverable content");

        vm.prank(seller);
        escrow.submitWork(escrowId, hash);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.SUBMITTED));
        assertEq(e.deliverableHash, hash);
        assertGt(e.submittedAt, 0);
    }

    function test_submitWork_byOracle() public {
        _createEscrow();

        bytes32 hash = keccak256("deliverable");

        vm.prank(oracle);
        escrow.submitWork(escrowId, hash);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.SUBMITTED));
    }

    function test_submitWork_revertAfterDeadline() public {
        _createEscrow();

        // Fast forward past deadline
        vm.warp(block.timestamp + 169 hours);

        vm.prank(seller);
        vm.expectRevert("Deadline passed");
        escrow.submitWork(escrowId, keccak256("late"));
    }

    // ============ ACCEPT DELIVERY ============

    function test_acceptDelivery_immediate() public {
        _createEscrow();
        _submitWork();

        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 revMgrBefore = usdc.balanceOf(address(revenueManager));

        vm.prank(oracle);
        escrow.acceptDelivery(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));

        // 100 ether - 1% fee = 99 ether to seller
        assertEq(usdc.balanceOf(seller) - sellerBefore, 99 ether);
        assertEq(usdc.balanceOf(address(revenueManager)) - revMgrBefore, 1 ether);
    }

    function test_acceptDelivery_revertNotOracle() public {
        _createEscrow();
        _submitWork();

        vm.prank(buyer);
        vm.expectRevert("Only oracle");
        escrow.acceptDelivery(escrowId);
    }

    function test_acceptDelivery_revertNotSubmitted() public {
        _createEscrow();

        vm.prank(oracle);
        vm.expectRevert("Not submitted");
        escrow.acceptDelivery(escrowId);
    }

    // ============ RELEASE ============

    function test_release_byBuyerAfterSubmit() public {
        _createEscrow();
        _submitWork();

        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.release(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));
        assertEq(usdc.balanceOf(seller) - sellerBefore, 99 ether);
    }

    function test_release_revertBuyerBeforeSubmit() public {
        _createEscrow();

        vm.prank(buyer);
        vm.expectRevert("Not submitted");
        escrow.release(escrowId);
    }

    function test_release_byOracleAfterDisputeWindow() public {
        _createEscrow();
        _submitWork();

        // Fast forward past dispute window (48 hours)
        vm.warp(block.timestamp + 49 hours);

        vm.prank(oracle);
        escrow.release(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));
    }

    function test_release_revertOracleDuringDisputeWindow() public {
        _createEscrow();
        _submitWork();

        // Still within dispute window
        vm.prank(oracle);
        vm.expectRevert("Dispute window active");
        escrow.release(escrowId);
    }

    function test_release_oracleImmediate_zeroDisputeWindow() public {
        // Create escrow with 0 dispute window
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 0);
        vm.stopPrank();

        vm.prank(oracle);
        escrow.submitWork(escrowId, keccak256("deliverable"));

        // Oracle can release immediately with 0 dispute window
        vm.prank(oracle);
        escrow.release(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.RELEASED));
    }

    // ============ DISPUTE ============

    function test_dispute() public {
        _createEscrow();
        _submitWork();

        vm.prank(buyer);
        escrow.dispute(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.DISPUTED));
    }

    function test_dispute_revertAfterWindow() public {
        _createEscrow();
        _submitWork();

        // Fast forward past dispute window
        vm.warp(block.timestamp + 49 hours);

        vm.prank(buyer);
        vm.expectRevert("Dispute window closed");
        escrow.dispute(escrowId);
    }

    function test_dispute_revertNotBuyer() public {
        _createEscrow();
        _submitWork();

        vm.prank(seller);
        vm.expectRevert("Only buyer");
        escrow.dispute(escrowId);
    }

    function test_dispute_revertZeroDisputeWindow() public {
        // Create escrow with 0 dispute window — disputes not allowed
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 0);
        vm.stopPrank();

        vm.prank(oracle);
        escrow.submitWork(escrowId, keccak256("deliverable"));

        vm.prank(buyer);
        vm.expectRevert("Disputes not allowed");
        escrow.dispute(escrowId);
    }

    // ============ RESOLVE DISPUTE ============

    function test_resolveDispute_releaseToSeller() public {
        _createEscrow();
        _submitWork();
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
        _submitWork();
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
        _submitWork();
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
        _submitWork();
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

    // ============ ASSIGN SELLER ============

    function test_assignSeller() public {
        // Create escrow with no seller
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, address(0), address(usdc), amount, 168, 48);
        vm.stopPrank();

        vm.prank(oracle);
        escrow.assignSeller(escrowId, seller);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(e.seller, seller);
    }

    function test_assignSeller_revertAfterDeadline() public {
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, address(0), address(usdc), amount, 168, 48);
        vm.stopPrank();

        vm.warp(block.timestamp + 169 hours);

        vm.prank(oracle);
        vm.expectRevert("Deadline passed");
        escrow.assignSeller(escrowId, seller);
    }

    // ============ CANCEL UNASSIGNED ============

    function test_cancelUnassigned() public {
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, address(0), address(usdc), amount, 168, 48);
        vm.stopPrank();

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        escrow.cancelUnassigned(escrowId);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(uint8(e.state), uint8(DatalayerEscrow.EscrowState.REFUNDED));
        assertEq(usdc.balanceOf(buyer) - buyerBefore, amount);
    }

    function test_cancelUnassigned_revertSellerAssigned() public {
        _createEscrow(); // has seller assigned

        vm.prank(buyer);
        vm.expectRevert("Seller already assigned");
        escrow.cancelUnassigned(escrowId);
    }

    // ============ ASSIGN SELLER AND ADJUST ============

    function test_assignSellerAndAdjust() public {
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, address(0), address(usdc), amount, 168, 48);
        vm.stopPrank();

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(oracle);
        escrow.assignSellerAndAdjust(escrowId, seller, 80 ether);

        DatalayerEscrow.Escrow memory e = escrow.getEscrow(escrowId);
        assertEq(e.seller, seller);
        assertEq(e.amount, 80 ether);
        // Buyer gets 20 ether refund
        assertEq(usdc.balanceOf(buyer) - buyerBefore, 20 ether);
    }

    // ============ VIEW FUNCTIONS ============

    function test_isAutoReleaseReady() public {
        _createEscrow();
        _submitWork();

        assertFalse(escrow.isAutoReleaseReady(escrowId));

        // Fast forward past dispute window
        vm.warp(block.timestamp + 49 hours);

        assertTrue(escrow.isAutoReleaseReady(escrowId));
    }

    function test_isAutoReleaseReady_zeroWindow() public {
        uint256 amount = 100 ether;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.createEscrow(escrowId, seller, address(usdc), amount, 168, 0);
        vm.stopPrank();

        vm.prank(oracle);
        escrow.submitWork(escrowId, keccak256("deliverable"));

        // Immediately ready with 0 window
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

    function _submitWork() internal {
        vm.prank(seller);
        escrow.submitWork(escrowId, keccak256("deliverable"));
    }

    function _dispute() internal {
        vm.prank(buyer);
        escrow.dispute(escrowId);
    }
}

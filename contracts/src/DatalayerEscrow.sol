// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DatalayerEscrow
/// @notice On-chain escrow contract for the Datalayer Market agent marketplace on BSC
/// @dev Supports multi-token (USDC + USDT), configurable fees, split dispute resolution,
///      oracle-controlled release, zero-seller creation, and atomic seller assignment.
contract DatalayerEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ CONSTANTS ============

    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant ORACLE_CHANGE_DELAY = 24 hours;
    uint256 public constant MAX_FEE_BPS = 500; // 5% max fee

    // ============ STATE ============

    uint256 public feeBasisPoints; // Default 100 (1%)
    address public revenueManager;
    address public oracle;
    address public pendingOracle;
    uint256 public oracleChangeTimestamp;

    // Whitelisted tokens (USDC, USDT on BSC)
    mapping(address => bool) public allowedTokens;

    enum EscrowState { NONE, FUNDED, SUBMITTED, DISPUTED, RELEASED, REFUNDED }

    struct Escrow {
        address buyer;
        address seller;
        address token;
        uint256 amount;
        uint256 createdAt;
        uint256 deadline;
        uint256 submittedAt;
        uint256 disputeWindowHours;
        bytes32 deliverableHash;
        EscrowState state;
    }

    mapping(bytes32 => Escrow) public escrows;

    // ============ EVENTS ============

    event EscrowCreated(
        bytes32 indexed refId,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount,
        uint256 deadline,
        uint256 disputeWindowHours
    );
    event WorkSubmitted(bytes32 indexed refId, uint256 submittedAt, bytes32 deliverableHash);
    event DeliveryAccepted(bytes32 indexed refId, uint256 sellerAmount, uint256 feeAmount);
    event EscrowDisputed(bytes32 indexed refId, address disputedBy);
    event EscrowReleased(bytes32 indexed refId, uint256 sellerAmount, uint256 feeAmount);
    event EscrowRefunded(bytes32 indexed refId, uint256 amount);
    event EscrowSplitResolved(bytes32 indexed refId, uint256 sellerAmount, uint256 buyerAmount, uint256 feeAmount);
    event SellerAssigned(bytes32 indexed refId, address indexed seller);
    event EscrowAdjusted(bytes32 indexed refId, uint256 oldAmount, uint256 newAmount);
    event OracleChangeInitiated(address indexed currentOracle, address indexed pendingOracle, uint256 effectiveTime);
    event OracleChangeCompleted(address indexed oldOracle, address indexed newOracle);
    event OracleChangeCancelled(address indexed cancelledOracle);
    event RevenueManagerUpdated(address indexed oldManager, address indexed newManager);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event TokenAllowed(address indexed token, bool allowed);
    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);

    // ============ MODIFIERS ============

    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }

    modifier onlyBuyerOrOracle(bytes32 refId) {
        require(
            msg.sender == escrows[refId].buyer || msg.sender == oracle,
            "Only buyer or oracle"
        );
        _;
    }

    modifier onlySellerOrOracle(bytes32 refId) {
        require(
            msg.sender == escrows[refId].seller || msg.sender == oracle,
            "Only seller or oracle"
        );
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _revenueManager,
        address _oracle,
        uint256 _feeBasisPoints,
        address[] memory _allowedTokens
    ) Ownable(msg.sender) {
        require(_revenueManager != address(0), "Invalid revenue manager");
        require(_oracle != address(0), "Invalid oracle");
        require(_feeBasisPoints <= MAX_FEE_BPS, "Fee too high");

        revenueManager = _revenueManager;
        oracle = _oracle;
        feeBasisPoints = _feeBasisPoints;

        for (uint256 i = 0; i < _allowedTokens.length; i++) {
            require(_allowedTokens[i] != address(0), "Invalid token");
            allowedTokens[_allowedTokens[i]] = true;
            emit TokenAllowed(_allowedTokens[i], true);
        }
    }

    // ============ ESCROW FUNCTIONS ============

    /// @notice Create escrow — buyer locks funds in contract
    /// @param refId Unique reference identifier (e.g. jobId, taskId converted to bytes32)
    /// @param seller Worker/seller agent address (address(0) allowed for deferred assignment)
    /// @param token ERC20 token address (USDC or USDT)
    /// @param amount Token amount (18 decimals on BSC)
    /// @param deadlineHours Hours until deadline (1-720)
    /// @param disputeWindowHours Hours for dispute window after delivery (1-168)
    function createEscrow(
        bytes32 refId,
        address seller,
        address token,
        uint256 amount,
        uint256 deadlineHours,
        uint256 disputeWindowHours
    ) external nonReentrant whenNotPaused {
        require(escrows[refId].state == EscrowState.NONE, "Escrow exists");
        // seller=address(0) is allowed (deferred assignment via assignSeller)
        if (seller != address(0)) {
            require(seller != msg.sender, "Cannot escrow to self");
        }
        require(amount > 0, "Amount must be > 0");
        require(allowedTokens[token], "Token not allowed");
        require(deadlineHours > 0 && deadlineHours <= 720, "Deadline 1-720 hours");
        require(disputeWindowHours <= 168, "Dispute window 0-168 hours");

        escrows[refId] = Escrow({
            buyer: msg.sender,
            seller: seller,
            token: token,
            amount: amount,
            createdAt: block.timestamp,
            deadline: block.timestamp + (deadlineHours * 1 hours),
            submittedAt: 0,
            disputeWindowHours: disputeWindowHours,
            deliverableHash: bytes32(0),
            state: EscrowState.FUNDED
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit EscrowCreated(refId, msg.sender, seller, token, amount, escrows[refId].deadline, disputeWindowHours);
    }

    /// @notice Cancel an unassigned escrow — buyer can reclaim funds immediately when no seller assigned
    /// @param refId The escrow reference identifier
    function cancelUnassigned(bytes32 refId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[refId];
        require(msg.sender == escrow.buyer, "Only buyer");
        require(escrow.state == EscrowState.FUNDED, "Not funded");
        require(escrow.seller == address(0), "Seller already assigned");

        escrow.state = EscrowState.REFUNDED;

        IERC20(escrow.token).safeTransfer(escrow.buyer, escrow.amount);

        emit EscrowRefunded(refId, escrow.amount);
    }

    /// @notice Assign seller — oracle assigns a seller to an unassigned escrow
    /// @param refId The escrow reference identifier
    /// @param seller The seller/worker address to assign
    function assignSeller(
        bytes32 refId,
        address seller
    ) external nonReentrant whenNotPaused onlyOracle {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.FUNDED, "Not funded");
        require(escrow.seller == address(0), "Seller already assigned");
        require(seller != address(0), "Invalid seller");
        require(seller != escrow.buyer, "Seller cannot be buyer");
        require(block.timestamp <= escrow.deadline, "Deadline passed");

        escrow.seller = seller;

        emit SellerAssigned(refId, seller);
    }

    /// @notice Assign seller and adjust amount atomically — oracle assigns seller and optionally
    ///         reduces escrow amount (refunding difference to buyer) in a single transaction
    /// @param refId The escrow reference identifier
    /// @param seller The seller/worker address to assign
    /// @param newAmount The new escrow amount (must be > 0 and <= current amount)
    function assignSellerAndAdjust(
        bytes32 refId,
        address seller,
        uint256 newAmount
    ) external nonReentrant whenNotPaused onlyOracle {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.FUNDED, "Not funded");
        require(escrow.seller == address(0), "Seller already assigned");
        require(seller != address(0), "Invalid seller");
        require(seller != escrow.buyer, "Seller cannot be buyer");
        require(block.timestamp <= escrow.deadline, "Deadline passed");
        require(newAmount > 0, "Amount must be > 0");
        require(newAmount <= escrow.amount, "Amount exceeds escrow");

        // Adjust amount if needed (refund difference to buyer)
        if (newAmount < escrow.amount) {
            uint256 refundAmount = escrow.amount - newAmount;
            uint256 oldAmount = escrow.amount;
            escrow.amount = newAmount;
            IERC20(escrow.token).safeTransfer(escrow.buyer, refundAmount);
            emit EscrowAdjusted(refId, oldAmount, newAmount);
        }

        // Assign seller
        escrow.seller = seller;
        emit SellerAssigned(refId, seller);
    }

    /// @notice Submit work — seller or oracle marks work as submitted
    /// @param refId The escrow reference identifier
    /// @param deliverableHash Hash of the delivered content for on-chain proof
    function submitWork(
        bytes32 refId,
        bytes32 deliverableHash
    ) external whenNotPaused onlySellerOrOracle(refId) {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.FUNDED, "Not funded");
        require(escrow.seller != address(0), "No seller assigned");
        require(block.timestamp <= escrow.deadline, "Deadline passed");

        escrow.submittedAt = block.timestamp;
        escrow.deliverableHash = deliverableHash;
        escrow.state = EscrowState.SUBMITTED;

        emit WorkSubmitted(refId, block.timestamp, deliverableHash);
    }

    /// @notice Dispute — buyer can call within dispute window after work submission
    /// @dev disputeWindowHours == 0 means no dispute allowed (instant release escrow)
    /// @param refId The escrow reference identifier
    function dispute(bytes32 refId) external nonReentrant whenNotPaused {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.SUBMITTED, "Not submitted");
        require(msg.sender == escrow.buyer, "Only buyer");
        require(escrow.disputeWindowHours > 0, "Disputes not allowed");
        require(
            block.timestamp <= escrow.submittedAt + (escrow.disputeWindowHours * 1 hours),
            "Dispute window closed"
        );

        escrow.state = EscrowState.DISPUTED;

        emit EscrowDisputed(refId, msg.sender);
    }

    /// @notice Accept delivery — oracle releases immediately when buyer explicitly accepts
    /// @dev Bypasses dispute window. Only callable by oracle (buyer acceptance is verified off-chain).
    /// @param refId The escrow reference identifier
    function acceptDelivery(bytes32 refId) external nonReentrant whenNotPaused onlyOracle {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.SUBMITTED, "Not submitted");
        require(escrow.seller != address(0), "No seller assigned");

        escrow.state = EscrowState.RELEASED;

        uint256 fee = (escrow.amount * feeBasisPoints) / BASIS_POINTS;
        uint256 sellerAmount = escrow.amount - fee;

        IERC20(escrow.token).safeTransfer(escrow.seller, sellerAmount);
        if (fee > 0) {
            IERC20(escrow.token).safeTransfer(revenueManager, fee);
        }

        emit DeliveryAccepted(refId, sellerAmount, fee);
    }

    /// @notice Release — buyer can release after work is submitted, oracle after dispute window (cron)
    /// @dev Buyer release bypasses dispute window (explicit acceptance from their wallet).
    ///      Oracle release enforces dispute window (auto-release via cron).
    /// @param refId The escrow reference identifier
    function release(bytes32 refId) external nonReentrant whenNotPaused onlyBuyerOrOracle(refId) {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.SUBMITTED, "Not submitted");
        require(escrow.seller != address(0), "No seller assigned");

        // Oracle can only auto-release after dispute window
        if (msg.sender == oracle) {
            require(
                escrow.disputeWindowHours == 0 ||
                block.timestamp > escrow.submittedAt + (escrow.disputeWindowHours * 1 hours),
                "Dispute window active"
            );
        }

        escrow.state = EscrowState.RELEASED;

        uint256 fee = (escrow.amount * feeBasisPoints) / BASIS_POINTS;
        uint256 sellerAmount = escrow.amount - fee;

        IERC20(escrow.token).safeTransfer(escrow.seller, sellerAmount);
        if (fee > 0) {
            IERC20(escrow.token).safeTransfer(revenueManager, fee);
        }

        emit EscrowReleased(refId, sellerAmount, fee);
    }

    /// @notice Refund — buyer (after deadline if not delivered) or oracle anytime
    /// @param refId The escrow reference identifier
    function refund(bytes32 refId) external nonReentrant whenNotPaused onlyBuyerOrOracle(refId) {
        Escrow storage escrow = escrows[refId];
        require(
            escrow.state == EscrowState.FUNDED ||
            escrow.state == EscrowState.SUBMITTED ||
            escrow.state == EscrowState.DISPUTED,
            "Cannot refund"
        );

        // Buyer-specific restrictions
        if (msg.sender == escrow.buyer) {
            if (escrow.state == EscrowState.FUNDED) {
                require(block.timestamp > escrow.deadline, "Deadline not passed");
            } else if (escrow.state == EscrowState.SUBMITTED) {
                revert("Must dispute first");
            }
            if (escrow.state == EscrowState.DISPUTED) {
                revert("Awaiting dispute resolution");
            }
        }

        escrow.state = EscrowState.REFUNDED;

        IERC20(escrow.token).safeTransfer(escrow.buyer, escrow.amount);

        emit EscrowRefunded(refId, escrow.amount);
    }

    /// @notice Resolve dispute — oracle decides binary release or refund
    /// @param refId The escrow reference identifier
    /// @param releaseToSeller true = release to seller, false = refund to buyer
    function resolveDispute(
        bytes32 refId,
        bool releaseToSeller
    ) external nonReentrant whenNotPaused onlyOracle {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.DISPUTED, "Not disputed");
        require(escrow.seller != address(0), "No seller assigned");

        if (releaseToSeller) {
            escrow.state = EscrowState.RELEASED;

            uint256 fee = (escrow.amount * feeBasisPoints) / BASIS_POINTS;
            uint256 sellerAmount = escrow.amount - fee;

            IERC20(escrow.token).safeTransfer(escrow.seller, sellerAmount);
            if (fee > 0) {
                IERC20(escrow.token).safeTransfer(revenueManager, fee);
            }

            emit EscrowReleased(refId, sellerAmount, fee);
        } else {
            escrow.state = EscrowState.REFUNDED;
            IERC20(escrow.token).safeTransfer(escrow.buyer, escrow.amount);
            emit EscrowRefunded(refId, escrow.amount);
        }
    }

    /// @notice Resolve dispute with split — oracle splits funds between buyer and seller
    /// @param refId The escrow reference identifier
    /// @param sellerBps Basis points (0-10000) to allocate to seller
    function resolveDisputeSplit(
        bytes32 refId,
        uint256 sellerBps
    ) external nonReentrant whenNotPaused onlyOracle {
        Escrow storage escrow = escrows[refId];
        require(escrow.state == EscrowState.DISPUTED, "Not disputed");
        require(escrow.seller != address(0), "No seller assigned");
        require(sellerBps <= BASIS_POINTS, "Invalid split");

        escrow.state = EscrowState.RELEASED;

        uint256 sellerGross = (escrow.amount * sellerBps) / BASIS_POINTS;
        uint256 buyerAmount = escrow.amount - sellerGross;

        // Fee only on seller portion
        uint256 fee = (sellerGross * feeBasisPoints) / BASIS_POINTS;
        uint256 sellerNet = sellerGross - fee;

        if (sellerNet > 0) {
            IERC20(escrow.token).safeTransfer(escrow.seller, sellerNet);
        }
        if (buyerAmount > 0) {
            IERC20(escrow.token).safeTransfer(escrow.buyer, buyerAmount);
        }
        if (fee > 0) {
            IERC20(escrow.token).safeTransfer(revenueManager, fee);
        }

        emit EscrowSplitResolved(refId, sellerNet, buyerAmount, fee);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Check if auto-release is ready (used by oracle cron)
    function isAutoReleaseReady(bytes32 refId) external view returns (bool) {
        Escrow storage escrow = escrows[refId];
        if (escrow.state != EscrowState.SUBMITTED) return false;
        if (escrow.disputeWindowHours == 0) return true;
        return block.timestamp > escrow.submittedAt + (escrow.disputeWindowHours * 1 hours);
    }

    /// @notice Check if refund is ready (deadline passed, not delivered)
    function isRefundReady(bytes32 refId) external view returns (bool) {
        Escrow storage escrow = escrows[refId];
        if (escrow.state != EscrowState.FUNDED) return false;
        return block.timestamp > escrow.deadline;
    }

    /// @notice Get full escrow details
    function getEscrow(bytes32 refId) external view returns (Escrow memory) {
        return escrows[refId];
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Update platform fee (capped at MAX_FEE_BPS)
    function setFee(uint256 _feeBasisPoints) external onlyOwner {
        require(_feeBasisPoints <= MAX_FEE_BPS, "Fee too high");
        emit FeeUpdated(feeBasisPoints, _feeBasisPoints);
        feeBasisPoints = _feeBasisPoints;
    }

    /// @notice Update revenue manager address
    function setRevenueManager(address _revenueManager) external onlyOwner {
        require(_revenueManager != address(0), "Invalid address");
        emit RevenueManagerUpdated(revenueManager, _revenueManager);
        revenueManager = _revenueManager;
    }

    /// @notice Add or remove allowed token
    function setAllowedToken(address _token, bool _allowed) external onlyOwner {
        require(_token != address(0), "Invalid token");
        allowedTokens[_token] = _allowed;
        emit TokenAllowed(_token, _allowed);
    }

    /// @notice Initiate oracle change (24 hour delay)
    function initiateOracleChange(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "Invalid oracle");
        require(_newOracle != oracle, "Same oracle");

        pendingOracle = _newOracle;
        oracleChangeTimestamp = block.timestamp + ORACLE_CHANGE_DELAY;

        emit OracleChangeInitiated(oracle, _newOracle, oracleChangeTimestamp);
    }

    /// @notice Complete oracle change after delay
    function completeOracleChange() external onlyOwner {
        require(pendingOracle != address(0), "No pending oracle");
        require(block.timestamp >= oracleChangeTimestamp, "Delay not passed");

        address oldOracle = oracle;
        oracle = pendingOracle;
        pendingOracle = address(0);
        oracleChangeTimestamp = 0;

        emit OracleChangeCompleted(oldOracle, oracle);
    }

    /// @notice Cancel pending oracle change
    function cancelOracleChange() external onlyOwner {
        require(pendingOracle != address(0), "No pending oracle");
        address cancelled = pendingOracle;
        pendingOracle = address(0);
        oracleChangeTimestamp = 0;
        emit OracleChangeCancelled(cancelled);
    }

    /// @notice Pause contract in emergency
    function pause() external onlyOwner {
        _pause();
        emit ContractPaused(msg.sender);
    }

    /// @notice Unpause contract
    function unpause() external onlyOwner {
        _unpause();
        emit ContractUnpaused(msg.sender);
    }
}

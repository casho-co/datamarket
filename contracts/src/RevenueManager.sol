// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RevenueManager
/// @notice Collects platform fees from DatalayerEscrow and distributes to configured recipients
/// @dev Recipients and their share (in basis points) are configurable by owner
contract RevenueManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BASIS_POINTS = 10000;

    struct Recipient {
        address addr;
        uint256 shareBps; // Share in basis points (e.g. 7000 = 70%)
        string label;     // Human-readable label (e.g. "treasury", "buyback")
    }

    Recipient[] public recipients;
    address[] public allowedTokens;

    // Track total distributed per token
    mapping(address => uint256) public totalDistributed;

    // ============ EVENTS ============

    event RecipientsUpdated(uint256 count);
    event Distributed(address indexed token, uint256 totalAmount);
    event RecipientPaid(address indexed recipient, address indexed token, uint256 amount, string label);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    // ============ CONSTRUCTOR ============

    constructor(
        address[] memory _tokens
    ) Ownable(msg.sender) {
        for (uint256 i = 0; i < _tokens.length; i++) {
            allowedTokens.push(_tokens[i]);
            emit TokenAdded(_tokens[i]);
        }
    }

    // ============ CORE FUNCTIONS ============

    /// @notice Distribute all token balances to configured recipients
    /// @param token The ERC20 token to distribute
    function distribute(address token) external nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance to distribute");
        require(recipients.length > 0, "No recipients configured");

        uint256 distributed = 0;

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 share;
            if (i == recipients.length - 1) {
                // Last recipient gets remainder to avoid rounding dust
                share = balance - distributed;
            } else {
                share = (balance * recipients[i].shareBps) / BASIS_POINTS;
            }

            if (share > 0) {
                IERC20(token).safeTransfer(recipients[i].addr, share);
                emit RecipientPaid(recipients[i].addr, token, share, recipients[i].label);
            }
            distributed += share;
        }

        totalDistributed[token] += distributed;
        emit Distributed(token, distributed);
    }

    /// @notice Distribute all tracked tokens at once
    function distributeAll() external {
        for (uint256 i = 0; i < allowedTokens.length; i++) {
            uint256 balance = IERC20(allowedTokens[i]).balanceOf(address(this));
            if (balance > 0) {
                this.distribute(allowedTokens[i]);
            }
        }
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Get balance of a token held by this contract
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Get all recipients
    function getRecipients() external view returns (Recipient[] memory) {
        return recipients;
    }

    /// @notice Get count of recipients
    function getRecipientCount() external view returns (uint256) {
        return recipients.length;
    }

    /// @notice Get all tracked tokens
    function getAllowedTokens() external view returns (address[] memory) {
        return allowedTokens;
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Set recipients and their shares (must total 10000 BPS)
    /// @param _addrs Recipient addresses
    /// @param _sharesBps Share in basis points per recipient
    /// @param _labels Human-readable labels
    function setRecipients(
        address[] calldata _addrs,
        uint256[] calldata _sharesBps,
        string[] calldata _labels
    ) external onlyOwner {
        require(_addrs.length == _sharesBps.length, "Length mismatch");
        require(_addrs.length == _labels.length, "Length mismatch");
        require(_addrs.length > 0, "Empty recipients");

        uint256 totalBps = 0;
        for (uint256 i = 0; i < _sharesBps.length; i++) {
            require(_addrs[i] != address(0), "Invalid address");
            require(_sharesBps[i] > 0, "Share must be > 0");
            totalBps += _sharesBps[i];
        }
        require(totalBps == BASIS_POINTS, "Shares must total 10000");

        // Clear existing
        delete recipients;

        for (uint256 i = 0; i < _addrs.length; i++) {
            recipients.push(Recipient({
                addr: _addrs[i],
                shareBps: _sharesBps[i],
                label: _labels[i]
            }));
        }

        emit RecipientsUpdated(_addrs.length);
    }

    /// @notice Add a tracked token
    function addToken(address _token) external onlyOwner {
        require(_token != address(0), "Invalid token");
        allowedTokens.push(_token);
        emit TokenAdded(_token);
    }

    /// @notice Remove a tracked token by index
    function removeToken(uint256 index) external onlyOwner {
        require(index < allowedTokens.length, "Invalid index");
        address removed = allowedTokens[index];
        allowedTokens[index] = allowedTokens[allowedTokens.length - 1];
        allowedTokens.pop();
        emit TokenRemoved(removed);
    }

    /// @notice Emergency withdraw — owner only
    function emergencyWithdraw(address _token, uint256 _amount, address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyWithdraw(_token, _amount, _to);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BuybackHandler
/// @notice Receives portion of platform fees and executes token buybacks via PancakeSwap V3 on BSC
/// @dev Called by RevenueManager or authorized operators
contract BuybackHandler is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // PancakeSwap V3 SwapRouter interface (subset)
    interface ISwapRouter {
        struct ExactInputSingleParams {
            address tokenIn;
            address tokenOut;
            uint24 fee;
            address recipient;
            uint256 amountIn;
            uint256 amountOutMinimum;
            uint160 sqrtPriceLimitX96;
        }

        function exactInputSingle(
            ExactInputSingleParams calldata params
        ) external payable returns (uint256 amountOut);
    }

    // ============ STATE ============

    ISwapRouter public router;
    address public protocolToken; // Token to buy back
    uint24 public poolFee;        // PancakeSwap pool fee tier (e.g. 2500 = 0.25%)

    mapping(address => bool) public authorizedCallers;

    // Track buyback stats
    uint256 public totalBuybacks;
    mapping(address => uint256) public totalBoughtBack; // token => total amount bought

    // ============ EVENTS ============

    event BuybackExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event ProtocolTokenUpdated(address indexed oldToken, address indexed newToken);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event PoolFeeUpdated(uint24 oldFee, uint24 newFee);
    event CallerAuthorized(address indexed caller, bool authorized);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    // ============ MODIFIERS ============

    modifier onlyAuthorized() {
        require(authorizedCallers[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address _router,
        address _protocolToken,
        uint24 _poolFee
    ) Ownable(msg.sender) {
        require(_router != address(0), "Invalid router");
        require(_protocolToken != address(0), "Invalid protocol token");

        router = ISwapRouter(_router);
        protocolToken = _protocolToken;
        poolFee = _poolFee;
    }

    // ============ CORE FUNCTIONS ============

    /// @notice Execute buyback — swap input token for protocol token via PancakeSwap
    /// @param tokenIn The input token (USDC/USDT from fees)
    /// @param amountIn Amount of input token to swap
    /// @param minAmountOut Minimum output to accept (slippage protection)
    function executeBuyback(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant onlyAuthorized returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        require(protocolToken != address(0), "Protocol token not set");

        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        require(balance >= amountIn, "Insufficient balance");

        // Approve router
        IERC20(tokenIn).safeIncreaseAllowance(address(router), amountIn);

        // Execute swap
        amountOut = router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: protocolToken,
                fee: poolFee,
                recipient: address(this), // Bought tokens stay in this contract
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );

        totalBuybacks++;
        totalBoughtBack[protocolToken] += amountOut;

        emit BuybackExecuted(tokenIn, protocolToken, amountIn, amountOut);
    }

    // ============ VIEW FUNCTIONS ============

    /// @notice Get balance of a token
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ============ ADMIN FUNCTIONS ============

    /// @notice Set protocol token to buy back
    function setProtocolToken(address _protocolToken) external onlyOwner {
        require(_protocolToken != address(0), "Invalid token");
        emit ProtocolTokenUpdated(protocolToken, _protocolToken);
        protocolToken = _protocolToken;
    }

    /// @notice Set PancakeSwap router
    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        emit RouterUpdated(address(router), _router);
        router = ISwapRouter(_router);
    }

    /// @notice Set pool fee tier
    function setPoolFee(uint24 _poolFee) external onlyOwner {
        emit PoolFeeUpdated(poolFee, _poolFee);
        poolFee = _poolFee;
    }

    /// @notice Authorize or revoke a caller
    function setAuthorizedCaller(address _caller, bool _authorized) external onlyOwner {
        require(_caller != address(0), "Invalid caller");
        authorizedCallers[_caller] = _authorized;
        emit CallerAuthorized(_caller, _authorized);
    }

    /// @notice Emergency withdraw stuck tokens
    function withdrawStuck(address _token, uint256 _amount, address _to) external onlyOwner {
        require(_to != address(0), "Invalid address");
        IERC20(_token).safeTransfer(_to, _amount);
        emit EmergencyWithdraw(_token, _amount, _to);
    }
}

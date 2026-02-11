// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 }    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable }   from "@openzeppelin/contracts/access/Ownable.sol";

/*//////////////////////////////////////////////////////////////
                        ROUTER INTERFACE
//////////////////////////////////////////////////////////////*/

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

/*//////////////////////////////////////////////////////////////
                            TAX VAULT
//////////////////////////////////////////////////////////////*/

/// @title  TaxVault
/// @notice Collects MMM tax revenue, splits it according to BPS
///         weights, burns a portion, and swaps the remainder into
///         USDC before distributing to downstream vaults.
contract TaxVault is Ownable {
    using SafeERC20 for IERC20;

    // ─── ERRORS ───────────────────────────────────────────────

    error ZeroAddress();
    error NotWired();
    error AmountZero();
    error RouterMissing();
    error OnlyOwnerOrKeeper();
    error ProcessingDisabled();

    // ─── CONSTANTS ────────────────────────────────────────────

    /// @dev 100 % expressed in basis-points.
    uint256 public constant BPS  = 10_000;
    /// @dev Tokens sent here are effectively destroyed.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ─── IMMUTABLES ───────────────────────────────────────────

    IERC20 public immutable mmm;   // protocol native token (input)
    IERC20 public immutable usdc;  // stable coin (payout denomination)
    IERC20 public immutable wmon;  // wrapped native (mid-hop on mainnet)

    // ─── WIRING (set once by owner) ───────────────────────────

    address public rewardVault;
    address public boostVault;
    address public swapVault;          // reserved for future use
    address public marketingVault;
    address public teamVestingVault;

    // ─── EXTERNAL DEPS ────────────────────────────────────────

    address public router;             // Uniswap V2-compatible router
    address public keeper;             // off-chain automation wallet

    // ─── EMERGENCY CONTROL ────────────────────────────────────

    /// @notice Emergency kill-switch for processing functionality.
    ///         When false, process() will revert.
    bool public processingEnabled = true;

    // ─── SPLIT WEIGHTS (basis-points) ─────────────────────────
    //
    // MMM-denominated (applied to mmmAmount)
    //   Reward   40 %  → rewardVault  (MMM)
    //   Burn     10 %  → DEAD         (MMM)
    //   Remainder 50 % → swapped to USDC, then split below
    //
    // USDC-denominated (relative weights applied to usdcOut)
    //   Boost  2500 / 3500  ≈ 71.4 %
    //   Mkt     700 / 3500  ≈ 20.0 %
    //   Team    300 / 3500  ≈  8.6 %  ← receives dust remainder
    //

    uint16 public bpsReward = 4000;
    uint16 public bpsBoost  = 2500;
    uint16 public bpsBurn   = 1000;
    uint16 public bpsMkt    =  700;
    uint16 public bpsTeam   =  300;

    // ─── SWAP PATH MODE ───────────────────────────────────────

    /// @dev true  → MMM → USDC          (testnet / mock)
    ///      false → MMM → WMON → USDC   (mainnet)
    bool public useDirectUsdcPath = true;

    // ─── EVENTS ───────────────────────────────────────────────

    event Wired(
        address indexed rewardVault,
        address indexed boostVault,
        address         swapVault,
        address indexed marketingVault,
        address         teamVestingVault
    );

    event RouterSet(address indexed router);
    event RouterApproved(address indexed router);
    event KeeperSet(address indexed keeper);
    event PathModeSet(bool directUsdc);
    event ProcessingEnabledSet(bool enabled);

    event Processed(
        uint256 mmmIn,
        uint256 mmmToReward,
        uint256 mmmToBurn,
        uint256 mmmSwappedForUsdc,
        uint256 usdcOut,
        uint256 usdcToBoost,
        uint256 usdcToMkt,
        uint256 usdcToTeam
    );

    // ─── CONSTRUCTOR ──────────────────────────────────────────

    constructor(
        address mmmToken,
        address usdcToken,
        address wmonToken,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            mmmToken     == address(0) ||
            usdcToken    == address(0) ||
            wmonToken    == address(0) ||
            initialOwner == address(0)
        ) revert ZeroAddress();

        mmm  = IERC20(mmmToken);
        usdc = IERC20(usdcToken);
        wmon = IERC20(wmonToken);
    }

    // ─── MODIFIERS ────────────────────────────────────────────

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper)
            revert OnlyOwnerOrKeeper();
        _;
    }

    // ─── ADMIN ────────────────────────────────────────────────

    /// @notice Set the Uniswap V2 router address.
    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    /// @notice Grant the router an unlimited MMM allowance.
    ///         Call after setRouter.
    function approveRouter() external onlyOwner {
        if (router == address(0)) revert RouterMissing();
        mmm.forceApprove(router, type(uint256).max);
        emit RouterApproved(router);
    }

    /// @notice Set the keeper (automation) wallet.
    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Toggle between 2-hop and 3-hop swap path.
    function setUseDirectUsdcPath(bool v) external onlyOwner {
        useDirectUsdcPath = v;
        emit PathModeSet(v);
    }

    /// @notice Emergency control: enable or disable processing.
    ///         When disabled, process() will revert.
    /// @param enabled True to enable processing, false to disable.
    function setProcessingEnabled(bool enabled) external onlyOwner {
        processingEnabled = enabled;
        emit ProcessingEnabledSet(enabled);
    }

    /// @notice Wire all downstream vault addresses (all must be non-zero).
    function wireOnce(
        address rewardVault_,
        address boostVault_,
        address swapVault_,
        address marketingVault_,
        address teamVestingVault_
    ) external onlyOwner {
        if (
            rewardVault_      == address(0) ||
            boostVault_       == address(0) ||
            swapVault_        == address(0) ||
            marketingVault_   == address(0) ||
            teamVestingVault_ == address(0)
        ) revert ZeroAddress();

        rewardVault      = rewardVault_;
        boostVault       = boostVault_;
        swapVault        = swapVault_;
        marketingVault   = marketingVault_;
        teamVestingVault = teamVestingVault_;

        emit Wired(
            rewardVault_,
            boostVault_,
            swapVault_,
            marketingVault_,
            teamVestingVault_
        );
    }

    // ─── PROCESS ──────────────────────────────────────────────

    /// @notice Main entry-point: split → burn → swap → distribute.
    ///
    /// @param mmmAmount   Total MMM held by this contract to process.
    /// @param minUsdcOut  Slippage floor for the swap.
    /// @param deadline    Timestamp deadline forwarded to the router.
    function process(
        uint256 mmmAmount,
        uint256 minUsdcOut,
        uint256 deadline
    ) external onlyOwnerOrKeeper {

        // ── emergency control ─────────────────────────────────
        if (!processingEnabled) revert ProcessingDisabled();

        // ── input checks ──────────────────────────────────────
        if (mmmAmount == 0) revert AmountZero();

        if (
            rewardVault      == address(0) ||
            boostVault       == address(0) ||
            swapVault        == address(0) ||
            marketingVault   == address(0) ||
            teamVestingVault == address(0)
        ) revert NotWired();

        // ── 1. MMM splits ─────────────────────────────────────
        uint256 toReward = (mmmAmount * bpsReward) / BPS;   // 40 %
        uint256 toBurn   = (mmmAmount * bpsBurn)   / BPS;   // 10 %
        uint256 toSwap   = mmmAmount - toReward - toBurn;   // 50 %

        mmm.safeTransfer(rewardVault, toReward);
        mmm.safeTransfer(DEAD,        toBurn);

        // ── 2. Swap remaining MMM → USDC ──────────────────────
        uint256 usdcOut = 0;

        if (toSwap > 0) {
            if (router == address(0)) revert RouterMissing();

            // Build swap path.
            //   Direct  : MMM ──────────► USDC
            //   Via WMON: MMM ──► WMON ──► USDC
            address[] memory path;

            if (useDirectUsdcPath) {
                path = new address[](2);
                path[0] = address(mmm);
                path[1] = address(usdc);
            } else {
                path = new address[](3);
                path[0] = address(mmm);
                path[1] = address(wmon);
                path[2] = address(usdc);
            }

            // Snapshot so we get the exact USDC delta regardless
            // of router return-value quirks.
            uint256 balBefore = usdc.balanceOf(address(this));

            IUniswapV2Router02(router).swapExactTokensForTokens(
                toSwap,
                minUsdcOut,
                path,
                address(this),
                deadline
            );

            usdcOut = usdc.balanceOf(address(this)) - balBefore;
        }

        // ── 3. USDC splits (relative weights) ─────────────────
        //   Team receives the dust remainder to avoid rounding loss.
        uint256 denom   = uint256(bpsBoost) + uint256(bpsMkt) + uint256(bpsTeam);

        uint256 toBoost = denom == 0 ? 0 : (usdcOut * bpsBoost) / denom;
        uint256 toMkt   = denom == 0 ? 0 : (usdcOut * bpsMkt)   / denom;
        uint256 toTeam  = usdcOut - toBoost - toMkt;

        if (toBoost > 0) usdc.safeTransfer(boostVault,       toBoost);
        if (toMkt   > 0) usdc.safeTransfer(marketingVault,   toMkt);
        if (toTeam  > 0) usdc.safeTransfer(teamVestingVault, toTeam);

        // ── 4. Full accounting event ──────────────────────────
        emit Processed(
            mmmAmount,
            toReward,
            toBurn,
            toSwap,
            usdcOut,
            toBoost,
            toMkt,
            toTeam
        );
    }
}

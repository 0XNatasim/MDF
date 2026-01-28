// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract TaxVault is Ownable2Step {
    using SafeERC20 for IERC20;

    // ------------------------- Errors -------------------------
    error ZeroAddress();
    error NotWired();
    error InvalidBps();
    error AmountZero();
    error RouterMissing();
    error SwapFailed();
    error OnlyOwnerOrKeeper();

    // ------------------------- Constants -------------------------
    uint256 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ------------------------- Immutables -------------------------
    IERC20 public immutable mmm;
    IERC20 public immutable usdc;
    IERC20 public immutable wmon;

    // ------------------------- Wiring -------------------------
    address public rewardVault;      // receives MMM
    address public boostVault;       // receives USDC
    address public swapVault;        // receives MMM
    address public marketingVault;   // receives USDC
    address public teamVestingVault; // receives USDC

    address public router; // UniswapV2Router02

    // optional keeper (can call process)
    address public keeper;

    // ------------------------- Split config (of tax pot) -------------------------
    // Must sum to 10_000
    uint16 public bpsReward = 4000;     // 40% MMM
    uint16 public bpsBoost  = 2500;     // 25% USDC
    uint16 public bpsLiq    = 1500;     // 15% MMM
    uint16 public bpsBurn   = 1000;     // 10% MMM burn
    uint16 public bpsMkt    = 700;      // 7% USDC
    uint16 public bpsTeam   = 300;      // 3% USDC

    // ------------------------- Events -------------------------
    event Wired(address rewardVault, address boostVault, address swapVault, address marketingVault, address teamVestingVault);
    event RouterSet(address router);
    event KeeperSet(address keeper);
    event SplitSet(uint16 reward, uint16 boost, uint16 liq, uint16 burn, uint16 mkt, uint16 team);

    event Processed(
        uint256 mmmIn,
        uint256 mmmToReward,
        uint256 mmmToLiq,
        uint256 mmmToBurn,
        uint256 mmmSwappedForUsdc,
        uint256 usdcOut,
        uint256 usdcToBoost,
        uint256 usdcToMkt,
        uint256 usdcToTeam
    );

    constructor(
        address mmmToken,
        address usdcToken,
        address wmonToken,
        address initialOwner
    ) Ownable2Step() {
        if (mmmToken == address(0) || usdcToken == address(0) || wmonToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IERC20(mmmToken);
        usdc = IERC20(usdcToken);
        wmon = IERC20(wmonToken);
        _transferOwnership(initialOwner);
    }

    // ------------------------- Admin -------------------------

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function wireOnce(
        address rewardVault_,
        address boostVault_,
        address swapVault_,
        address marketingVault_,
        address teamVestingVault_
    ) external onlyOwner {
        if (
            rewardVault_ == address(0) ||
            boostVault_ == address(0) ||
            swapVault_ == address(0) ||
            marketingVault_ == address(0) ||
            teamVestingVault_ == address(0)
        ) revert ZeroAddress();

        rewardVault = rewardVault_;
        boostVault = boostVault_;
        swapVault = swapVault_;
        marketingVault = marketingVault_;
        teamVestingVault = teamVestingVault_;

        emit Wired(rewardVault_, boostVault_, swapVault_, marketingVault_, teamVestingVault_);
    }

    function setSplitBps(
        uint16 reward_,
        uint16 boost_,
        uint16 liq_,
        uint16 burn_,
        uint16 mkt_,
        uint16 team_
    ) external onlyOwner {
        uint256 sum = uint256(reward_) + boost_ + liq_ + burn_ + mkt_ + team_;
        if (sum != BPS) revert InvalidBps();

        bpsReward = reward_;
        bpsBoost = boost_;
        bpsLiq = liq_;
        bpsBurn = burn_;
        bpsMkt = mkt_;
        bpsTeam = team_;

        emit SplitSet(reward_, boost_, liq_, burn_, mkt_, team_);
    }

    // ------------------------- Views -------------------------

    function mmmBalance() external view returns (uint256) { return mmm.balanceOf(address(this)); }
    function usdcBalance() external view returns (uint256) { return usdc.balanceOf(address(this)); }

    // ------------------------- Processing -------------------------

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper) revert OnlyOwnerOrKeeper();
        _;
    }

    function process(uint256 mmmAmount, uint256 minUsdcOut, uint256 deadline) external onlyOwnerOrKeeper {
        if (mmmAmount == 0) revert AmountZero();
        if (rewardVault == address(0) || boostVault == address(0) || swapVault == address(0) || marketingVault == address(0) || teamVestingVault == address(0)) {
            revert NotWired();
        }

        // compute MMM splits
        uint256 toReward = (mmmAmount * bpsReward) / BPS;
        uint256 toLiq    = (mmmAmount * bpsLiq) / BPS;
        uint256 toBurn   = (mmmAmount * bpsBurn) / BPS;

        // portion to be swapped for USDC (Boost + Marketing + Team)
        uint256 toUsdcMmm = mmmAmount - toReward - toLiq - toBurn;

        // 1) Transfer MMM legs
        mmm.safeTransfer(rewardVault, toReward);
        mmm.safeTransfer(swapVault, toLiq);
        mmm.safeTransfer(DEAD, toBurn);

        uint256 usdcOut = 0;

        // 2) Swap MMM -> USDC for remaining legs
        if (toUsdcMmm > 0) {
            if (router == address(0)) revert RouterMissing();

            // approve router
            mmm.safeIncreaseAllowance(router, toUsdcMmm);

            // Create path array for MMM -> WMON -> USDC swap
            address[] memory path = new address[](3);
            path[0] = address(mmm);
            path[1] = address(wmon);
            path[2] = address(usdc);

            uint256 beforeBal = usdc.balanceOf(address(this));
            uint[] memory amts = IUniswapV2Router02(router).swapExactTokensForTokens(
                toUsdcMmm,
                minUsdcOut,
                path,
                address(this),
                deadline
            );
            // amts[amts.length - 1] is expected output, but we trust balance delta
            uint256 afterBal = usdc.balanceOf(address(this));
            usdcOut = afterBal - beforeBal;

            // (optional) reset allowance to 0 is not necessary, but okay
        }

        // 3) Split USDC output by bps proportions of USDC legs
        // total USDC legs = bpsBoost + bpsMkt + bpsTeam = 2500 + 700 + 300 = 3500
        uint256 denom = uint256(bpsBoost) + bpsMkt + bpsTeam;
        uint256 toBoost = denom == 0 ? 0 : (usdcOut * bpsBoost) / denom;
        uint256 toMkt   = denom == 0 ? 0 : (usdcOut * bpsMkt) / denom;
        uint256 toTeam  = usdcOut - toBoost - toMkt;

        if (toBoost > 0) usdc.safeTransfer(boostVault, toBoost);
        if (toMkt > 0) usdc.safeTransfer(marketingVault, toMkt);
        if (toTeam > 0) usdc.safeTransfer(teamVestingVault, toTeam);

        emit Processed(mmmAmount, toReward, toLiq, toBurn, toUsdcMmm, usdcOut, toBoost, toMkt, toTeam);
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract TaxVault is Ownable {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error NotWired();
    error InvalidBps();
    error AmountZero();
    error RouterMissing();
    error OnlyOwnerOrKeeper();

    uint256 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable mmm;
    IERC20 public immutable usdc;
    IERC20 public immutable wmon;

    address public rewardVault;
    address public boostVault;
    address public swapVault;
    address public marketingVault;
    address public teamVestingVault;

    address public router;
    address public keeper;

    uint16 public bpsReward = 4000;
    uint16 public bpsBoost  = 2500;
    uint16 public bpsLiq    = 1500;
    uint16 public bpsBurn   = 1000;
    uint16 public bpsMkt    = 700;
    uint16 public bpsTeam   = 300;

    event Wired(address rewardVault, address boostVault, address swapVault, address marketingVault, address teamVestingVault);
    event RouterSet(address router);
    event KeeperSet(address keeper);
    event SplitSet(uint16 reward, uint16 boost, uint16 liq, uint16 burn, uint16 mkt, uint16 team);
    event RouterApproved(address router);

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

    constructor(
        address mmmToken,
        address usdcToken,
        address wmonToken,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            mmmToken == address(0) ||
            usdcToken == address(0) ||
            wmonToken == address(0) ||
            initialOwner == address(0)
        ) revert ZeroAddress();

        mmm  = IERC20(mmmToken);
        usdc = IERC20(usdcToken);
        wmon = IERC20(wmonToken);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    function approveRouter() external onlyOwner {
        if (router == address(0)) revert RouterMissing();
        mmm.forceApprove(router, type(uint256).max);
        emit RouterApproved(router);
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

        rewardVault      = rewardVault_;
        boostVault       = boostVault_;
        swapVault        = swapVault_;
        marketingVault   = marketingVault_;
        teamVestingVault = teamVestingVault_;

        emit Wired(rewardVault_, boostVault_, swapVault_, marketingVault_, teamVestingVault_);
    }

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper) revert OnlyOwnerOrKeeper();
        _;
    }

    function process(uint256 mmmAmount, uint256 minUsdcOut, uint256 deadline)
        external
        onlyOwnerOrKeeper
    {
        if (mmmAmount == 0) revert AmountZero();
        if (
            rewardVault == address(0) ||
            boostVault == address(0) ||
            swapVault == address(0) ||
            marketingVault == address(0) ||
            teamVestingVault == address(0)
        ) revert NotWired();

        uint256 toReward = (mmmAmount * bpsReward) / BPS;
        uint256 toBurn   = (mmmAmount * bpsBurn) / BPS;
        uint256 toUsdcMmm = mmmAmount - toReward - toBurn;

        mmm.safeTransfer(rewardVault, toReward);
        mmm.safeTransfer(DEAD, toBurn);

        uint256 usdcOut = 0;

        if (toUsdcMmm > 0) {
            if (router == address(0)) revert RouterMissing();

            // MMM -> WMON -> USDC
            address[] memory path = new address[](3);
            path[0] = address(mmm);
            path[1] = address(wmon);
            path[2] = address(usdc);

            uint256 beforeBal = usdc.balanceOf(address(this));

            IUniswapV2Router02(router).swapExactTokensForTokens(
                toUsdcMmm,
                minUsdcOut,
                path,
                address(this),
                deadline
            );

            usdcOut = usdc.balanceOf(address(this)) - beforeBal;
        }

        uint256 denom = uint256(bpsBoost) + bpsMkt + bpsTeam;

        uint256 toBoost = denom == 0 ? 0 : (usdcOut * bpsBoost) / denom;
        uint256 toMkt   = denom == 0 ? 0 : (usdcOut * bpsMkt) / denom;
        uint256 toTeam  = usdcOut - toBoost - toMkt;

        if (toBoost > 0) usdc.safeTransfer(boostVault, toBoost);
        if (toMkt > 0) usdc.safeTransfer(marketingVault, toMkt);
        if (toTeam > 0) usdc.safeTransfer(teamVestingVault, toTeam);

        emit Processed(mmmAmount, toReward, toBurn, toUsdcMmm, usdcOut, toBoost, toMkt, toTeam);
    }
}

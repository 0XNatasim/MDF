// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

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
    ) external;
}

/*//////////////////////////////////////////////////////////////
                            TAX VAULT
//////////////////////////////////////////////////////////////*/

contract TaxVault is Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error NotWired();
    error AmountZero();
    error RouterMissing();
    error OnlyOwnerOrKeeper();

    /*//////////////////////////////////////////////////////////////
                              CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BPS = 10_000;
    address public constant DEAD =
        0x000000000000000000000000000000000000dEaD;

    /*//////////////////////////////////////////////////////////////
                              IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable mmm;
    IERC20 public immutable usdc;
    IERC20 public immutable wmon;

    /*//////////////////////////////////////////////////////////////
                              WIRING
    //////////////////////////////////////////////////////////////*/

    address public rewardVault;
    address public boostVault;
    address public swapVault; // reserved for future use
    address public marketingVault;
    address public teamVestingVault;

    address public router;
    address public keeper;

    /*//////////////////////////////////////////////////////////////
                              SPLITS
    //////////////////////////////////////////////////////////////*/

    uint16 public bpsReward = 4000;
    uint16 public bpsBoost  = 2500;
    uint16 public bpsBurn   = 1000;
    uint16 public bpsMkt    = 700;
    uint16 public bpsTeam   = 300;

    /*//////////////////////////////////////////////////////////////
                                MODE
    //////////////////////////////////////////////////////////////*/

    // true  = MMM -> USDC (TESTNET / MOCK)
    // false = MMM -> WMON -> USDC (MAINNET)
    bool public useDirectUsdcPath = true;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Wired(
        address rewardVault,
        address boostVault,
        address swapVault,
        address marketingVault,
        address teamVestingVault
    );

    event RouterSet(address router);
    event RouterApproved(address router);
    event KeeperSet(address keeper);
    event PathModeSet(bool directUsdc);

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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

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

    /*//////////////////////////////////////////////////////////////
                              ADMIN
    //////////////////////////////////////////////////////////////*/

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

    function setUseDirectUsdcPath(bool v) external onlyOwner {
        useDirectUsdcPath = v;
        emit PathModeSet(v);
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

        emit Wired(
            rewardVault_,
            boostVault_,
            swapVault_,
            marketingVault_,
            teamVestingVault_
        );
    }

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper) {
            revert OnlyOwnerOrKeeper();
        }
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              PROCESS
    //////////////////////////////////////////////////////////////*/

    function process(
        uint256 mmmAmount,
        uint256 minUsdcOut,
        uint256 deadline
    ) external onlyOwnerOrKeeper {
        if (mmmAmount == 0) revert AmountZero();
        if (
            rewardVault == address(0) ||
            boostVault == address(0) ||
            swapVault == address(0) ||
            marketingVault == address(0) ||
            teamVestingVault == address(0)
        ) revert NotWired();

        uint256 toReward  = (mmmAmount * bpsReward) / BPS;
        uint256 toBurn    = (mmmAmount * bpsBurn) / BPS;
        uint256 toUsdcMmm = mmmAmount - toReward - toBurn;

        mmm.safeTransfer(rewardVault, toReward);
        mmm.safeTransfer(DEAD, toBurn);

        uint256 usdcOut = 0;

        if (toUsdcMmm > 0) {
            if (router == address(0)) revert RouterMissing();

            address[] memory path;

            if (useDirectUsdcPath) {
                // ✅ THIS IS THE EXACT SAFE VERSION THAT FIXED YOUR ERRORS
                path = new address;
                path[0] = address(mmm);
                path[1] = address(usdc);
            } else {
                path = new address;
                path[0] = address(mmm);
                path[1] = address(wmon);
                path[2] = address(usdc);
            }

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

        emit Processed(
            mmmAmount,
            toReward,
            toBurn,
            toUsdcMmm,
            usdcOut,
            toBoost,
            toMkt,
            toTeam
        );
    }
}

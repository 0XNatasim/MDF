// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IRouterLike {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity);
}

interface IRewardVault {
    function depositRewards() external;
}

/**
 * SwapVault (v1)
 *
 * Responsibilities:
 * - Receives MMM from TaxVault
 * - Splits into:
 *   • Liquidity (MMM + WMON)
 *   • Rewards (MMM → MON → RewardVault)
 *
 * Security:
 * - Only TaxVault can call process()
 * - RewardVault is NOT payable externally
 * - Rewards are explicitly accounted
 */
contract SwapVault is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable mmm;
    IERC20 public immutable wmon;

    address public router;
    address public taxVault;
    address public rewardVault;

    address public lpReceiver;

    bool public routerSetOnce;
    bool public taxVaultSetOnce;
    bool public rewardVaultSetOnce;

    // ----------------- Errors -----------------
    error ZeroAddress();
    error OnlyTaxVault(address caller);
    error RouterNotSet();
    error TaxVaultNotSet();
    error RewardVaultNotSet();
    error RouterAlreadySet();
    error TaxVaultAlreadySet();
    error RewardVaultAlreadySet();

    // ----------------- Events -----------------
    event RouterSet(address indexed router, bool setOnce);
    event TaxVaultSet(address indexed taxVault, bool setOnce);
    event RewardVaultSet(address indexed rewardVault, bool setOnce);
    event LpReceiverSet(address indexed lpReceiver);
    event LiquidityProcessed(
        uint256 amountIn,
        uint256 rewardAmount,
        uint256 liquidityAmount,
        uint256 monSent,
        uint256 liquidityMinted
    );

    constructor(
        address mmm_,
        address wmon_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            mmm_ == address(0) ||
            wmon_ == address(0) ||
            initialOwner == address(0)
        ) revert ZeroAddress();

        mmm = IERC20(mmm_);
        wmon = IERC20(wmon_);
        lpReceiver = address(this);
    }

    // ----------------- Admin wiring -----------------

    function setRouterOnce(address r) external onlyOwner {
        if (routerSetOnce) revert RouterAlreadySet();
        if (r == address(0)) revert ZeroAddress();
        router = r;
        routerSetOnce = true;
        emit RouterSet(r, true);
    }

    function setTaxVaultOnce(address tv) external onlyOwner {
        if (taxVaultSetOnce) revert TaxVaultAlreadySet();
        if (tv == address(0)) revert ZeroAddress();
        taxVault = tv;
        taxVaultSetOnce = true;
        emit TaxVaultSet(tv, true);
    }

    function setRewardVaultOnce(address rv) external onlyOwner {
        if (rewardVaultSetOnce) revert RewardVaultAlreadySet();
        if (rv == address(0)) revert ZeroAddress();
        rewardVault = rv;
        rewardVaultSetOnce = true;
        emit RewardVaultSet(rv, true);
    }

    function setLpReceiver(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        lpReceiver = to;
        emit LpReceiverSet(to);
    }

    // ----------------- Core flow -----------------

    function process(uint256 amountIn) external {
        if (taxVault == address(0)) revert TaxVaultNotSet();
        if (rewardVault == address(0)) revert RewardVaultNotSet();
        if (router == address(0)) revert RouterNotSet();
        if (msg.sender != taxVault) revert OnlyTaxVault(msg.sender);
        if (amountIn == 0) return;

        // Split: 50% rewards / 50% liquidity (can be tuned later)
        uint256 rewardAmount = amountIn / 2;
        uint256 liquidityAmount = amountIn - rewardAmount;

        // =========================================================
        // REWARD PATH: MMM → MON → RewardVault
        // =========================================================
        _forceApprove(mmm, router, rewardAmount);

        address[] memory rewardPath = new address[](2);
        rewardPath[0] = address(mmm);
        rewardPath[1] = address(wmon);

        uint256 monBefore = address(this).balance;

        IRouterLike(router)
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
                rewardAmount,
                0,
                rewardPath,
                address(this),
                block.timestamp
            );

        uint256 monReceived = address(this).balance - monBefore;
        require(monReceived > 0, "No MON received");

        (bool ok, ) = rewardVault.call{value: monReceived}("");
        require(ok, "MON transfer failed");

        IRewardVault(rewardVault).depositRewards();

        // =========================================================
        // LIQUIDITY PATH: MMM + WMON
        // =========================================================
        uint256 swapAmount = liquidityAmount / 2;
        uint256 keepAmount = liquidityAmount - swapAmount;

        _forceApprove(mmm, router, swapAmount);

        address[] memory lpPath = new address[](2);
        lpPath[0] = address(mmm);
        lpPath[1] = address(wmon);

        IRouterLike(router)
            .swapExactTokensForTokensSupportingFeeOnTransferTokens(
                swapAmount,
                0,
                lpPath,
                address(this),
                block.timestamp
            );

        uint256 wmonBal = wmon.balanceOf(address(this));

        _forceApprove(mmm, router, keepAmount);
        _forceApprove(wmon, router, wmonBal);

        (, , uint liquidityMinted) = IRouterLike(router).addLiquidity(
            address(mmm),
            address(wmon),
            keepAmount,
            wmonBal,
            0,
            0,
            lpReceiver,
            block.timestamp
        );

        emit LiquidityProcessed(
            amountIn,
            rewardAmount,
            liquidityAmount,
            monReceived,
            liquidityMinted
        );
    }

    // ----------------- Helpers -----------------

    function _forceApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        token.forceApprove(spender, amount);
    }

    receive() external payable {}
}

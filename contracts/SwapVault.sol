// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IRouterLike {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
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

/**
 * SwapVault (v1)
 * Receives MMM from TaxVault and adds MMM/WMON liquidity via Router.
 *
 * Notes:
 * - Uses UniswapV2-style router method "SupportingFeeOnTransferTokens"
 * - Slippage mins = 0 (OK for testnet plumbing; NOT OK for mainnet)
 * - OZ v5: Ownable requires Ownable(initialOwner) in constructor
 */
contract SwapVault is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable mmm;
    IERC20 public immutable wmon;

    address public router;
    address public taxVault;

    // Where LP tokens are sent. For now can be this contract.
    address public lpReceiver;

    // Optional “set once” safety toggles
    bool public routerSetOnce;
    bool public taxVaultSetOnce;

    // ----------------- Errors -----------------
    error ZeroAddress();
    error OnlyTaxVault(address caller);
    error RouterNotSet();
    error TaxVaultNotSet();
    error RouterAlreadySet();
    error TaxVaultAlreadySet();

    // ----------------- Events -----------------
    event RouterSet(address indexed router, bool setOnce);
    event TaxVaultSet(address indexed taxVault, bool setOnce);
    event LpReceiverSet(address indexed lpReceiver);
    event LiquidityProcessed(
        uint256 amountIn,
        uint256 swapAmount,
        uint256 keepAmount,
        uint256 wmonReceived,
        uint256 amountAUsed,
        uint256 amountBUsed,
        uint256 liquidityMinted
    );

    constructor(address mmm_, address wmon_, address initialOwner)
        Ownable(initialOwner)
    {
        if (mmm_ == address(0) || wmon_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IERC20(mmm_);
        wmon = IERC20(wmon_);
        lpReceiver = address(this);
    }

    // ----------------- Admin wiring -----------------

    function setRouter(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        router = r;
        emit RouterSet(r, false);
    }

    function setRouterOnce(address r) external onlyOwner {
        if (routerSetOnce) revert RouterAlreadySet();
        if (r == address(0)) revert ZeroAddress();
        router = r;
        routerSetOnce = true;
        emit RouterSet(r, true);
    }

    function setTaxVault(address tv) external onlyOwner {
        if (tv == address(0)) revert ZeroAddress();
        taxVault = tv;
        emit TaxVaultSet(tv, false);
    }

    function setTaxVaultOnce(address tv) external onlyOwner {
        if (taxVaultSetOnce) revert TaxVaultAlreadySet();
        if (tv == address(0)) revert ZeroAddress();
        taxVault = tv;
        taxVaultSetOnce = true;
        emit TaxVaultSet(tv, true);
    }

    function setLpReceiver(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        lpReceiver = to;
        emit LpReceiverSet(to);
    }

    // ----------------- Core flow -----------------

    function processLiquidity(uint256 amountIn) external {
        if (taxVault == address(0)) revert TaxVaultNotSet();
        if (msg.sender != taxVault) revert OnlyTaxVault(msg.sender);
        if (router == address(0)) revert RouterNotSet();
        if (amountIn == 0) return;

        uint256 swapAmount = amountIn / 2;
        uint256 keepAmount = amountIn - swapAmount;

        // --- swap MMM -> WMON ---
        _forceApprove(mmm, router, swapAmount);

        address[] memory path = new address[](2);
        path[0] = address(mmm);
        path[1] = address(wmon);

        IRouterLike(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            swapAmount,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 wmonBal = wmon.balanceOf(address(this));

        // --- add liquidity MMM + WMON ---
        _forceApprove(mmm, router, keepAmount);
        _forceApprove(wmon, router, wmonBal);

        (uint amountAUsed, uint amountBUsed, uint liquidityMinted) = IRouterLike(router).addLiquidity(
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
            swapAmount,
            keepAmount,
            wmonBal,
            amountAUsed,
            amountBUsed,
            liquidityMinted
        );
    }

    // ----------------- Internal helpers -----------------

    function _forceApprove(IERC20 token, address spender, uint256 amount) internal {
        // OZ v5: use forceApprove (handles tokens that require resetting allowance)
        token.forceApprove(spender, amount);
    }
}


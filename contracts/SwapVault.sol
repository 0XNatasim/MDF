// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

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

contract SwapVault is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable mmm;
    IERC20 public immutable wmon;

    address public router;
    address public taxVault;

    error OnlyTaxVault();
    error RouterNotSet();

    constructor(address mmm_, address wmon_, address owner_) {
        mmm = IERC20(mmm_);
        wmon = IERC20(wmon_);
        _transferOwnership(owner_);
    }

    function setRouter(address r) external onlyOwner {
        router = r;
    }

    function setTaxVault(address tv) external onlyOwner {
        taxVault = tv;
    }

    function processLiquidity(uint256 amountIn) external {
        if (msg.sender != taxVault) revert OnlyTaxVault();
        if (router == address(0)) revert RouterNotSet();

        uint256 swapAmount = amountIn / 2;
        uint256 keepAmount = amountIn - swapAmount;

        mmm.safeIncreaseAllowance(router, swapAmount);

        address;
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
        mmm.safeIncreaseAllowance(router, keepAmount);
        wmon.safeIncreaseAllowance(router, wmonBal);

        IRouterLike(router).addLiquidity(
            address(mmm),
            address(wmon),
            keepAmount,
            wmonBal,
            0,
            0,
            address(this),
            block.timestamp
        );
    }
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MockLP} from "./MockLP.sol";

contract MockRouter is Ownable2Step {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error BadPath();
    error InsufficientRouterInventory();

    MockLP public immutable lp;

    constructor(address owner_) Ownable2Step() {
        if (owner_ == address(0)) revert ZeroAddress();
        lp = new MockLP(owner_);
        _transferOwnership(owner_);
    }

    function lpToken() external view returns (address) {
        return address(lp);
    }

    // Pre-fund router inventory for output tokens used in swaps
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint /*deadline*/
    ) external returns (uint[] memory amounts) {
        if (path.length < 2) revert BadPath();
        if (to == address(0)) revert ZeroAddress();

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        // pull tokenIn from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 1:1 out
        uint out = amountIn;
        if (out < amountOutMin) revert InsufficientRouterInventory();

        uint bal = IERC20(tokenOut).balanceOf(address(this));
        if (bal < out) revert InsufficientRouterInventory();

        IERC20(tokenOut).safeTransfer(to, out);

        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = out;
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        // same behavior in this mock
        swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint /*amountAMin*/,
        uint /*amountBMin*/,
        address to,
        uint /*deadline*/
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        if (tokenA == address(0) || tokenB == address(0) || to == address(0)) revert ZeroAddress();

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);

        amountA = amountADesired;
        amountB = amountBDesired;

        // dumb liquidity mint: sqrt-ish not needed; just use min(amountA, amountB)
        liquidity = amountA < amountB ? amountA : amountB;
        if (liquidity == 0) liquidity = 1;

        lp.mint(to, liquidity);
    }
}

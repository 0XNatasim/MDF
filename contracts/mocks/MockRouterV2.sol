// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * MockRouter
 * - NOT a real AMM.
 * - Only for testnet/local compile + basic flow wiring.
 * - swap: pulls tokenIn and sends tokenOut 1:1 (or capped by router balance).
 * - addLiquidity: pulls both tokens and returns "liquidity" as min(a,b).
 */
contract MockRouter {
    using SafeERC20 for IERC20;

    event MockSwap(address indexed tokenIn, address indexed tokenOut, uint amountIn, uint amountOut, address indexed to);
    event MockAddLiquidity(address indexed tokenA, address indexed tokenB, uint amountA, uint amountB, address indexed to);

    // fund the router with tokenOut so swaps can pay out
    function fund(address token, uint amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external {
        require(block.timestamp <= deadline, "EXPIRED");
        require(path.length >= 2, "BAD_PATH");
        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        // pull tokenIn from caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // 1:1 mock pricing (amountOut = amountIn)
        uint amountOut = amountIn;

        // enforce "min out"
        require(amountOut >= amountOutMin, "INSUFFICIENT_OUTPUT");

        // pay out tokenOut (cap by router balance)
        uint balOut = IERC20(tokenOut).balanceOf(address(this));
        if (amountOut > balOut) amountOut = balOut;

        if (amountOut > 0) {
            IERC20(tokenOut).safeTransfer(to, amountOut);
        }

        emit MockSwap(tokenIn, tokenOut, amountIn, amountOut, to);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        require(block.timestamp <= deadline, "EXPIRED");

        // For a mock: use desired as used amounts
        amountA = amountADesired;
        amountB = amountBDesired;

        require(amountA >= amountAMin, "A_MIN");
        require(amountB >= amountBMin, "B_MIN");

        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        // fake liquidity minted
        liquidity = amountA < amountB ? amountA : amountB;

        emit MockAddLiquidity(tokenA, tokenB, amountA, amountB, to);
    }
}

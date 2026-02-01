// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

contract MockRouterV2 {
    using SafeERC20 for IERC20;

    address public immutable MMM;
    address public immutable WMON;
    address public immutable USDC;

    event MockSwap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    );

    event MockAddLiquidity(
        address indexed tokenA,
        address indexed tokenB,
        uint256 amountA,
        uint256 amountB,
        address to
    );

    constructor(address mmm, address wmon, address usdc) {
        MMM = mmm;
        WMON = wmon;
        USDC = usdc;
    }

    /* ------------------------------------------------------------
        SWAP (Uniswap-compatible)
    ------------------------------------------------------------ */

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint,
        address[] calldata path,
        address to,
        uint
    ) external {
        require(path.length >= 2, "BAD_PATH");

        address tokenIn = path[0];
        address tokenOut = path[path.length - 1];

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        if (tokenIn == MMM && tokenOut == WMON) {
            IMintableERC20(WMON).mint(to, amountIn);
        } 
        else if (tokenIn == MMM && tokenOut == USDC) {
            // USDC has 6 decimals, normalize
            uint256 usdcOut = amountIn / 1e12;
            IMintableERC20(USDC).mint(to, usdcOut);
        } 
        else {
            revert("PAIR_NOT_SUPPORTED");
        }

        emit MockSwap(msg.sender, tokenIn, tokenOut, amountIn, amountIn, to);
    }

    /* ------------------------------------------------------------
        ADD LIQUIDITY (noop but compatible)
    ------------------------------------------------------------ */

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint,
        uint,
        address to,
        uint
    ) external returns (uint amountA, uint amountB, uint liquidity) {
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBDesired);

        emit MockAddLiquidity(tokenA, tokenB, amountADesired, amountBDesired, to);

        return (amountADesired, amountBDesired, 0);
    }
}

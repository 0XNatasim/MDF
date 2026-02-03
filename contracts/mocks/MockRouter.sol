// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

/**
 * @title MockRouter
 * @notice Deterministic Uniswap-compatible mock router for testnet
 * @dev Supports multi-hop paths and fee-on-transfer calls
 */
contract MockRouter {
    using SafeERC20 for IERC20;

    address public immutable MMM;
    address public immutable WMON;
    address public immutable USDC;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    // ⚠️ Solidity allows max 3 indexed params
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

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address mmm, address wmon, address usdc) {
        require(mmm != address(0), "MMM_ZERO");
        require(wmon != address(0), "WMON_ZERO");
        require(usdc != address(0), "USDC_ZERO");

        MMM  = mmm;
        WMON = wmon;
        USDC = usdc;
    }

    /*//////////////////////////////////////////////////////////////
        SWAP — UniswapV2 compatible (fee-on-transfer safe)
    //////////////////////////////////////////////////////////////*/

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 /* amountOutMin */,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external {
        require(amountIn > 0, "AMOUNT_ZERO");
        require(path.length >= 2, "BAD_PATH");
        require(to != address(0), "BAD_TO");

        address tokenIn  = path[0];
        address tokenOut = path[path.length - 1];

        // Pull input token
        IERC20(tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            amountIn
        );

        uint256 amountOut;

        // ---------------------------------------------------------
        // Supported mock routes
        // ---------------------------------------------------------

        if (tokenIn == MMM && tokenOut == WMON) {
            // 1:1 MMM -> WMON (18 -> 18)
            amountOut = amountIn;
            IMintableERC20(WMON).mint(to, amountOut);
        }
        else if (tokenIn == MMM && tokenOut == USDC) {
            // MMM (18) -> USDC (6)
            amountOut = amountIn / 1e12;
            IMintableERC20(USDC).mint(to, amountOut);
        }
        else {
            revert("PAIR_NOT_SUPPORTED");
        }

        emit MockSwap(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut,
            to
        );
    }

    /*//////////////////////////////////////////////////////////////
        ADD LIQUIDITY — noop but ABI-compatible
    //////////////////////////////////////////////////////////////*/

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256,
        uint256,
        address to,
        uint256
    )
        external
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        require(amountADesired > 0 && amountBDesired > 0, "AMOUNT_ZERO");
        require(to != address(0), "BAD_TO");

        IERC20(tokenA).safeTransferFrom(
            msg.sender,
            address(this),
            amountADesired
        );

        IERC20(tokenB).safeTransferFrom(
            msg.sender,
            address(this),
            amountBDesired
        );

        emit MockAddLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            to
        );

        // Liquidity token is irrelevant in mock
        return (amountADesired, amountBDesired, 0);
    }
}

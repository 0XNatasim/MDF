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
    SWAP — UniswapV2 compatible
//////////////////////////////////////////////////////////////*/
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint[] memory amounts) {

        require(amountIn > 0, "AMOUNT_ZERO");
        require(path.length >= 2, "BAD_PATH");
        require(to != address(0), "BAD_TO");

        // Pull initial token
        IERC20(path[0]).safeTransferFrom(
            msg.sender,
            address(this),
            amountIn
        );

        amounts = new uint[](path.length);
        amounts[0] = amountIn;

        uint256 currentAmount = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {

            address tokenIn  = path[i];
            address tokenOut = path[i + 1];

            uint256 amountOut;

            // -------------------------------
            // Supported mock pairs
            // -------------------------------

            if (tokenIn == MMM && tokenOut == WMON) {
                amountOut = currentAmount; // 1:1
                IMintableERC20(WMON).mint(address(this), amountOut);
            }
            else if (tokenIn == WMON && tokenOut == USDC) {
                // 18 → 6 decimals
                amountOut = currentAmount / 1e12;
                IMintableERC20(USDC).mint(address(this), amountOut);
            }
            else if (tokenIn == MMM && tokenOut == USDC) {
                // direct fallback
                amountOut = currentAmount / 1e12;
                IMintableERC20(USDC).mint(address(this), amountOut);
            }
            else {
                revert("PAIR_NOT_SUPPORTED");
            }

            currentAmount = amountOut;
            amounts[i + 1] = amountOut;
        }

    // Send final token to recipient
    IERC20(path[path.length - 1]).safeTransfer(to, currentAmount);

    emit MockSwap(
        msg.sender,
        path[0],
        path[path.length - 1],
        amountIn,
        currentAmount,
        to
    );

    return amounts;
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

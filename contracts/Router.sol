// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

/**
 * PatchedV2Router02 (Solidity 0.8.x)
 *
 * UniswapV2-style router that works with an existing V2 Factory + V2 Pair + WETH/WMON.
 * - No external imports (avoids compiler-version conflicts).
 * - Supports ETH<->Token swaps + fee-on-transfer variants.
 * - Supports addLiquidityETH.
 *
 * IMPORTANT:
 * - "ETH" here is Monad native MON. WETH is your WMON.
 * - Your Factory/Pair contracts can remain older compiler versions; router just calls their ABI.
 */

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function mint(address to) external returns (uint liquidity);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
    function sync() external;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

library TransferHelper {
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TH: TRANSFER_FAILED");
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TH: TRANSFER_FROM_FAILED");
    }

    function safeTransferETH(address to, uint256 value) internal {
        (bool ok, ) = to.call{value: value}("");
        require(ok, "TH: ETH_TRANSFER_FAILED");
    }
}

contract Router {
    address public immutable factory;
    address public immutable WETH; // WMON

    error Expired();
    error InvalidPath();
    error PairMissing();
    error InsufficientOutput();
    error PathMustStartWETH();
    error PathMustEndWETH();
    error EthOnlyFromWeth();

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert Expired();
        _;
    }

    constructor(address _factory, address _weth) {
        require(_factory != address(0), "Router: factory=0");
        require(_weth != address(0), "Router: WETH=0");
        factory = _factory;
        WETH = _weth;
    }

    receive() external payable {
        // Only accept native coin from WETH withdraw
        if (msg.sender != WETH) revert EthOnlyFromWeth();
    }

    // =========================================================
    // Pair helpers
    // =========================================================

    function _getPair(address tokenA, address tokenB) internal view returns (address pair) {
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
    }

    function _getOrCreatePair(address tokenA, address tokenB) internal returns (address pair) {
        pair = _getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
    }

    function _getReserves(address pair, address tokenA, address tokenB)
        internal
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        address t0 = IUniswapV2Pair(pair).token0();
        if (tokenA == t0) {
            reserveA = uint256(r0);
            reserveB = uint256(r1);
        } else {
            reserveA = uint256(r1);
            reserveB = uint256(r0);
        }
    }

    // =========================================================
    // Math helpers (Uniswap V2)
    // =========================================================

    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "Router: INSUFF_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "Router: INSUFF_LIQ");
        amountB = (amountA * reserveB) / reserveA;
    }

    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "Router: INSUFF_INPUT");
        require(reserveIn > 0 && reserveOut > 0, "Router: INSUFF_LIQ");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    // =========================================================
    // addLiquidityETH
    // =========================================================

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
    {
        address pair = _getOrCreatePair(token, WETH);

        (uint256 reserveToken, uint256 reserveWeth) = _getReserves(pair, token, WETH);

        if (reserveToken == 0 && reserveWeth == 0) {
            amountToken = amountTokenDesired;
            amountETH = msg.value;
        } else {
            uint256 optimalETH = _quote(amountTokenDesired, reserveToken, reserveWeth);
            if (optimalETH <= msg.value) {
                require(optimalETH >= amountETHMin, "Router: INSUFF_ETH");
                amountToken = amountTokenDesired;
                amountETH = optimalETH;
            } else {
                uint256 optimalToken = _quote(msg.value, reserveWeth, reserveToken);
                require(optimalToken >= amountTokenMin, "Router: INSUFF_TOKEN");
                amountToken = optimalToken;
                amountETH = msg.value;
            }
        }

        // transfer token to pair
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);

        // wrap ETH->WETH and send to pair
        IWETH(WETH).deposit{value: amountETH}();
        TransferHelper.safeTransfer(WETH, pair, amountETH);

        liquidity = IUniswapV2Pair(pair).mint(to);

        // refund dust
        if (msg.value > amountETH) {
            TransferHelper.safeTransferETH(msg.sender, msg.value - amountETH);
        }
    }

    // =========================================================
    // getAmountsOut
    // =========================================================

    function getAmountsOut(uint256 amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = _getPair(path[i], path[i + 1]);
            if (pair == address(0)) revert PairMissing();

            (uint256 reserveIn, uint256 reserveOut) = _getReserves(pair, path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    // =========================================================
    // Swap internals
    // =========================================================

    function _swapStep(address input, address output, address to_) internal {
        address pair = _getPair(input, output);
        if (pair == address(0)) revert PairMissing();

        (uint256 reserveIn, uint256 reserveOut) = _getReserves(pair, input, output);

        uint256 balanceInput = IERC20(input).balanceOf(pair);
        uint256 amountInput = balanceInput - reserveIn;

        uint256 amountOutput = _getAmountOut(amountInput, reserveIn, reserveOut);

        (uint256 amount0Out, uint256 amount1Out) = input == IUniswapV2Pair(pair).token0()
            ? (uint256(0), amountOutput)
            : (amountOutput, uint256(0));

        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, to_, new bytes(0));
    }

    function _swapExact(uint256[] memory amounts, address[] memory path, address finalTo) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address input = path[i];
            address output = path[i + 1];

            address to_ =
                (i < path.length - 2) ? _getPair(output, path[i + 2]) : finalTo;

            address pair = _getPair(input, output);
            if (pair == address(0)) revert PairMissing();

            (uint256 amount0Out, uint256 amount1Out) = input == IUniswapV2Pair(pair).token0()
                ? (uint256(0), amounts[i + 1])
                : (amounts[i + 1], uint256(0));

            IUniswapV2Pair(pair).swap(amount0Out, amount1Out, to_, new bytes(0));
        }
    }

    function _swapSupportingFee(address[] memory path, address finalTo) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address input = path[i];
            address output = path[i + 1];

            address to_ =
                (i < path.length - 2) ? _getPair(output, path[i + 2]) : finalTo;

            _swapStep(input, output, to_);
        }
    }

    // =========================================================
    // swapExactETHForTokens
    // =========================================================

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        if (path[0] != WETH) revert PathMustStartWETH();

        amounts = getAmountsOut(msg.value, _copyPath(path));
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();

        // wrap + send to first pair
        IWETH(WETH).deposit{value: amounts[0]}();
        TransferHelper.safeTransfer(WETH, _getPair(path[0], path[1]), amounts[0]);

        _swapExact(amounts, _copyPath(path), to);
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        payable
        ensure(deadline)
    {
        if (path.length < 2) revert InvalidPath();
        if (path[0] != WETH) revert PathMustStartWETH();

        IWETH(WETH).deposit{value: msg.value}();
        TransferHelper.safeTransfer(WETH, _getPair(path[0], path[1]), msg.value);

        uint256 beforeBal = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFee(_copyPath(path), to);
        uint256 afterBal = IERC20(path[path.length - 1]).balanceOf(to);

        if (afterBal - beforeBal < amountOutMin) revert InsufficientOutput();
    }

    // =========================================================
    // swapExactTokensForETH
    // =========================================================

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        if (path[path.length - 1] != WETH) revert PathMustEndWETH();

        amounts = getAmountsOut(amountIn, _copyPath(path));
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();

        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            _getPair(path[0], path[1]),
            amounts[0]
        );

        _swapExact(amounts, _copyPath(path), address(this));

        uint256 wethOut = amounts[amounts.length - 1];
        IWETH(WETH).withdraw(wethOut);
        TransferHelper.safeTransferETH(to, wethOut);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
    {
        if (path.length < 2) revert InvalidPath();
        if (path[path.length - 1] != WETH) revert PathMustEndWETH();

        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            _getPair(path[0], path[1]),
            amountIn
        );

        uint256 beforeWeth = IERC20(WETH).balanceOf(address(this));
        _swapSupportingFee(_copyPath(path), address(this));
        uint256 afterWeth = IERC20(WETH).balanceOf(address(this));

        uint256 receivedWeth = afterWeth - beforeWeth;
        if (receivedWeth < amountOutMin) revert InsufficientOutput();

        IWETH(WETH).withdraw(receivedWeth);
        TransferHelper.safeTransferETH(to, receivedWeth);
    }

    // =========================================================
    // swapExactTokensForTokens
    // =========================================================

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();

        amounts = getAmountsOut(amountIn, _copyPath(path));
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutput();

        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            _getPair(path[0], path[1]),
            amounts[0]
        );

        _swapExact(amounts, _copyPath(path), to);
    }

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    )
        external
        ensure(deadline)
    {
        if (path.length < 2) revert InvalidPath();

        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            _getPair(path[0], path[1]),
            amountIn
        );

        uint256 beforeOut = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFee(_copyPath(path), to);
        uint256 afterOut = IERC20(path[path.length - 1]).balanceOf(to);

        if (afterOut - beforeOut < amountOutMin) revert InsufficientOutput();
    }

    // =========================================================
    // Utility: copy calldata path to memory
    // =========================================================

    function _copyPath(address[] calldata path) internal pure returns (address[] memory p) {
        p = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) {
            p[i] = path[i];
        }
    }
}

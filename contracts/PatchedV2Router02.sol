// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity =0.6.6;

// Factory/Pair interfaces come from v2-core
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

// WETH + helpers from periphery/lib
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

/**
 * @dev Complete Patched Router with all swap functions.
 * Supports:
 *  - addLiquidityETH
 *  - swapExactETHForTokens / swapExactETHForTokensSupportingFeeOnTransferTokens
 *  - swapExactTokensForETH / swapExactTokensForETHSupportingFeeOnTransferTokens
 *  - swapExactTokensForTokens / swapExactTokensForTokensSupportingFeeOnTransferTokens
 */
contract PatchedV2Router02 {
    address public immutable factory;
    address public immutable WETH;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, "PatchedRouter: EXPIRED");
        _;
    }

    constructor(address _factory, address _WETH) public {
        factory = _factory;
        WETH = _WETH;
    }

    receive() external payable {
        require(msg.sender == WETH, "PatchedRouter: ETH_ONLY_FROM_WETH");
    }

    // --------- helpers ---------

    function _getOrCreatePair(address tokenA, address tokenB) internal returns (address pair) {
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
    }

    function _getReserves(address pair, address tokenA, address tokenB)
        internal
        view
        returns (uint reserveA, uint reserveB)
    {
        (uint reserve0, uint reserve1,) = IUniswapV2Pair(pair).getReserves();
        address token0 = IUniswapV2Pair(pair).token0();
        if (tokenA == token0) {
            (reserveA, reserveB) = (reserve0, reserve1);
        } else {
            (reserveA, reserveB) = (reserve1, reserve0);
        }
    }

    function _quote(uint amountA, uint reserveA, uint reserveB) internal pure returns (uint amountB) {
        require(amountA > 0, "PatchedRouter: INSUFF_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "PatchedRouter: INSUFF_LIQ");
        amountB = amountA * reserveB / reserveA;
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal returns (uint amountA, uint amountB, address pair) {
        pair = _getOrCreatePair(tokenA, tokenB);

        (uint reserveA, uint reserveB) = _getReserves(pair, tokenA, tokenB);

        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = _quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "PatchedRouter: INSUFF_B");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal >= amountAMin, "PatchedRouter: INSUFF_A");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    // --------- public: addLiquidityETH ---------

    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint amountToken, uint amountETH, uint liquidity)
    {
        address pair;
        (amountToken, amountETH, pair) = _addLiquidity(
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );

        // pull token to pair
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);

        // wrap ETH -> WETH, send to pair
        IWETH(WETH).deposit{value: amountETH}();
        assert(IWETH(WETH).transfer(pair, amountETH));

        liquidity = IUniswapV2Pair(pair).mint(to);

        // refund dust ETH if any
        if (msg.value > amountETH) {
            TransferHelper.safeTransferETH(msg.sender, msg.value - amountETH);
        }
    }

    // --------- public: getAmountsOut ---------
    
    function getAmountsOut(uint amountIn, address[] memory path)
        public
        view
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, "PatchedRouter: INVALID_PATH");
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        
        for (uint i = 0; i < path.length - 1; i++) {
            address pair = IUniswapV2Factory(factory).getPair(path[i], path[i + 1]);
            require(pair != address(0), "PatchedRouter: PAIR_MISSING");
            
            (uint reserveIn, uint reserveOut) = _getReserves(pair, path[i], path[i + 1]);
            
            // UniswapV2 formula with 0.3% fee
            uint amountInWithFee = amounts[i] * 997;
            uint numerator = amountInWithFee * reserveOut;
            uint denominator = reserveIn * 1000 + amountInWithFee;
            amounts[i + 1] = numerator / denominator;
        }
    }

    // --------- public: swapExactETHForTokens (basic) ---------

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, "PatchedRouter: INVALID_PATH");
        require(path[0] == WETH, "PatchedRouter: PATH_MUST_START_WETH");

        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        // wrap ETH -> WETH
        IWETH(WETH).deposit{value: amounts[0]}();
        assert(IWETH(WETH).transfer(IUniswapV2Factory(factory).getPair(path[0], path[1]), amounts[0]));

        _swap(amounts, path, to);
    }

    // --------- public: swapExactETHForTokensSupportingFeeOnTransferTokens ---------

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        payable
        ensure(deadline)
    {
        require(path.length >= 2, "PatchedRouter: INVALID_PATH");
        require(path[0] == WETH, "PatchedRouter: PATH_MUST_START_WETH");

        // wrap ETH -> WETH
        IWETH(WETH).deposit{value: msg.value}();
        assert(IWETH(WETH).transfer(IUniswapV2Factory(factory).getPair(path[0], path[1]), msg.value));

        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        uint balanceAfter = IERC20(path[path.length - 1]).balanceOf(to);
        
        require(balanceAfter - balanceBefore >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    // --------- public: swapExactTokensForETH (basic) ---------

    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path.length >= 2, "PatchedRouter: INVALID_PATH");
        require(path[path.length - 1] == WETH, "PatchedRouter: PATH_MUST_END_WETH");

        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IUniswapV2Factory(factory).getPair(path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        
        // unwrap WETH -> ETH
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferETH(to, amounts[amounts.length - 1]);
    }

    // --------- public: swapExactTokensForETHSupportingFeeOnTransferTokens ---------

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        ensure(deadline)
    {
        require(path.length >= 2, "PatchedRouter: INVALID_PATH");
        require(path[path.length - 1] == WETH, "PatchedRouter: PATH_MUST_END_WETH");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IUniswapV2Factory(factory).getPair(path[0], path[1]), amountIn
        );
        
        // Use IERC20 for balanceOf since WETH is also an ERC20 token
        uint balanceBefore = IERC20(WETH).balanceOf(address(this));
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint balanceAfter = IERC20(WETH).balanceOf(address(this));
        
        require(balanceAfter - balanceBefore >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        
        // unwrap WETH -> ETH
        IWETH(WETH).withdraw(balanceAfter - balanceBefore);
        TransferHelper.safeTransferETH(to, balanceAfter - balanceBefore);
    }

    // --------- public: swapExactTokensForTokens (basic) ---------

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IUniswapV2Factory(factory).getPair(path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }

    // --------- public: swapExactTokensForTokensSupportingFeeOnTransferTokens ---------

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        ensure(deadline)
    {
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IUniswapV2Factory(factory).getPair(path[0], path[1]), amountIn
        );
        
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        uint balanceAfter = IERC20(path[path.length - 1]).balanceOf(to);
        
        require(balanceAfter - balanceBefore >= amountOutMin, "PatchedRouter: INSUFFICIENT_OUTPUT_AMOUNT");
    }

    // --------- internal: _swap ---------

    function _swap(uint[] memory amounts, address[] memory path, address _to) internal {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address to = i < path.length - 2 ? IUniswapV2Factory(factory).getPair(output, path[i + 2]) : _to;
            
            address pair = IUniswapV2Factory(factory).getPair(input, output);
            require(pair != address(0), "PatchedRouter: PAIR_MISSING");
            
            (uint amount0Out, uint amount1Out) = input == IUniswapV2Pair(pair).token0()
                ? (uint(0), amounts[i + 1])
                : (amounts[i + 1], uint(0));
                
            IUniswapV2Pair(pair).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    // --------- internal: _swapSupportingFeeOnTransferTokens ---------

    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            address to = i < path.length - 2 ? IUniswapV2Factory(factory).getPair(output, path[i + 2]) : _to;
            
            address pair = IUniswapV2Factory(factory).getPair(input, output);
            require(pair != address(0), "PatchedRouter: PAIR_MISSING");
            
            (uint reserveInput, uint reserveOutput) = _getReserves(pair, input, output);
            
            uint balanceInput = IERC20(input).balanceOf(pair);
            uint amountInput = balanceInput - reserveInput;
            
            // UniswapV2 formula with 0.3% fee
            uint amountInWithFee = amountInput * 997;
            uint numerator = amountInWithFee * reserveOutput;
            uint denominator = reserveInput * 1000 + amountInWithFee;
            uint amountOutput = numerator / denominator;
            
            (uint amount0Out, uint amount1Out) = input == IUniswapV2Pair(pair).token0()
                ? (uint(0), amountOutput)
                : (amountOutput, uint(0));
                
            IUniswapV2Pair(pair).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }
}
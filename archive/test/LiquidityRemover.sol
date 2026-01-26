// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IERC20.sol";

/**
 * @title LiquidityRemover
 * @dev Helper contract to remove liquidity from Uniswap V2 pairs
 * Since the patched router doesn't support removeLiquidityETH, this contract provides that functionality
 */
contract LiquidityRemover {
    function removeLiquidityETH(
        address pair,
        address token,
        address weth,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH) {
        require(deadline >= block.timestamp, "LiquidityRemover: EXPIRED");
        
        IUniswapV2Pair pairContract = IUniswapV2Pair(pair);
        
        // Transfer LP tokens from caller to this contract
        IERC20(pair).transferFrom(msg.sender, address(this), liquidity);
        
        // Transfer LP tokens to pair and burn
        IERC20(pair).transfer(pair, liquidity);
        
        // Get reserves before burn
        (uint112 reserve0, uint112 reserve1,) = pairContract.getReserves();
        address token0 = pairContract.token0();
        
        // Determine which token is which
        bool tokenIs0 = token == token0;
        uint256 reserveToken = tokenIs0 ? reserve0 : reserve1;
        uint256 reserveWETH = tokenIs0 ? reserve1 : reserve0;
        
        // Calculate amounts (proportional to LP share)
        uint256 totalSupply = pairContract.totalSupply();
        amountToken = (reserveToken * liquidity) / totalSupply;
        amountETH = (reserveWETH * liquidity) / totalSupply;
        
        require(amountToken >= amountTokenMin, "LiquidityRemover: INSUFFICIENT_TOKEN_AMOUNT");
        require(amountETH >= amountETHMin, "LiquidityRemover: INSUFFICIENT_ETH_AMOUNT");
        
        // Burn LP tokens (this will send tokens back to this contract)
        (uint256 amount0, uint256 amount1) = pairContract.burn(address(this));
        
        // Determine actual amounts received
        uint256 amountTokenReceived = tokenIs0 ? amount0 : amount1;
        uint256 amountETHReceived = tokenIs0 ? amount1 : amount0;
        
        // Transfer token to user
        IERC20(token).transfer(to, amountTokenReceived);
        
        // Unwrap WETH and send ETH to user
        IWETH(weth).withdraw(amountETHReceived);
        payable(to).transfer(amountETHReceived);
        
        return (amountTokenReceived, amountETHReceived);
    }
    
    receive() external payable {}
}


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUniswapV2Router02Like {
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

    error ZeroAddress();
    error OnlyTaxVault(address caller);
    error RouterMissing();

    IERC20 public immutable mmm;
    IERC20 public immutable wmon;

    address public taxVault;
    bool public taxVaultSetOnce;

    address public router;

    event TaxVaultSet(address indexed taxVault);
    event RouterSet(address indexed router);
    event LiquidityAdded(uint256 mmmIn, uint256 wmonIn, uint256 lpOut);

    constructor(address mmmToken, address wmonToken, address initialOwner) Ownable2Step() {
        if (mmmToken == address(0) || wmonToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IERC20(mmmToken);
        wmon = IERC20(wmonToken);
        _transferOwnership(initialOwner);
    }

    function setTaxVaultOnce(address taxVault_) external onlyOwner {
        if (taxVaultSetOnce) revert("TaxVaultAlreadySet");
        if (taxVault_ == address(0)) revert ZeroAddress();
        taxVault = taxVault_;
        taxVaultSetOnce = true;
        emit TaxVaultSet(taxVault_);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    function processLiquidity(
        uint256 mmmAmount,
        uint256 minWmonOut,
        uint256 minMmmAdd,
        uint256 minWmonAdd,
        uint256 deadline
    ) external returns (uint256 lpOut) {
        if (msg.sender != taxVault) revert OnlyTaxVault(msg.sender);
        if (router == address(0)) revert RouterMissing();
        if (mmmAmount == 0) return 0;

        // split MMM in half
        uint256 half = mmmAmount / 2;
        uint256 otherHalf = mmmAmount - half;

        // approve router for MMM
        mmm.safeIncreaseAllowance(router, mmmAmount);

        // swap half MMM -> WMON
        address;
        path[0] = address(mmm);
        path[1] = address(wmon);

        uint256 wBefore = wmon.balanceOf(address(this));
        IUniswapV2Router02Like(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            half,
            minWmonOut,
            path,
            address(this),
            deadline
        );
        uint256 wGained = wmon.balanceOf(address(this)) - wBefore;

        // approve router for WMON
        wmon.safeIncreaseAllowance(router, wGained);

        // add liquidity MMM + WMON, LP stays in this vault for now
        (,, uint liq) = IUniswapV2Router02Like(router).addLiquidity(
            address(mmm),
            address(wmon),
            otherHalf,
            wGained,
            minMmmAdd,
            minWmonAdd,
            address(this),
            deadline
        );

        lpOut = liq;
        emit LiquidityAdded(otherHalf, wGained, liq);
    }
}

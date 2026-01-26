// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMonRewardTracker {
    function notifyReward() external payable;
    function updateRewardOnTransfer(address from, address to, uint256 amount) external;
}

interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

/**
 * @title MMM - Monad Money Machine
 * @notice ERC20 with buy/sell taxes and swapback to native MON for dividends.
 *
 * Expectations-level notes:
 * - Reward tracker hook includes `amount` so tracker can maintain eligible supply.
 * - swapTaxForRewards sends native MON to tracker exactly once via notifyReward{value:...}.
 * - Owner must set AMM pair(s) via setPair(pair,true) for buy/sell detection.
 */
contract MMM is ERC20, Ownable, ReentrancyGuard {
    // -------------------- Tax settings --------------------
    uint256 public buyTaxBps = 500;   // 5%
    uint256 public sellTaxBps = 500;  // 5%
    uint256 public constant MAX_TAX_BPS = 1000;

    // -------------------- Addresses --------------------
    address public router;
    address public immutable wmon; // Wrapped MON (WETH-equivalent)
    address public rewardTracker;

    // -------------------- State --------------------
    uint256 public taxTokens; // MMM tokens accumulated as tax inside this contract

    mapping(address => bool) public isExcludedFromFees;
    mapping(address => bool) public ammPairs;

    // swap lock
    bool private _swapping;

    // -------------------- Events --------------------
    event TaxesUpdated(uint256 buyTaxBps, uint256 sellTaxBps);
    event RewardTrackerSet(address indexed tracker);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event PairSet(address indexed pair, bool enabled);
    event ExcludedFromFees(address indexed account, bool excluded);
    event TaxSwap(uint256 mmmSwapped, uint256 monReceived);

    // -------------------- Modifiers --------------------
    modifier swapping() {
        _swapping = true;
        _;
        _swapping = false;
    }

    constructor(
        uint256 supply,
        address router_,
        address wmon_
    )
        ERC20("Monad Money Machine", "MMM")
        Ownable(msg.sender)
    {
        require(router_ != address(0), "MMM: zero router");
        require(wmon_ != address(0), "MMM: zero wmon");

        _mint(msg.sender, supply);

        router = router_;
        wmon = wmon_;

        // Exclude from fees
        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[router_] = true;

        emit RouterUpdated(address(0), router_);
        emit ExcludedFromFees(msg.sender, true);
        emit ExcludedFromFees(address(this), true);
        emit ExcludedFromFees(router_, true);
    }

    // =========================================================
    // Admin / Configuration
    // =========================================================

    function setTaxes(uint256 buyBps, uint256 sellBps) external onlyOwner {
        require(buyBps <= MAX_TAX_BPS, "MMM: buy tax too high");
        require(sellBps <= MAX_TAX_BPS, "MMM: sell tax too high");
        buyTaxBps = buyBps;
        sellTaxBps = sellBps;
        emit TaxesUpdated(buyBps, sellBps);
    }

    function setRewardTracker(address tracker) external onlyOwner {
        require(tracker != address(0), "MMM: zero tracker");
        rewardTracker = tracker;
        emit RewardTrackerSet(tracker);
    }

    function setRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "MMM: zero router");
        address old = router;
        router = newRouter;

        // keep router excluded from fees
        isExcludedFromFees[newRouter] = true;

        emit RouterUpdated(old, newRouter);
        emit ExcludedFromFees(newRouter, true);
    }

    function setPair(address pair, bool enabled) external onlyOwner {
        require(pair != address(0), "MMM: zero pair");
        ammPairs[pair] = enabled;
        emit PairSet(pair, enabled);
    }

    function setExcludedFromFees(address account, bool excluded) external onlyOwner {
        isExcludedFromFees[account] = excluded;
        emit ExcludedFromFees(account, excluded);
    }

    // =========================================================
    // Transfers with Taxes + Reward Tracker Hook
    // =========================================================

    function _update(address from, address to, uint256 amount) internal override {
        // 1) During swapback, skip tracker + skip tax (gas + avoids tracker blowing up)
        if (_swapping) {
            super._update(from, to, amount);
            return;
        }

        // 2) Normal transfers: call tracker hook
        address tracker = rewardTracker;
        if (tracker != address(0)) {
            IMonRewardTracker(tracker).updateRewardOnTransfer(from, to, amount);
        }

        // 3) No fees for excluded
        if (amount == 0 || isExcludedFromFees[from] || isExcludedFromFees[to]) {
            super._update(from, to, amount);
            return;
        }

        bool isBuy = ammPairs[from] && !ammPairs[to];
        bool isSell = ammPairs[to] && !ammPairs[from];

        uint256 fee = 0;
        if (isBuy && buyTaxBps > 0) {
            fee = (amount * buyTaxBps) / 10_000;
        } else if (isSell && sellTaxBps > 0) {
            fee = (amount * sellTaxBps) / 10_000;
        }

        if (fee > 0) {
            super._update(from, address(this), fee);
            taxTokens += fee;
            super._update(from, to, amount - fee);
        } else {
            super._update(from, to, amount);
        }
    }
    // =========================================================
    // Swapback: MMM taxTokens -> MON -> rewardTracker.notifyReward()
    // =========================================================

    function swapTaxForRewards(uint256 amount)
        external
        onlyOwner
        nonReentrant
        swapping
    {
        address tracker = rewardTracker;
        require(tracker != address(0), "MMM: tracker not set");
        require(taxTokens > 0, "MMM: no tax tokens");

        if (amount == 0 || amount > taxTokens) {
            amount = taxTokens;
        }

    // Approve router for exact amount
    _approve(address(this), router, amount);

    // Path: MMM -> WMON
    address[] memory path = new address[](2);
    path[0] = address(this);
    path[1] = wmon;

    uint256 initialBalance = address(this).balance;

    IUniswapV2Router02(router).swapExactTokensForETHSupportingFeeOnTransferTokens(
        amount,
        0,
        path,
        address(this),
        block.timestamp
);

uint256 monReceived = address(this).balance - initialBalance;
taxTokens -= amount;

emit TaxSwap(amount, monReceived);

if (monReceived > 0) {
    IMonRewardTracker(tracker).notifyReward{value: monReceived}();
}

    }

    // =========================================================
    // Utility / Views
    // =========================================================

    function getTaxInfo() external view returns (uint256, uint256, uint256) {
        return (buyTaxBps, sellTaxBps, taxTokens);
    }

    // =========================================================
    // Emergency
    // =========================================================

    function rescueETH(uint256 amount) external onlyOwner {
        (bool success, ) = owner().call{value: amount}("");
        require(success, "MMM: rescue failed");
    }

    function rescueToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    receive() external payable {}
}

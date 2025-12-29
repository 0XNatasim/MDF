// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

contract SnapshotRewardTrackerMon is Ownable, ReentrancyGuard {
    IERC20Balance public immutable token;
    address public immutable tokenAddress;

    // Global accounting
    uint256 public rewardPerTokenStored;       // scaled 1e18
    uint256 public totalRewardsDistributed;
    uint256 public totalRewardsClaimed;

    // Eligible supply excludes addresses marked excluded
    uint256 public eligibleSupply;

    // Per-user accounting
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards; // accrued, claimable

    // Exclusions
    mapping(address => bool) public isExcludedFromRewards;

    // Minimum claim amount (native MON)
    uint256 public minClaimAmount = 0.001 ether;

    event RewardNotified(uint256 amount, uint256 newRewardPerToken, uint256 eligibleSupply);
    event RewardClaimed(address indexed account, uint256 amount);
    event ExcludedFromRewards(address indexed account, bool excluded);
    event MinClaimAmountUpdated(uint256 newAmount);
    event EligibleSupplyAdjusted(uint256 newEligibleSupply);

    constructor(address _token) Ownable(msg.sender) {
        require(_token != address(0), "Tracker: zero token");
        token = IERC20Balance(_token);
        tokenAddress = _token;

        // Exclude obvious addresses
        isExcludedFromRewards[address(0)] = true;
        isExcludedFromRewards[address(this)] = true;

        // Start with full supply eligible, then subtract excluded balances (currently only 0 and self)
        eligibleSupply = token.totalSupply();
        eligibleSupply -= token.balanceOf(address(this));

        emit EligibleSupplyAdjusted(eligibleSupply);
    }

    // -------------------- Views --------------------

    function earned(address account) public view returns (uint256) {
        if (isExcludedFromRewards[account]) return 0;

        uint256 bal = token.balanceOf(account);
        uint256 delta = rewardPerTokenStored - userRewardPerTokenPaid[account];
        uint256 pending = (bal * delta) / 1e18;

        return rewards[account] + pending;
    }

    function withdrawable(address account) external view returns (uint256) {
        return earned(account);
    }

    function getRewardInfo(address account)
        external
        view
        returns (uint256 earnedAmount, uint256 tokenBalance, uint256 paidCheckpoint, bool excluded)
    {
        return (earned(account), token.balanceOf(account), userRewardPerTokenPaid[account], isExcludedFromRewards[account]);
    }

    // -------------------- Reward ingestion --------------------

    function notifyReward() external payable {
        _notifyReward(msg.value);
    }

    receive() external payable {
        _notifyReward(msg.value);
    }

    function _notifyReward(uint256 amount) internal {
        if (amount == 0) return;

        uint256 supply = eligibleSupply;
        if (supply == 0) return;

        rewardPerTokenStored += (amount * 1e18) / supply;
        totalRewardsDistributed += amount;

        emit RewardNotified(amount, rewardPerTokenStored, supply);
    }

    // -------------------- Hook from token --------------------
    // MMM must call this as: updateRewardOnTransfer(from, to, amount)
    function updateRewardOnTransfer(address from, address to, uint256 amount) external {
        require(msg.sender == tokenAddress, "Tracker: only token");

        // No-op fast path
        if (amount == 0) return;

        // Determine excluded status (treat mint/burn endpoints as excluded)
        bool fromExcluded = (from == address(0)) || isExcludedFromRewards[from];
        bool toExcluded   = (to == address(0))   || isExcludedFromRewards[to];

        // 1) Checkpoint accounts that are eligible (so they don't miss rewards up to now)
        if (!fromExcluded) _updateReward(from);
        if (!toExcluded) _updateReward(to);

        // 2) Adjust eligible supply ONLY when tokens cross the excluded boundary
        // - mint: 0x0 (excluded) -> eligible address  => eligibleSupply increases
        // - burn: eligible address -> 0x0 (excluded)  => eligibleSupply decreases
        // - excluded -> eligible (e.g., excluded wallet sends out) => eligibleSupply increases
        // - eligible -> excluded (e.g., user sends to excluded wallet) => eligibleSupply decreases
        if (fromExcluded && !toExcluded) {
            eligibleSupply += amount;
            emit EligibleSupplyAdjusted(eligibleSupply);
        } else if (!fromExcluded && toExcluded) {
            if (eligibleSupply >= amount) {
                eligibleSupply -= amount;
            } else {
                eligibleSupply = 0;
            }
            emit EligibleSupplyAdjusted(eligibleSupply);
        }

        // 3) Keep excluded accounts' checkpoints aligned so they don't "back-earn" if later included
        if (from != address(0) && fromExcluded) {
            userRewardPerTokenPaid[from] = rewardPerTokenStored;
        }
        if (to != address(0) && toExcluded) {
            userRewardPerTokenPaid[to] = rewardPerTokenStored;
        }
    }

    function _updateReward(address account) internal {
        // Since `earned()` reads current token.balanceOf(account), this safely accrues
        // pending rewards to `rewards[account]` using the current rewardPerTokenStored.
        rewards[account] = earned(account);
        userRewardPerTokenPaid[account] = rewardPerTokenStored;
    }
    // -------------------- Claims --------------------

    function claim() external nonReentrant {
        _claimFor(msg.sender);
    }

    function claimForAccount(address account) external nonReentrant {
        require(msg.sender == account || msg.sender == owner(), "Tracker: not auth");
        _claimFor(account);
    }

    function _claimFor(address account) internal {
        require(!isExcludedFromRewards[account], "Tracker: excluded");

        _updateReward(account);

        uint256 reward = rewards[account];
        require(reward >= minClaimAmount, "Tracker: below min");

        rewards[account] = 0;
        totalRewardsClaimed += reward;

        (bool ok, ) = account.call{value: reward}("");
        require(ok, "Tracker: send fail");

        emit RewardClaimed(account, reward);
    }

    // -------------------- Admin --------------------

    function excludeFromRewards(address account, bool excluded) external onlyOwner {
        require(account != address(this), "Tracker: cannot exclude self");

        // checkpoint first
        if (!isExcludedFromRewards[account]) {
            _updateReward(account);
        } else {
            // keep checkpoint consistent
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }

        uint256 bal = token.balanceOf(account);

        bool wasExcluded = isExcludedFromRewards[account];
        if (!wasExcluded && excluded) {
            // leaving eligible set
            if (eligibleSupply >= bal) eligibleSupply -= bal;
            else eligibleSupply = 0;
        } else if (wasExcluded && !excluded) {
            // entering eligible set
            eligibleSupply += bal;
        }

        isExcludedFromRewards[account] = excluded;

        // align checkpoint so toggling doesn’t retroactively earn
        userRewardPerTokenPaid[account] = rewardPerTokenStored;

        emit ExcludedFromRewards(account, excluded);
        emit EligibleSupplyAdjusted(eligibleSupply);
    }

    function setMinClaimAmount(uint256 amount) external onlyOwner {
        minClaimAmount = amount;
        emit MinClaimAmountUpdated(amount);
    }

    // Emergency: owner can withdraw stranded MON (use carefully)
    function emergencyWithdrawETH(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "Tracker: insufficient");
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Tracker: withdraw fail");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Like {
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMMMToken is IERC20Like {
    function lastNonZeroAt(address user) external view returns (uint256);
}

interface IBoostVault {
    function claimBonus(address user, uint256 baseAmount) external returns (uint256 paidBonus);
}

contract RewardVault is Ownable2Step, ReentrancyGuard {
    // ------------------------- Errors -------------------------
    error NothingToClaim();
    error ExcludedFromRewards(address who);
    error BalanceBelowMin(address who, uint256 bal, uint256 minBal);
    error HoldTimeNotMet(address who, uint256 lastNonZeroAt, uint256 nowTs, uint256 minHoldSec);
    error ClaimCooldownActive(address who, uint256 lastClaimAt, uint256 nowTs, uint256 cooldownSec);
    error ZeroAmount();
    error EligibleSupplyZero();
    error ZeroAddress();

    uint256 public constant ACC_SCALE = 1e18;

    IMMMToken public immutable mmm;

    // readable immutables
    uint48  public immutable minHoldTimeSec;
    uint48  public immutable claimCooldown;
    uint256 public immutable minBalance;

    // Optional BoostVault (USDC bonus)
    address public boostVault;
    bool public boostVaultSetOnce;

    // Excluded list for eligibleSupply denominator
    address[] public excludedRewardAddresses;
    mapping(address => bool) public isExcludedReward;

    // Accounting
    uint256 public totalDistributed;
    uint256 public accRewardPerToken;

    mapping(address => uint256) public rewardDebt;
    mapping(address => uint48)  public lastClaimAt;

    // ------------------------- Events -------------------------
    event ExcludedRewardAddressAdded(address indexed a);
    event ExcludedRewardAddressRemoved(address indexed a);
    event RewardExclusionSet(address indexed a, bool excluded);

    event BoostVaultSet(address indexed boostVault);

    event Notified(uint256 amount, uint256 eligibleSupply, uint256 newAccRewardPerToken);
    event Claimed(address indexed user, uint256 amount);
    event BonusAttempt(address indexed user, uint256 baseAmount, uint256 paidBonus);

    constructor(
        address _mmm,
        uint48 _minHoldTimeSec,
        uint48 _claimCooldown,
        uint256 _minBalance,
        address initialOwner
    ) Ownable2Step() {
        if (_mmm == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IMMMToken(_mmm);
        minHoldTimeSec = _minHoldTimeSec;
        claimCooldown  = _claimCooldown;
        minBalance     = _minBalance;
        _transferOwnership(initialOwner);
    }

    // ------------------------- View helpers -------------------------

    function isExcludedFromRewards(address who) external view returns (bool) {
        return isExcludedReward[who];
    }

    function excludedRewardAddressesLength() external view returns (uint256) {
        return excludedRewardAddresses.length;
    }

    function eligibleSupply() public view returns (uint256) {
        uint256 ts = mmm.totalSupply();
        uint256 sumExcluded = 0;
        uint256 n = excludedRewardAddresses.length;
        for (uint256 i = 0; i < n; i++) {
            sumExcluded += mmm.balanceOf(excludedRewardAddresses[i]);
        }
        return ts - sumExcluded;
    }

    function pending(address user) public view returns (uint256) {
        uint256 bal = mmm.balanceOf(user);
        uint256 accrued = (bal * accRewardPerToken) / ACC_SCALE;
        uint256 debt = rewardDebt[user];
        if (accrued <= debt) return 0;
        return accrued - debt;
    }

    // ------------------------- Admin -------------------------

    function setBoostVaultOnce(address boostVault_) external onlyOwner {
        if (boostVaultSetOnce) revert("BoostVaultAlreadySet");
        if (boostVault_ == address(0)) revert ZeroAddress();
        boostVault = boostVault_;
        boostVaultSetOnce = true;
        emit BoostVaultSet(boostVault_);
    }

    function addExcludedRewardAddress(address a) external onlyOwner {
        excludedRewardAddresses.push(a);
        emit ExcludedRewardAddressAdded(a);
    }

    function removeExcludedRewardAddress(uint256 idx) external onlyOwner {
        uint256 n = excludedRewardAddresses.length;
        require(idx < n, "BadIndex");
        address removed = excludedRewardAddresses[idx];
        excludedRewardAddresses[idx] = excludedRewardAddresses[n - 1];
        excludedRewardAddresses.pop();
        emit ExcludedRewardAddressRemoved(removed);
    }

    function setRewardExcluded(address a, bool excluded) external onlyOwner {
        isExcludedReward[a] = excluded;
        emit RewardExclusionSet(a, excluded);
    }

    // ------------------------- Distribution -------------------------
    // RewardVault is funded by TaxVault transferring MMM here.
    // Owner (or a keeper you choose) calls notifyRewardAmount(amount) to account it.

    function notifyRewardAmount(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 denom = eligibleSupply();
        if (denom == 0) revert EligibleSupplyZero();

        // We assume MMM already transferred into this vault by TaxVault before calling notify.
        accRewardPerToken += (amount * ACC_SCALE) / denom;
        totalDistributed  += amount;

        emit Notified(amount, denom, accRewardPerToken);
    }

    // ------------------------- Claim -------------------------

    function claim() external nonReentrant returns (uint256 claimed) {
        address user = msg.sender;

        if (isExcludedReward[user]) revert ExcludedFromRewards(user);

        uint256 bal = mmm.balanceOf(user);
        if (bal < minBalance) revert BalanceBelowMin(user, bal, minBalance);

        uint256 lnz = mmm.lastNonZeroAt(user);
        uint256 nowTs = block.timestamp;
        if (nowTs < lnz + minHoldTimeSec) {
            revert HoldTimeNotMet(user, lnz, nowTs, minHoldTimeSec);
        }

        uint48 last = lastClaimAt[user];
        if (last != 0 && nowTs < uint256(last) + uint256(claimCooldown)) {
            revert ClaimCooldownActive(user, last, nowTs, claimCooldown);
        }

        claimed = pending(user);
        if (claimed == 0) revert NothingToClaim();

        // update accounting BEFORE transfer
        rewardDebt[user] = (bal * accRewardPerToken) / ACC_SCALE;
        lastClaimAt[user] = uint48(nowTs);

        require(IERC20Like(address(mmm)).transfer(user, claimed), "TransferFailed");
        emit Claimed(user, claimed);

        // Optional USDC bonus, never allowed to break base claim.
        uint256 paidBonus = 0;
        if (boostVault != address(0)) {
            try IBoostVault(boostVault).claimBonus(user, claimed) returns (uint256 b) {
                paidBonus = b;
            } catch {
                paidBonus = 0;
            }
        }
        emit BonusAttempt(user, claimed, paidBonus);
    }

    function syncRewardDebt(address user) external {
        uint256 bal = mmm.balanceOf(user);
        rewardDebt[user] = (bal * accRewardPerToken) / ACC_SCALE;
    }
}

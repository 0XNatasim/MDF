// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Like {
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMMMToken is IERC20Like {
    function lastNonZeroAt(address user) external view returns (uint256);
}

interface ITaxVault {
    function sweepToRewardVault(uint256 amount) external;
}

/**
 * @notice BoostVault interface (bonus paid in USDC per your plan).
 * baseAmount is expressed in MMM 18-decimal units (same scale as claim()).
 * Must NOT revert base claims: RewardVault calls via try/catch.
 */
interface IBoostVault {
    function claimBonus(address user, uint256 baseAmount) external returns (uint256 paidBonus);
}

/// @notice MMM v1 RewardVault: distributes MMM rewards pro-rata to eligible supply (totalSupply - excluded list).
/// Gating order on claim():
///   1) ExcludedFromRewards
///   2) BalanceBelowMin
///   3) HoldTimeNotMet
///   4) ClaimCooldownActive
///   5) NothingToClaim
///
/// v1.1 additions:
/// - Optional BoostVault hook that pays bonus in USDC (or any token BoostVault holds),
///   invoked AFTER a successful base MMM claim (never blocks base claim).
contract RewardVault is Ownable, ReentrancyGuard {
    // ------------------------- Errors -------------------------
    error NothingToClaim();
    error ExcludedFromRewards(address who);
    error BalanceBelowMin(address who, uint256 bal, uint256 minBal);
    error HoldTimeNotMet(address who, uint256 lastNonZeroAt, uint256 nowTs, uint256 minHoldSec);
    error ClaimCooldownActive(address who, uint256 lastClaimAt, uint256 nowTs, uint256 cooldownSec);
    error ZeroAmount();
    error EligibleSupplyZero();
    error ZeroAddress();

    // ------------------------- Constants -------------------------
    uint256 public constant ACC_SCALE = 1e18;

    // ------------------------- Immutable config (public getters) -------------------------
    IMMMToken public immutable mmm;
    ITaxVault public immutable taxVault;

    uint48  public immutable minHoldTimeSec;  // seconds
    uint48  public immutable claimCooldown;   // seconds
    uint256 public immutable minBalance;      // MMM wei

    // ------------------------- Optional BoostVault wiring -------------------------
    address public boostVault;

    // ------------------------- State -------------------------
    // Excluded list used ONLY for eligibleSupply denominator (admin-managed small array).
    address[] public excludedRewardAddresses;

    // Claim-time exclusion gate
    mapping(address => bool) public isExcludedReward;

    // Rewards accounting
    uint256 public totalDistributed;
    uint256 public accRewardPerToken; // scaled by ACC_SCALE

    mapping(address => uint256) public rewardDebt;
    mapping(address => uint48)  public lastClaimAt;

    // ------------------------- Events -------------------------
    event ExcludedRewardAddressAdded(address indexed a);
    event ExcludedRewardAddressRemoved(address indexed a);
    event RewardExclusionSet(address indexed a, bool excluded);

    event Notified(uint256 amount, uint256 eligibleSupply, uint256 newAccRewardPerToken);
    event Claimed(address indexed user, uint256 amount);

    event BoostVaultSet(address indexed boostVault);
    event BoostAttempt(address indexed boostVault, address indexed user, uint256 baseAmount, bool success, uint256 paidBonus);

    constructor(
        address _mmm,
        address _taxVault,
        uint48 _minHoldTimeSec,
        uint48 _claimCooldown,
        uint256 _minBalance,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_mmm == address(0) || _taxVault == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IMMMToken(_mmm);
        taxVault = ITaxVault(_taxVault);
        minHoldTimeSec = _minHoldTimeSec;
        claimCooldown  = _claimCooldown;
        minBalance     = _minBalance;
    }

    // ------------------------- View helpers -------------------------

    /// @notice Alias helper for tests (some specs expect this name).
    function isExcludedFromRewards(address who) external view returns (bool) {
        return isExcludedReward[who];
    }

    function excludedRewardAddressesLength() external view returns (uint256) {
        return excludedRewardAddresses.length;
    }

    /// @notice eligibleSupply = totalSupply - sum(balanceOf(excludedRewardAddresses))
    function eligibleSupply() public view returns (uint256) {
        uint256 ts = mmm.totalSupply();
        uint256 sumExcluded = 0;
        uint256 n = excludedRewardAddresses.length;
        for (uint256 i = 0; i < n; i++) {
            sumExcluded += mmm.balanceOf(excludedRewardAddresses[i]);
        }
        return ts - sumExcluded;
    }

    /// @notice Pending MMM claimable for user, based on current accRewardPerToken and current balance.
    function pending(address user) public view returns (uint256) {
        uint256 bal = mmm.balanceOf(user);
        uint256 accrued = (bal * accRewardPerToken) / ACC_SCALE;

        uint256 debt = rewardDebt[user];
        if (accrued <= debt) return 0;
        return accrued - debt;
    }

    // ------------------------- Admin: excluded sets -------------------------

    function addExcludedRewardAddress(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
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
        if (a == address(0)) revert ZeroAddress();
        isExcludedReward[a] = excluded;
        emit RewardExclusionSet(a, excluded);
    }

    // ------------------------- Admin: BoostVault wiring -------------------------

    /**
     * @notice Set/replace BoostVault (optional).
     * If BoostVault reverts or is unfunded, base claims still work.
     */
    function setBoostVault(address boostVault_) external onlyOwner {
        // allow zero to disable
        boostVault = boostVault_;
        emit BoostVaultSet(boostVault_);
    }

    // ------------------------- Distribution -------------------------

    /// @notice Pulls MMM from TaxVault via sweep, and updates accRewardPerToken using eligibleSupply denominator.
    function notifyRewardAmountFromTaxVault(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 denom = eligibleSupply();
        if (denom == 0) revert EligibleSupplyZero();

        // Pull funds from TaxVault to this vault
        taxVault.sweepToRewardVault(amount);

        // Update accumulator
        accRewardPerToken += (amount * ACC_SCALE) / denom;
        totalDistributed  += amount;

        emit Notified(amount, denom, accRewardPerToken);
    }

    // ------------------------- Claim -------------------------

    function claim() external nonReentrant returns (uint256 claimed) {
        address user = msg.sender;

        // 1) excluded gate
        if (isExcludedReward[user]) revert ExcludedFromRewards(user);

        // 2) min balance gate
        uint256 bal = mmm.balanceOf(user);
        if (bal < minBalance) revert BalanceBelowMin(user, bal, minBalance);

        // 3) hold-time gate
        uint256 lnz = mmm.lastNonZeroAt(user);
        uint256 nowTs = block.timestamp;
        if (nowTs < lnz + minHoldTimeSec) {
            revert HoldTimeNotMet(user, lnz, nowTs, minHoldTimeSec);
        }

        // 4) cooldown gate
        uint48 last = lastClaimAt[user];
        if (last != 0 && nowTs < uint256(last) + uint256(claimCooldown)) {
            revert ClaimCooldownActive(user, last, nowTs, claimCooldown);
        }

        // 5) compute pending
        claimed = pending(user);
        if (claimed == 0) revert NothingToClaim();

        // update accounting BEFORE transfer
        rewardDebt[user] = (bal * accRewardPerToken) / ACC_SCALE;
        lastClaimAt[user] = uint48(nowTs);

        // base payout in MMM
        require(IERC20Like(address(mmm)).transfer(user, claimed), "TransferFailed");
        emit Claimed(user, claimed);

        // Optional bonus payout via BoostVault (never blocks base claim)
        address bv = boostVault;
        if (bv != address(0)) {
            // call and ignore failures
            try IBoostVault(bv).claimBonus(user, claimed) returns (uint256 paidBonus) {
                emit BoostAttempt(bv, user, claimed, true, paidBonus);
            } catch {
                emit BoostAttempt(bv, user, claimed, false, 0);
            }
        }
    }

    /**
     * @notice Manual debt sync helper (for tests / edge cases).
     * WARNING: Calling this when user has pending will effectively "forfeit" pending.
     */
    function syncRewardDebt(address user) external {
        uint256 bal = mmm.balanceOf(user);
        rewardDebt[user] = (bal * accRewardPerToken) / ACC_SCALE;
    }
}

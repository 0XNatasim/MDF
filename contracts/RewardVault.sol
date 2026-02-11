// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/*//////////////////////////////////////////////////////////////
                        TOKEN INTERFACES
//////////////////////////////////////////////////////////////*/

interface IERC20Like {
    function totalSupply() external view returns (uint256);
    function balanceOf(address a) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IMMMToken is IERC20Like {
    /// @notice Timestamp when user last crossed from zero → non-zero balance
    function lastNonZeroAt(address user) external view returns (uint256);
}

/*//////////////////////////////////////////////////////////////
                        BOOST INTERFACES
//////////////////////////////////////////////////////////////*/

/// @notice Optional USDC bonus vault (v2+ only)
interface IBoostVault {
    function claimBonus(address user, uint256 baseAmount)
        external
        returns (uint256 paidBonus);
}

/// @notice Minimal, read-only Boost NFT interface
interface IBoostNFT {
    struct BoostConfig {
        uint32 holdReduction;      // seconds
        uint32 cooldownReduction;  // seconds
    }

    function getBoost(address user)
        external
        view
        returns (BoostConfig memory config, uint8 rarity);
}

/*//////////////////////////////////////////////////////////////
                            REWARD VAULT
//////////////////////////////////////////////////////////////*/

contract RewardVault is Ownable, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/
    error NothingToClaim();
    error ExcludedFromRewards(address who);
    error BalanceBelowMin(address who, uint256 bal, uint256 minBal);
    error HoldTimeNotMet(
        address who,
        uint256 lastNonZeroAt,
        uint256 nowTs,
        uint256 requiredHold
    );
    error ClaimCooldownActive(
        address who,
        uint256 lastClaimAt,
        uint256 nowTs,
        uint256 requiredCooldown
    );
    error ZeroAmount();
    error EligibleSupplyZero();
    error ZeroAddress();
    error BoostVaultAlreadySet();

    /*//////////////////////////////////////////////////////////////
                            CONSTANTS
    //////////////////////////////////////////////////////////////*/
    uint256 public constant ACC_SCALE = 1e18;

    /*//////////////////////////////////////////////////////////////
                            IMMUTABLES
    //////////////////////////////////////////////////////////////*/
    IMMMToken public immutable mmm;

    uint48  public immutable minHoldTimeSec;
    uint48  public immutable claimCooldown;
    uint256 public immutable minBalance;

    /*//////////////////////////////////////////////////////////////
                        OPTIONAL EXTERNAL MODULES
    //////////////////////////////////////////////////////////////*/
    address   public boostVault;         // optional, v2+
    bool      public boostVaultSetOnce;
    IBoostNFT public boostNFT;            // optional, v2+

    /*//////////////////////////////////////////////////////////////
                        REWARD EXCLUSION
    //////////////////////////////////////////////////////////////*/
    /// @dev Admin-managed, bounded list (≤10 addresses by policy)
    address[] public excludedRewardAddresses;
    mapping(address => bool) public isExcludedReward;

    /*//////////////////////////////////////////////////////////////
                        ACCOUNTING STATE
    //////////////////////////////////////////////////////////////*/
    uint256 public totalDistributed;
    uint256 public accRewardPerToken;

    mapping(address => uint256) public rewardDebt;
    mapping(address => uint48)  public lastClaimAt;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event ExcludedRewardAddressAdded(address indexed a);
    event ExcludedRewardAddressRemoved(address indexed a);
    event RewardExclusionSet(address indexed a, bool excluded);

    event BoostVaultSet(address indexed boostVault);
    event BoostNFTSet(address indexed boostNFT);

    event Notified(
        uint256 amount,
        uint256 eligibleSupply,
        uint256 newAccRewardPerToken
    );
    event Claimed(address indexed user, uint256 amount);
    event BonusAttempt(
        address indexed user,
        uint256 baseAmount,
        uint256 paidBonus
    );

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _mmm,
        uint48  _minHoldTimeSec,
        uint48  _claimCooldown,
        uint256 _minBalance,
        address initialOwner
    ) Ownable(initialOwner) {
        if (_mmm == address(0) || initialOwner == address(0))
            revert ZeroAddress();

        mmm = IMMMToken(_mmm);
        minHoldTimeSec = _minHoldTimeSec;
        claimCooldown  = _claimCooldown;
        minBalance     = _minBalance;
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW HELPERS
    //////////////////////////////////////////////////////////////*/

    function excludedRewardAddressesLength()
        external
        view
        returns (uint256)
    {
        return excludedRewardAddresses.length;
    }

    /// @notice Eligible supply used as reward denominator.
    /// @dev Excluded list must remain small (≤10 addresses).
    function eligibleSupply() public view returns (uint256) {
        uint256 ts = mmm.totalSupply();
        uint256 sumExcluded;
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

    /*//////////////////////////////////////////////////////////////
                            ADMIN
    //////////////////////////////////////////////////////////////*/

    function setBoostVaultOnce(address boostVault_)
        external
        onlyOwner
    {
        if (boostVaultSetOnce) revert BoostVaultAlreadySet();
        if (boostVault_ == address(0)) revert ZeroAddress();

        boostVault = boostVault_;
        boostVaultSetOnce = true;

        emit BoostVaultSet(boostVault_);
    }

    /// @notice Optional Boost NFT hook (read-only).
    ///         If unset, behavior is identical to v1.
    function setBoostNFT(address boostNFT_)
        external
        onlyOwner
    {
        boostNFT = IBoostNFT(boostNFT_);
        emit BoostNFTSet(boostNFT_);
    }

    function addExcludedRewardAddress(address a)
        external
        onlyOwner
    {
        excludedRewardAddresses.push(a);
        emit ExcludedRewardAddressAdded(a);
    }

    function removeExcludedRewardAddress(uint256 idx)
        external
        onlyOwner
    {
        uint256 n = excludedRewardAddresses.length;
        require(idx < n, "BadIndex");

        address removed = excludedRewardAddresses[idx];
        excludedRewardAddresses[idx] =
            excludedRewardAddresses[n - 1];
        excludedRewardAddresses.pop();

        emit ExcludedRewardAddressRemoved(removed);
    }

    function setRewardExcluded(address a, bool excluded)
        external
        onlyOwner
    {
        isExcludedReward[a] = excluded;
        emit RewardExclusionSet(a, excluded);
    }

    /*//////////////////////////////////////////////////////////////
                        DISTRIBUTION (OWNER)
    //////////////////////////////////////////////////////////////*/

    function notifyRewardAmount(uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();

        uint256 denom = eligibleSupply();
        if (denom == 0) revert EligibleSupplyZero();

        accRewardPerToken += (amount * ACC_SCALE) / denom;
        totalDistributed  += amount;

        emit Notified(amount, denom, accRewardPerToken);
    }

    /*//////////////////////////////////////////////////////////////
                            CLAIM
    //////////////////////////////////////////////////////////////*/

    function claim()
        external
        nonReentrant
        returns (uint256 claimed)
    {
        address user = msg.sender;

        if (isExcludedReward[user])
            revert ExcludedFromRewards(user);

        uint256 bal = mmm.balanceOf(user);
        if (bal < minBalance)
            revert BalanceBelowMin(user, bal, minBalance);

        uint256 nowTs = block.timestamp;

        /*────────── HOLD TIME (FIRST CLAIM ONLY) ──────────*/
        if (lastClaimAt[user] == 0) {
            uint256 effectiveHold = minHoldTimeSec;

            if (address(boostNFT) != address(0)) {
                try boostNFT.getBoost(user)
                    returns (IBoostNFT.BoostConfig memory cfg, )
                {
                    effectiveHold =
                        cfg.holdReduction < effectiveHold
                            ? effectiveHold - cfg.holdReduction
                            : 0;
                } catch {}
            }

            uint256 lnz = mmm.lastNonZeroAt(user);
            if (nowTs < lnz + effectiveHold) {
                revert HoldTimeNotMet(
                    user,
                    lnz,
                    nowTs,
                    effectiveHold
                );
            }
        }

        /*────────── COOLDOWN (EVERY CLAIM) ──────────*/
        uint256 effectiveCooldown = claimCooldown;

        if (address(boostNFT) != address(0)) {
            try boostNFT.getBoost(user)
                returns (IBoostNFT.BoostConfig memory cfg, )
            {
                effectiveCooldown =
                    cfg.cooldownReduction < effectiveCooldown
                        ? effectiveCooldown - cfg.cooldownReduction
                        : 0;
            } catch {}
        }

        uint48 last = lastClaimAt[user];
        if (last != 0 && nowTs < uint256(last) + effectiveCooldown) {
            revert ClaimCooldownActive(
                user,
                last,
                nowTs,
                effectiveCooldown
            );
        }

        /*────────── PAYOUT ──────────*/
        claimed = pending(user);
        if (claimed == 0) revert NothingToClaim();

        // Update accounting BEFORE transfer
        rewardDebt[user] =
            (bal * accRewardPerToken) / ACC_SCALE;
        lastClaimAt[user] = uint48(nowTs);

        require(
            IERC20Like(address(mmm)).transfer(user, claimed),
            "TransferFailed"
        );

        emit Claimed(user, claimed);

        /*────────── OPTIONAL BONUS (FAIL-SAFE) ──────────*/
        uint256 paidBonus;
        if (boostVault != address(0)) {
            try IBoostVault(boostVault)
                .claimBonus(user, claimed)
                returns (uint256 b)
            {
                paidBonus = b;
            } catch {}
        }

        emit BonusAttempt(user, claimed, paidBonus);
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN SYNC (SAFE)
    //////////////////////////////////////////////////////////////*/

    /// @notice Owner-only debt sync to fix edge cases.
    /// @dev Can zero pending rewards if misused.
    function syncRewardDebt(address user)
        external
        onlyOwner
    {
        uint256 bal = mmm.balanceOf(user);
        rewardDebt[user] =
            (bal * accRewardPerToken) / ACC_SCALE;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20MetadataLike {
    function decimals() external view returns (uint8);
}

interface IERC721Like {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * BoostVault (v1)
 * Holds USDC and pays an additional claim-time bonus based on NFT ownership.
 *
 * Design goals:
 * - Does NOT change RewardVault base math (eligibleSupply, accRewardPerToken, etc.)
 * - No holder enumeration
 * - Bonus is paid only when user claims from RewardVault
 * - If BoostVault is empty, base claims still succeed (RewardVault should try/catch or tolerate 0 bonus)
 *
 * Multiplier logic (default):
 * - rareNFT.balanceOf(user) > 0 => rareMultiplierBps (11500)
 * - else if commonNFT.balanceOf(user) > 0 => commonMultiplierBps (10500)
 * - else => 10000 (no boost)
 *
 * IMPORTANT (units):
 * RewardVault baseAmount is in MMM (18 decimals). USDC typically has 6 decimals.
 * This vault computes "bonus" as:
 *   bonusMMM = baseAmount * (mult - 10000) / 10000
 * then scales to USDC decimals:
 *   bonusUSDC = bonusMMM / 10^(18 - usdcDecimals)
 *
 * This makes bonus amounts deterministic without a price oracle.
 * Your funding policy must ensure BoostVault has enough USDC to cover expected bonuses.
 */
contract BoostVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------- Constants -------------------------
    uint256 public constant BPS = 10_000;
    uint8 public constant BASE_DECIMALS = 18; // MMM decimals assumption (v1)

    // ------------------------- Immutables -------------------------
    IERC20 public immutable usdc;
    uint8 public immutable usdcDecimals;

    // ------------------------- Config -------------------------
    address public rewardVault;
    bool public rewardVaultSetOnce;

    address public commonNFT; // ERC721 (optional, can be zero until deployed)
    address public rareNFT;   // ERC721 (optional, can be zero until deployed)

    uint256 public commonMultiplierBps = 10_500; // 1.05x
    uint256 public rareMultiplierBps   = 11_500; // 1.15x

    // ------------------------- Events -------------------------
    event RewardVaultSet(address indexed rewardVault);
    event NFTsSet(address indexed commonNFT, address indexed rareNFT);
    event MultipliersSet(uint256 commonMultiplierBps, uint256 rareMultiplierBps);
    event BonusPaid(
        address indexed user,
        uint256 baseAmountMMM18,
        uint256 bonusAmountUSDC,
        uint256 multiplierBps
    );
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    // ------------------------- Errors -------------------------
    error ZeroAddress();
    error OnlyRewardVault(address caller);
    error RewardVaultAlreadySet();
    error InvalidMultiplier();
    error CannotRescueUSDC();
    error BadDecimals();

    constructor(address usdcToken, address initialOwner) Ownable(initialOwner) {
        if (usdcToken == address(0) || initialOwner == address(0)) revert ZeroAddress();

        usdc = IERC20(usdcToken);

        // Detect decimals best-effort; default to 6 if token doesn't implement decimals().
        uint8 d = 6;
        try IERC20MetadataLike(usdcToken).decimals() returns (uint8 dec) {
            d = dec;
        } catch {
            // keep default 6
        }

        // We require <= 18 to safely downscale from 18-dec base.
        if (d > BASE_DECIMALS) revert BadDecimals();
        usdcDecimals = d;
    }

    // ------------------------- Admin -------------------------

    /**
     * One-time wiring: only RewardVault can call claimBonus().
     */
    function setRewardVaultOnce(address rewardVault_) external onlyOwner {
        if (rewardVaultSetOnce) revert RewardVaultAlreadySet();
        if (rewardVault_ == address(0)) revert ZeroAddress();

        rewardVault = rewardVault_;
        rewardVaultSetOnce = true;

        emit RewardVaultSet(rewardVault_);
    }

    /**
     * Set NFT contracts (can be zero if not deployed yet).
     */
    function setNFTs(address commonNFT_, address rareNFT_) external onlyOwner {
        commonNFT = commonNFT_;
        rareNFT = rareNFT_;
        emit NFTsSet(commonNFT_, rareNFT_);
    }

    /**
     * Set multipliers in bps (>= 10000).
     */
    function setMultipliers(uint256 commonBps, uint256 rareBps) external onlyOwner {
        if (commonBps < BPS || rareBps < BPS) revert InvalidMultiplier();
        // upper cap to prevent insane boosts
        if (commonBps > 20_000 || rareBps > 20_000) revert InvalidMultiplier();

        commonMultiplierBps = commonBps;
        rareMultiplierBps = rareBps;

        emit MultipliersSet(commonBps, rareBps);
    }

    /**
     * Rescue non-USDC tokens accidentally sent here.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(usdc)) revert CannotRescueUSDC();

        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    // ------------------------- Views -------------------------

    function multiplierBps(address user) public view returns (uint256) {
        // Rare takes precedence
        if (rareNFT != address(0)) {
            try IERC721Like(rareNFT).balanceOf(user) returns (uint256 bal) {
                if (bal > 0) return rareMultiplierBps;
            } catch {
                // ignore (treat as not holding)
            }
        }
        if (commonNFT != address(0)) {
            try IERC721Like(commonNFT).balanceOf(user) returns (uint256 bal) {
                if (bal > 0) return commonMultiplierBps;
            } catch {
                // ignore (treat as not holding)
            }
        }
        return BPS;
    }

    /**
     * @notice Convert an MMM(18) amount to USDC decimals by downscaling.
     * If USDC has 6 decimals => divide by 1e12.
     */
    function _toUsdcDecimals(uint256 amountMMM18) internal view returns (uint256) {
        uint8 d = usdcDecimals;
        if (d == BASE_DECIMALS) return amountMMM18;
        uint256 div = 10 ** uint256(BASE_DECIMALS - d);
        return amountMMM18 / div;
    }

    function bonusFor(address user, uint256 baseAmountMMM18)
        external
        view
        returns (uint256 bonusUSDC, uint256 multBps)
    {
        multBps = multiplierBps(user);
        if (multBps <= BPS || baseAmountMMM18 == 0) return (0, multBps);

        uint256 bonusMMM18 = (baseAmountMMM18 * (multBps - BPS)) / BPS;
        bonusUSDC = _toUsdcDecimals(bonusMMM18);
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ------------------------- RewardVault Flow -------------------------

    /**
     * @notice Pay claim-time bonus (only callable by RewardVault).
     * @dev baseAmountMMM18 is the base reward the user just claimed (MMM, 18 decimals).
     * Bonus paid in USDC using deterministic downscale from 18 -> usdcDecimals.
     */
    function claimBonus(address user, uint256 baseAmountMMM18)
        external
        nonReentrant
        returns (uint256 paidBonusUSDC)
    {
        if (msg.sender != rewardVault) revert OnlyRewardVault(msg.sender);
        if (user == address(0)) revert ZeroAddress();
        if (baseAmountMMM18 == 0) return 0;

        uint256 mult = multiplierBps(user);
        if (mult <= BPS) return 0;

        uint256 bonusMMM18 = (baseAmountMMM18 * (mult - BPS)) / BPS;
        uint256 bonusUSDC = _toUsdcDecimals(bonusMMM18);
        if (bonusUSDC == 0) return 0;

        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) return 0;

        paidBonusUSDC = bonusUSDC > bal ? bal : bonusUSDC;
        usdc.safeTransfer(user, paidBonusUSDC);

        emit BonusPaid(user, baseAmountMMM18, paidBonusUSDC, mult);
    }
}

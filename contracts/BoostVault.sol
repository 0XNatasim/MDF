// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IERC721Like {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * BoostVault (v1)
 * Holds USDC and pays additional claim-time bonus based on NFT ownership.
 *
 * Multipliers:
 * - Rare NFT > 0 => 1.15x (11500 bps)
 * - else Common NFT > 0 => 1.05x (10500 bps)
 * - else 1.00x
 *
 * Bonus paid = baseClaim * (multiplier - 1)
 * baseClaim is MMM amount from RewardVault; bonus is USDC, so this is "value policy"
 * (you can later adjust bonus scaling logic if you want strict USD parity).
 */
contract BoostVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    IERC20 public immutable usdc;

    address public rewardVault;
    bool public rewardVaultSetOnce;

    address public commonNFT; // ERC721
    address public rareNFT;   // ERC721

    uint256 public commonMultiplierBps = 10_500; // 1.05x
    uint256 public rareMultiplierBps   = 11_500; // 1.15x

    event RewardVaultSet(address indexed rewardVault);
    event NFTsSet(address indexed commonNFT, address indexed rareNFT);
    event MultipliersSet(uint256 commonMultiplierBps, uint256 rareMultiplierBps);
    event BonusPaid(address indexed user, uint256 baseAmount, uint256 paidBonus, uint256 multiplierBps);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error OnlyRewardVault(address caller);
    error RewardVaultAlreadySet();
    error InvalidMultiplier();
    error CannotRescueUSDC();

    constructor(address usdcToken, address initialOwner) Ownable2Step() {
        if (usdcToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken);
        _transferOwnership(initialOwner);
    }

    function setRewardVaultOnce(address rewardVault_) external onlyOwner {
        if (rewardVaultSetOnce) revert RewardVaultAlreadySet();
        if (rewardVault_ == address(0)) revert ZeroAddress();
        rewardVault = rewardVault_;
        rewardVaultSetOnce = true;
        emit RewardVaultSet(rewardVault_);
    }

    function setNFTs(address commonNFT_, address rareNFT_) external onlyOwner {
        commonNFT = commonNFT_;
        rareNFT = rareNFT_;
        emit NFTsSet(commonNFT_, rareNFT_);
    }

    function setMultipliers(uint256 commonBps, uint256 rareBps) external onlyOwner {
        if (commonBps < BPS || rareBps < BPS) revert InvalidMultiplier();
        if (commonBps > 20_000 || rareBps > 20_000) revert InvalidMultiplier();
        commonMultiplierBps = commonBps;
        rareMultiplierBps = rareBps;
        emit MultipliersSet(commonBps, rareBps);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(usdc)) revert CannotRescueUSDC();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    function multiplierBps(address user) public view returns (uint256) {
        if (rareNFT != address(0)) {
            try IERC721Like(rareNFT).balanceOf(user) returns (uint256 bal) {
                if (bal > 0) return rareMultiplierBps;
            } catch {}
        }
        if (commonNFT != address(0)) {
            try IERC721Like(commonNFT).balanceOf(user) returns (uint256 bal) {
                if (bal > 0) return commonMultiplierBps;
            } catch {}
        }
        return BPS;
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function claimBonus(address user, uint256 baseAmount) external returns (uint256 paidBonus) {
        if (msg.sender != rewardVault) revert OnlyRewardVault(msg.sender);
        if (user == address(0)) revert ZeroAddress();
        if (baseAmount == 0) return 0;

        uint256 mult = multiplierBps(user);
        if (mult <= BPS) return 0;

        uint256 bonus = (baseAmount * (mult - BPS)) / BPS;
        if (bonus == 0) return 0;

        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) return 0;

        paidBonus = bonus > bal ? bal : bonus;
        usdc.safeTransfer(user, paidBonus);

        emit BonusPaid(user, baseAmount, paidBonus, mult);
    }
}

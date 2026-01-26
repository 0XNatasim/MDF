// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * TaxVault (v1)
 * Holds MMM tax proceeds (in MMM).
 *
 * v1 responsibilities:
 * - Custody MMM (taxes transferred in by MMMToken).
 * - One-time wiring to RewardVault.
 * - Allow ONLY RewardVault to pull MMM out (sweep) for conversion/distribution.
 * - Allow owner to rescue non-MMM tokens accidentally sent here.
 *
 * Notes:
 * - You cannot prevent arbitrary users from transferring MMM into the vault (ERC20),
 *   so the vault focuses on safe outbound flows + access controls.
 */
contract TaxVault is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable mmm;
    address public rewardVault;
    bool public rewardVaultSet;

    // ------------------------- Events -------------------------
    event RewardVaultSet(address indexed rewardVault);
    event SweptToRewardVault(uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    // ------------------------- Errors -------------------------
    error ZeroAddress();
    error RewardVaultAlreadySet();
    error OnlyRewardVault(address caller);
    error CannotRescueMMM();

    constructor(address mmmToken, address initialOwner) Ownable(initialOwner) {
        if (mmmToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        mmm = IERC20(mmmToken);
    }

    // ------------------------- Admin -------------------------

    /**
     * One-time wiring: RewardVault address.
     * Once set, it is the only address allowed to pull MMM out of this vault.
     */
    function setRewardVaultOnce(address rewardVault_) external onlyOwner {
        if (rewardVaultSet) revert RewardVaultAlreadySet();
        if (rewardVault_ == address(0)) revert ZeroAddress();

        rewardVault = rewardVault_;
        rewardVaultSet = true;

        emit RewardVaultSet(rewardVault_);
    }

    /**
     * Rescue non-MMM tokens accidentally sent to this vault.
     * Intentionally forbids rescuing MMM to avoid bypassing the v1 flow.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(mmm)) revert CannotRescueMMM();

        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    // ------------------------- RewardVault Flow -------------------------

    /**
     * Pull MMM out to RewardVault (only callable by RewardVault).
     * Used later by RewardVault to convert/distribute.
     */
    function sweepToRewardVault(uint256 amount) external {
        if (msg.sender != rewardVault) revert OnlyRewardVault(msg.sender);
        mmm.safeTransfer(rewardVault, amount);
        emit SweptToRewardVault(amount);
    }

    // ------------------------- Views -------------------------

    function mmmBalance() external view returns (uint256) {
        return mmm.balanceOf(address(this));
    }
}

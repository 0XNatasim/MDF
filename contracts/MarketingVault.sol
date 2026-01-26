// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * MarketingVault (v1)
 * Receives USDC marketing stream and automatically routes a fixed share to TeamVestingVault.
 *
 * Split:
 * - teamShareBps = 2500 (25% of deposits) -> TeamVestingVault
 * - remainder stays here for Marketing multisig withdrawals
 *
 * Notes:
 * - This vault does NOT perform swaps. It assumes it receives USDC already.
 * - Owner should be your 2/3 multisig.
 */
contract MarketingVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    IERC20 public immutable usdc;

    address public teamVestingVault; // receives team share (USDC)
    uint256 public teamShareBps = 2_500; // 25%

    event TeamVestingVaultSet(address indexed teamVestingVault);
    event TeamShareSet(uint256 teamShareBps);
    event SplitExecuted(uint256 depositAmount, uint256 teamAmount, uint256 marketingAmount);
    event Withdrawn(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error BadBps();
    error TeamVaultNotSet();
    error ZeroAmount();
    error CannotRescueUSDC();

    constructor(address usdcToken, address initialOwner) {
        if (usdcToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken);
        _transferOwnership(initialOwner);
    }

    // ------------------------- Admin -------------------------

    function setTeamVestingVault(address teamVault) external onlyOwner {
        if (teamVault == address(0)) revert ZeroAddress();
        teamVestingVault = teamVault;
        emit TeamVestingVaultSet(teamVault);
    }

    /**
     * teamShareBps is percent of incoming USDC that is forwarded to TeamVestingVault.
     * Must be <= 10,000. Recommended: 2,500.
     */
    function setTeamShareBps(uint256 bps) external onlyOwner {
        if (bps > BPS) revert BadBps();
        teamShareBps = bps;
        emit TeamShareSet(bps);
    }

    /**
     * Rescue non-USDC tokens accidentally sent here.
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(usdc)) revert CannotRescueUSDC();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    // ------------------------- Core -------------------------

    /**
     * Anyone can call to enforce the split on whatever USDC is currently sitting here.
     * This avoids needing a "deposit hook" from the sender.
     *
     * It will forward team share to TeamVestingVault and leave the rest.
     */
    function splitNow() external returns (uint256 teamAmount, uint256 marketingAmount) {
        address teamVault = teamVestingVault;
        if (teamVault == address(0)) revert TeamVaultNotSet();

        uint256 bal = usdc.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();

        teamAmount = (bal * teamShareBps) / BPS;
        marketingAmount = bal - teamAmount;

        if (teamAmount > 0) {
            usdc.safeTransfer(teamVault, teamAmount);
        }

        emit SplitExecuted(bal, teamAmount, marketingAmount);
    }

    /**
     * Marketing multisig (owner) withdraws USDC remaining in this vault (after split).
     */
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}

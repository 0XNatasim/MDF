// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * TeamVestingVault (v1)
 * Holds USDC and releases it linearly to a beneficiary according to schedules.
 *
 * Funding model:
 * - MarketingVault forwards team share USDC into this contract.
 * - Owner (multisig) defines vesting schedules for team wallets.
 *
 * No holder enumeration. Schedules are explicit, per beneficiary.
 */
contract TeamVestingVault is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    struct Schedule {
        uint128 total;     // total amount vested under this schedule
        uint128 claimed;   // already claimed
        uint48  start;     // start timestamp
        uint48  end;       // end timestamp (must be > start)
        bool    exists;
    }

    mapping(address => Schedule) public scheduleOf;

    event ScheduleSet(address indexed beneficiary, uint256 total, uint256 start, uint256 end);
    event Claimed(address indexed beneficiary, uint256 amount, uint256 totalClaimed);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error BadSchedule();
    error NoSchedule(address who);
    error NothingToClaim();
    error CannotRescueUSDC();

    constructor(address usdcToken, address initialOwner) {
        if (usdcToken == address(0) || initialOwner == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken);
        _transferOwnership(initialOwner);
    }

    // ------------------------- Admin -------------------------

    /**
     * Create/replace a vesting schedule for a beneficiary.
     * total is the maximum that can ever be claimed under this schedule.
     *
     * If you want multiple tranches per person, deploy v2 later with array schedules.
     * For v1: one schedule per beneficiary keeps it simple and auditable.
     */
    function setSchedule(address beneficiary, uint256 total, uint48 start, uint48 end) external onlyOwner {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (total == 0) revert BadSchedule();
        if (end <= start) revert BadSchedule();

        Schedule storage s = scheduleOf[beneficiary];
        // preserve already claimed amount if schedule exists (prevents “reset to steal” issues)
        uint128 already = s.exists ? s.claimed : 0;
        if (already > total) revert BadSchedule();

        scheduleOf[beneficiary] = Schedule({
            total: uint128(total),
            claimed: already,
            start: start,
            end: end,
            exists: true
        });

        emit ScheduleSet(beneficiary, total, start, end);
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

    // ------------------------- Views -------------------------

    function vestedAmount(address beneficiary, uint256 ts) public view returns (uint256) {
        Schedule memory s = scheduleOf[beneficiary];
        if (!s.exists) return 0;

        if (ts <= s.start) return 0;
        if (ts >= s.end) return uint256(s.total);

        uint256 duration = uint256(s.end - s.start);
        uint256 elapsed = ts - uint256(s.start);
        return (uint256(s.total) * elapsed) / duration;
    }

    function claimable(address beneficiary) public view returns (uint256) {
        Schedule memory s = scheduleOf[beneficiary];
        if (!s.exists) return 0;

        uint256 vested = vestedAmount(beneficiary, block.timestamp);
        uint256 claimed = uint256(s.claimed);
        if (vested <= claimed) return 0;
        return vested - claimed;
    }

    function usdcBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    // ------------------------- Claim -------------------------

    function claim() external returns (uint256 amount) {
        Schedule storage s = scheduleOf[msg.sender];
        if (!s.exists) revert NoSchedule(msg.sender);

        amount = claimable(msg.sender);
        if (amount == 0) revert NothingToClaim();

        s.claimed = uint128(uint256(s.claimed) + amount);

        // Pay what we can (in case vault is temporarily underfunded).
        uint256 bal = usdc.balanceOf(address(this));
        uint256 pay = amount > bal ? bal : amount;
        if (pay == 0) revert NothingToClaim();

        usdc.safeTransfer(msg.sender, pay);
        emit Claimed(msg.sender, pay, s.claimed);
        return pay;
    }
}

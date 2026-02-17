// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 }    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable }   from "@openzeppelin/contracts/access/Ownable.sol";

/*//////////////////////////////////////////////////////////////
                        ROUTER INTERFACE
//////////////////////////////////////////////////////////////*/

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint[] memory amounts);
}

/*//////////////////////////////////////////////////////////////
                    REWARD VAULT INTERFACE
//////////////////////////////////////////////////////////////*/

interface IRewardVault {
    function notifyRewardAmount(uint256 amount) external;
}

/*//////////////////////////////////////////////////////////////
                            TAX VAULT
//////////////////////////////////////////////////////////////*/

contract TaxVault is Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error NotWired();
    error AmountZero();
    error RouterMissing();
    error OnlyOwnerOrKeeper();
    error ProcessingDisabled();
    error DeadlineExpired();
    error InsufficientBalance();

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BPS  = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    /*//////////////////////////////////////////////////////////////
                                TOKENS
    //////////////////////////////////////////////////////////////*/

    IERC20 public immutable mmm;
    IERC20 public immutable usdc;
    IERC20 public immutable wmon;

    /*//////////////////////////////////////////////////////////////
                                WIRING
    //////////////////////////////////////////////////////////////*/

    address public rewardVault;
    address public swapVault;
    address public marketingVault;
    address public teamVestingVault;

    /*//////////////////////////////////////////////////////////////
                                ROUTER / KEEPER
    //////////////////////////////////////////////////////////////*/

    address public router;
    address public keeper;

    bool public processingEnabled = true;

    /*//////////////////////////////////////////////////////////////
                                SPLITS
    //////////////////////////////////////////////////////////////*/

    uint16 public bpsReward = 4000; // 40%
    uint16 public bpsBurn   = 1000; // 10%
    uint16 public bpsMkt    =  700; // 70% of USDC
    uint16 public bpsTeam   =  300; // 30% of USDC

    bool public useDirectUsdcPath = true;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Processed(
        uint256 mmmIn,
        uint256 mmmToReward,
        uint256 mmmToBurn,
        uint256 mmmSwapped,
        uint256 usdcOut,
        uint256 usdcToMkt,
        uint256 usdcToTeam
    );

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address mmmToken,
        address usdcToken,
        address wmonToken,
        address initialOwner
    ) Ownable(initialOwner) {
        if (
            mmmToken == address(0) ||
            usdcToken == address(0) ||
            wmonToken == address(0) ||
            initialOwner == address(0)
        ) revert ZeroAddress();

        mmm  = IERC20(mmmToken);
        usdc = IERC20(usdcToken);
        wmon = IERC20(wmonToken);
    }

    /*//////////////////////////////////////////////////////////////
                                MODIFIER
    //////////////////////////////////////////////////////////////*/

    modifier onlyOwnerOrKeeper() {
        if (msg.sender != owner() && msg.sender != keeper)
            revert OnlyOwnerOrKeeper();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/

    function setRouter(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        router = r;
    }

    function approveRouter() external onlyOwner {
        if (router == address(0)) revert RouterMissing();
        mmm.forceApprove(router, type(uint256).max);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
    }

    function setProcessingEnabled(bool v) external onlyOwner {
        processingEnabled = v;
    }

    function wireOnce(
        address rewardVault_,
        address swapVault_,
        address marketingVault_,
        address teamVestingVault_
    ) external onlyOwner {
        if (
            rewardVault_ == address(0) ||
            swapVault_ == address(0) ||
            marketingVault_ == address(0) ||
            teamVestingVault_ == address(0)
        ) revert ZeroAddress();

        rewardVault = rewardVault_;
        swapVault = swapVault_;
        marketingVault = marketingVault_;
        teamVestingVault = teamVestingVault_;
    }

    /*//////////////////////////////////////////////////////////////
                                PROCESS
    //////////////////////////////////////////////////////////////*/

    function process(
        uint256 mmmAmount,
        uint256 minUsdcOut,
        uint256 deadline
    ) external onlyOwnerOrKeeper {

        if (!processingEnabled) revert ProcessingDisabled();
        if (mmmAmount == 0) revert AmountZero();
        if (block.timestamp > deadline) revert DeadlineExpired();

        if (
            rewardVault == address(0) ||
            marketingVault == address(0) ||
            teamVestingVault == address(0)
        ) revert NotWired();

        uint256 balance = mmm.balanceOf(address(this));
        if (balance < mmmAmount) revert InsufficientBalance();

        /*//////////////////////////////////////////////////////////////
                            1. SPLIT MMM
        //////////////////////////////////////////////////////////////*/

        uint256 toReward = (mmmAmount * bpsReward) / BPS;
        uint256 toBurn   = (mmmAmount * bpsBurn)   / BPS;
        uint256 toSwap   = mmmAmount - toReward - toBurn;

        /*//////////////////////////////////////////////////////////////
                            2. BURN
        //////////////////////////////////////////////////////////////*/

        if (toBurn > 0)
            mmm.safeTransfer(DEAD, toBurn);

        /*//////////////////////////////////////////////////////////////
                        3. SEND REWARD + ACTIVATE EMISSION
        //////////////////////////////////////////////////////////////*/

        if (toReward > 0) {
            mmm.safeTransfer(rewardVault, toReward);
            IRewardVault(rewardVault).notifyRewardAmount(toReward);
        }

        /*//////////////////////////////////////////////////////////////
                            4. SWAP TO USDC
        //////////////////////////////////////////////////////////////*/

        uint256 usdcOut = 0;

        if (toSwap > 0) {

            if (router == address(0)) revert RouterMissing();

            address[] memory path;

            if (useDirectUsdcPath) {
                path = new address[](2);
                path[0] = address(mmm);
                path[1] = address(usdc);
            } else {
                path = new address[](3);
                path[0] = address(mmm);
                path[1] = address(wmon);
                path[2] = address(usdc);
            }

            uint256 balBefore = usdc.balanceOf(address(this));

            IUniswapV2Router02(router).swapExactTokensForTokens(
                toSwap,
                minUsdcOut,
                path,
                address(this),
                deadline
            );

            usdcOut = usdc.balanceOf(address(this)) - balBefore;
        }

        /*//////////////////////////////////////////////////////////////
                            5. SPLIT USDC
        //////////////////////////////////////////////////////////////*/

        uint256 denom = uint256(bpsMkt) + uint256(bpsTeam);

        uint256 toMkt  = denom == 0 ? 0 : (usdcOut * bpsMkt) / denom;
        uint256 toTeam = usdcOut - toMkt;

        if (toMkt  > 0) usdc.safeTransfer(marketingVault, toMkt);
        if (toTeam > 0) usdc.safeTransfer(teamVestingVault, toTeam);

        emit Processed(
            mmmAmount,
            toReward,
            toBurn,
            toSwap,
            usdcOut,
            toMkt,
            toTeam
        );
    }
}

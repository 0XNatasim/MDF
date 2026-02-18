// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MMMToken is ERC20, Ownable {

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error ZeroAddress();
    error TaxVaultAlreadySet();
    error AlreadyLaunched();
    error TradingNotEnabled();

    /*//////////////////////////////////////////////////////////////
                                CONFIG
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BPS = 10_000;

    address public taxVault;
    bool public taxVaultSetOnce;

    address public pair;
    address public router;

    bool public tradingEnabled;
    bool public launched;
    uint256 public launchTime;

    mapping(address => bool) public isTaxExempt;
    mapping(address => uint256) public lastNonZeroAt;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event Launch(uint256 timestamp);
    event TradingEnabled();
    event TaxVaultSet(address indexed vault);
    event PairSet(address indexed pair);
    event RouterSet(address indexed router);
    event TaxExemptSet(address indexed who, bool exempt);

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_
    )
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        if (owner_ == address(0)) revert ZeroAddress();

        _mint(owner_, initialSupply);

        isTaxExempt[owner_] = true;

        if (initialSupply > 0) {
            lastNonZeroAt[owner_] = block.timestamp;
        }
    }

    /*//////////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////////*/

    function setTaxVaultOnce(address vault) external onlyOwner {
        if (taxVaultSetOnce) revert TaxVaultAlreadySet();
        if (vault == address(0)) revert ZeroAddress();

        taxVault = vault;
        taxVaultSetOnce = true;

        emit TaxVaultSet(vault);
    }

    function setPair(address pair_) external onlyOwner {
        if (pair_ == address(0)) revert ZeroAddress();
        pair = pair_;
        emit PairSet(pair_);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    /// @notice Final launch trigger. Cannot be reversed.
    function launch() external onlyOwner {
        if (launched) revert AlreadyLaunched();

        launched = true;
        tradingEnabled = true;
        launchTime = block.timestamp;

        emit Launch(launchTime);
        emit TradingEnabled();
    }

    function setTaxExempt(address who, bool exempt) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        isTaxExempt[who] = exempt;
        emit TaxExemptSet(who, exempt);
    }

    /*//////////////////////////////////////////////////////////////
                        BUY / SELL DETECTION
    //////////////////////////////////////////////////////////////*/

    function isBuy(address from, address to) public view returns (bool) {
        return from == pair && to != address(0);
    }

    function isSell(address from, address to) public view returns (bool) {
        return to == pair && from != address(0);
    }

    /*//////////////////////////////////////////////////////////////
                            TAX DECAY MODEL
    //////////////////////////////////////////////////////////////*/

    function getBuyTaxBps() public view returns (uint256) {
        if (!launched) return 0;

        uint256 elapsed = block.timestamp - launchTime;

        if (elapsed < 10 minutes) return 8000;  // 80%
        if (elapsed < 20 minutes) return 5000;  // 50%
        if (elapsed < 40 minutes) return 3000;  // 30%
        if (elapsed < 60 minutes) return 1000;  // 10%
        return 500;                              // 5% final
    }

    function getSellTaxBps() public view returns (uint256) {
        if (!launched) return 0;

        uint256 elapsed = block.timestamp - launchTime;

        if (elapsed < 20 minutes) return 8000;  // 80%
        if (elapsed < 40 minutes) return 6000;  // 60%
        if (elapsed < 60 minutes) return 4000;  // 40%
        if (elapsed < 90 minutes) return 2000;  // 20%
        return 500;                              // 5% final
    }

    /*//////////////////////////////////////////////////////////////
                        LAST NON ZERO TRACKING
    //////////////////////////////////////////////////////////////*/

    function _syncLastNonZero(address a) internal {
        if (a == address(0)) return;

        uint256 bal = balanceOf(a);

        if (bal == 0) {
            lastNonZeroAt[a] = 0;
        } else {
            if (lastNonZeroAt[a] == 0) {
                lastNonZeroAt[a] = block.timestamp;
            }
        }
    }
    /*//////////////////////////////////////////////////////////////
                    OZ v5 TRANSFER HOOK (FIXED)
    //////////////////////////////////////////////////////////////*/

    function _update(address from, address to, uint256 amount) internal override {

        // Mint / burn
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        // Trading lock
        if (!tradingEnabled) {
            if (!isTaxExempt[from] && !isTaxExempt[to]) {
                revert TradingNotEnabled();
            }
        }

        bool takeTax =
            launched &&
            taxVault != address(0) &&
            pair != address(0) &&
            !isTaxExempt[from] &&
            !isTaxExempt[to];

        if (!takeTax) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        uint256 taxBps = 0;

        bool buy = isBuy(from, to);
        bool sell = isSell(from, to);

        if (buy) {
            taxBps = getBuyTaxBps();
        } else if (sell) {
            taxBps = getSellTaxBps();
        }

        if (taxBps == 0) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        uint256 tax = (amount * taxBps) / BPS;
        uint256 net = amount - tax;

        if (buy) {
            // FULL amount from pair to buyer (DO NOT tax pair)
            super._update(from, to, amount);

            if (tax > 0) {
                // Take tax from buyer
                super._update(to, taxVault, tax);
            }

        } else {
            // SELL: tax from sender
            if (tax > 0) {
                super._update(from, taxVault, tax);
            }

            super._update(from, to, net);
        }

        _syncLastNonZero(from);
        _syncLastNonZero(to);
        _syncLastNonZero(taxVault);
    }

}

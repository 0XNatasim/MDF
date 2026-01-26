// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract MMMToken is ERC20, Ownable2Step {
    // ------------------------- Errors -------------------------
    error ZeroAddress();
    error TaxVaultAlreadySet();
    error PairNotSet();
    error RouterNotSet();
    error TaxesDisabled();
    error InvalidBps();
    error OnlyTaxVault();

    // ------------------------- Config -------------------------
    address public taxVault;
    bool public taxVaultSetOnce;

    address public pair;   // MMM/WMON pair
    address public router; // UniswapV2Router02

    bool public taxesEnabled;
    uint16 public buyTaxBps;  // e.g. 500 = 5%
    uint16 public sellTaxBps; // e.g. 500 = 5%

    mapping(address => bool) public isTaxExempt;

    // last timestamp user had non-zero balance
    mapping(address => uint256) public lastNonZeroAt;

    // ------------------------- Events -------------------------
    event TaxVaultSet(address indexed vault);
    event PairSet(address indexed pair);
    event RouterSet(address indexed router);
    event TaxesSet(uint16 buyBps, uint16 sellBps);
    event TaxesEnabledSet(bool enabled);
    event TaxExemptSet(address indexed who, bool exempt);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply,
        address owner_
    ) ERC20(name_, symbol_) {
        if (owner_ == address(0)) revert ZeroAddress();
        _mint(owner_, initialSupply);
        _transferOwnership(owner_);

        // Owner is exempt by default (operational convenience)
        isTaxExempt[owner_] = true;
        emit TaxExemptSet(owner_, true);

        // Initialize lastNonZeroAt for owner if minted > 0
        if (initialSupply > 0) lastNonZeroAt[owner_] = block.timestamp;
    }

    // ------------------------- Admin wiring -------------------------

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

    function setTaxes(uint16 buyBps, uint16 sellBps) external onlyOwner {
        // hard cap for safety
        if (buyBps > 2000 || sellBps > 2000) revert InvalidBps();
        buyTaxBps = buyBps;
        sellTaxBps = sellBps;
        emit TaxesSet(buyBps, sellBps);
    }

    function setTaxesEnabled(bool enabled) external onlyOwner {
        taxesEnabled = enabled;
        emit TaxesEnabledSet(enabled);
    }

    function setTaxExempt(address who, bool exempt) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        isTaxExempt[who] = exempt;
        emit TaxExemptSet(who, exempt);
    }

    // ------------------------- Views -------------------------

    function isBuy(address from, address to) public view returns (bool) {
        return from == pair && to != address(0);
    }

    function isSell(address from, address to) public view returns (bool) {
        return to == pair && from != address(0);
    }

    // ------------------------- Internal transfer with tax -------------------------

    function _updateLastNonZero(address a, uint256 newBal) internal {
        if (a == address(0)) return;
        if (newBal > 0) {
            // if it was previously 0, stamp it
            if (lastNonZeroAt[a] == 0) lastNonZeroAt[a] = block.timestamp;
        } else {
            // when going to 0, keep the timestamp at 0 (means "not holding")
            lastNonZeroAt[a] = 0;
        }
    }

    function _afterTokenTransfer(address from, address to) internal {
        _updateLastNonZero(from, balanceOf(from));
        _updateLastNonZero(to, balanceOf(to));
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        if (from == address(0) || to == address(0)) {
            super._transfer(from, to, amount);
            return;
        }

        // stamp lastNonZeroAt on first ever acquisition
        if (balanceOf(to) == 0 && amount > 0) {
            lastNonZeroAt[to] = block.timestamp;
        }

        bool takeTax =
            taxesEnabled &&
            taxVault != address(0) &&
            !isTaxExempt[from] &&
            !isTaxExempt[to] &&
            pair != address(0);

        if (!takeTax) {
            super._transfer(from, to, amount);
            _afterTokenTransfer(from, to);
            return;
        }

        uint256 taxBps = 0;
        if (isBuy(from, to)) taxBps = buyTaxBps;
        else if (isSell(from, to)) taxBps = sellTaxBps;

        if (taxBps == 0) {
            super._transfer(from, to, amount);
            _afterTokenTransfer(from, to);
            return;
        }

        uint256 tax = (amount * taxBps) / 10_000;
        uint256 net = amount - tax;

        // send tax to vault, remainder to recipient
        super._transfer(from, taxVault, tax);
        super._transfer(from, to, net);

        _afterTokenTransfer(from, to);
    }
}

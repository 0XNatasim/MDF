// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * MMMToken (v1)
 * - ERC20 with deterministic buy/sell taxation on ONE canonical pair only.
 * - Taxes accumulate in MMM into a TaxVault (one-time wiring).
 * - No external calls to routers/pairs (no swaps, no hooks).
 * - taxesEnabled defaults to false; cannot be enabled until taxVault is set.
 * - lastNonZeroAt tracking for continuous non-zero balance holding periods.
 *
 * OpenZeppelin v5: override _update(), not _transfer().
 */
contract MMMToken is ERC20, Ownable2Step {
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_TAX_BPS = 800;

    address public taxVault;
    bool public taxVaultSet;

    address public pair;
    address public router;

    uint16 public buyTaxBps;
    uint16 public sellTaxBps;

    bool public taxesEnabled;

    mapping(address => bool) public isTaxExempt;

    mapping(address => uint48) public lastNonZeroAt;

    event TaxVaultSet(address indexed taxVault);
    event PairSet(address indexed pair);
    event RouterSet(address indexed oldRouter, address indexed newRouter);
    event TaxesUpdated(uint16 buyTaxBps, uint16 sellTaxBps);
    event TaxesEnabledSet(bool enabled);
    event TaxExemptSet(address indexed account, bool isExempt);
    event TaxTaken(address indexed from, address indexed to, uint256 grossAmount, uint256 taxAmount, address indexed taxVault);

    error ZeroAddress();
    error TaxVaultAlreadySet();
    error TaxVaultNotSet();
    error TaxesAlreadyEnabled();
    error TaxTooHigh();

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
        lastNonZeroAt[owner_] = uint48(block.timestamp);

        taxesEnabled = false;
        buyTaxBps = 500;
        sellTaxBps = 500;
    }

    function setTaxVaultOnce(address taxVault_) external onlyOwner {
        if (taxVaultSet) revert TaxVaultAlreadySet();
        if (taxVault_ == address(0)) revert ZeroAddress();

        taxVault = taxVault_;
        taxVaultSet = true;

        isTaxExempt[taxVault_] = true;
        emit TaxExemptSet(taxVault_, true);

        emit TaxVaultSet(taxVault_);
    }

    function setPair(address pair_) external onlyOwner {
        if (pair_ == address(0)) revert ZeroAddress();
        pair = pair_;
        emit PairSet(pair_);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();

        address old = router;
        if (old != address(0)) {
            isTaxExempt[old] = false;
            emit TaxExemptSet(old, false);
        }

        router = router_;
        isTaxExempt[router_] = true;
        emit TaxExemptSet(router_, true);

        emit RouterSet(old, router_);
    }

    function setTaxes(uint16 buyBps, uint16 sellBps) external onlyOwner {
        if (buyBps > MAX_TAX_BPS || sellBps > MAX_TAX_BPS) revert TaxTooHigh();
        buyTaxBps = buyBps;
        sellTaxBps = sellBps;
        emit TaxesUpdated(buyBps, sellBps);
    }

    function setTaxExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    function setTaxesEnabled(bool enabled) external onlyOwner {
        if (enabled) {
            if (!taxVaultSet) revert TaxVaultNotSet();
            if (taxesEnabled) revert TaxesAlreadyEnabled();
        }
        taxesEnabled = enabled;
        emit TaxesEnabledSet(enabled);
    }

    function _update(address from, address to, uint256 value) internal override {
        uint256 fromBalBefore = (from == address(0)) ? 0 : balanceOf(from);
        uint256 toBalBefore = (to == address(0)) ? 0 : balanceOf(to);

        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);

            if (from != address(0)) _updateLastNonZeroAt(from, fromBalBefore, balanceOf(from));
            if (to != address(0)) _updateLastNonZeroAt(to, toBalBefore, balanceOf(to));
            return;
        }

        bool canTax = taxesEnabled && taxVaultSet && pair != address(0);

        if (
            canTax &&
            !isTaxExempt[from] &&
            !isTaxExempt[to] &&
            from != router &&
            to != router
        ) {
            uint16 taxBps = 0;
            if (from == pair) taxBps = buyTaxBps;
            else if (to == pair) taxBps = sellTaxBps;

            if (taxBps != 0) {
                uint256 taxAmount = (value * taxBps) / BPS_DENOMINATOR;
                uint256 netAmount = value - taxAmount;

                super._update(from, taxVault, taxAmount);
                super._update(from, to, netAmount);

                emit TaxTaken(from, to, value, taxAmount, taxVault);

                _updateLastNonZeroAt(from, fromBalBefore, balanceOf(from));
                _updateLastNonZeroAt(to, toBalBefore, balanceOf(to));
                return;
            }
        }

        super._update(from, to, value);

        _updateLastNonZeroAt(from, fromBalBefore, balanceOf(from));
        _updateLastNonZeroAt(to, toBalBefore, balanceOf(to));
    }

    function _updateLastNonZeroAt(address user, uint256 balBefore, uint256 balAfter) internal {
        if (balBefore == 0 && balAfter > 0) {
            lastNonZeroAt[user] = uint48(block.timestamp);
            return;
        }
        if (balBefore > 0 && balAfter == 0) {
            lastNonZeroAt[user] = 0;
            return;
        }
    }
}

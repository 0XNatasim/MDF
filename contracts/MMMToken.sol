// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MMMToken is ERC20, Ownable {
    // ------------------------- Errors -------------------------
    error ZeroAddress();
    error TaxVaultAlreadySet();
    error InvalidBps();

    // ------------------------- Config -------------------------
    address public taxVault;
    bool public taxVaultSetOnce;

    address public pair;   // MMM/WMON pair
    address public router; // UniswapV2Router02 (stored for wiring/UI; not used internally)

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
    )
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        if (owner_ == address(0)) revert ZeroAddress();

        _mint(owner_, initialSupply);

        // Owner exempt by default (operational convenience)
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

    // ------------------------- lastNonZero bookkeeping -------------------------

    function _syncLastNonZero(address a) internal {
        if (a == address(0)) return;

        uint256 bal = balanceOf(a);
        if (bal == 0) {
            lastNonZeroAt[a] = 0;
        } else {
            if (lastNonZeroAt[a] == 0) lastNonZeroAt[a] = block.timestamp;
        }
    }

    // ------------------------- OZ v5 hook -------------------------
    // In OZ v5, customize transfers by overriding _update (NOT _transfer).
    function _update(address from, address to, uint256 amount) internal override {
        // Mint / burn => no tax
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        bool takeTax =
            taxesEnabled &&
            taxVault != address(0) &&
            !isTaxExempt[from] &&
            !isTaxExempt[to] &&
            pair != address(0);

        if (!takeTax) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        uint256 taxBps = 0;
        if (isBuy(from, to)) taxBps = buyTaxBps;
        else if (isSell(from, to)) taxBps = sellTaxBps;

        if (taxBps == 0) {
            super._update(from, to, amount);
            _syncLastNonZero(from);
            _syncLastNonZero(to);
            return;
        }

        uint256 tax = (amount * taxBps) / 10_000;
        uint256 net = amount - tax;

        if (tax > 0) super._update(from, taxVault, tax);
        super._update(from, to, net);

        _syncLastNonZero(from);
        _syncLastNonZero(to);
        _syncLastNonZero(taxVault);
    }
}

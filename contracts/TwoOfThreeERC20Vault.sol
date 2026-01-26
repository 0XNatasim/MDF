// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TwoOfThreeERC20Vault {
    using SafeERC20 for IERC20;

    error NotOwner();
    error BadOwners();
    error AlreadyConfirmed();
    error TxNotFound();
    error AlreadyExecuted();
    error NotConfirmed();
    error ZeroAddress();

    IERC20 public immutable token; // USDC

    address[3] public owners;
    mapping(address => bool) public isOwner;

    struct Txn {
        address to;
        uint256 amount;
        bool executed;
        uint8 confirms;
    }

    Txn[] public txns;
    mapping(uint256 => mapping(address => bool)) public confirmed;

    event Submitted(uint256 indexed txId, address indexed to, uint256 amount);
    event Confirmed(uint256 indexed txId, address indexed by, uint8 confirms);
    event Executed(uint256 indexed txId, address indexed to, uint256 amount);

    constructor(address token_, address[3] memory owners_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);

        // validate owners
        for (uint256 i = 0; i < 3; i++) {
            address o = owners_[i];
            if (o == address(0)) revert BadOwners();
            if (isOwner[o]) revert BadOwners();
            owners[i] = o;
            isOwner[o] = true;
        }
    }

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    function submit(address to, uint256 amount) external onlyOwner returns (uint256 txId) {
        if (to == address(0)) revert ZeroAddress();
        txns.push(Txn({to: to, amount: amount, executed: false, confirms: 0}));
        txId = txns.length - 1;
        emit Submitted(txId, to, amount);
    }

    function confirm(uint256 txId) external onlyOwner {
        if (txId >= txns.length) revert TxNotFound();
        Txn storage t = txns[txId];
        if (t.executed) revert AlreadyExecuted();
        if (confirmed[txId][msg.sender]) revert AlreadyConfirmed();

        confirmed[txId][msg.sender] = true;
        t.confirms += 1;
        emit Confirmed(txId, msg.sender, t.confirms);
    }

    function execute(uint256 txId) external onlyOwner {
        if (txId >= txns.length) revert TxNotFound();
        Txn storage t = txns[txId];
        if (t.executed) revert AlreadyExecuted();

        // require at least 2 confirmations
        if (t.confirms < 2) revert NotConfirmed();

        t.executed = true;
        token.safeTransfer(t.to, t.amount);
        emit Executed(txId, t.to, t.amount);
    }

    function tokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function txCount() external view returns (uint256) {
        return txns.length;
    }
}

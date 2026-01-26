// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TwoOfThreeERC20Vault} from "./TwoOfThreeERC20Vault.sol";

contract TeamVestingVault is TwoOfThreeERC20Vault {
    constructor(address usdc, address[3] memory owners) TwoOfThreeERC20Vault(usdc, owners) {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPair {
    address public token0;
    address public token1;

    constructor(address a, address b) {
        token0 = a;
        token1 = b;
    }
}

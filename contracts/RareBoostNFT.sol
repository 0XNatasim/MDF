// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract RareBoostNFT is ERC721, Ownable2Step {
    uint256 public nextId = 1;

    constructor(address initialOwner)
        ERC721("MMM Rare Boost", "MMM-RARE")
        Ownable2Step(initialOwner)
    {}

    function mint(address to) external onlyOwner returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
    }
}

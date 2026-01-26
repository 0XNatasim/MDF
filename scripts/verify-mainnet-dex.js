// scripts/verify-mainnet-dex.js
const hre = require("hardhat");
const { ethers } = hre;

function isAddr(a) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
}

async function main() {
  const FACTORY = "0x182a927119d56008d921126764bf884221b10f59";
  const ROUTER  = "0x4b2ab38dbf28d31d467aa8993f6c2585981d6804";

  if (!isAddr(FACTORY) || !isAddr(ROUTER)) {
    throw new Error("Bad FACTORY/ROUTER address format");
  }

  const net = await ethers.provider.getNetwork();
  console.log("=== DEX VERIFY ===");
  console.log("network:", hre.network.name);
  console.log("chainId:", net.chainId.toString());
  console.log("FACTORY:", FACTORY);
  console.log("ROUTER :", ROUTER);

  const fCode = await ethers.provider.getCode(FACTORY);
  const rCode = await ethers.provider.getCode(ROUTER);

  console.log("factory code:", fCode === "0x" ? "MISSING (0x)" : "OK");
  console.log("router  code:", rCode === "0x" ? "MISSING (0x)" : "OK");

  if (net.chainId !== 143n) {
    throw new Error(`Expected chainId 143 (Monad Mainnet). Got ${net.chainId.toString()}`);
  }
  if (fCode === "0x") throw new Error("Factory has no code at this address on mainnet.");
  if (rCode === "0x") throw new Error("Router has no code at this address on mainnet.");

  console.log("PASS: Factory + Router code present on Monad mainnet.");
}

main().catch((e) => {
  console.error("\n[FAIL]", e.message || e);
  process.exit(1);
});

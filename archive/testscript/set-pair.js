// scripts/set-pair-new.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  
  const MMM_ADDRESS = "0x27Badfbd4836d392E1E87487C0EE22A1E90dC096";
  const ROUTER_ADDR = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436";
  
  const [user] = await ethers.getSigners();
  
  // Get the pair address from factory
  const router = new ethers.Contract(ROUTER_ADDR, ["function factory() view returns (address)"], ethers.provider);
  const factoryAddr = await router.factory();
  const factory = new ethers.Contract(factoryAddr, ["function getPair(address,address) view returns (address)"], ethers.provider);
  
  const weth = await new ethers.Contract(ROUTER_ADDR, ["function WETH() view returns (address)"], ethers.provider).WETH();
  const pairAddress = await factory.getPair(MMM_ADDRESS, weth);
  
  console.log("Pair address:", pairAddress);
  
  if (pairAddress === ethers.ZeroAddress) {
    console.log("❌ No pool found! Create pool first.");
    return;
  }
  
  // Set as AMM pair
  const mmm = new ethers.Contract(MMM_ADDRESS, [
    "function setPair(address pair, bool enabled) external",
    "function ammPairs(address) view returns (bool)"
  ], user);
  
  const isAlreadyPair = await mmm.ammPairs(pairAddress);
  
  if (isAlreadyPair) {
    console.log("✅ Pool already set as AMM pair");
  } else {
    const tx = await mmm.setPair(pairAddress, true);
    await tx.wait();
    console.log("✅ Pool set as AMM pair!");
    console.log("Tx:", tx.hash);
  }
}

main();
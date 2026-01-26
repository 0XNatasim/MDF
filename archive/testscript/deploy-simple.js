// scripts/deploy-simple.js
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;

  // ===== CONFIG =====
  const INITIAL_SUPPLY = ethers.parseEther("1000000000"); // 1B MMM

  // Monad addresses (from you)
  const ROUTER_ADDRESS = "0xfb8e1c3b833f9e67a71c859a132cf783b645e436"; // UniswapV2Router02
  const WMON_ADDRESS   = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541"; // WMON

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "MON"
  );

  console.log("\n🚀 Deploying Contracts...");
  console.log("=".repeat(60));

  // 1) Compile
  console.log("\n1) Compiling contracts...");
  await hre.run("compile");
  console.log("✅ Compiled");

  // 2) Deploy MMM
  console.log("\n2) Deploying MMM Token...");
  const MMM = await ethers.getContractFactory("MMM");
  const mmm = await MMM.deploy(INITIAL_SUPPLY, ROUTER_ADDRESS, WMON_ADDRESS);
  await mmm.waitForDeployment();
  const mmmAddress = await mmm.getAddress();
  console.log("✅ MMM deployed:", mmmAddress);

  // 3) Deploy Tracker
  console.log("\n3) Deploying Reward Tracker...");
  const Tracker = await ethers.getContractFactory("SnapshotRewardTrackerMon");
  const tracker = await Tracker.deploy(mmmAddress);
  await tracker.waitForDeployment();
  const trackerAddress = await tracker.getAddress();
  console.log("✅ Tracker deployed:", trackerAddress);

  // 4) Configure
  console.log("\n4) Configuring contracts...");

  // Link tracker
  const tx1 = await mmm.setRewardTracker(trackerAddress);
  await tx1.wait();
  console.log("✅ Tracker set in MMM");

  // Taxes (temporary values; we’ll finalize later)
  const tx2 = await mmm.setTaxes(500, 500); // 5% buy, 5% sell
  await tx2.wait();
  console.log("✅ Taxes set: 5% buy, 5% sell");

  // Exclusions
  const tx3 = await mmm.setExcludedFromFees(ROUTER_ADDRESS, true);
  await tx3.wait();
  console.log("✅ Router excluded from fees");

  const tx4 = await mmm.setExcludedFromFees(trackerAddress, true);
  await tx4.wait();
  console.log("✅ Tracker excluded from fees");

  const tx5 = await mmm.setExcludedFromFees(deployer.address, true);
  await tx5.wait();
  console.log("✅ Deployer excluded from fees");

  // 5) Info
  console.log("\n5) Deployment Info:");
  console.log("=".repeat(60));
  console.log("Network:", hre.network.name);
  console.log("MMM Token:", mmmAddress);
  console.log("Reward Tracker:", trackerAddress);
  console.log("Router:", ROUTER_ADDRESS);
  console.log("wMON:", WMON_ADDRESS);

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    mmm.name(),
    mmm.symbol(),
    mmm.decimals(),
    mmm.totalSupply(),
  ]);

  console.log("\n📊 Token Details:");
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Decimals:", decimals);
  console.log("Total Supply:", ethers.formatUnits(totalSupply, decimals));

  console.log("\n✅ DEPLOYMENT COMPLETE.");
  console.log("Next: create pool + add initial liquidity + set pair in MMM.");
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exitCode = 1;
});

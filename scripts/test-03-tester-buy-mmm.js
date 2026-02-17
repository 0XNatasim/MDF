// scripts/test-03-tester-buy-mmm.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function loadManifest() {
  const file = path.join(
    "deployments",
    hre.network.name,
    "latest.json"
  );

  if (!fs.existsSync(file)) {
    throw new Error(`No deployment manifest found for ${hre.network.name}`);
  }

  return JSON.parse(fs.readFileSync(file));
}

async function main() {

  console.log("\n=== TEST 03: Tester acquires MMM (eligibility flow) ===\n");

  const [deployer, tester] = await ethers.getSigners();

  const manifest = loadManifest();
  const { MMM } = manifest.contracts;

  const mmm = await ethers.getContractAt("MMMToken", MMM, deployer);

  console.log("Network:", hre.network.name);
  console.log("Tester:", tester.address);

  const amount = ethers.parseUnits("1000", 18);

  console.log("Transferring MMM from deployer → tester...");
  await (await mmm.transfer(tester.address, amount)).wait();

  console.log("✓ Tester received MMM:", ethers.formatUnits(amount, 18));

  const bal = await mmm.balanceOf(tester.address);
  console.log("Tester MMM balance:", ethers.formatUnits(bal, 18));

  if (bal === 0n) {
    throw new Error("❌ Transfer failed");
  }

  console.log("\n=== TEST 03 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

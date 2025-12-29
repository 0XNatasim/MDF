const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const pairPath = path.join("deployments", `pair.${net}.json`);
  const routerPath = path.join("deployments", `router_patched.${net}.json`);
  const wmonPath = path.join("deployments", `wmon.${net}.json`);

  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(pairPath)) throw new Error(`Missing ${pairPath}`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);

  const { mmm } = readJson(mmmPath);
  const { pair } = readJson(pairPath);
  const { router } = readJson(routerPath);
  const { wmon } = readJson(wmonPath);

  const owner = (await hre.ethers.getSigners())[0];

  if (!process.env.TESTER_PRIVATE_KEY) {
    throw new Error("Missing TESTER_PRIVATE_KEY in .env");
  }

  const tester = new hre.ethers.Wallet(process.env.TESTER_PRIVATE_KEY, hre.ethers.provider);

  const mmmAbi = (await hre.artifacts.readArtifact("MMM")).abi;
  const routerAbi = (await hre.artifacts.readArtifact("PatchedV2Router02")).abi;

  const mmmC_owner = new hre.ethers.Contract(mmm, mmmAbi, owner);
  const mmmC_tester = new hre.ethers.Contract(mmm, mmmAbi, tester);
  const routerC_tester = new hre.ethers.Contract(router, routerAbi, tester);

  console.log("Network:", net);
  console.log("MMM:", mmm);
  console.log("PAIR:", pair);
  console.log("Router:", router);
  console.log("WMON:", wmon);
  console.log("Owner:", await owner.getAddress());
  console.log("Tester:", tester.address);

  const taxBefore = await mmmC_owner.taxTokens();
  console.log("taxTokens BEFORE:", taxBefore.toString());

  const testerMon = await hre.ethers.provider.getBalance(tester.address);
  console.log("Tester MON balance:", hre.ethers.formatEther(testerMon));

  // 1) Seed tester with MMM from owner (so we can sell)
  const seedAmount = hre.ethers.parseUnits("10000", 18); // 10,000 MMM
  console.log("Seeding tester with", seedAmount.toString(), "MMM...");
  let tx = await mmmC_owner.transfer(tester.address, seedAmount);
  console.log("seed tx:", tx.hash);
  await tx.wait();

  const bal = await mmmC_tester.balanceOf(tester.address);
  console.log("Tester MMM balance:", bal.toString());

  // 2) Approve router
  console.log("Approving router...");
  tx = await mmmC_tester.approve(router, seedAmount);
  console.log("approve tx:", tx.hash);
  await tx.wait();

  // 3) Sell MMM -> MON (router expects path length 2: [MMM, WMON])
  const sellAmount = hre.ethers.parseUnits("1000", 18); // 1,000 MMM
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  console.log("Selling", sellAmount.toString(), "MMM for MON...");
  tx = await routerC_tester.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmount,
    0,
    [mmm, wmon],
    tester.address,
    deadline,
    { gasLimit: 5_000_000 }
  );
  console.log("sell tx:", tx.hash);
  await tx.wait();

  const taxAfter = await mmmC_owner.taxTokens();
  console.log("taxTokens AFTER:", taxAfter.toString());

  const testerMonAfter = await hre.ethers.provider.getBalance(tester.address);
  console.log("Tester MON AFTER:", hre.ethers.formatEther(testerMonAfter));

  if (taxAfter > taxBefore) {
    console.log("SUCCESS: taxTokens increased (sell tax is working).");
  } else {
    console.log("WARNING: taxTokens did not increase. Check ammPairs + exclusions.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

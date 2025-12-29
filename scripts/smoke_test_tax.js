const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const net = hre.network.name;

  const routerPath = path.join("deployments", `router_patched.${net}.json`);
  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  const wmonPath = path.join("deployments", `wmon.${net}.json`);

  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);
  if (!fs.existsSync(mmmPath)) throw new Error(`Missing ${mmmPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);

  const { router } = readJson(routerPath);
  const { mmm } = readJson(mmmPath);
  const { wmon } = readJson(wmonPath);

  // Build tester signer from env
  const testerPk = process.env.TESTER_PRIVATE_KEY;
  if (!testerPk) throw new Error("Set TESTER_PRIVATE_KEY in .env for the wallet that will trade.");

  const tester = new hre.ethers.Wallet(testerPk, hre.ethers.provider);

  console.log("Network:", net);
  console.log("Router (patched):", router);
  console.log("MMM:", mmm);
  console.log("WMON:", wmon);
  console.log("Tester:", tester.address);

  const bal = await hre.ethers.provider.getBalance(tester.address);
  console.log("Tester MON balance:", hre.ethers.formatEther(bal));

  const mmmC = await hre.ethers.getContractAt("MMM", mmm, tester);
  const routerC = await hre.ethers.getContractAt("PatchedV2Router02", router, tester);

  // Helper view calls (owner-excluded check)
  console.log("Tester excluded from fees?:", await mmmC.isExcludedFromFees(tester.address));

  const taxBefore = await mmmC.taxTokens();
  console.log("taxTokens BEFORE:", taxBefore.toString());

  // ========= BUY: MON -> MMM =========
  const buyMon = hre.ethers.parseEther("0.01");
  console.log("\nBuying MMM with", hre.ethers.formatEther(buyMon), "MON...");

  const pathBuy = [mmm, wmon]; // NOTE: patched router expects path[1] == WETH/WMON for token->ETH swaps,
                              // but for ETH->token we are not using a router function here.
                              // Therefore: we will do a simple manual buy by sending MON to WMON+pair is more complex.

  // Instead of implementing ETH->Token swap in patched router,
  // we do the buy by transferring MON to WMON (deposit) and then swapping directly at the pair is non-trivial.
  // So: for now, we test SELL tax (MMM -> MON) which is the critical one for swapback.
  // To test BUY tax, use an external swap UI or extend patched router with swapExactETHForTokens.

  console.log("NOTE: This patched router contract we deployed includes token->ETH swap, not ETH->token.");
  console.log("So this script will test SELL tax path (MMM -> MON), which is what your swapback relies on.");
  console.log("Tester MON (wei):", (await hre.ethers.provider.getBalance(tester.address)).toString());
  console.log("Tester MMM (wei):", (await mmmC.balanceOf(tester.address)).toString());



  // ========= SELL: MMM -> MON =========
  // Send some MMM from owner to tester (owner is excluded so it transfers cleanly)
  const [ownerSigner] = await hre.ethers.getSigners();
  const ownerMMM = await hre.ethers.getContractAt("MMM", mmm, ownerSigner);

  const seed = hre.ethers.parseUnits("10000", 18);
  console.log("\nSeeding tester with", seed.toString(), "MMM from owner...");
  const txSeed = await ownerMMM.transfer(tester.address, seed);
  console.log("Seed tx:", txSeed.hash);
  await txSeed.wait();

  console.log("Tester MMM balance:", (await mmmC.balanceOf(tester.address)).toString());

  // Approve router for tester
  const allowance = await mmmC.allowance(tester.address, router);
  if (allowance < seed) {
    console.log("Approving router...");
    const txA = await mmmC.approve(router, seed);
    console.log("Approve tx:", txA.hash);
    await txA.wait();
  }

  const sellAmt = hre.ethers.parseUnits("1000", 18);

  console.log("\nSelling", sellAmt.toString(), "MMM for MON...");
  const sellPath = [mmm, wmon];

  const txSell = await routerC.swapExactTokensForETHSupportingFeeOnTransferTokens(
    sellAmt,
    0,
    sellPath,
    tester.address,
    Math.floor(Date.now() / 1000) + 60 * 20,
    { gasLimit: 3_500_000 }
  );

  console.log("Sell tx:", txSell.hash);
  await txSell.wait();

  const taxAfter = await mmmC.taxTokens();
  console.log("\ntaxTokens AFTER:", taxAfter.toString());

  const balAfter = await hre.ethers.provider.getBalance(tester.address);
  console.log("Tester MON balance AFTER:", hre.ethers.formatEther(balAfter));

  if (taxAfter > taxBefore) {
    console.log("\nSUCCESS: taxTokens increased on sell (sell tax is working).");
  } else {
    console.log("\nWARNING: taxTokens did not increase. Most likely tester is excluded or pair flag is wrong.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

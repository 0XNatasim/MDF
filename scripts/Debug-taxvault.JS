// scripts/debug-taxvault-2.js
// Pinpoints exactly where process() reverts by checking each precondition.
const hre = require("hardhat");
const { ethers } = hre;

const DELAY_MS = 300;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== Debug TaxVault — Step-by-step ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const TaxVault = await getContract("TaxVault", process.env.TESTNET_TAXVAULT, deployer);
  const MMM      = await getContract("MMMToken", process.env.TESTNET_MMM,      deployer);
  const Router   = await getContract("MockRouter", process.env.TESTNET_ROUTER, deployer);
  await sleep(DELAY_MS);

  // ─── 1) Read actual BPS from chain
  console.log("--- Split BPS (on-chain) ---\n");
  const bpsReward = await TaxVault.bpsReward(); await sleep(DELAY_MS);
  const bpsBoost  = await TaxVault.bpsBoost();  await sleep(DELAY_MS);
  const bpsLiq    = await TaxVault.bpsLiq();    await sleep(DELAY_MS);
  const bpsBurn   = await TaxVault.bpsBurn();   await sleep(DELAY_MS);
  const bpsMkt    = await TaxVault.bpsMkt();    await sleep(DELAY_MS);
  const bpsTeam   = await TaxVault.bpsTeam();   await sleep(DELAY_MS);
  const sum = Number(bpsReward)+Number(bpsBoost)+Number(bpsLiq)+Number(bpsBurn)+Number(bpsMkt)+Number(bpsTeam);
  console.log(`  reward=${bpsReward} boost=${bpsBoost} liq=${bpsLiq} burn=${bpsBurn} mkt=${bpsMkt} team=${bpsTeam} | sum=${sum}`);

  // ─── 2) Check if MockRouter actually has swapExactTokensForTokens
  console.log("\n--- MockRouter function check ---\n");
  // selector for swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
  const swapSelector = "0x8a57146b"; // keccak256 first 4 bytes — but let's just try to call it
  // Actually let's do it properly: encode a call and use eth_call
  const routerIface = new ethers.Interface([
    "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])"
  ]);
  const dummyPath = [process.env.TESTNET_MMM, process.env.TESTNET_USDC];
  const dummyData = routerIface.encodeFunctionData("swapExactTokensForTokens", [
    1n, 0n, dummyPath, deployer.address, Math.floor(Date.now()/1000)+600
  ]);
  console.log("  Calling MockRouter.swapExactTokensForTokens with amountIn=1 (will fail on transferFrom, but tells us if the function EXISTS)...");
  try {
    await provider.call({ to: process.env.TESTNET_ROUTER, data: dummyData });
    console.log("  ✓ Function exists and somehow didn't revert");
  } catch (e) {
    // If the error is about transferFrom/allowance, the function EXISTS but can't pull tokens (expected)
    // If the error is "execution reverted" with no data or "not a function", it DOESN'T exist
    if (e.data && e.data !== "0x") {
      console.log("  ✓ Function EXISTS (reverted with data — expected, we didn't approve anything)");
      console.log("    revert selector:", e.data.slice(0, 10));
    } else {
      console.log("  ✗ Function does NOT exist or reverted with no data");
      console.log("    This means the old MockRouter was deployed. You need to redeploy.");
      console.log("    error:", e.message?.slice(0, 120));
    }
  }
  await sleep(DELAY_MS);

  // ─── 3) Simulate process() math
  console.log("\n--- process() math ---\n");
  const taxBal = await MMM.balanceOf(process.env.TESTNET_TAXVAULT); await sleep(DELAY_MS);
  const mmmAmount = taxBal;

  const toReward  = (mmmAmount * BigInt(bpsReward)) / 10000n;
  const toLiq     = (mmmAmount * BigInt(bpsLiq))    / 10000n;
  const toBurn    = (mmmAmount * BigInt(bpsBurn))   / 10000n;
  const toUsdcMmm = mmmAmount - toReward - toLiq - toBurn;

  console.log(`  mmmAmount  = ${ethers.formatUnits(mmmAmount, 18)}`);
  console.log(`  toReward   = ${ethers.formatUnits(toReward, 18)}`);
  console.log(`  toLiq      = ${ethers.formatUnits(toLiq, 18)}`);
  console.log(`  toBurn     = ${ethers.formatUnits(toBurn, 18)}`);
  console.log(`  toUsdcMmm  = ${ethers.formatUnits(toUsdcMmm, 18)}  ← amount approved + swapped`);

  // ─── 4) Try each safeTransfer via eth_call to see which one reverts
  console.log("\n--- Simulating each transfer step via eth_call ---\n");

  const mmmIface = new ethers.Interface([
    "function transfer(address,uint256) returns (bool)"
  ]);

  const steps = [
    { label: "transfer to rewardVault", to: process.env.TESTNET_REWARDVAULT, amount: toReward },
    { label: "transfer to swapVault",   to: process.env.TESTNET_SWAPVAULT,   amount: toLiq },
    { label: "transfer to DEAD",        to: "0x000000000000000000000000000000000000dEaD", amount: toBurn },
  ];

  for (const step of steps) {
    const data = mmmIface.encodeFunctionData("transfer", [step.to, step.amount]);
    try {
      await provider.call({
        from: process.env.TESTNET_TAXVAULT,
        to:   process.env.TESTNET_MMM,
        data: data,
      });
      console.log(`  ✓ ${step.label} (${ethers.formatUnits(step.amount, 18)} MMM) — OK`);
    } catch (e) {
      console.log(`  ✗ ${step.label} (${ethers.formatUnits(step.amount, 18)} MMM) — REVERTS`);
      console.log(`    ${e.data ? "revert data: " + e.data.slice(0, 66) : e.message?.slice(0, 120)}`);
    }
    await sleep(DELAY_MS);
  }

  // ─── 5) Check allowance state and router USDC balance
  console.log("\n--- Current allowance & router balance ---\n");
  const allowance = await MMM.allowance(process.env.TESTNET_TAXVAULT, process.env.TESTNET_ROUTER);
  await sleep(DELAY_MS);
  const USDC = await getContract("MockERC20", process.env.TESTNET_USDC, deployer);
  const routerUsdc = await USDC.balanceOf(process.env.TESTNET_ROUTER);
  await sleep(DELAY_MS);

  console.log(`  TaxVault→Router MMM allowance: ${ethers.formatUnits(allowance, 18)}`);
  console.log(`  MockRouter USDC balance:       ${ethers.formatUnits(routerUsdc, 6)}`);

  console.log("\n=== DEBUG 2 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
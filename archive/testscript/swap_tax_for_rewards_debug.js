const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const MMM_ADDR = "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";

  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;

  console.log("Network:", hre.network.name);
  console.log("Signer :", signer.address);

  // Minimal MMM ABI needed
  const MMM_ABI = [
    "function owner() view returns (address)",
    "function router() view returns (address)",
    "function wmon() view returns (address)",
    "function rewardTracker() view returns (address)",
    "function taxTokens() view returns (uint256)",
    "function swapTaxForRewards(uint256 amount)",
  ];

  // Pair read (to compute a SAFE swap size)
  const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];
  const PAIR_ABI = [
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function getReserves() view returns (uint112,uint112,uint32)",
  ];

  const mmm = new ethers.Contract(MMM_ADDR, MMM_ABI, provider);
  const iface = new ethers.Interface(MMM_ABI);

  // ---- sanity: owner check
  const owner = await mmm.owner();
  console.log("MMM.owner():", owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("You are NOT the MMM owner. swapTaxForRewards is onlyOwner.");
  }

  const router = await mmm.router();
  const wmon = await mmm.wmon();
  const tracker = await mmm.rewardTracker();
  const taxTokens = await mmm.taxTokens();

  console.log("MMM.router():", router);
  console.log("MMM.wmon()  :", wmon);
  console.log("MMM.tracker:", tracker);
  console.log("MMM.taxTokens(raw):", taxTokens.toString());
  console.log("MMM.taxTokens:", ethers.formatUnits(taxTokens, 18), "MMM");

  if (taxTokens === 0n) {
    throw new Error("No taxTokens to swap.");
  }

  // ---- compute a safe amount based on pool reserves (optional but recommended)
  // We infer factory from your router deployment file convention:
  // If you want, hardcode your factory here:
  const FACTORY = "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615";
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);

  const pairAddr = await factory.getPair(wmon, MMM_ADDR);
  console.log("Pair:", pairAddr);

  let safeAmount = taxTokens / 1000n; // default = 0.1%
  if (pairAddr && pairAddr !== ethers.ZeroAddress) {
    const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const [t0, t1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
    const token0 = t0.toLowerCase();
    const token1 = t1.toLowerCase();

    const r0 = reserves[0];
    const r1 = reserves[1];

    let reserveMMM;
    if (token0 === MMM_ADDR.toLowerCase() && token1 === wmon.toLowerCase()) {
      reserveMMM = r0;
    } else if (token1 === MMM_ADDR.toLowerCase() && token0 === wmon.toLowerCase()) {
      reserveMMM = r1;
    } else {
      reserveMMM = 0n;
    }

    console.log("Reserve MMM (raw):", reserveMMM.toString());
    console.log("Reserve MMM:", ethers.formatUnits(reserveMMM, 18));

    // Swap at most 5% of MMM reserves so you don’t nuke your own pool
    const maxByReserve = reserveMMM / 20n; // 5%
    safeAmount = minBigint(safeAmount, maxByReserve);
  }

  // Also cap to something reasonable on testnet
  const hardCap = ethers.parseUnits("10000", 18); // 10k MMM cap
  safeAmount = minBigint(safeAmount, hardCap);

  // If somehow becomes 0, force small
  if (safeAmount <= 0n) safeAmount = ethers.parseUnits("1000", 18);

  console.log("Chosen swap amount:", ethers.formatUnits(safeAmount, 18), "MMM");

  // ---- FORCE calldata
  const data = iface.encodeFunctionData("swapTaxForRewards", [safeAmount]);
  console.log("Calldata prefix:", data.slice(0, 10), "len:", (data.length - 2) / 2);

  // ---- preflight eth_call (captures revert)
  console.log("\n--- eth_call preflight ---");
  try {
    await provider.call({ to: MMM_ADDR, from: signer.address, data });
    console.log("eth_call OK (would not revert).");
  } catch (e) {
    console.log("eth_call REVERT:", e.shortMessage || e.message || e);
    // If your contract uses custom errors, Hardhat may not decode without full artifact.
    // Still: this proves the revert is real and not “slippage”.
    throw e;
  }

  // ---- estimate gas
  console.log("\n--- estimateGas ---");
  let gas;
  try {
    gas = await provider.estimateGas({ to: MMM_ADDR, from: signer.address, data });
    console.log("estimated gas:", gas.toString());
  } catch (e) {
    console.log("estimateGas REVERT:", e.shortMessage || e.message || e);
    throw e;
  }

  // ---- send raw tx with calldata (guarantees data != "")
  console.log("\n--- sending tx ---");
  const tx = await signer.sendTransaction({
    to: MMM_ADDR,
    data,
    gasLimit: (gas * 130n) / 100n, // +30% buffer
  });

  console.log("tx hash:", tx.hash);
  const rcpt = await tx.wait();
  console.log("✅ confirmed in block:", rcpt.blockNumber);
  console.log("gasUsed:", rcpt.gasUsed.toString());
}

function minBigint(a, b) {
  return a < b ? a : b;
}

main().catch((e) => {
  console.error("\nFAILED:", e);
  process.exit(1);
});

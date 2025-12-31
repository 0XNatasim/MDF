// scripts/seed_recalibrate_direct_mint.js
const hre = require("hardhat");
const { ethers } = hre;

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const WMON_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function mint(address to) returns (uint liquidity)",
];

async function main() {
  const CONFIG = {
    mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    pair:     "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",
    wmon:     "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
  };

  // ✅ target seed (recalibrate ratio)
  const SEED_MMM = "100000";
  const SEED_MON = "0.2";

  const [signer] = await ethers.getSigners();
  console.log("Network:", hre.network.name);
  console.log("Signer :", signer.address);

  const MMM  = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
  const WMON = new ethers.Contract(CONFIG.wmon,     WMON_ABI, signer);
  const Pair = new ethers.Contract(CONFIG.pair,     PAIR_ABI, signer);

  const decimals = await MMM.decimals();
  const mmmAmount = ethers.parseUnits(SEED_MMM, decimals);
  const monAmount = ethers.parseEther(SEED_MON);

  // --------- sanity / balances ---------
  const [mmmBal, monBal] = await Promise.all([
    MMM.balanceOf(signer.address),
    ethers.provider.getBalance(signer.address),
  ]);

  console.log("\n--- Balances ---");
  console.log("MMM:", ethers.formatUnits(mmmBal, decimals));
  console.log("MON:", ethers.formatEther(monBal));

  const gasBuffer = ethers.parseEther("0.05");
  if (mmmBal < mmmAmount) throw new Error("Insufficient MMM for seed.");
  if (monBal < monAmount + gasBuffer) throw new Error("Insufficient MON (need seed + gas buffer).");

  // --------- show current reserves (for debugging) ---------
  const [t0, t1, res] = await Promise.all([Pair.token0(), Pair.token1(), Pair.getReserves()]);
  console.log("\n--- Pair tokens ---");
  console.log("token0:", t0);
  console.log("token1:", t1);

  console.log("\n--- Current reserves ---");
  console.log("reserve0:", res[0].toString());
  console.log("reserve1:", res[1].toString());

  // --------- STEP 1: transfer MMM directly to pair ---------
  console.log(`\n1) Transfer ${SEED_MMM} MMM -> Pair...`);
  const tx1 = await MMM.transfer(CONFIG.pair, mmmAmount);
  console.log("   tx:", tx1.hash);
  await tx1.wait();

  // --------- STEP 2: wrap MON to WMON (deposit) ---------
  console.log(`\n2) Wrap ${SEED_MON} MON -> WMON (deposit)...`);
  const tx2 = await WMON.deposit({ value: monAmount });
  console.log("   tx:", tx2.hash);
  await tx2.wait();

  // --------- STEP 3: transfer WMON to pair ---------
  console.log("\n3) Transfer WMON -> Pair...");
  const tx3 = await WMON.transfer(CONFIG.pair, monAmount);
  console.log("   tx:", tx3.hash);
  await tx3.wait();

  // --------- STEP 4: mint LP (this sets the new ratio effectively) ---------
  console.log("\n4) Call pair.mint(signer) to mint LP...");
  const tx4 = await Pair.mint(signer.address);
  console.log("   tx:", tx4.hash);
  const rcpt = await tx4.wait();

  console.log("\n✅ Seeded + minted LP. Recalibrated pool ratio.");
  console.log("Block:", rcpt.blockNumber);

  // Show new reserves
  const res2 = await Pair.getReserves();
  console.log("\n--- New reserves (raw) ---");
  console.log("reserve0:", res2[0].toString());
  console.log("reserve1:", res2[1].toString());
}

main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});

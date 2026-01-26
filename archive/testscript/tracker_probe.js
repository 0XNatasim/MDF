const hre = require("hardhat");
const { ethers } = hre;

const TRACKER = "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Tracker:", TRACKER);

  const prov = ethers.provider;

  const bal = await prov.getBalance(TRACKER);
  console.log("Tracker MON balance:", ethers.formatEther(bal));

  // Minimal ABI to probe common admin/ownership patterns
  const PROBE_ABI = [
    "function owner() view returns (address)",
    "function admin() view returns (address)",
    "function getOwner() view returns (address)",

    // common “rescue/sweep” variants
    "function rescueETH(uint256 amount) external",
    "function rescueNative(uint256 amount) external",
    "function sweep() external",
    "function sweepETH() external",
    "function withdraw(uint256 amount) external",
    "function withdrawETH(uint256 amount) external",
    "function recoverETH(uint256 amount) external",
    "function recoverNative(uint256 amount) external",
    "function recoverFunds(address token, uint256 amount) external",
    "function rescueToken(address token, uint256 amount) external",

    // dividend tracker style
    "function claim() external",
    "function process(uint256 gas) external returns (uint256, uint256, uint256)",
    "function distributeDividends() external payable",
  ];

  const t = new ethers.Contract(TRACKER, PROBE_ABI, signer);

  // ownership checks (ignore failures)
  for (const fn of ["owner", "admin", "getOwner"]) {
    try {
      const v = await t[fn]();
      console.log(`${fn}():`, v);
    } catch (_) {}
  }

  console.log("\n--- Probe write functions by callStatic (will revert if missing/unauthorized) ---");

  // For safety: do callStatic first; do not send tx yet.
  const amount = bal; // attempt full balance in simulation
  const tests = [
    ["rescueETH", [amount]],
    ["rescueNative", [amount]],
    ["withdraw", [amount]],
    ["withdrawETH", [amount]],
    ["recoverETH", [amount]],
    ["recoverNative", [amount]],
    ["sweep", []],
    ["sweepETH", []],
  ];

  for (const [fn, args] of tests) {
    try {
      await t.callStatic[fn](...args);
      console.log(`✅ callStatic.${fn} would succeed`);
    } catch (e) {
      // show only the short reason
      const msg = (e?.shortMessage || e?.reason || e?.message || "").split("\n")[0];
      console.log(`❌ callStatic.${fn} failed: ${msg || "revert / not present / not authorized"}`);
    }
  }

  console.log("\nIf one shows ✅, we can send the real tx using that method.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

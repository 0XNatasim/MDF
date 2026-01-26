const hre = require("hardhat");

async function main() {
  const routerAddr = "0x2532faDDa5d1B9F73da7ADb7571A71e797884ed2";

  const code = await hre.ethers.provider.getCode(routerAddr);
  console.log("Router code length:", code.length);

  const router = await hre.ethers.getContractAt("PatchedV2Router02", routerAddr);

  console.log("router.factory():", await router.factory());
  console.log("router.WETH():", await router.WETH());

  // sanity: call swap with dummy values via staticCall to see if it reverts with same reason
  const dummyPath = [
    "0xDd0a05eD815B59048dB9206213ec050f3120c359", // MMM
    "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079", // WMON
  ];

  try {
    await router.swapExactTokensForETHSupportingFeeOnTransferTokens.staticCall(
      1n,
      0n,
      dummyPath,
      "0xBF98e5FEf825CcD68dcFF3cF0a766faB413D6207",
      BigInt(Math.floor(Date.now()/1000) + 1200)
    );
    console.log("swap staticCall: OK (unexpected)");
  } catch (e) {
    console.log("swap staticCall reverted:", e.shortMessage || e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

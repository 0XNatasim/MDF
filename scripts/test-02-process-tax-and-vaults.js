// scripts/test-02-process-tax-and-vaults.js
const hre = require("hardhat");
const { ethers } = hre;

/*//////////////////////////////////////////////////////////////
  Helper — load contract with explicit signer (rate-limit safe)
//////////////////////////////////////////////////////////////*/
async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== TEST 02: Process Tax ===\n");

  /*//////////////////////////////////////////////////////////////
    Provider + signer (NO ethers.getContractAt spam)
  //////////////////////////////////////////////////////////////*/
  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("Caller (deployer):", deployer.address);

  /*//////////////////////////////////////////////////////////////
    Load contracts
  //////////////////////////////////////////////////////////////*/
  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);
  const USDC     = await getContract("MockERC20", process.env.TESTNET_USDC,     deployer);

  const tvAddr     = TaxVault.target;
  const routerAddr = process.env.TESTNET_ROUTER;

  console.log("TaxVault address:", tvAddr);
  console.log("Router address:  ", routerAddr);

  /*//////////////////////////////////////////////////////////////
    PRE-FLIGHT (minimal calls)
  //////////////////////////////////////////////////////////////*/
  const tvOwner = await TaxVault.owner();
  if (tvOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("❌ Caller is not TaxVault owner");
  }

  const onChainRouter = await TaxVault.router();
  if (onChainRouter === ethers.ZeroAddress) {
    console.log("⚠️ Router not set — setting now...");
    const tx = await TaxVault.setRouter(routerAddr);
    await tx.wait();
  }

  const allowance = await MMM.allowance(tvAddr, routerAddr);
  if (allowance === 0n) {
    console.log("⚠️ Router not approved — approving now...");
    const tx = await TaxVault.approveRouter();
    await tx.wait();
  }

  /*//////////////////////////////////////////////////////////////
    Check wiring (single batch)
  //////////////////////////////////////////////////////////////*/
  const [
    rewardVault,
    boostVault,
    swapVault,
    marketingVault,
    teamVestingVault
  ] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.boostVault(),
    TaxVault.swapVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  if (
    rewardVault      === ethers.ZeroAddress ||
    boostVault       === ethers.ZeroAddress ||
    swapVault        === ethers.ZeroAddress ||
    marketingVault   === ethers.ZeroAddress ||
    teamVestingVault === ethers.ZeroAddress
  ) {
    throw new Error("❌ TaxVault not fully wired");
  }

  console.log("✓ Pre-flight checks passed\n");

  /*//////////////////////////////////////////////////////////////
    Tax balance
  //////////////////////////////////////////////////////////////*/
  const taxBal = await MMM.balanceOf(tvAddr);
  console.log("TaxVault MMM before:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No MMM in TaxVault — run test-01 first");
  }

  /*//////////////////////////////////////////////////////////////
    PROCESS (single tx)
  //////////////////////////////////////////////////////////////*/
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process()...");
  const tx = await TaxVault.process(
    taxBal,
    0,          // minUsdcOut (OK for testnet)
    deadline
  );

  // ⛔️ THIS is where QuickNode was rate-limiting
  const receipt = await tx.wait(1);
  console.log("✓ process() executed:", receipt.hash);

  /*//////////////////////////////////////////////////////////////
    Post-balances (minimal reads)
  //////////////////////////////////////////////////////////////*/
  const logBal = async (label, token, addr, decimals = 18) => {
    const bal = await token.balanceOf(addr);
    console.log(`  ${label}: ${ethers.formatUnits(bal, decimals)}`);
  };

  console.log("\n--- Vault balances after ---");
  await logBal("RewardVault MMM",  MMM,  rewardVault);
  await logBal("BoostVault USDC",  USDC, boostVault,       6);
  await logBal("Marketing USDC",   USDC, marketingVault,   6);
  await logBal("TeamVesting USDC", USDC, teamVestingVault, 6);

  const finalMmm  = await MMM.balanceOf(tvAddr);
  const finalUsdc = await USDC.balanceOf(tvAddr);

  console.log("\nTaxVault MMM remaining :", ethers.formatUnits(finalMmm,  18));
  console.log("TaxVault USDC remaining:", ethers.formatUnits(finalUsdc, 6));

  console.log("\n=== TEST 02 COMPLETE ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

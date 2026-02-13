// scripts/test-02-process-tax-and-vaults-FIXED.js
const hre = require("hardhat");
const { ethers } = hre;

/*//////////////////////////////////////////////////////////////
  Helper – load contract with explicit signer (rate-limit safe)
//////////////////////////////////////////////////////////////*/
async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== TEST 02: Process Tax (FIXED) ===\n");

  /*//////////////////////////////////////////////////////////////
    Provider + signer
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
  const WMON     = await getContract("MockERC20", process.env.TESTNET_WMON,     deployer);
  const Router   = await getContract("MockRouter", process.env.TESTNET_ROUTER,  deployer);

  const tvAddr     = TaxVault.target;
  const routerAddr = Router.target;

  console.log("TaxVault address:", tvAddr);
  console.log("Router address:  ", routerAddr);

  /*//////////////////////////////////////////////////////////////
    CRITICAL FIX: Verify Router owns USDC and WMON
  //////////////////////////////////////////////////////////////*/
  console.log("\n=== Checking Router Ownership ===");
  
  const usdcOwner = await USDC.owner();
  const wmonOwner = await WMON.owner();
  
  console.log("USDC owner:", usdcOwner);
  console.log("WMON owner:", wmonOwner);
  console.log("Router addr:", routerAddr);

  if (usdcOwner.toLowerCase() !== routerAddr.toLowerCase()) {
    console.log("\n❌ CRITICAL: Router doesn't own USDC!");
    console.log("Transferring USDC ownership to Router...");
    const tx1 = await USDC.transferOwnership(routerAddr);
    await tx1.wait();
    console.log("✓ USDC ownership transferred");
  } else {
    console.log("✓ Router owns USDC");
  }

  if (wmonOwner.toLowerCase() !== routerAddr.toLowerCase()) {
    console.log("\n❌ CRITICAL: Router doesn't own WMON!");
    console.log("Transferring WMON ownership to Router...");
    const tx2 = await WMON.transferOwnership(routerAddr);
    await tx2.wait();
    console.log("✓ WMON ownership transferred");
  } else {
    console.log("✓ Router owns WMON");
  }

  /*//////////////////////////////////////////////////////////////
    PRE-FLIGHT (minimal calls)
  //////////////////////////////////////////////////////////////*/
  console.log("\n=== Pre-flight Checks ===");
  
  const tvOwner = await TaxVault.owner();
  if (tvOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error("❌ Caller is not TaxVault owner");
  }
  console.log("✓ Caller is TaxVault owner");

  const onChainRouter = await TaxVault.router();
  if (onChainRouter === ethers.ZeroAddress) {
    console.log("⚠️ Router not set – setting now...");
    const tx = await TaxVault.setRouter(routerAddr);
    await tx.wait();
    console.log("✓ Router set");
  } else {
    console.log("✓ Router already set");
  }

  const allowance = await MMM.allowance(tvAddr, routerAddr);
  if (allowance === 0n) {
    console.log("⚠️ Router not approved – approving now...");
    const tx = await TaxVault.approveRouter();
    await tx.wait();
    console.log("✓ Router approved");
  } else {
    console.log("✓ Router already approved");
  }

  /*//////////////////////////////////////////////////////////////
    Check wiring (single batch)
  //////////////////////////////////////////////////////////////*/
  const [
    rewardVault,
    swapVault,
    marketingVault,
    teamVestingVault
  ] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.swapVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  if (
    rewardVault      === ethers.ZeroAddress ||
    swapVault        === ethers.ZeroAddress ||
    marketingVault   === ethers.ZeroAddress ||
    teamVestingVault === ethers.ZeroAddress
  ) {
    throw new Error("❌ TaxVault not fully wired");
  }
  console.log("✓ All vaults wired");

  const processingEnabled = await TaxVault.processingEnabled();
  if (!processingEnabled) {
    throw new Error("❌ Processing is disabled");
  }
  console.log("✓ Processing enabled");

  /*//////////////////////////////////////////////////////////////
    Tax balance
  //////////////////////////////////////////////////////////////*/
  const taxBal = await MMM.balanceOf(tvAddr);
  console.log("\nTaxVault MMM before:", ethers.formatUnits(taxBal, 18));

  if (taxBal === 0n) {
    throw new Error("❌ No MMM in TaxVault – run test-01 first");
  }

  /*//////////////////////////////////////////////////////////////
    PROCESS (single tx with manual gas limit)
  //////////////////////////////////////////////////////////////*/
  const deadline = Math.floor(Date.now() / 1000) + 600;

  console.log("\nCalling TaxVault.process()...");
  
  try {
    const tx = await TaxVault.process(
      taxBal,
      0,          // minUsdcOut (OK for testnet)
      deadline,
      {
        gasLimit: 1000000  // Manual gas limit to avoid estimation issues
      }
    );

    const receipt = await tx.wait(1);
    console.log("✓ process() executed:", receipt.hash);
  } catch (error) {
    console.error("\n❌ Process failed!");
    console.error("Error:", error.message);
    if (error.data) {
      console.error("Error data:", error.data);
    }
    throw error;
  }

  /*//////////////////////////////////////////////////////////////
    Post-balances (minimal reads)
  //////////////////////////////////////////////////////////////*/
  const logBal = async (label, token, addr, decimals = 18) => {
    const bal = await token.balanceOf(addr);
    console.log(`  ${label}: ${ethers.formatUnits(bal, decimals)}`);
  };

  console.log("\n--- Vault balances after ---");
  await logBal("RewardVault MMM",  MMM,  rewardVault);
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

// scripts/check-balances-and-allowances.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== BALANCE & ALLOWANCE CHECK ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const MMM      = await getContract("MMMToken",  process.env.TESTNET_MMM,      deployer);
  const TaxVault = await getContract("TaxVault",  process.env.TESTNET_TAXVAULT, deployer);
  const Router   = await getContract("MockRouter", process.env.TESTNET_ROUTER,  deployer);
  const USDC     = await getContract("MockERC20", process.env.TESTNET_USDC,     deployer);

  const tvAddr     = TaxVault.target;
  const routerAddr = Router.target;

  console.log("Addresses:");
  console.log("  Deployer: ", deployer.address);
  console.log("  MMM:      ", MMM.target);
  console.log("  TaxVault: ", tvAddr);
  console.log("  Router:   ", routerAddr);
  console.log("  USDC:     ", USDC.target);
  console.log();

  // Get all vaults
  const [rewardVault, swapVault, marketingVault, teamVestingVault] = await Promise.all([
    TaxVault.rewardVault(),
    TaxVault.swapVault(),
    TaxVault.marketingVault(),
    TaxVault.teamVestingVault()
  ]);

  console.log("Vaults:");
  console.log("  Reward:    ", rewardVault);
  console.log("  Swap:      ", swapVault);
  console.log("  Marketing: ", marketingVault);
  console.log("  TeamVest:  ", teamVestingVault);
  console.log();

  // Check MMM balances
  console.log("=== MMM BALANCES ===");
  const deployerMmm = await MMM.balanceOf(deployer.address);
  const taxVaultMmm = await MMM.balanceOf(tvAddr);
  const rewardVaultMmm = await MMM.balanceOf(rewardVault);
  const routerMmm = await MMM.balanceOf(routerAddr);

  console.log("  Deployer:    ", ethers.formatUnits(deployerMmm, 18));
  console.log("  TaxVault:    ", ethers.formatUnits(taxVaultMmm, 18), "← This is what we process");
  console.log("  RewardVault: ", ethers.formatUnits(rewardVaultMmm, 18));
  console.log("  Router:      ", ethers.formatUnits(routerMmm, 18));
  console.log();

  // Check USDC balances
  console.log("=== USDC BALANCES ===");
  const deployerUsdc = await USDC.balanceOf(deployer.address);
  const taxVaultUsdc = await USDC.balanceOf(tvAddr);
  const marketingUsdc = await USDC.balanceOf(marketingVault);
  const teamVestUsdc = await USDC.balanceOf(teamVestingVault);
  const routerUsdc = await USDC.balanceOf(routerAddr);

  console.log("  Deployer:    ", ethers.formatUnits(deployerUsdc, 6));
  console.log("  TaxVault:    ", ethers.formatUnits(taxVaultUsdc, 6));
  console.log("  Marketing:   ", ethers.formatUnits(marketingUsdc, 6));
  console.log("  TeamVesting: ", ethers.formatUnits(teamVestUsdc, 6));
  console.log("  Router:      ", ethers.formatUnits(routerUsdc, 6));
  console.log();

  // Check allowances
  console.log("=== MMM ALLOWANCES ===");
  const tvToRouter = await MMM.allowance(tvAddr, routerAddr);
  const deployerToRouter = await MMM.allowance(deployer.address, routerAddr);
  
  console.log("  TaxVault → Router:  ", ethers.formatUnits(tvToRouter, 18));
  console.log("  Deployer → Router:  ", ethers.formatUnits(deployerToRouter, 18));
  console.log();

  // Check if TaxVault has enough MMM
  if (taxVaultMmm === 0n) {
    console.log("❌ TaxVault has NO MMM!");
    console.log("   Run test-01 to send MMM to TaxVault");
    return;
  }

  // Check if router allowance is sufficient
  if (tvToRouter < taxVaultMmm) {
    console.log("❌ TaxVault allowance to Router is insufficient!");
    console.log("   Current:", ethers.formatUnits(tvToRouter, 18));
    console.log("   Needed: ", ethers.formatUnits(taxVaultMmm, 18));
    console.log("   Run: TaxVault.approveRouter()");
    return;
  }

  // Calculate what process() will do
  console.log("=== PROCESS() CALCULATION ===");
  const bpsReward = await TaxVault.bpsReward();
  const bpsBurn = await TaxVault.bpsBurn();
  const bpsMkt = await TaxVault.bpsMkt();
  const bpsTeam = await TaxVault.bpsTeam();
  const BPS = 10000n;

  console.log("BPS Settings:");
  console.log("  Reward:", bpsReward.toString(), `(${Number(bpsReward) / 100}%)`);
  console.log("  Burn:  ", bpsBurn.toString(), `(${Number(bpsBurn) / 100}%)`);
  console.log("  Mkt:   ", bpsMkt.toString(), "(relative to USDC out)");
  console.log("  Team:  ", bpsTeam.toString(), "(relative to USDC out)");
  console.log();

  const toReward = (taxVaultMmm * bpsReward) / BPS;
  const toBurn = (taxVaultMmm * bpsBurn) / BPS;
  const toSwap = taxVaultMmm - toReward - toBurn;

  console.log("MMM Split:");
  console.log("  To RewardVault:", ethers.formatUnits(toReward, 18), "MMM (40%)");
  console.log("  To DEAD (burn):", ethers.formatUnits(toBurn, 18), "MMM (10%)");
  console.log("  To Swap:       ", ethers.formatUnits(toSwap, 18), "MMM (50%)");
  console.log();

  // Expected USDC out (MockRouter converts 18 decimals to 6)
  const expectedUsdc = toSwap / 1000000000000n; // divide by 1e12
  console.log("Expected USDC from swap:", ethers.formatUnits(expectedUsdc, 6), "USDC");
  
  const denom = BigInt(bpsMkt) + BigInt(bpsTeam);
  const toMkt = (expectedUsdc * BigInt(bpsMkt)) / denom;
  const toTeam = expectedUsdc - toMkt;

  console.log("USDC Split:");
  console.log("  To Marketing:   ", ethers.formatUnits(toMkt, 6), "USDC (70%)");
  console.log("  To TeamVesting: ", ethers.formatUnits(toTeam, 6), "USDC (30%)");
  console.log();

  // Check Router configuration
  console.log("=== ROUTER CONFIGURATION ===");
  const routerMmmAddr = await Router.MMM();
  const routerUsdcAddr = await Router.USDC();
  const routerWmonAddr = await Router.WMON();

  console.log("  Router.MMM:  ", routerMmmAddr);
  console.log("  Actual MMM:  ", MMM.target);
  console.log("  Match:       ", routerMmmAddr.toLowerCase() === MMM.target.toLowerCase() ? "✓" : "❌");
  console.log();
  console.log("  Router.USDC: ", routerUsdcAddr);
  console.log("  Actual USDC: ", USDC.target);
  console.log("  Match:       ", routerUsdcAddr.toLowerCase() === USDC.target.toLowerCase() ? "✓" : "❌");
  console.log();

  // Check USDC and WMON ownership
  const usdcOwner = await USDC.owner();
  const wmonOwner = await (await getContract("MockERC20", process.env.TESTNET_WMON, deployer)).owner();

  console.log("  USDC owner:  ", usdcOwner);
  console.log("  Router addr: ", routerAddr);
  console.log("  Router owns USDC:", usdcOwner.toLowerCase() === routerAddr.toLowerCase() ? "✓" : "❌");
  console.log();
  console.log("  WMON owner:  ", wmonOwner);
  console.log("  Router owns WMON:", wmonOwner.toLowerCase() === routerAddr.toLowerCase() ? "✓" : "❌");
  console.log();

  // Check processing enabled
  const processingEnabled = await TaxVault.processingEnabled();
  console.log("=== TAXVAULT STATE ===");
  console.log("  Processing enabled:", processingEnabled ? "✓ YES" : "❌ NO");
  
  const onChainRouter = await TaxVault.router();
  console.log("  Router set:        ", onChainRouter);
  console.log("  Router matches:    ", onChainRouter.toLowerCase() === routerAddr.toLowerCase() ? "✓" : "❌");

  const useDirectPath = await TaxVault.useDirectUsdcPath();
  console.log("  Direct USDC path:  ", useDirectPath ? "YES (MMM→USDC)" : "NO (MMM→WMON→USDC)");
  console.log();

  console.log("=== ALL CHECKS COMPLETE ===");
  console.log("\nReady to call process() with:");
  console.log("  mmmAmount: ", ethers.formatUnits(taxVaultMmm, 18));
  console.log("  minUsdcOut:", "0 (testnet, no slippage protection)");
  console.log("  deadline:  ", Math.floor(Date.now() / 1000) + 600);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

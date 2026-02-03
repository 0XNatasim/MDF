// ─── paste this ENTIRE block into: npx hardhat console --network monadTestnet ───

(async () => {
    const fmt = (n, d = 18) => ethers.formatUnits(n, d);
  
    // ── addresses from .env ─────────────────────────────────────────────
    const TV_ADDR     = process.env.TESTNET_TAXVAULT;
    const MMM_ADDR    = process.env.TESTNET_MMM;
    const USDC_ADDR   = process.env.TESTNET_USDC;
    const ROUTER_ADDR = process.env.TESTNET_ROUTER;
  
    // ── bind contracts ──────────────────────────────────────────────────
    const TaxVault = await ethers.getContractAt("TaxVault",  TV_ADDR);
    const MMM      = await ethers.getContractAt("MMMToken",  MMM_ADDR);
    const USDC     = await ethers.getContractAt("MockERC20", USDC_ADDR);
  
    console.log("\n========== DIAGNOSE ==========\n");
  
    // ── 1. TaxVault state ───────────────────────────────────────────────
    console.log("--- TaxVault state ---");
    console.log("  owner:              ", await TaxVault.owner());
    console.log("  router:             ", await TaxVault.router());
    console.log("  keeper:             ", await TaxVault.keeper());
    console.log("  useDirectUsdcPath:  ", await TaxVault.useDirectUsdcPath());
    console.log("  rewardVault:        ", await TaxVault.rewardVault());
    console.log("  boostVault:         ", await TaxVault.boostVault());
    console.log("  swapVault:          ", await TaxVault.swapVault());
    console.log("  marketingVault:     ", await TaxVault.marketingVault());
    console.log("  teamVestingVault:   ", await TaxVault.teamVestingVault());
    console.log("  bpsReward:          ", await TaxVault.bpsReward());
    console.log("  bpsBoost:           ", await TaxVault.bpsBoost());
    console.log("  bpsBurn:            ", await TaxVault.bpsBurn());
    console.log("  bpsMkt:             ", await TaxVault.bpsMkt());
    console.log("  bpsTeam:            ", await TaxVault.bpsTeam());
  
    // ── 2. Balances ─────────────────────────────────────────────────────
    const tvMmm = await MMM.balanceOf(TV_ADDR);
    console.log("\n--- Balances ---");
    console.log("  TaxVault MMM:       ", fmt(tvMmm));
    console.log("  TaxVault USDC:      ", fmt(await USDC.balanceOf(TV_ADDR), 6));
    console.log("  Router  MMM:        ", fmt(await MMM.balanceOf(ROUTER_ADDR)));
  
    // ── 3. Allowance ────────────────────────────────────────────────────
    const allow = await MMM.allowance(TV_ADDR, ROUTER_ADDR);
    console.log("\n--- Allowance ---");
    console.log("  MMM allowance (TaxVault → Router):", fmt(allow));
  
    // ── 4. MMM tax config ───────────────────────────────────────────────
    //    These are the critical ones. MMMToken likely has tax rate + taxVault.
    //    If tax is charged on TaxVault's OWN outgoing transfers, balance
    //    drops more than expected and the router pull fails.
    console.log("\n--- MMMToken tax config ---");
    try { console.log("  taxVault:           ", await MMM.taxVault());           } catch(e) { console.log("  taxVault:            N/A"); }
    try { console.log("  taxRate:            ", await MMM.taxRate());            } catch(e) { console.log("  taxRate:             N/A"); }
    try { console.log("  taxBps:             ", await MMM.taxBps());             } catch(e) { console.log("  taxBps:              N/A"); }
    try { console.log("  isTaxExempt(TV):    ", await MMM.isTaxExempt(TV_ADDR)); } catch(e) { console.log("  isTaxExempt(TV):     N/A"); }
    try { console.log("  isTaxExempt(Router):", await MMM.isTaxExempt(ROUTER_ADDR)); } catch(e) { console.log("  isTaxExempt(Router): N/A"); }
    try { console.log("  isTaxExempt(DEAD):  ", await MMM.isTaxExempt("0x000000000000000000000000000000000000dEaD")); } catch(e) { console.log("  isTaxExempt(DEAD):   N/A"); }
  
    // ── 5. Simulate the math ────────────────────────────────────────────
    console.log("\n--- Simulated split math (no tax) ---");
    const BPS        = 10000n;
    const bpsReward  = BigInt(await TaxVault.bpsReward());
    const bpsBurn    = BigInt(await TaxVault.bpsBurn());
    const toReward   = (tvMmm * bpsReward) / BPS;
    const toBurn     = (tvMmm * bpsBurn)   / BPS;
    const toSwap     = tvMmm - toReward - toBurn;
    console.log("  mmmAmount (balance): ", fmt(tvMmm));
    console.log("  toReward  (40%):     ", fmt(toReward));
    console.log("  toBurn    (10%):     ", fmt(toBurn));
    console.log("  toSwap    (50%):     ", fmt(toSwap));
    console.log("  sum check:           ", fmt(toReward + toBurn + toSwap), "(should == mmmAmount)");
  
    // ── 6. Do a test transfer to see if tax eats balance ───────────────
    console.log("\n--- Live transfer test ---");
    console.log("  TaxVault MMM BEFORE test transfer:", fmt(await MMM.balanceOf(TV_ADDR)));
    // We won't actually send — just flag what to check manually if needed
    console.log("  → If tax is NOT exempt on TaxVault, each safeTransfer out");
    console.log("    deducts MORE than the amount. By the time router pulls,");
    console.log("    TaxVault has < toSwap  →  transferFrom reverts.");
    console.log("");
    console.log("  FIX: either exempt TaxVault from tax in MMMToken,");
    console.log("       or snapshot the REAL balance after the two transfers");
    console.log("       and pass that to the router instead of the calculated toSwap.");
  
    console.log("\n========== DONE ==========\n");
  })();
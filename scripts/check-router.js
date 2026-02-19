const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  console.log("\n=== CHECK ROUTER ===\n");

  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const artifact = await hre.artifacts.readArtifact("UniswapV2Router02");
  const iface = new ethers.Interface(artifact.abi);

  // ethers v6: use iface.fragments instead of iface.functions
  const fns = artifact.abi.filter(f => f.type === "function");

  console.log("Swap-related functions in router ABI:");
  fns.filter(f => f.name.toLowerCase().includes("swap") || f.name.toLowerCase().includes("eth"))
     .forEach(f => {
       const sig = `${f.name}(${f.inputs.map(i => i.type).join(",")})`;
       const selector = ethers.id(sig).slice(0, 10);
       console.log(` - ${f.name}`);
       console.log(`   selector: ${selector}`);
     });

  // Check bytecode at router address
  const code = await provider.getCode(process.env.TESTNET_ROUTER);
  console.log("\nRouter bytecode length:", code.length);
  console.log("Router has code:", code.length > 2 ? "✅ Yes" : "❌ No");

  const targetSelector = "b6f9de95"; // swapExactETHForTokensSupportingFeeOnTransferTokens
  const swapExact      = "7ff36ab5"; // swapExactETHForTokens
  const swapExactTokens = "18cbafe5"; // swapExactTokensForETH

  console.log(`\nSelector b6f9de95 (swapExactETHForTokensSupportingFeeOnTransferTokens): ${code.includes(targetSelector) ? "✅ Found" : "❌ NOT FOUND"}`);
  console.log(`Selector 7ff36ab5 (swapExactETHForTokens):                              ${code.includes(swapExact) ? "✅ Found" : "❌ NOT FOUND"}`);
  console.log(`Selector 18cbafe5 (swapExactTokensForETH):                              ${code.includes(swapExactTokens) ? "✅ Found" : "❌ NOT FOUND"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
// scripts/verify-router-ownership.js
const hre = require("hardhat");
const { ethers } = hre;

async function getContract(name, address, signer) {
  const artifact = await hre.artifacts.readArtifact(name);
  return new ethers.Contract(address, artifact.abi, signer);
}

async function main() {
  console.log("=== Verify Router Ownership ===\n");

  const rpcUrl   = hre.network.config.url;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const USDC   = await getContract("MockERC20", process.env.TESTNET_USDC,   deployer);
  const WMON   = await getContract("MockERC20", process.env.TESTNET_WMON,   deployer);
  const Router = await getContract("MockRouter", process.env.TESTNET_ROUTER, deployer);

  const routerAddr = Router.target;

  console.log("Router address:", routerAddr);
  console.log("Deployer address:", deployer.address);
  console.log();

  const usdcOwner = await USDC.owner();
  const wmonOwner = await WMON.owner();

  console.log("USDC contract:", USDC.target);
  console.log("USDC owner:   ", usdcOwner);
  console.log("Match router: ", usdcOwner.toLowerCase() === routerAddr.toLowerCase() ? "✓ YES" : "❌ NO");
  console.log();

  console.log("WMON contract:", WMON.target);
  console.log("WMON owner:   ", wmonOwner);
  console.log("Match router: ", wmonOwner.toLowerCase() === routerAddr.toLowerCase() ? "✓ YES" : "❌ NO");
  console.log();

  // If router doesn't own them, transfer ownership
  let needsTransfer = false;

  if (usdcOwner.toLowerCase() !== routerAddr.toLowerCase()) {
    console.log("⚠️  USDC is not owned by Router!");
    if (usdcOwner.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("Current owner is deployer - we can transfer...");
      needsTransfer = true;
    } else {
      console.log("❌ Current owner is someone else - cannot transfer!");
    }
  }

  if (wmonOwner.toLowerCase() !== routerAddr.toLowerCase()) {
    console.log("⚠️  WMON is not owned by Router!");
    if (wmonOwner.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("Current owner is deployer - we can transfer...");
      needsTransfer = true;
    } else {
      console.log("❌ Current owner is someone else - cannot transfer!");
    }
  }

  if (needsTransfer) {
    console.log("\n=== Transferring Ownership ===");
    
    if (usdcOwner.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("Transferring USDC ownership to Router...");
      const tx1 = await USDC.transferOwnership(routerAddr);
      await tx1.wait();
      console.log("✓ USDC ownership transferred");
    }

    if (wmonOwner.toLowerCase() === deployer.address.toLowerCase()) {
      console.log("Transferring WMON ownership to Router...");
      const tx2 = await WMON.transferOwnership(routerAddr);
      await tx2.wait();
      console.log("✓ WMON ownership transferred");
    }

    console.log("\n=== Verification After Transfer ===");
    const newUsdcOwner = await USDC.owner();
    const newWmonOwner = await WMON.owner();
    
    console.log("USDC owner:", newUsdcOwner);
    console.log("WMON owner:", newWmonOwner);
    console.log();
    console.log("✓ Ownership transfer complete!");
  } else {
    console.log("✓ Router already owns USDC and WMON");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

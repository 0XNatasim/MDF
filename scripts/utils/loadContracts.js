const fs = require("fs");
const path = require("path");

function loadAddresses(hre) {
  const network = hre.network.name;

  // Try deployment manifest first
  const manifestPath = path.join(
    __dirname,
    `../../deployments/${network}/latest.json`
  );

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    console.log(`📦 Loaded addresses from deployments/${network}/latest.json`);
    return manifest.contracts;
  }

  // Fallback to .env
  console.log("📄 Loaded addresses from .env");

  return {
    MMM: process.env.TESTNET_MMM,
    WMON: process.env.TESTNET_WMON,
    USDC: process.env.TESTNET_USDC,
    ROUTER: process.env.TESTNET_ROUTER,
    TAX_VAULT: process.env.TESTNET_TAXVAULT,
    REWARD_VAULT: process.env.TESTNET_REWARDVAULT,
    SWAP_VAULT: process.env.TESTNET_SWAPVAULT,
    MARKETING_VAULT: process.env.TESTNET_MARKETINGVAULT,
    TEAM_VAULT: process.env.TESTNET_TEAMVAULT
  };
}

module.exports = { loadAddresses };

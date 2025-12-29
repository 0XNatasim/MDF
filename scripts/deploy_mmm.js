const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Native balance:", hre.ethers.formatEther(bal), "MON");

  const wmonPath = path.join("deployments", `wmon.${hre.network.name}.json`);
  const routerPath = path.join("deployments", `router.${hre.network.name}.json`);

  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}. Deploy WMON first.`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}. Deploy Router first.`);

  const { wmon } = readJson(wmonPath);
  const { router } = readJson(routerPath);

  console.log("Router:", router);
  console.log("WMON:", wmon);

  // ===== CONFIG: total supply =====
  // Example: 1,000,000,000 MMM (18 decimals)
  const totalSupplyHuman = "1000000000";
  const totalSupply = hre.ethers.parseUnits(totalSupplyHuman, 18);

  console.log("Deploying MMM totalSupply:", totalSupplyHuman, "MMM");

  const MMM = await hre.ethers.getContractFactory("MMM");
  const mmm = await MMM.deploy(totalSupply, router, wmon);

  console.log("Deploy tx:", mmm.deploymentTransaction().hash);
  await mmm.waitForDeployment();

  const addr = await mmm.getAddress();
  console.log("MMM deployed at:", addr);

  // sanity reads
  console.log("MMM router():", await mmm.router());
  console.log("MMM wmon():", await mmm.wmon());

  // persist
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `mmm.${hre.network.name}.json`),
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        mmm: addr,
        router,
        wmon,
        supplyHuman: totalSupplyHuman,
        supplyWei: totalSupply.toString(),
        txHash: mmm.deploymentTransaction().hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("Saved deployments file.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

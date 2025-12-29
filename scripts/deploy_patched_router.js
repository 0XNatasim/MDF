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

  const factoryPath = path.join("deployments", `factory.${hre.network.name}.json`);
  const wmonPath = path.join("deployments", `wmon.${hre.network.name}.json`);

  if (!fs.existsSync(factoryPath)) throw new Error(`Missing ${factoryPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);

  const { factory } = readJson(factoryPath);
  const { wmon } = readJson(wmonPath);

  console.log("Factory:", factory);
  console.log("WMON:", wmon);

  const R = await hre.ethers.getContractFactory("PatchedV2Router02");
  const r = await R.deploy(factory, wmon);

  console.log("Deploy tx:", r.deploymentTransaction().hash);
  await r.waitForDeployment();

  const addr = await r.getAddress();
  console.log("PatchedV2Router02 deployed at:", addr);

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `router_patched.${hre.network.name}.json`),
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        router: addr,
        factory,
        wmon,
        txHash: r.deploymentTransaction().hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("Saved deployments/router_patched.<network>.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

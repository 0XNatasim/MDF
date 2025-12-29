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
  console.log("Balance:", hre.ethers.formatEther(bal), "MON");

  const factoryPath = path.join("deployments", `factory.${hre.network.name}.json`);
  const wmonPath = path.join("deployments", `wmon.${hre.network.name}.json`);

  if (!fs.existsSync(factoryPath)) {
    throw new Error(`Missing ${factoryPath}. Deploy Factory first.`);
  }
  if (!fs.existsSync(wmonPath)) {
    throw new Error(`Missing ${wmonPath}. Deploy WMON first.`);
  }

  const factoryJson = readJson(factoryPath);
  const wmonJson = readJson(wmonPath);

  const factory = factoryJson.factory;
  const wmon = wmonJson.wmon;

  console.log("Factory:", factory);
  console.log("WMON:", wmon);

  // UniswapV2Router02 constructor: (address _factory, address _WETH)
  const Router = await hre.ethers.getContractFactory("UniswapV2Router02");
  const router = await Router.deploy(factory, wmon);

  console.log("Deploy tx:", router.deploymentTransaction().hash);
  await router.waitForDeployment();

  const routerAddr = await router.getAddress();
  console.log("UniswapV2Router02 deployed at:", routerAddr);

  // sanity checks (Router exposes these public vars)
  console.log("router.factory():", await router.factory());
  console.log("router.WETH():", await router.WETH());

  // persist
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `router.${hre.network.name}.json`),
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        router: routerAddr,
        factory,
        wmon,
        txHash: router.deploymentTransaction().hash,
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

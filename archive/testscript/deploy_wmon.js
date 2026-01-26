const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "MON");

  const WMON = await hre.ethers.getContractFactory("WMON");
  const wmon = await WMON.deploy();

  console.log("Deploy tx:", wmon.deploymentTransaction().hash);
  await wmon.waitForDeployment();

  const addr = await wmon.getAddress();
  console.log("WMON deployed at:", addr);

  // quick sanity: totalSupply should be 0 at start
  const ts = await wmon.totalSupply();
  console.log("WMON totalSupply:", ts.toString());

  // persist
  const fs = require("fs");
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    `deployments/wmon.${hre.network.name}.json`,
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        wmon: addr,
        txHash: wmon.deploymentTransaction().hash,
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

const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Network:", hre.network.name);
  console.log("Deployer:", deployer.address);

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "MON");

  const feeToSetter = deployer.address;

  const Factory = await hre.ethers.getContractFactory("UniswapV2Factory");
  const factory = await Factory.deploy(feeToSetter);

  console.log("Deploy tx:", factory.deploymentTransaction().hash);
  await factory.waitForDeployment();

  const addr = await factory.getAddress();
  console.log("UniswapV2Factory deployed at:", addr);
  console.log("feeToSetter:", feeToSetter);

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    `deployments/factory.${hre.network.name}.json`,
    JSON.stringify(
      {
        network: hre.network.name,
        deployer: deployer.address,
        factory: addr,
        feeToSetter,
        txHash: factory.deploymentTransaction().hash,
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

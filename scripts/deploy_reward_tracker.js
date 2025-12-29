const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;

  console.log("Network:", net);
  console.log("Deployer:", deployer.address);

  // Load MMM address
  const mmmPath = path.join("deployments", `mmm.${net}.json`);
  if (!fs.existsSync(mmmPath)) {
    throw new Error("MMM deployment not found");
  }

  const { mmm } = JSON.parse(fs.readFileSync(mmmPath, "utf8"));
  console.log("MMM token:", mmm);

  // Deploy tracker
  const Tracker = await hre.ethers.getContractFactory("SnapshotRewardTrackerMon");
  const tracker = await Tracker.deploy(mmm);

  console.log("Deploy tx:", tracker.deploymentTransaction().hash);
  await tracker.waitForDeployment();

  const trackerAddr = await tracker.getAddress();
  console.log("SnapshotRewardTrackerMon deployed at:", trackerAddr);

  // Save deployment
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `rewardTracker.${net}.json`),
    JSON.stringify(
      {
        network: net,
        deployer: deployer.address,
        rewardTracker: trackerAddr,
        mmm,
        txHash: tracker.deploymentTransaction().hash,
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("Saved deployments/rewardTracker.<network>.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

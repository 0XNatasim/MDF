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

  const factoryPath = path.join("deployments", `factory.${hre.network.name}.json`);
  const wmonPath = path.join("deployments", `wmon.${hre.network.name}.json`);
  const routerPath = path.join("deployments", `router.${hre.network.name}.json`);

  if (!fs.existsSync(factoryPath)) throw new Error(`Missing ${factoryPath}`);
  if (!fs.existsSync(wmonPath)) throw new Error(`Missing ${wmonPath}`);
  if (!fs.existsSync(routerPath)) throw new Error(`Missing ${routerPath}`);

  const { factory } = readJson(factoryPath);
  const { wmon } = readJson(wmonPath);
  const { router } = readJson(routerPath);

  console.log("Factory:", factory);
  console.log("WMON:", wmon);
  console.log("Router:", router);

  // ============
  // CONFIG YOU SET
  // ============
  // 1) Your MMM token address:
  //    - If you've already deployed MMM and saved it, put it in deployments/mmm.monadTestnet.json
  //    - Otherwise paste it here.
  const mmmDeployPath = path.join("deployments", `mmm.${hre.network.name}.json`);
  let MMM_ADDRESS = null;

  if (fs.existsSync(mmmDeployPath)) {
    const mmmJson = readJson(mmmDeployPath);
    MMM_ADDRESS = mmmJson.mmm || mmmJson.token || mmmJson.address;
  }

  if (!MMM_ADDRESS) {
    // TODO: paste if you don't have deployments/mmm.<network>.json
    MMM_ADDRESS = process.env.MMM_ADDRESS || "";
  }

  if (!hre.ethers.isAddress(MMM_ADDRESS) || MMM_ADDRESS === hre.ethers.ZeroAddress) {
    throw new Error(
      `MMM_ADDRESS not set. Either create deployments/mmm.${hre.network.name}.json or set env MMM_ADDRESS=0x...`
    );
  }

  // 2) How much liquidity to add:
  //    - Keep small on testnet.
  //    - You MUST have these MMM tokens in your deployer wallet.
  const MMM_AMOUNT = hre.ethers.parseUnits("1000000", 18); // 1,000,000 MMM (assuming 18 decimals)
  const MON_AMOUNT = hre.ethers.parseEther("0.10");        // 0.10 MON

  // 3) Slippage tolerance (simple approach)
  const MMM_MIN = (MMM_AMOUNT * 95n) / 100n; // 5% slippage buffer
  const MON_MIN = (MON_AMOUNT * 95n) / 100n;

  // 4) Deadline (20 minutes)
  const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

  console.log("MMM token:", MMM_ADDRESS);
  console.log("Adding liquidity MMM:", MMM_AMOUNT.toString());
  console.log("Adding liquidity MON:", hre.ethers.formatEther(MON_AMOUNT));

  // ============
  // CONTRACTS
  // ============
  const routerC = await hre.ethers.getContractAt("UniswapV2Router02", router);

  // Minimal ERC20 ABI to avoid relying on your MMM artifact name
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  const mmm = new hre.ethers.Contract(MMM_ADDRESS, erc20Abi, deployer);

  // Try to detect decimals (optional)
  let decimals = 18;
  try {
    decimals = Number(await mmm.decimals());
  } catch (_) {
    // ignore; keep 18
  }
  if (decimals !== 18) {
    console.log("Detected MMM decimals:", decimals, "(script default amounts assume 18!)");
    console.log("If this is not 18, change MMM_AMOUNT parseUnits accordingly.");
  }

  // ============
  // APPROVE ROUTER
  // ============
  const balMMM = await mmm.balanceOf(deployer.address);
  console.log("Deployer MMM balance:", balMMM.toString());

  if (balMMM < MMM_AMOUNT) {
    throw new Error(
      `Not enough MMM to add liquidity. Need ${MMM_AMOUNT.toString()} but have ${balMMM.toString()}.`
    );
  }

  const currentAllowance = await mmm.allowance(deployer.address, router);
  if (currentAllowance < MMM_AMOUNT) {
    console.log("Approving router to spend MMM...");
    const tx = await mmm.approve(router, MMM_AMOUNT);
    console.log("Approve tx:", tx.hash);
    await tx.wait();
  } else {
    console.log("Router already approved for MMM.");
  }

  // ============
  // ADD LIQUIDITY (token + native)
  // This will wrap MON into WMON internally via router.
  // ============
  console.log("Adding liquidity via addLiquidityETH...");
  const tx2 = await routerC.addLiquidityETH(
    MMM_ADDRESS,
    MMM_AMOUNT,
    MMM_MIN,
    MON_MIN,
    deployer.address,
    deadline,
    { value: MON_AMOUNT }
  );

  console.log("addLiquidityETH tx:", tx2.hash);
  const receipt = await tx2.wait();
  console.log("Liquidity added. Receipt status:", receipt.status);

  // ============
  // DERIVE PAIR ADDRESS (optional verification)
  // ============
  // We can ask factory for the pair address
  const factoryAbi = ["function getPair(address, address) view returns (address)"];
  const factoryC = new hre.ethers.Contract(factory, factoryAbi, deployer);

  const pair = await factoryC.getPair(MMM_ADDRESS, wmon);
  console.log("MMM/WMON pair address:", pair);

  // Save output
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", `pair.${hre.network.name}.json`),
    JSON.stringify(
      {
        network: hre.network.name,
        mmm: MMM_ADDRESS,
        wmon,
        factory,
        router,
        pair,
        addLiquidityTx: tx2.hash,
        mmmAmount: MMM_AMOUNT.toString(),
        monAmountWei: MON_AMOUNT.toString(),
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  console.log("Saved deployments/pair.<network>.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

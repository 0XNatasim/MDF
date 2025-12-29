const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function extractInitCodeHashFromPeriphery() {
  const libPath = path.join(
    "node_modules",
    "@uniswap",
    "v2-periphery",
    "contracts",
    "libraries",
    "UniswapV2Library.sol"
  );
  const src = fs.readFileSync(libPath, "utf8");

  // Look for: hex'...'
  const m = src.match(/hex'([0-9a-fA-F]{64})'/);
  if (!m) throw new Error("Could not find INIT_CODE_HASH in UniswapV2Library.sol");
  return "0x" + m[1].toLowerCase();
}

function sortTokens(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
}

function pairFor(factory, tokenA, tokenB, initCodeHash) {
  const [t0, t1] = sortTokens(tokenA, tokenB);
  const salt = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["address", "address"], [t0, t1])
  );

  const packed = hre.ethers.solidityPacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", factory, salt, initCodeHash]
  );

  const addr = "0x" + hre.ethers.keccak256(packed).slice(26);
  return hre.ethers.getAddress(addr);
}

async function main() {
  const net = hre.network.name;

  const { factory } = readJson(path.join("deployments", `factory.${net}.json`));
  const { router }  = readJson(path.join("deployments", `router.${net}.json`));
  const { wmon }    = readJson(path.join("deployments", `wmon.${net}.json`));
  const { mmm }     = readJson(path.join("deployments", `mmm.${net}.json`));

  console.log("Factory:", factory);
  console.log("Router :", router);
  console.log("MMM    :", mmm);
  console.log("WMON   :", wmon);

  const initCodeHash = extractInitCodeHashFromPeriphery();
  console.log("Periphery INIT_CODE_HASH:", initCodeHash);

  const factoryAbi = ["function getPair(address,address) view returns (address)"];
  const factoryC = new hre.ethers.Contract(factory, factoryAbi, hre.ethers.provider);

  const onchainPair = await factoryC.getPair(mmm, wmon);
  const computedPair = pairFor(factory, mmm, wmon, initCodeHash);

  console.log("Factory getPair:", onchainPair);
  console.log("Router-computed:", computedPair);

  const codeOnchainPair = await hre.ethers.provider.getCode(onchainPair);
  const codeComputedPair = await hre.ethers.provider.getCode(computedPair);

  console.log("Code at getPair address length:", (codeOnchainPair.length - 2) / 2);
  console.log("Code at computed address length:", (codeComputedPair.length - 2) / 2);

  if (onchainPair.toLowerCase() !== computedPair.toLowerCase()) {
    console.log("\nMISMATCH DETECTED: Router will target the wrong pair address -> addLiquidityETH reverts.\n");
  } else {
    console.log("\nNo mismatch: Router computed pair matches factory.getPair.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

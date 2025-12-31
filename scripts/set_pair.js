// scripts/set_pair.js
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadDeploymentAddress(net, name) {
  const p = path.join(__dirname, "..", "deployments", `${name}.${net}.json`);
  if (!fs.existsSync(p)) return null;
  const j = readJson(p);

  // Prefer explicit keys
  const preferredKey =
    name === "mmm" ? "mmm" :
    name === "pair" ? "pair" :
    name === "router" ? "router" :
    name;

  if (typeof j[preferredKey] === "string" && j[preferredKey].startsWith("0x")) {
    return j[preferredKey];
  }

  // Otherwise, find any 0x string in the JSON
  for (const v of Object.values(j)) {
    if (typeof v === "string" && v.startsWith("0x")) return v;
  }

  return null;
}

async function main() {
  const net = hre.network.name;

  const FALLBACK = {
    mmm:  "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    pair: "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",
  };

  const MMM_ADDR  = loadDeploymentAddress(net, "mmm")  || FALLBACK.mmm;
  const PAIR_ADDR = loadDeploymentAddress(net, "pair") || FALLBACK.pair;

  const [signer] = await ethers.getSigners();
  console.log("Network:", net);
  console.log("Signer :", signer.address);
  console.log("MMM    :", MMM_ADDR);
  console.log("PAIR   :", PAIR_ADDR);

  const MMM_ABI = [
    "function setPair(address pair, bool enabled) external",
    "function ammPairs(address pair) view returns (bool)",
    "function owner() view returns (address)",
  ];

  const mmm = new ethers.Contract(MMM_ADDR, MMM_ABI, signer);

  const owner = await mmm.owner().catch(() => null);
  if (owner && owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Signer is not MMM owner. MMM.owner()=${owner}`);
  }

  const before = await mmm.ammPairs(PAIR_ADDR);
  console.log("ammPairs(pair) before:", before);

  if (before) {
    console.log("✅ Pair already enabled.");
    return;
  }

  const tx = await mmm.setPair(PAIR_ADDR, true);
  console.log("setPair tx:", tx.hash);
  await tx.wait();

  const after = await mmm.ammPairs(PAIR_ADDR);
  console.log("ammPairs(pair) after:", after);
  console.log("✅ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// scripts/run-live-tests.js
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function listSpecsRecursive(dirAbs) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  const out = [];

  for (const e of entries) {
    const p = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(...listSpecsRecursive(p));
    else if (e.isFile() && e.name.endsWith(".spec.js")) out.push(p);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function resolveHardhatBin(root) {
  // Prefer local Hardhat binary, cross-platform
  const binName = process.platform === "win32" ? "hardhat.cmd" : "hardhat";
  return path.join(root, "node_modules", ".bin", binName);
}

function main() {
  const root = process.cwd();
  const liveDirAbs = path.join(root, "test", "live");

  if (!fs.existsSync(liveDirAbs)) {
    console.error(`Missing folder: ${liveDirAbs}`);
    process.exit(1);
  }

  const specsAbs = listSpecsRecursive(liveDirAbs);
  if (specsAbs.length === 0) {
    console.error(`No *.spec.js files found in ${liveDirAbs}`);
    process.exit(1);
  }

  // Use relative paths so Mocha/Hardhat resolves them consistently
  const specsRel = specsAbs.map((p) => path.relative(root, p));

  const hardhat = resolveHardhatBin(root);
  if (!fs.existsSync(hardhat)) {
    console.error(`Hardhat binary not found: ${hardhat}`);
    console.error(`Try: npm i`);
    process.exit(1);
  }

  const args = [
    "test",
    "--network",
    "monadTestnet",
    "--no-compile",
    "--show-stack-traces",
    ...specsRel,
  ];

  console.log(`Running: ${hardhat} ${args.join(" ")}`);

  // Key fix:
  // - Do NOT wrap the executable path in extra quotes
  // - Do NOT shell out through cmd.exe unless absolutely necessary
  // - If Windows still complains in some environments, set shell: true
  const res = spawnSync(hardhat, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32", // helps some Windows setups without breaking others
  });

  if (res.error) {
    console.error("Failed to start Hardhat:", res.error);
    process.exit(1);
  }

  process.exit(typeof res.status === "number" ? res.status : 1);
}

main();

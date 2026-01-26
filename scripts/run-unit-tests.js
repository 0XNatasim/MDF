// scripts/run-unit-tests.js
"use strict";

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

function listSpecFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSpecFiles(p));
    else if (e.isFile() && e.name.endsWith(".spec.js")) out.push(p);
  }
  return out;
}

function main() {
  const repoRoot = process.cwd();
  const unitDir = path.join(repoRoot, "test", "unit");

  if (!fs.existsSync(unitDir)) {
    console.error(`Missing folder: ${unitDir}`);
    process.exit(1);
  }

  const files = listSpecFiles(unitDir);
  if (files.length === 0) {
    console.error(`No *.spec.js found under ${unitDir}`);
    process.exit(1);
  }

  // Use hardhat.cmd directly (avoids npx / execution policy issues)
  const hardhatCmd = path.join(repoRoot, "node_modules", ".bin", "hardhat.cmd");

  const args = ["test", "--show-stack-traces", ...files];

  console.log("Running:", hardhatCmd, args.join(" "));

  // shell:true avoids Windows spawn EINVAL edge cases
  const r = spawnSync(hardhatCmd, args, {
    stdio: "inherit",
    shell: true
  });

  process.exit(r.status ?? 1);
}

main();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Default file paths (adjust if your layout differs)
const ENV_PATH = path.join(process.cwd(), '.env');
const LIBRARY_PATH = path.join(process.cwd(), 'contracts/uniswap/periphery/libraries/UniswapV2Library.sol');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag) => {
  const arg = args.find(a => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : null;
};

const wmon = getArg('wmon');
const usdc = getArg('usdc');
const factory = getArg('factory');
const hash = getArg('hash'); // the raw hash without 0x

// Validation
if (!wmon || !usdc || !factory || !hash) {
  console.error(`
❌ Missing required arguments.
Usage: node post-step1-update.js --wmon=<address> --usdc=<address> --factory=<address> --hash=<64_hex_chars>

Example:
node post-step1-update.js \\
  --wmon=0xF723ED8918FBA6A5499A0F869ef3fb29810CA6e3 \\
  --usdc=0x5A51A1758770Bcd74FFf29B7C07728A03721c2c7 \\
  --factory=0xB0D3507E9ffa8633b1cbe036f5188e5C25706711 \\
  --hash=bfc8d8e180d072186968e3d791fc51f20e3a8b3a4b5bd52a9b8bde862db90814
  `);
  process.exit(1);
}

if (!/^0x[a-fA-F0-9]{40}$/.test(wmon)) {
  console.error(`❌ WMON address is not a valid Ethereum address: ${wmon}`);
  process.exit(1);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(usdc)) {
  console.error(`❌ USDC address is not a valid Ethereum address: ${usdc}`);
  process.exit(1);
}
if (!/^0x[a-fA-F0-9]{40}$/.test(factory)) {
  console.error(`❌ FACTORY address is not a valid Ethereum address: ${factory}`);
  process.exit(1);
}
if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
  console.error(`❌ Init code hash must be exactly 64 hex characters (no 0x prefix): ${hash}`);
  process.exit(1);
}

// ------------------------------------------------------------------
// Update .env file
// ------------------------------------------------------------------
function updateEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error(`❌ .env file not found at ${ENV_PATH}`);
    return false;
  }

  const envContent = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = envContent.split('\n');
  let updated = false;

  const replacements = {
    TESTNET_WMON: wmon,
    TESTNET_USDC: usdc,
    TESTNET_FACTORY: factory,
  };

  const newLines = lines.map(line => {
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`^${key}=.*`);
      if (regex.test(line)) {
        updated = true;
        return `${key}=${value}`;
      }
    }
    return line;
  });

  // If any key was missing, append them
  for (const key of Object.keys(replacements)) {
    if (!lines.some(line => new RegExp(`^${key}=`).test(line))) {
      newLines.push(`${key}=${replacements[key]}`);
      updated = true;
    }
  }

  if (updated) {
    fs.writeFileSync(ENV_PATH, newLines.join('\n'), 'utf8');
    console.log('✅ .env updated with new addresses.');
  } else {
    console.log('ℹ️  No changes needed in .env (values already match?).');
  }
  return true;
}

// ------------------------------------------------------------------
// Update UniswapV2Library.sol
// ------------------------------------------------------------------
function updateLibrary() {
  if (!fs.existsSync(LIBRARY_PATH)) {
    console.error(`❌ UniswapV2Library.sol not found at ${LIBRARY_PATH}`);
    return false;
  }

  let content = fs.readFileSync(LIBRARY_PATH, 'utf8');

  // Look for the hex string (64 hex chars) inside hex'...'
  const regex = /hex'([a-fA-F0-9]{64})'/g;
  const match = regex.exec(content);
  if (!match) {
    console.error('❌ Could not find a hex string of 64 characters in the file. Is the file correct?');
    return false;
  }

  const oldHash = match[1];
  if (oldHash === hash) {
    console.log('ℹ️  Library already contains the correct hash. No change needed.');
    return true;
  }

  // Replace with new hash (preserve any surrounding code)
  const newContent = content.replace(regex, `hex'${hash}'`);
  fs.writeFileSync(LIBRARY_PATH, newContent, 'utf8');
  console.log(`✅ UniswapV2Library.sol updated with new init code hash: ${hash}`);
  return true;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
console.log('\n🔄 Updating deployment files after Step 1...\n');

const envOk = updateEnv();
const libOk = updateLibrary();

if (envOk && libOk) {
  console.log(`
✅ All files updated successfully.

Next steps:
  1. Recompile: npx hardhat compile
  2. Run step 2: npx hardhat run scripts/deploy-step2.js --network monadTestnet
`);
} else {
  console.error('\n❌ Some updates failed. Please check the errors above.');
  process.exit(1);
}
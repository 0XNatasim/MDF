# scripts/run-all-tests.js
const { exec } = require('child_process');
const fs = require('fs');

async function runAllTests() {
  const tests = [
    'npx hardhat run scripts/check-balances.js --network monadTestnet',
    'npx hardhat run scripts/check-pool-exist.js --network monadTestnet',
    'npx hardhat run scripts/buy-mmm.js --network monadTestnet',
    'npx hardhat run scripts/check-withdrawable.js --network monadTestnet',
    'npx hardhat run scripts/claim-cli.js --network monadTestnet'
  ];
  
  for (const test of tests) {
    console.log(`\n🚀 Running: ${test}`);
    await runCommand(test);
  }
}

runAllTests();
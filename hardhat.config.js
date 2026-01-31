require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

// ----------------------------------------------------------------------------
// Accounts (loaded from .env). Keep as "0x..." keys.
// ----------------------------------------------------------------------------
const accounts = [];
if (process.env.PRIVATE_KEY) accounts.push(process.env.PRIVATE_KEY);
if (process.env.TESTER_PRIVATE_KEY) accounts.push(process.env.TESTER_PRIVATE_KEY);
if (process.env.CLAIMER_PRIVATE_KEY) accounts.push(process.env.CLAIMER_PRIVATE_KEY);

// ----------------------------------------------------------------------------
// Networks
// ----------------------------------------------------------------------------
const MONAD_TESTNET_RPC = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const MONAD_TESTNET_CHAIN_ID = Number(process.env.CHAIN_ID || 10143);

const MONAD_MAINNET_RPC = process.env.MONAD_MAINNET_RPC; // REQUIRED to use mainnet
const MONAD_MAINNET_CHAIN_ID = Number(process.env.MONAD_MAINNET_CHAIN_ID || 143);

// ----------------------------------------------------------------------------
// Solidity
// - Most of your repo is ^0.8.24
// - WETH9.sol is ^0.6.6 (legacy)
// ----------------------------------------------------------------------------
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
    // Optional: if you ever need explicit per-file overrides (not required here):
    // overrides: {
    //   "contracts/WETH9.sol": { version: "0.6.6", settings: { optimizer: { enabled: true, runs: 200 } } },
    // },
  },

  networks: {
    monadTestnet: {
      url: MONAD_TESTNET_RPC,
      chainId: MONAD_TESTNET_CHAIN_ID,
      accounts,
    },

    // 🔒 MAINNET (kept, but only enabled if RPC is present)
    ...(MONAD_MAINNET_RPC
      ? {
          monadMainnet: {
            url: MONAD_MAINNET_RPC,
            chainId: MONAD_MAINNET_CHAIN_ID,
            accounts,
          },
        }
      : {}),
  },
};

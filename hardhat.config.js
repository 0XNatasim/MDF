require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/* ============================================================
   Accounts (loaded safely from .env)
============================================================ */
const accounts = [];
if (process.env.PRIVATE_KEY) accounts.push(process.env.PRIVATE_KEY);
if (process.env.TESTER_PRIVATE_KEY) accounts.push(process.env.TESTER_PRIVATE_KEY);
if (process.env.CLAIMER_PRIVATE_KEY) accounts.push(process.env.CLAIMER_PRIVATE_KEY);

/* ============================================================
   Network Configuration
============================================================ */
const MONAD_TESTNET_RPC =
  process.env.RPC_URL || "https://testnet-rpc.monad.xyz";

const MONAD_MAINNET_RPC = process.env.MONAD_MAINNET_RPC;

/* ============================================================
   Hardhat Config
============================================================ */

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: { optimizer: { enabled: true, runs: 200 } }
      },
      {
        version: "0.6.6",
        settings: { optimizer: { enabled: true, runs: 200 } }
      },
      {
        version: "0.5.16",
        settings: { optimizer: { enabled: true, runs: 200 } }
      }
    ]
  },

  networks: {
    monadTestnet: {
      url: MONAD_TESTNET_RPC,
      chainId: 10143,
      accounts
    },

    ...(MONAD_MAINNET_RPC
      ? {
          monadMainnet: {
            url: MONAD_MAINNET_RPC,
            chainId: 143,
            accounts
          }
        }
      : {})
  }
};

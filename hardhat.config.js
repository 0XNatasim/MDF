require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const accounts = [];
if (process.env.PRIVATE_KEY) accounts.push(process.env.PRIVATE_KEY);
if (process.env.TESTER_PRIVATE_KEY) accounts.push(process.env.TESTER_PRIVATE_KEY);
if (process.env.CLAIMER_PRIVATE_KEY) accounts.push(process.env.CLAIMER_PRIVATE_KEY);


module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // viaIR NOT supported here
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // viaIR NOT supported here
        },
      },
    ],
  },

  
  networks: {
    monadTestnet: {
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID || 10143),
      accounts,
    },
      // 🔒 MAINNET 
    monadMainnet: {
      url: process.env.MONAD_MAINNET_RPC, // REQUIRED
      chainId: 143,
      accounts,
    },
  },
};

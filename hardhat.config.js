require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true, // ✅ works here
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // ❌ viaIR NOT supported here
        },
      },
      {
        version: "0.5.16",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // ❌ viaIR NOT supported here
        },
      },
    ],
  },

  networks: {
    monadTestnet: {
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID || 10143),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

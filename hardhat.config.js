require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } }, // MMM
      { version: "0.6.6",  settings: { optimizer: { enabled: true, runs: 200 } } }, // Uniswap V2 periphery (Router02)
      { version: "0.5.16", settings: { optimizer: { enabled: true, runs: 200 } } }, // Uniswap V2 core
    ],
    viaIR: true,
  },

  networks: {
    monadTestnet: {
      url: process.env.RPC_URL,
      chainId: Number(process.env.CHAIN_ID || 10143),
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

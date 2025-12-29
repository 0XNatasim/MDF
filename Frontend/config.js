// Configuration for MMM Token Dashboard
const CONFIG = {
  // Contract addresses
  MMM_TOKEN_ADDRESS: '0x08e3e7677DdBf2B4C7b45407e665E7726d4823dc',
  MON_REWARDS_ADDRESS: '0xD1c7AFF5D89363eFaC6Fa40d7D534f39Efc2cEc6',
  
  // Network configuration
  NETWORK: {
    name: 'Monad Testnet',
    chainId: '0x279F', // Hex for 10143
    chainIdDecimal: 10143,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    symbol: 'MON',
    explorer: 'https://testnet.monadexplorer.com'
  },
  
  // ERC20 ABI (minimum required functions)
  ERC20_ABI: [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function name() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)"
  ],
  
  // Rewards ABI (if different from ERC20)
  REWARDS_ABI: [
    "function claimable(address user) view returns (uint256)",
    "function claim()",
    "function totalClaimed(address user) view returns (uint256)"
  ],
  
  // App settings
  SETTINGS: {
    refreshInterval: 30000, // 30 seconds
    maxNotifications: 5,
    localStorageKey: 'mmm_dashboard_data',
    defaultDecimals: 18,
    explorerUrl: 'https://testnet.monadexplorer.com/tx/'
  }
};

// Global state
const STATE = {
  provider: null,
  signer: null,
  connectedAddress: null,
  mmmContract: null,
  monContract: null,
  mmmDecimals: 18,
  monDecimals: 18,
  totalMMM: 0,
  totalClaimable: 0,
  totalClaimed: 0,
  wallets: [],
  isConnected: false,
  isInitialized: false,
  
  // Transaction tracking
  pendingTransactions: [],
  lastTransactionHash: null,
  lastTransactionTime: null
};

// Export to global scope
window.CONFIG = CONFIG;
window.STATE = STATE;
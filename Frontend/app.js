// Main application logic for MMM Token Dashboard

// Check if dependencies are loaded
function checkDependencies() {
  if (typeof ethers === 'undefined') {
    throw new Error('ethers.js not loaded. Please check your internet connection.');
  }
  
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask is not installed. Please install it to use this dashboard.');
  }
  
  return true;
}

// DOM Elements
const elements = {
  connectButton: document.getElementById('connectButton'),
  refreshButton: document.getElementById('refreshButton'),
  addWalletButton: document.getElementById('addWalletButton'),
  claimAllButton: document.getElementById('claimAllButton'),
  walletList: document.getElementById('walletList'),
  noWalletsMessage: document.getElementById('noWalletsMessage'),
  networkLabel: document.getElementById('networkLabel'),
  notification: document.getElementById('notification'),
  totalMMM: document.getElementById('totalMMM'),
  totalClaimable: document.getElementById('totalClaimable'),
  totalClaimed: document.getElementById('totalClaimed'),
  walletSelector: document.getElementById('walletSelector'),
  walletInfo: document.getElementById('walletInfo'),
  connectedAddress: document.getElementById('connectedAddress'),
  walletMonBalance: document.getElementById('walletMonBalance'),
  sendMmmButton: document.getElementById('sendMmmButton')
};

// Initialize app
async function initApp() {
  console.log('Initializing MMM Token Dashboard...');
  
  try {
    // Check dependencies
    checkDependencies();
    
    // Initialize event listeners
    initEventListeners();
    
    // Check for existing connection
    await checkExistingConnection();
    
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Initialization error:', error);
    showNotification(`Initialization failed: ${error.message}`, 'error');
  }
}

// Initialize event listeners
function initEventListeners() {
  elements.connectButton.addEventListener('click', connectWallet);
  elements.refreshButton.addEventListener('click', refreshData);
  elements.addWalletButton.addEventListener('click', handleAddWallet);
  elements.claimAllButton.addEventListener('click', claimAllRewards);
  elements.sendMmmButton.addEventListener('click', sendMMMTokens);
  
  // MetaMask event listeners
  if (window.ethereum) {
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);
    window.ethereum.on('disconnect', handleDisconnect);
  }
}

// Check for existing connection
async function checkExistingConnection() {
  try {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts.length > 0) {
      console.log('Found existing connection:', accounts[0]);
      await connectWallet();
    }
  } catch (error) {
    console.log('No existing connection found');
  }
}

// Handle MetaMask account changes
async function handleAccountsChanged(accounts) {
  console.log('Accounts changed:', accounts);
  if (accounts.length === 0) {
    disconnectWallet();
  } else {
    STATE.connectedAddress = accounts[0];
    await updateConnectionStatus();
    await loadWalletData();
    showNotification('Account changed', 'info');
  }
}

// Handle chain changes
function handleChainChanged() {
  console.log('Chain changed, reloading...');
  window.location.reload();
}

// Handle disconnect
function handleDisconnect() {
  console.log('Wallet disconnected');
  disconnectWallet();
}

// Show notification
function showNotification(message, type = 'info') {
  const types = {
    success: { 
      bg: 'bg-emerald-900/90', 
      border: 'border-emerald-700', 
      icon: 'fa-check-circle', 
      text: 'text-emerald-300' 
    },
    error: { 
      bg: 'bg-red-900/90', 
      border: 'border-red-700', 
      icon: 'fa-exclamation-circle', 
      text: 'text-red-300' 
    },
    info: { 
      bg: 'bg-blue-900/90', 
      border: 'border-blue-700', 
      icon: 'fa-info-circle', 
      text: 'text-blue-300' 
    }
  };

  const config = types[type] || types.info;
  const id = 'notification-' + Date.now();
  
  const notificationHTML = `
    <div id="${id}" class="notification-item ${config.bg} border ${config.border} rounded-xl p-4 mb-2">
      <div class="flex items-center gap-3">
        <i class="fa-solid ${config.icon} ${config.text} text-lg"></i>
        <div class="flex-1">
          <p class="${config.text} font-medium">${message}</p>
        </div>
        <button onclick="document.getElementById('${id}').remove()" class="text-slate-400 hover:text-white">
          <i class="fa-solid fa-times"></i>
        </button>
      </div>
    </div>
  `;
  
  elements.notification.innerHTML = notificationHTML + elements.notification.innerHTML;
  elements.notification.classList.remove('hidden');
  
  // Limit number of notifications
  const notifications = elements.notification.querySelectorAll('.notification-item');
  if (notifications.length > CONFIG.SETTINGS.maxNotifications) {
    notifications[notifications.length - 1].remove();
  }
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    const notif = document.getElementById(id);
    if (notif) {
      notif.classList.add('fade-out');
      setTimeout(() => notif.remove(), 300);
    }
  }, 5000);
}

// Show wallet info
function showWalletInfo(address, monBalance) {
  const shortAddress = `${address.substring(0, 6)}...${address.substring(38)}`;
  elements.connectedAddress.textContent = shortAddress;
  elements.walletMonBalance.textContent = monBalance;
  elements.walletInfo.classList.remove('hidden');
}

// Hide wallet info
function hideWalletInfo() {
  elements.walletInfo.classList.add('hidden');
  elements.connectedAddress.textContent = '';
  elements.walletMonBalance.textContent = '0.00';
}

// Switch to Monad Testnet
async function switchToMonadNetwork() {
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CONFIG.NETWORK.chainId }]
    });
    return true;
  } catch (error) {
    if (error.code === 4902) {
      // Network not added, try to add it
      return await addMonadNetwork();
    }
    return false;
  }
}

// Add Monad Testnet to MetaMask
async function addMonadNetwork() {
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CONFIG.NETWORK.chainId,
        chainName: CONFIG.NETWORK.name,
        nativeCurrency: {
          name: 'Monad',
          symbol: CONFIG.NETWORK.symbol,
          decimals: 18
        },
        rpcUrls: [CONFIG.NETWORK.rpcUrl],
        blockExplorerUrls: [CONFIG.NETWORK.explorer]
      }]
    });
    return true;
  } catch (error) {
    console.error('Failed to add network:', error);
    return false;
  }
}

// Connect wallet
async function connectWallet() {
  try {
    if (STATE.isConnected) {
      disconnectWallet();
      return;
    }

    setButtonLoading(elements.connectButton, true);
    
    // Check if MetaMask is installed
    if (!window.ethereum) {
      throw new Error('MetaMask is not installed');
    }
    
    // Switch to Monad Testnet
    const switched = await switchToMonadNetwork();
    if (!switched) {
      throw new Error('Failed to switch to Monad Testnet');
    }
    
    // Request accounts
    const accounts = await window.ethereum.request({
      method: 'eth_requestAccounts'
    });
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }
    
    // Initialize provider and signer
    STATE.provider = new ethers.providers.Web3Provider(window.ethereum);
    STATE.signer = STATE.provider.getSigner();
    STATE.connectedAddress = accounts[0];
    STATE.isConnected = true;
    
    // Initialize contracts
    await initializeContracts();
    
    // Update UI
    await updateConnectionStatus();
    
    // Load data
    await loadWalletData();
    
    showNotification('Wallet connected successfully!', 'success');
    
  } catch (error) {
    console.error('Connect error:', error);
    showNotification(`Connection failed: ${error.message}`, 'error');
  } finally {
    setButtonLoading(elements.connectButton, false);
  }
}

// Set button loading state
function setButtonLoading(button, isLoading) {
  if (isLoading) {
    button.disabled = true;
    const originalText = button.innerHTML;
    button.setAttribute('data-original-text', originalText);
    button.innerHTML = '<div class="spinner"></div>';
  } else {
    button.disabled = false;
    const originalText = button.getAttribute('data-original-text');
    if (originalText) {
      button.innerHTML = originalText;
    }
  }
}

// Initialize contracts
async function initializeContracts() {
  try {
    // MMM Token Contract
    STATE.mmmContract = new ethers.Contract(
      CONFIG.MMM_TOKEN_ADDRESS,
      CONFIG.ERC20_ABI,
      STATE.provider
    );
    
    // Get MMM decimals
    try {
      STATE.mmmDecimals = await STATE.mmmContract.decimals();
    } catch {
      STATE.mmmDecimals = 18;
    }
    
    // MON Rewards Contract
    STATE.monContract = new ethers.Contract(
      CONFIG.MON_REWARDS_ADDRESS,
      CONFIG.ERC20_ABI,
      STATE.provider
    );
    
    // Get MON decimals
    try {
      STATE.monDecimals = await STATE.monContract.decimals();
    } catch {
      STATE.monDecimals = 18;
    }
    
    console.log('Contracts initialized');
    return true;
  } catch (error) {
    console.error('Contract init error:', error);
    throw new Error('Failed to initialize contracts');
  }
}

// Update connection status UI
async function updateConnectionStatus() {
  if (STATE.isConnected && STATE.connectedAddress) {
    const shortAddress = `${STATE.connectedAddress.substring(0, 6)}...${STATE.connectedAddress.substring(38)}`;
    
    elements.connectButton.innerHTML = `
      <i class="fa-solid fa-wallet"></i>
      <span>${shortAddress}</span>
      <i class="fa-solid fa-check ml-1 text-xs"></i>
    `;
    
    elements.networkLabel.innerHTML = `
      <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
      <span class="text-emerald-400 font-medium">Connected</span>
      <span class="text-slate-400"> • ${CONFIG.NETWORK.name}</span>
    `;
    
    elements.connectButton.onclick = disconnectWallet;
  } else {
    elements.connectButton.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect Wallet</span>';
    elements.networkLabel.innerHTML = `
      <div class="w-2 h-2 rounded-full bg-red-500"></div>
      <span class="text-slate-400">Not connected</span>
    `;
    elements.connectButton.onclick = connectWallet;
  }
}

// Format balance with decimals
function formatBalance(balance, decimals) {
  if (!balance) return '0.00';
  const formatted = ethers.utils.formatUnits(balance, decimals);
  return parseFloat(formatted).toFixed(2);
}

// Load wallet data
async function loadWalletData() {
  if (!STATE.isConnected || !STATE.mmmContract) {
    console.log('Not connected, skipping data load');
    return;
  }

  try {
    setButtonLoading(elements.refreshButton, true);
    
    console.log('Loading wallet data...');
    
    // Get MMM balance
    let mmmBalance = '0.00';
    try {
      const balance = await STATE.mmmContract.balanceOf(STATE.connectedAddress);
      mmmBalance = formatBalance(balance, STATE.mmmDecimals);
      console.log('MMM Balance:', mmmBalance);
    } catch (error) {
      console.error('Error getting MMM balance:', error);
    }
    
    // Get MON balance
    let monBalance = '0.00';
    try {
      const balance = await STATE.monContract.balanceOf(STATE.connectedAddress);
      monBalance = formatBalance(balance, STATE.monDecimals);
      console.log('MON Balance:', monBalance);
    } catch (error) {
      console.error('Error getting MON balance:', error);
    }
    
    // Get local claimed amount
    const localClaimed = getLocalClaimed();
    
    // Update UI
    elements.totalMMM.textContent = mmmBalance;
    elements.totalClaimable.textContent = monBalance;
    elements.totalClaimed.textContent = localClaimed;
    
    // Update state
    STATE.totalMMM = parseFloat(mmmBalance);
    STATE.totalClaimable = parseFloat(monBalance);
    STATE.totalClaimed = parseFloat(localClaimed);
    
    // Show wallet info
    showWalletInfo(STATE.connectedAddress, monBalance);
    
    // Update wallet list
    updateWalletList([{
      address: STATE.connectedAddress,
      balance: mmmBalance,
      claimable: monBalance
    }]);
    
    // Enable buttons
    elements.refreshButton.disabled = false;
    elements.claimAllButton.disabled = false;
    elements.sendMmmButton.disabled = STATE.totalMMM === 0;
    
    console.log('Data loaded successfully');
    
  } catch (error) {
    console.error('Load data error:', error);
    showNotification(`Error loading data: ${error.message}`, 'error');
  } finally {
    setButtonLoading(elements.refreshButton, false);
  }
}

// Get local claimed amount
function getLocalClaimed() {
  try {
    const data = JSON.parse(localStorage.getItem(CONFIG.SETTINGS.localStorageKey) || '{}');
    return data.totalClaimed ? parseFloat(data.totalClaimed).toFixed(2) : '0.00';
  } catch (error) {
    return '0.00';
  }
}

// Update local claimed amount
function updateLocalClaimed(amount) {
  try {
    const data = JSON.parse(localStorage.getItem(CONFIG.SETTINGS.localStorageKey) || '{}');
    const current = parseFloat(data.totalClaimed || '0');
    const newTotal = current + parseFloat(amount);
    data.totalClaimed = newTotal.toFixed(2);
    localStorage.setItem(CONFIG.SETTINGS.localStorageKey, JSON.stringify(data));
    return newTotal;
  } catch (error) {
    return 0;
  }
}

// Update wallet list
function updateWalletList(wallets) {
  STATE.wallets = wallets;
  
  if (wallets.length === 0) {
    elements.noWalletsMessage.classList.remove('hidden');
    return;
  }
  
  elements.noWalletsMessage.classList.add('hidden');
  elements.walletList.innerHTML = '';
  
  wallets.forEach((wallet, index) => {
    const walletElement = document.createElement('div');
    walletElement.className = 'wallet-item card p-4';
    walletElement.innerHTML = `
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-slate-800 to-slate-900 
                      flex items-center justify-center border border-slate-700">
            <i class="fa-solid fa-wallet text-slate-300"></i>
          </div>
          <div>
            <h3 class="font-medium">Wallet ${index + 1}</h3>
            <p class="text-sm text-slate-400 font-mono">${wallet.address.substring(0, 8)}...${wallet.address.substring(36)}</p>
          </div>
        </div>
        
        <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <div class="text-center md:text-right">
            <div class="text-sm text-slate-400 mb-1">MMM Balance</div>
            <div class="flex items-baseline justify-center md:justify-end gap-1">
              <span class="text-xl font-bold text-indigo-300">${wallet.balance}</span>
              <span class="text-indigo-300 font-medium">MMM</span>
            </div>
          </div>
          
          <div class="text-center md:text-right">
            <div class="text-sm text-slate-400 mb-1">Claimable MON</div>
            <div class="flex items-baseline justify-center md:justify-end gap-1">
              <span class="text-xl font-bold text-emerald-300">${wallet.claimable}</span>
              <span class="text-emerald-300 font-medium">MON</span>
            </div>
          </div>
          
          <div class="flex gap-2">
            <button onclick="handleClaim('${wallet.address}')" 
                    class="px-3 py-1.5 text-sm bg-emerald-600/20 hover:bg-emerald-600/30 
                          text-emerald-300 rounded-lg border border-emerald-700/50 transition-colors">
              Claim
            </button>
          </div>
        </div>
      </div>
    `;
    
    elements.walletList.appendChild(walletElement);
  });
}

// Handle claim rewards
async function handleClaim(walletAddress) {
  if (!STATE.isConnected) {
    showNotification('Please connect wallet first', 'error');
    return;
  }

  try {
    showNotification('Claiming rewards...', 'info');
    
    // Update local storage
    const newClaimed = updateLocalClaimed(STATE.totalClaimable);
    
    // Update UI
    elements.totalClaimed.textContent = newClaimed.toFixed(2);
    STATE.totalClaimed = newClaimed;
    
    // Reset claimable
    STATE.totalClaimable = 0;
    elements.totalClaimable.textContent = '0.00';
    
    // Update wallet list
    if (STATE.wallets.length > 0) {
      STATE.wallets[0].claimable = '0.00';
      updateWalletList(STATE.wallets);
    }
    
    showNotification(`Successfully claimed!`, 'success');
    
  } catch (error) {
    console.error('Claim error:', error);
    showNotification(`Claim failed: ${error.message}`, 'error');
  }
}

// Claim all rewards
async function claimAllRewards() {
  if (!STATE.isConnected) {
    showNotification('Please connect wallet first', 'error');
    return;
  }

  try {
    setButtonLoading(elements.claimAllButton, true);
    
    if (STATE.totalClaimable === 0) {
      showNotification('No rewards to claim', 'info');
      return;
    }
    
    await handleClaim(STATE.connectedAddress);
    
  } catch (error) {
    console.error('Claim all error:', error);
    showNotification(`Claim failed: ${error.message}`, 'error');
  } finally {
    setButtonLoading(elements.claimAllButton, false);
  }
}

// Send MMM tokens
async function sendMMMTokens() {
  if (!STATE.isConnected) {
    showNotification('Please connect wallet first', 'error');
    return;
  }

  // Create modal for sending tokens
  const modalHTML = `
    <div id="sendMmmModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div class="bg-slate-900 rounded-xl border border-slate-700 max-w-md w-full p-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-bold">Send MMM Tokens</h3>
          <button onclick="document.getElementById('sendMmmModal').remove()" 
                  class="text-slate-400 hover:text-white">
            <i class="fa-solid fa-times"></i>
          </button>
        </div>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-slate-400 mb-2">Recipient Address</label>
            <input type="text" 
                   id="recipientAddress" 
                   placeholder="0x..." 
                   class="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 
                          focus:outline-none focus:ring-2 focus:ring-indigo-500/50 
                          placeholder:text-slate-600 font-mono">
          </div>
          
          <div>
            <label class="block text-sm text-slate-400 mb-2">Amount (MMM)</label>
            <div class="flex gap-2">
              <input type="number" 
                     id="sendAmount" 
                     min="0" 
                     max="${STATE.totalMMM}" 
                     step="0.01"
                     placeholder="0.00" 
                     class="flex-1 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 
                            focus:outline-none focus:ring-2 focus:ring-indigo-500/50 
                            placeholder:text-slate-600">
              <button onclick="document.getElementById('sendAmount').value = '${STATE.totalMMM}'" 
                      class="px-3 py-2 text-sm bg-slate-800/50 hover:bg-slate-700/50 
                             rounded-lg border border-slate-700 transition-colors">
                Max
              </button>
            </div>
            <div class="text-xs text-slate-500 mt-2">
              Your balance: <span class="text-indigo-300">${STATE.totalMMM} MMM</span>
            </div>
          </div>
          
          <div class="pt-4 flex gap-3">
            <button onclick="document.getElementById('sendMmmModal').remove()" 
                    class="flex-1 px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 
                           rounded-lg border border-slate-700 transition-colors">
              Cancel
            </button>
            <button onclick="confirmSendMMM()" 
                    id="confirmSendButton"
                    class="flex-1 px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 
                           hover:from-indigo-400 hover:to-purple-500 text-white 
                           rounded-lg transition-colors">
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Confirm and send MMM tokens
async function confirmSendMMM() {
  const modal = document.getElementById('sendMmmModal');
  const recipient = document.getElementById('recipientAddress').value;
  const amount = document.getElementById('sendAmount').value;
  const button = document.getElementById('confirmSendButton');
  
  // Validation
  if (!recipient || !ethers.utils.isAddress(recipient)) {
    showNotification('Please enter a valid recipient address', 'error');
    return;
  }
  
  if (!amount || parseFloat(amount) <= 0 || parseFloat(amount) > STATE.totalMMM) {
    showNotification('Please enter a valid amount', 'error');
    return;
  }
  
  try {
    setButtonLoading(button, true);
    
    // Convert amount to wei
    const amountWei = ethers.utils.parseUnits(amount, STATE.mmmDecimals);
    
    // Get contract with signer for sending
    const mmmContractWithSigner = STATE.mmmContract.connect(STATE.signer);
    
    // Send transaction
    const tx = await mmmContractWithSigner.transfer(recipient, amountWei);
    
    showNotification(`Transaction sent: ${tx.hash}`, 'info');
    
    // Wait for confirmation
    const receipt = await tx.wait();
    
    modal.remove();
    showNotification(`Successfully sent ${amount} MMM to ${recipient.substring(0, 8)}...`, 'success');
    
    // Refresh data
    await refreshData();
    
  } catch (error) {
    console.error('Send error:', error);
    showNotification(`Send failed: ${error.message}`, 'error');
  } finally {
    setButtonLoading(button, false);
  }
}

// Refresh data
async function refreshData() {
  if (!STATE.isConnected) {
    showNotification('Please connect wallet first', 'error');
    return;
  }
  
  await loadWalletData();
  showNotification('Data refreshed', 'success');
}

// Handle add wallet
function handleAddWallet() {
  showNotification('Switch accounts in MetaMask to add another wallet', 'info');
}

// Disconnect wallet
function disconnectWallet() {
  STATE.provider = null;
  STATE.signer = null;
  STATE.connectedAddress = null;
  STATE.mmmContract = null;
  STATE.monContract = null;
  STATE.isConnected = false;
  STATE.wallets = [];
  
  // Reset UI
  updateConnectionStatus();
  hideWalletInfo();
  elements.walletList.innerHTML = '';
  elements.noWalletsMessage.classList.remove('hidden');
  elements.totalMMM.textContent = '0.00';
  elements.totalClaimable.textContent = '0.00';
  
  elements.refreshButton.disabled = true;
  elements.claimAllButton.disabled = true;
  elements.sendMmmButton.disabled = true;
  
  showNotification('Wallet disconnected', 'info');
}

// Expose functions to global scope
window.handleClaim = handleClaim;
window.showNotification = showNotification;
window.sendMMMTokens = sendMMMTokens;
window.confirmSendMMM = confirmSendMMM;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
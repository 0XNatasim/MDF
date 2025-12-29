// ===========================================
// MMM TOKEN DASHBOARD - MAIN SCRIPT
// Save as: script.js
// ===========================================

// ========== DATA MANAGEMENT ==========
const DataManager = {
    wallets: JSON.parse(localStorage.getItem('mmm_wallets')) || [
        {
            id: '1',
            name: 'Main Wallet',
            address: '0x1234...5678',
            mmmHoldings: 1500.50,
            totalToClaim: 500.25,
            claimed: 250.75,
            color: 'wallet-gradient-1',
            isConnected: true
        },
        {
            id: '2',
            name: 'Trading Wallet',
            address: '0x2345...6789',
            mmmHoldings: 3200.75,
            totalToClaim: 800.50,
            claimed: 400.25,
            color: 'wallet-gradient-2',
            isConnected: true
        },
        {
            id: '3',
            name: 'Staking Wallet',
            address: '0x3456...7890',
            mmmHoldings: 850.25,
            totalToClaim: 200.00,
            claimed: 150.50,
            color: 'wallet-gradient-3',
            isConnected: true
        }
    ],

    transactions: JSON.parse(localStorage.getItem('mmm_transactions')) || [
        {
            id: '1',
            type: 'Claim',
            amount: 150.50,
            address: 'System Reward',
            status: 'Completed',
            date: '2024-01-15',
            time: '14:30',
            icon: 'fa-gift',
            txHash: '0x123...abc'
        },
        {
            id: '2',
            type: 'Send',
            amount: -100.00,
            address: '0x8a3f...c9b2',
            status: 'Completed',
            date: '2024-01-14',
            time: '09:15',
            icon: 'fa-paper-plane',
            txHash: '0x456...def'
        },
        {
            id: '3',
            type: 'Receive',
            amount: 250.00,
            address: '0x5b2d...f7a1',
            status: 'Completed',
            date: '2024-01-12',
            time: '16:45',
            icon: 'fa-download',
            txHash: '0x789...ghi'
        }
    ],

    settings: JSON.parse(localStorage.getItem('mmm_settings')) || {
        currency: 'USD',
        refreshInterval: 30,
        notifications: true,
        darkMode: false,
        autoClaim: false
    },

    saveToStorage: function() {
        localStorage.setItem('mmm_wallets', JSON.stringify(this.wallets));
        localStorage.setItem('mmm_transactions', JSON.stringify(this.transactions));
        localStorage.setItem('mmm_settings', JSON.stringify(this.settings));
    },

    generateId: function() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    formatNumber: function(num, decimals = 2) {
        return num.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },

    formatDate: function(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    },

    getTotalHoldings: function() {
        return this.wallets.reduce((sum, wallet) => sum + wallet.mmmHoldings, 0);
    },

    getTotalClaimable: function() {
        return this.wallets.reduce((sum, wallet) => sum + wallet.totalToClaim, 0);
    },

    getTotalClaimed: function() {
        return this.wallets.reduce((sum, wallet) => sum + wallet.claimed, 0);
    }
};

// ========== UI RENDERER ==========
const UIRenderer = {
    init: function() {
        this.renderWallets();
        this.renderTransactions();
        this.updateStats();
        this.setupEventListeners();
        this.updateLastUpdated();
    },

    renderWallets: function() {
        const container = document.getElementById('wallets-container');
        const select = document.getElementById('wallet-select');
        
        if (!container) return;
        
        container.innerHTML = '';
        select.innerHTML = '<option value="">Select a wallet</option>';
        
        DataManager.wallets.forEach((wallet, index) => {
            // Create wallet card
            const walletCard = this.createWalletCard(wallet, index);
            container.appendChild(walletCard);
            
            // Add to select dropdown
            const option = document.createElement('option');
            option.value = wallet.id;
            option.textContent = `${wallet.name} (${DataManager.formatNumber(wallet.mmmHoldings)} MMM)`;
            select.appendChild(option);
        });
        
        this.updateAvailableBalance();
    },

    createWalletCard: function(wallet, index) {
        const card = document.createElement('div');
        card.className = `card wallet-card fade-in`;
        card.style.animationDelay = `${index * 0.1}s`;
        card.innerHTML = `
            <div class="card-gradient ${wallet.color}"></div>
            <div class="flex justify-between items-start mb-4">
                <div class="flex items-center">
                    <div class="w-10 h-10 rounded-full ${wallet.color} flex items-center justify-center text-white mr-3">
                        <i class="fas fa-wallet"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg">${wallet.name}</h3>
                        <p class="wallet-address text-sm">${wallet.address}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    ${wallet.isConnected ? 
                        '<span class="badge badge-success text-xs"><i class="fas fa-link mr-1"></i>Connected</span>' : 
                        '<span class="badge badge-warning text-xs"><i class="fas fa-unlink mr-1"></i>Disconnected</span>'
                    }
                    <button onclick="WalletManager.disconnectWallet('${wallet.id}')" class="text-gray-400 hover:text-red-500">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            
            <div class="space-y-4">
                <div class="flex justify-between items-center">
                    <span class="text-gray-600">Holdings</span>
                    <span class="token-amount token-amount-large text-gradient">
                        ${DataManager.formatNumber(wallet.mmmHoldings)} MMM
                    </span>
                </div>
                
                <div class="space-y-2">
                    <div class="flex justify-between items-center">
                        <span class="text-gray-600">To Claim</span>
                        <span class="token-amount token-amount-small text-green-500">
                            ${DataManager.formatNumber(wallet.totalToClaim)} MMM
                        </span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${(wallet.claimed / (wallet.claimed + wallet.totalToClaim)) * 100 || 0}%"></div>
                    </div>
                </div>
                
                <div class="flex justify-between items-center">
                    <span class="text-gray-600">Claimed</span>
                    <span class="token-amount token-amount-small text-purple-500">
                        ${DataManager.formatNumber(wallet.claimed)} MMM
                    </span>
                </div>
                
                <div class="flex space-x-2 pt-2">
                    <button onclick="TransactionManager.claimTokens('${wallet.id}')" 
                            class="btn btn-success flex-1 ${wallet.totalToClaim <= 0 ? 'opacity-50 cursor-not-allowed' : ''}"
                            ${wallet.totalToClaim <= 0 ? 'disabled' : ''}>
                        <i class="fas fa-gift mr-2"></i>
                        ${wallet.totalToClaim > 0 ? 'Claim Tokens' : 'All Claimed'}
                    </button>
                    <button onclick="UIModals.showSendModal('${wallet.id}')" 
                            class="btn btn-outline">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;
        
        return card;
    },

    renderTransactions: function() {
        const tbody = document.getElementById('transactions-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        DataManager.transactions.forEach((tx, index) => {
            const row = document.createElement('tr');
            row.className = 'fade-in';
            row.style.animationDelay = `${index * 0.05}s`;
            row.innerHTML = `
                <td class="py-4">
                    <div class="flex items-center">
                        <div class="w-10 h-10 rounded-full ${tx.amount > 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-blue-100 dark:bg-blue-900/30'} flex items-center justify-center mr-3">
                            <i class="fas ${tx.icon} ${tx.amount > 0 ? 'text-green-600' : 'text-blue-600'}"></i>
                        </div>
                        <div>
                            <span class="font-medium">${tx.type}</span>
                            <p class="text-xs text-gray-500 font-mono">${tx.txHash}</p>
                        </div>
                    </div>
                </td>
                <td class="py-4">
                    <span class="font-bold ${tx.amount > 0 ? 'text-green-600' : 'text-red-600'}">
                        ${tx.amount > 0 ? '+' : ''}${DataManager.formatNumber(tx.amount)} MMM
                    </span>
                </td>
                <td class="py-4">
                    <span class="font-mono text-sm">${tx.address}</span>
                    <p class="text-xs text-gray-500">${tx.time}</p>
                </td>
                <td class="py-4">
                    <span class="badge ${tx.status === 'Completed' ? 'badge-success' : 'badge-warning'}">
                        ${tx.status}
                    </span>
                </td>
                <td class="py-4">
                    ${DataManager.formatDate(tx.date)}
                </td>
            `;
            tbody.appendChild(row);
        });
    },

    updateStats: function() {
        const totalHoldings = DataManager.getTotalHoldings();
        const totalClaimable = DataManager.getTotalClaimable();
        const totalClaimed = DataManager.getTotalClaimed();
        
        const holdingsEl = document.getElementById('total-holdings');
        const claimableEl = document.getElementById('total-claimable');
        const claimedEl = document.getElementById('total-claimed');
        
        if (holdingsEl) holdingsEl.textContent = `${DataManager.formatNumber(totalHoldings)} MMM`;
        if (claimableEl) claimableEl.textContent = `${DataManager.formatNumber(totalClaimable)} MMM`;
        if (claimedEl) claimedEl.textContent = `${DataManager.formatNumber(totalClaimed)} MMM`;
    },

    updateAvailableBalance: function() {
        const select = document.getElementById('wallet-select');
        const balanceEl = document.getElementById('available-balance');
        
        if (!select || !balanceEl) return;
        
        const selectedId = select.value;
        const wallet = DataManager.wallets.find(w => w.id === selectedId);
        
        if (wallet) {
            balanceEl.textContent = `${DataManager.formatNumber(wallet.mmmHoldings)} MMM`;
        } else {
            balanceEl.textContent = '0 MMM';
        }
    },

    updateLastUpdated: function() {
        const el = document.getElementById('last-updated');
        if (el) {
            const now = new Date();
            el.textContent = now.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });
        }
    },

    showLoading: function(show = true, message = 'Loading...') {
        let overlay = document.getElementById('loading-overlay');
        
        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'loading-overlay';
                overlay.className = 'loading-overlay';
                overlay.innerHTML = `
                    <div class="loading-content">
                        <div class="loading-spinner"></div>
                        <p class="text-white mt-4">${message}</p>
                    </div>
                `;
                document.body.appendChild(overlay);
            }
        } else {
            if (overlay) {
                overlay.remove();
            }
        }
    },

    showConfetti: function() {
        const confettiContainer = document.createElement('div');
        confettiContainer.className = 'confetti-container';
        document.body.appendChild(confettiContainer);
        
        // Create confetti particles
        for (let i = 0; i < 100; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = `${Math.random() * 100}vw`;
            confetti.style.background = `hsl(${Math.random() * 360}, 100%, 60%)`;
            confetti.style.animationDelay = `${Math.random() * 2}s`;
            confettiContainer.appendChild(confetti);
        }
        
        // Remove after animation
        setTimeout(() => {
            confettiContainer.remove();
        }, 3000);
    },

    setupEventListeners: function() {
        // Wallet select change
        const walletSelect = document.getElementById('wallet-select');
        if (walletSelect) {
            walletSelect.addEventListener('change', () => {
                this.updateAvailableBalance();
                this.validateAmount();
            });
        }

        // Amount input validation
        const amountInput = document.getElementById('amount');
        if (amountInput) {
            amountInput.addEventListener('input', () => this.validateAmount());
            amountInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    TransactionManager.sendTokens();
                }
            });
        }

        // Percentage buttons
        document.querySelectorAll('[data-percentage]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const percentage = parseFloat(e.target.dataset.percentage);
                this.setAmountPercentage(percentage);
            });
        });

        // Quick send buttons
        document.querySelectorAll('[data-quick-send]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const data = JSON.parse(e.target.dataset.quickSend);
                TransactionManager.quickSend(data.recipient, data.amount);
            });
        });

        // Refresh balances button
        const refreshBtn = document.getElementById('refresh-balances');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => WalletManager.refreshBalances());
        }

        // Connect wallet button
        const connectBtn = document.getElementById('connect-wallet');
        if (connectBtn) {
            connectBtn.addEventListener('click', () => WalletManager.connectWallet());
        }

        // Settings toggle buttons
        document.querySelectorAll('[data-setting-toggle]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const setting = e.target.dataset.settingToggle;
                SettingsManager.toggleSetting(setting);
            });
        });
    },

    validateAmount: function() {
        const amountInput = document.getElementById('amount');
        const amount = parseFloat(amountInput.value) || 0;
        const walletSelect = document.getElementById('wallet-select');
        const wallet = DataManager.wallets.find(w => w.id === walletSelect.value);
        
        if (wallet && amount > wallet.mmmHoldings) {
            amountInput.classList.add('border-red-500');
            return false;
        } else {
            amountInput.classList.remove('border-red-500');
            return true;
        }
    },

    setAmountPercentage: function(percentage) {
        const walletSelect = document.getElementById('wallet-select');
        const wallet = DataManager.wallets.find(w => w.id === walletSelect.value);
        
        if (wallet) {
            const amount = wallet.mmmHoldings * percentage;
            document.getElementById('amount').value = DataManager.formatNumber(amount);
            this.validateAmount();
        }
    }
};

// ========== WALLET MANAGER ==========
const WalletManager = {
    connectWallet: async function() {
        try {
            UIRenderer.showLoading(true, 'Connecting to wallet...');
            
            // Simulate wallet connection (replace with actual web3 code)
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const fakeAddress = '0x' + Math.random().toString(16).slice(2, 10) + '...' + 
                               Math.random().toString(16).slice(2, 6);
            
            const newWallet = {
                id: DataManager.generateId(),
                name: `Connected Wallet ${DataManager.wallets.length + 1}`,
                address: fakeAddress,
                mmmHoldings: Math.random() * 1000 + 500,
                totalToClaim: Math.random() * 300 + 100,
                claimed: Math.random() * 200,
                color: 'wallet-gradient-4',
                isConnected: true
            };
            
            DataManager.wallets.push(newWallet);
            DataManager.saveToStorage();
            
            UIRenderer.renderWallets();
            UIRenderer.updateStats();
            
            NotificationManager.showSuccess(`Wallet connected: ${fakeAddress}`);
            
            // Show confetti for new wallet
            UIRenderer.showConfetti();
            
        } catch (error) {
            console.error('Wallet connection failed:', error);
            NotificationManager.showError('Failed to connect wallet. Please try again.');
        } finally {
            UIRenderer.showLoading(false);
        }
    },

    disconnectWallet: function(walletId) {
        const walletIndex = DataManager.wallets.findIndex(w => w.id === walletId);
        if (walletIndex !== -1) {
            DataManager.wallets.splice(walletIndex, 1);
            DataManager.saveToStorage();
            
            UIRenderer.renderWallets();
            UIRenderer.updateStats();
            
            NotificationManager.showInfo('Wallet disconnected');
        }
    },

    refreshBalances: async function() {
        try {
            UIRenderer.showLoading(true, 'Refreshing balances...');
            
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Update with random fluctuations
            DataManager.wallets.forEach(wallet => {
                if (wallet.isConnected) {
                    const fluctuation = (Math.random() - 0.5) * 10;
                    wallet.mmmHoldings += fluctuation;
                    
                    if (wallet.totalToClaim > 0) {
                        wallet.totalToClaim += (Math.random() * 5);
                    }
                    
                    // Ensure values don't go negative
                    wallet.mmmHoldings = Math.max(0, wallet.mmmHoldings);
                    wallet.totalToClaim = Math.max(0, wallet.totalToClaim);
                }
            });
            
            DataManager.saveToStorage();
            
            UIRenderer.renderWallets();
            UIRenderer.updateStats();
            UIRenderer.updateLastUpdated();
            
            NotificationManager.showSuccess('Balances updated successfully!');
            
        } catch (error) {
            console.error('Balance refresh failed:', error);
            NotificationManager.showError('Failed to refresh balances');
        } finally {
            UIRenderer.showLoading(false);
        }
    },

    addSampleWallet: function() {
        const newWallet = {
            id: DataManager.generateId(),
            name: `Sample Wallet ${DataManager.wallets.length + 1}`,
            address: '0x' + Math.random().toString(16).slice(2, 10) + '...' + 
                    Math.random().toString(16).slice(2, 6),
            mmmHoldings: Math.random() * 2000 + 1000,
            totalToClaim: Math.random() * 500 + 200,
            claimed: Math.random() * 300,
            color: 'wallet-gradient-' + (DataManager.wallets.length % 4 + 1),
            isConnected: false
        };
        
        DataManager.wallets.push(newWallet);
        DataManager.saveToStorage();
        
        UIRenderer.renderWallets();
        UIRenderer.updateStats();
        
        NotificationManager.showSuccess(`Added: ${newWallet.name}`);
    }
};

// ========== TRANSACTION MANAGER ==========
const TransactionManager = {
    claimTokens: async function(walletId) {
        try {
            const walletIndex = DataManager.wallets.findIndex(w => w.id === walletId);
            if (walletIndex === -1 || DataManager.wallets[walletIndex].totalToClaim <= 0) {
                return;
            }
            
            const claimable = DataManager.wallets[walletIndex].totalToClaim;
            
            // Simulate blockchain transaction
            UIRenderer.showLoading(true, 'Claiming tokens...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Update wallet
            DataManager.wallets[walletIndex].mmmHoldings += claimable;
            DataManager.wallets[walletIndex].claimed += claimable;
            DataManager.wallets[walletIndex].totalToClaim = 0;
            
            // Add transaction record
            const newTransaction = {
                id: DataManager.generateId(),
                type: 'Claim',
                amount: claimable,
                address: 'System Reward',
                status: 'Completed',
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                icon: 'fa-gift',
                txHash: '0x' + Math.random().toString(16).slice(2, 34)
            };
            
            DataManager.transactions.unshift(newTransaction);
            DataManager.saveToStorage();
            
            // Update UI
            UIRenderer.renderWallets();
            UIRenderer.renderTransactions();
            UIRenderer.updateStats();
            
            NotificationManager.showSuccess(`Claimed ${DataManager.formatNumber(claimable)} MMM!`);
            
            // Show confetti for successful claim
            UIRenderer.showConfetti();
            
        } catch (error) {
            console.error('Claim failed:', error);
            NotificationManager.showError('Claim failed. Please try again.');
        } finally {
            UIRenderer.showLoading(false);
        }
    },

    sendTokens: async function() {
        try {
            const amountInput = document.getElementById('amount');
            const recipientInput = document.getElementById('recipient');
            
            const amount = parseFloat(amountInput.value) || 0;
            const recipient = recipientInput.value.trim();
            const selectedId = document.getElementById('wallet-select').value;
            
            // Validation
            if (!this.validateTransaction(amount, recipient, selectedId)) {
                return;
            }
            
            const walletIndex = DataManager.wallets.findIndex(w => w.id === selectedId);
            
            // Show loading state
            UIRenderer.showLoading(true, 'Processing transaction...');
            
            // Simulate blockchain transaction
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Update wallet balance
            DataManager.wallets[walletIndex].mmmHoldings -= amount;
            
            // Add transaction record
            const newTransaction = {
                id: DataManager.generateId(),
                type: 'Send',
                amount: -amount,
                address: recipient,
                status: 'Completed',
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                icon: 'fa-paper-plane',
                txHash: '0x' + Math.random().toString(16).slice(2, 34)
            };
            
            DataManager.transactions.unshift(newTransaction);
            DataManager.saveToStorage();
            
            // Update UI
            UIRenderer.renderWallets();
            UIRenderer.renderTransactions();
            UIRenderer.updateStats();
            
            // Reset form
            amountInput.value = '';
            recipientInput.value = '';
            
            NotificationManager.showSuccess(
                `Sent ${DataManager.formatNumber(amount)} MMM to ${recipient.slice(0, 12)}...`
            );
            
        } catch (error) {
            console.error('Send failed:', error);
            NotificationManager.showError('Transaction failed. Please try again.');
        } finally {
            UIRenderer.showLoading(false);
        }
    },

    validateTransaction: function(amount, recipient, selectedId) {
        // Check amount
        if (amount <= 0) {
            NotificationManager.showError('Please enter a valid amount');
            return false;
        }
        
        // Check recipient
        if (!recipient || !recipient.startsWith('0x') || recipient.length < 10) {
            NotificationManager.showError('Please enter a valid recipient address (0x...)');
            return false;
        }
        
        // Check wallet selection
        const wallet = DataManager.wallets.find(w => w.id === selectedId);
        if (!wallet) {
            NotificationManager.showError('Please select a wallet');
            return false;
        }
        
        // Check balance
        if (amount > wallet.mmmHoldings) {
            NotificationManager.showError('Insufficient balance');
            return false;
        }
        
        return true;
    },

    quickSend: function(recipient, amount) {
        document.getElementById('recipient').value = recipient;
        document.getElementById('amount').value = amount;
        this.sendTokens();
    },

    simulateTransaction: function(type, amount, address) {
        const newTransaction = {
            id: DataManager.generateId(),
            type: type,
            amount: amount,
            address: address,
            status: 'Completed',
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            icon: type === 'Receive' ? 'fa-download' : 'fa-paper-plane',
            txHash: '0x' + Math.random().toString(16).slice(2, 34)
        };
        
        DataManager.transactions.unshift(newTransaction);
        DataManager.saveToStorage();
        
        UIRenderer.renderTransactions();
        
        NotificationManager.showInfo(`Simulated ${type.toLowerCase()} transaction`);
    }
};

// ========== NOTIFICATION MANAGER ==========
const NotificationManager = {
    showNotification: function(message, type = 'info', duration = 5000) {
        // Remove existing notifications
        this.clearNotifications();
        
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} fixed top-4 right-4 z-50 max-w-md fade-in`;
        notification.innerHTML = `
            <div class="flex items-center">
                <i class="fas ${
                    type === 'success' ? 'fa-check-circle' :
                    type === 'error' ? 'fa-exclamation-triangle' :
                    type === 'warning' ? 'fa-exclamation-circle' :
                    'fa-info-circle'
                } alert-icon"></i>
                <span>${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        class="ml-auto text-gray-400 hover:text-gray-600">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after duration
        if (duration > 0) {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, duration);
        }
        
        return notification;
    },

    showSuccess: function(message) {
        return this.showNotification(message, 'success');
    },

    showError: function(message) {
        return this.showNotification(message, 'error', 7000);
    },

    showWarning: function(message) {
        return this.showNotification(message, 'warning');
    },

    showInfo: function(message) {
        return this.showNotification(message, 'info');
    },

    clearNotifications: function() {
        document.querySelectorAll('.alert.fixed').forEach(alert => {
            if (alert.parentNode) {
                alert.remove();
            }
        });
    }
};

// ========== SETTINGS MANAGER ==========
const SettingsManager = {
    init: function() {
        this.loadSettings();
        this.setupThemeToggle();
    },

    loadSettings: function() {
        // Apply dark mode if enabled
        if (DataManager.settings.darkMode) {
            document.body.classList.add('dark-mode');
            const themeIcon = document.getElementById('themeIcon');
            if (themeIcon) {
                themeIcon.classList.remove('fa-moon');
                themeIcon.classList.add('fa-sun');
            }
        }
        
        // Update UI elements based on settings
        this.updateSettingsUI();
    },

    setupThemeToggle: function() {
        const themeToggle = document.getElementById('themeToggle');
        const themeIcon = document.getElementById('themeIcon');
        
        if (themeToggle && themeIcon) {
            themeToggle.addEventListener('click', () => {
                document.body.classList.toggle('dark-mode');
                DataManager.settings.darkMode = document.body.classList.contains('dark-mode');
                DataManager.saveToStorage();
                
                if (DataManager.settings.darkMode) {
                    themeIcon.classList.remove('fa-moon');
                    themeIcon.classList.add('fa-sun');
                } else {
                    themeIcon.classList.remove('fa-sun');
                    themeIcon.classList.add('fa-moon');
                }
            });
        }
    },

    toggleSetting: function(setting) {
        if (DataManager.settings.hasOwnProperty(setting)) {
            DataManager.settings[setting] = !DataManager.settings[setting];
            DataManager.saveToStorage();
            
            this.updateSettingsUI();
            
            NotificationManager.showSuccess(
                `${setting.replace(/([A-Z])/g, ' $1')} ${DataManager.settings[setting] ? 'enabled' : 'disabled'}`
            );
        }
    },

    updateSettingsUI: function() {
        // Update toggle buttons based on settings
        Object.keys(DataManager.settings).forEach(setting => {
            const toggleBtn = document.querySelector(`[data-setting-toggle="${setting}"]`);
            if (toggleBtn) {
                toggleBtn.classList.toggle('active', DataManager.settings[setting]);
                toggleBtn.innerHTML = DataManager.settings[setting] ? 
                    `<i class="fas fa-toggle-on"></i>` : 
                    `<i class="fas fa-toggle-off"></i>`;
            }
        });
    },

    showSettingsModal: function() {
        UIModals.showModal('settings-modal');
    }
};

// ========== UI MODALS ==========
const UIModals = {
    showModal: function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            document.body.style.overflow = 'hidden';
        }
    },

    hideModal: function(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            document.body.style.overflow = '';
        }
    },

    showSendModal: function(walletId) {
        // Set the wallet in dropdown
        const select = document.getElementById('wallet-select');
        if (select) {
            select.value = walletId;
            UIRenderer.updateAvailableBalance();
        }
        
        // Show the send section (scroll to it)
        const sendSection = document.querySelector('.send-section');
        if (sendSection) {
            sendSection.scrollIntoView({ behavior: 'smooth' });
        }
    },

    showTransactionDetails: function(txId) {
        const transaction = DataManager.transactions.find(tx => tx.id === txId);
        if (!transaction) return;
        
        const modalContent = `
            <div class="modal max-w-md">
                <div class="modal-header">
                    <h3 class="text-lg font-bold">Transaction Details</h3>
                    <button onclick="UIModals.hideModal('transaction-details')" class="modal-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-sm text-gray-600">Type</p>
                            <p class="font-medium">${transaction.type}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-600">Status</p>
                            <span class="badge ${transaction.status === 'Completed' ? 'badge-success' : 'badge-warning'}">
                                ${transaction.status}
                            </span>
                        </div>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600">Amount</p>
                        <p class="text-2xl font-bold ${transaction.amount > 0 ? 'text-green-600' : 'text-red-600'}">
                            ${transaction.amount > 0 ? '+' : ''}${DataManager.formatNumber(transaction.amount)} MMM
                        </p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600">Address</p>
                        <p class="font-mono text-sm break-all">${transaction.address}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600">Transaction Hash</p>
                        <p class="font-mono text-sm break-all">${transaction.txHash}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-sm text-gray-600">Date</p>
                            <p>${DataManager.formatDate(transaction.date)}</p>
                        </div>
                        <div>
                            <p class="text-sm text-gray-600">Time</p>
                            <p>${transaction.time}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Create or update modal
        let modal = document.getElementById('transaction-details');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'transaction-details';
            modal.className = 'modal-overlay hidden';
            modal.onclick = (e) => {
                if (e.target === modal) {
                    this.hideModal('transaction-details');
                }
            };
            document.body.appendChild(modal);
        }
        
        modal.innerHTML = modalContent;
        this.showModal('transaction-details');
    }
};

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all managers
    UIRenderer.init();
    SettingsManager.init();
    
    // Auto-refresh balances every 30 seconds
    setInterval(() => {
        if (DataManager.settings.refreshInterval > 0) {
            WalletManager.refreshBalances();
        }
    }, 30000);
    
    // Update last updated time every minute
    setInterval(() => {
        UIRenderer.updateLastUpdated();
    }, 60000);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl/Cmd + R to refresh
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            WalletManager.refreshBalances();
        }
        
        // Ctrl/Cmd + N to add new wallet
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            WalletManager.addSampleWallet();
        }
        
        // Escape to close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(modal => {
                modal.classList.add('hidden');
            });
            document.body.style.overflow = '';
        }
    });
    
    // Export data for backup
    window.exportData = function() {
        const data = {
            wallets: DataManager.wallets,
            transactions: DataManager.transactions,
            settings: DataManager.settings,
            exportedAt: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `mmm-dashboard-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        NotificationManager.showSuccess('Data exported successfully!');
    };
    
    // Import data from backup
    window.importData = function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = function(e) {
            const file = e.target.files[0];
            const reader = new FileReader();
            
            reader.onload = function(event) {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    if (confirm('This will replace all current data. Continue?')) {
                        DataManager.wallets = data.wallets || [];
                        DataManager.transactions = data.transactions || [];
                        DataManager.settings = data.settings || DataManager.settings;
                        DataManager.saveToStorage();
                        
                        UIRenderer.renderWallets();
                        UIRenderer.renderTransactions();
                        UIRenderer.updateStats();
                        
                        NotificationManager.showSuccess('Data imported successfully!');
                    }
                } catch (error) {
                    NotificationManager.showError('Invalid backup file');
                }
            };
            
            reader.readAsText(file);
        };
        
        input.click();
    };
    
    // Reset demo data
    window.resetDemo = function() {
        if (confirm('Reset all data to demo state?')) {
            localStorage.clear();
            location.reload();
        }
    };
    
    // Demo mode controls
    console.log(`
    === MMM Token Dashboard Demo Controls ===
    
    Available commands:
    - WalletManager.connectWallet()          // Connect new wallet
    - WalletManager.addSampleWallet()        // Add sample wallet
    - WalletManager.refreshBalances()        // Refresh all balances
    - TransactionManager.claimTokens('1')    // Claim tokens from wallet 1
    - exportData()                          // Export all data
    - importData()                          // Import from backup
    - resetDemo()                           // Reset to demo state
    
    Keyboard shortcuts:
    - Ctrl/Cmd + R: Refresh balances
    - Ctrl/Cmd + N: Add new wallet
    - Escape: Close modals
    `);
});

// ========== EXPORT FUNCTIONS FOR HTML ==========
// Make functions available globally for onclick handlers
window.claimTokens = (walletId) => TransactionManager.claimTokens(walletId);
window.sendTokens = () => TransactionManager.sendTokens();
window.connectWallet = () => WalletManager.connectWallet();
window.refreshBalances = () => WalletManager.refreshBalances();
window.addSampleWallet = () => WalletManager.addSampleWallet();
window.setAmountPercentage = (percentage) => UIRenderer.setAmountPercentage(percentage);
window.quickSend = (recipient, amount) => TransactionManager.quickSend(recipient, amount);
window.showSettings = () => SettingsManager.showSettingsModal();
window.showTransactionDetails = (txId) => UIModals.showTransactionDetails(txId);
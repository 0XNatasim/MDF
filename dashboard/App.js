/* App.js — MMM Dashboard (v1.1 corrected eligibility)
   Single-source-of-truth using on-chain timestamps only.
   NO local timers. NO guessed state. NO divergence.
   FIXED: Proper hold time calculation for all scenarios.
*/

"use strict";

/* =========================
   CONFIG
========================= */
const CONFIG = {
  chainIdDec: 10143,
  chainIdHex: "0x279F",
  chainName: "Monad Testnet",
  nativeSymbol: "MON",
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
  explorerBase: "https://testnet.monadvision.com",

  mmmToken: "0x698828907aEBCC72f104200C2F61Ecd9a4fC4E29",
  rewardVault: "0x69a2c17f891645b71Edebdfa6c056Ae492A17C54",
  taxVault: "0x19d1CC532f27244b59f848437724be9eBFb641d8",
  router: "0xAD82f0b75dB323d0f553C879A628474EA5dCb7bb",
  wmon: "0x4D982b91355fDEfd421E37C15718d585a649E5ac",

  LS_WALLETS: "mmm_watch_wallets",
  LS_ACTIONS: "mmm_action_log",
};

/* =========================
   ABIs
========================= */
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function lastNonZeroAt(address) view returns (uint256)",
];

const REWARD_VAULT_ABI = [
  "function pending(address) view returns (uint256)",
  "function lastClaimAt(address) view returns (uint256)",
  "function minHoldTimeSec() view returns (uint256)",
  "function claimCooldown() view returns (uint256)",
  "function minBalance() view returns (uint256)",
  "function claim()",
];

/* =========================
   STATE
========================= */
let provider, browserProvider, signer;
let MMM, RewardVault;
let connectedAddress = null;

let wallets = [];
let actions = [];
let decimals = 18;

/* =========================
   HELPERS
========================= */
const $ = (id) => document.getElementById(id);

const now = () => Math.floor(Date.now() / 1000);

function fmt(n, d = 6) {
  return Number(n).toLocaleString("en-US", {
    maximumFractionDigits: d,
  });
}

function formatMMM(n) {
  return `${fmt(n)} MMM`;
}

function formatMON(n) {
  return `${fmt(n)} MON`;
}

function countdown(sec) {
  if (sec <= 0) return "Ready";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

/* =========================
   LOCAL STORAGE
========================= */
function loadLocal() {
  wallets = JSON.parse(localStorage.getItem(CONFIG.LS_WALLETS) || "[]");
  actions = JSON.parse(localStorage.getItem(CONFIG.LS_ACTIONS) || "[]");
}

function saveLocal() {
  localStorage.setItem(CONFIG.LS_WALLETS, JSON.stringify(wallets));
  localStorage.setItem(CONFIG.LS_ACTIONS, JSON.stringify(actions));
}

/* =========================
   CHAIN INIT
========================= */
async function initRead() {
  provider = new ethers.FallbackProvider(
    CONFIG.rpcUrls.map((u) => new ethers.JsonRpcProvider(u)),
    1
  );

  MMM = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, provider);
  RewardVault = new ethers.Contract(CONFIG.rewardVault, REWARD_VAULT_ABI, provider);

  decimals = await MMM.decimals();
}

/* =========================
   WALLET CONNECT
========================= */
async function connectWallet() {
  browserProvider = new ethers.BrowserProvider(window.ethereum);
  await browserProvider.send("eth_requestAccounts", []);

  signer = await browserProvider.getSigner();
  connectedAddress = await signer.getAddress();

  MMM = MMM.connect(signer);
  RewardVault = RewardVault.connect(signer);

  refreshAll();
}

/* =========================
   ELIGIBILITY (AUTHORITATIVE - FIXED)
========================= */
async function getWalletState(addr) {
  const [
    balRaw,
    pendingRaw,
    lastClaimAt,
    lastNonZeroAt,
    minHold,
    cooldown,
    minBalanceRaw,
  ] = await Promise.all([
    MMM.balanceOf(addr),
    RewardVault.pending(addr),
    RewardVault.lastClaimAt(addr),
    MMM.lastNonZeroAt(addr),
    RewardVault.minHoldTimeSec(),
    RewardVault.claimCooldown(),
    RewardVault.minBalance(),
  ]);

  const bal = Number(ethers.formatUnits(balRaw, decimals));
  const pending = Number(ethers.formatEther(pendingRaw));
  const minBalance = Number(ethers.formatUnits(minBalanceRaw, decimals));

  const currentTime = now();

  // CRITICAL FIX: Hold time calculation
  // The hold requirement applies whenever:
  // 1. User has minimum balance
  // 2. User has not held long enough since acquiring balance
  let holdRemaining = 0;
  
  if (bal >= minBalance && lastNonZeroAt > 0n) {
    // Calculate time since first acquisition of minimum balance
    const timeSinceAcquisition = currentTime - Number(lastNonZeroAt);
    const requiredHoldTime = Number(minHold);
    
    // If they haven't held long enough, show remaining time
    if (timeSinceAcquisition < requiredHoldTime) {
      holdRemaining = requiredHoldTime - timeSinceAcquisition;
    }
  } else if (bal < minBalance) {
    // If balance is below minimum, they need to acquire more
    // Show as "Insufficient balance" rather than a timer
    holdRemaining = -1; // Special value indicating insufficient balance
  }

  // Cooldown calculation (time since last claim)
  let cooldownRemaining = 0;
  if (lastClaimAt > 0n) {
    const timeSinceLastClaim = currentTime - Number(lastClaimAt);
    const requiredCooldown = Number(cooldown);
    
    if (timeSinceLastClaim < requiredCooldown) {
      cooldownRemaining = requiredCooldown - timeSinceLastClaim;
    }
  }

  // Eligibility determination
  const canClaim =
    pending > 0 &&
    bal >= minBalance &&
    holdRemaining === 0 &&  // Must have held long enough
    cooldownRemaining === 0; // Must be past cooldown

  return {
    bal,
    pending,
    holdRemaining,
    cooldownRemaining,
    canClaim,
    minBalance,
    lastNonZeroAt: Number(lastNonZeroAt),
    lastClaimAt: Number(lastClaimAt),
  };
}

/* =========================
   RENDER CONNECTED
========================= */
async function renderConnected() {
  if (!connectedAddress) {
    $("connectedCard").innerHTML = "";
    return;
  }

  const s = await getWalletState(connectedAddress);

  // Format hold status
  let holdStatus;
  if (s.holdRemaining === -1) {
    holdStatus = "Insufficient balance";
  } else if (s.holdRemaining > 0) {
    holdStatus = countdown(s.holdRemaining);
  } else {
    holdStatus = "Ready";
  }

  $("connectedCard").innerHTML = `
    <div class="wallet-card">
      <h3>Connected Wallet</h3>
      <div class="wallet-address">${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}</div>
      <div>MMM Holdings: ${formatMMM(s.bal)}</div>
      <div>Claimable MON: ${formatMON(s.pending)}</div>
      <div>Hold: ${holdStatus}</div>
      <div>Cooldown: ${countdown(s.cooldownRemaining)}</div>
      <button ${s.canClaim ? "" : "disabled"}
        onclick="claimConnected()">
        ${s.canClaim ? "Claim Rewards" : "Not Eligible"}
      </button>
    </div>
  `;
}

async function claimConnected() {
  try {
    const tx = await RewardVault.claim();
    showLoading("Claiming rewards...");
    await tx.wait();
    hideLoading();
    refreshAll();
  } catch (err) {
    hideLoading();
    console.error("Claim failed:", err);
    alert("Claim failed: " + (err.message || err));
  }
}

/* =========================
   WATCHED WALLETS
========================= */
async function renderWatched() {
  const el = $("walletsContainer");
  
  if (wallets.length === 0) {
    el.innerHTML = '<div class="empty-state">No watched wallets</div>';
    return;
  }

  el.innerHTML = "";

  for (const w of wallets) {
    const s = await getWalletState(w.address);

    // Format hold status
    let holdStatus;
    if (s.holdRemaining === -1) {
      holdStatus = "Insufficient balance";
    } else if (s.holdRemaining > 0) {
      holdStatus = countdown(s.holdRemaining);
    } else {
      holdStatus = "Ready";
    }

    el.innerHTML += `
      <div class="wallet-card">
        <div class="wallet-header">
          <h3>${w.name || "Unnamed"}</h3>
          <button onclick="removeWallet('${w.address}')" class="btn-icon">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        <div class="wallet-address">${w.address.slice(0, 6)}...${w.address.slice(-4)}</div>
        <div>MMM Holdings: ${formatMMM(s.bal)}</div>
        <div>Claimable MON: ${formatMON(s.pending)}</div>
        <div>Hold: ${holdStatus}</div>
        <div>Cooldown: ${countdown(s.cooldownRemaining)}</div>
        <div class="wallet-status ${s.canClaim ? 'eligible' : 'not-eligible'}">
          ${s.canClaim ? "✓ Eligible to claim" : "✗ Not eligible"}
        </div>
      </div>
    `;
  }
}

/* =========================
   WALLET MANAGEMENT
========================= */
function removeWallet(address) {
  if (confirm(`Remove ${address} from watched wallets?`)) {
    wallets = wallets.filter(w => w.address.toLowerCase() !== address.toLowerCase());
    saveLocal();
    refreshAll();
  }
}

/* =========================
   LOADING OVERLAY
========================= */
function showLoading(text = "Processing...") {
  const overlay = $("loadingOverlay");
  const loadingText = $("loadingText");
  if (overlay) overlay.classList.remove("hidden");
  if (loadingText) loadingText.textContent = text;
}

function hideLoading() {
  const overlay = $("loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
}

/* =========================
   REFRESH
========================= */
async function refreshAll() {
  try {
    await renderConnected();
    await renderWatched();
    saveLocal();
  } catch (err) {
    console.error("Refresh failed:", err);
  }
}

/* =========================
   BOOT
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  loadLocal();
  await initRead();
  
  if (window.ethereum) {
    const accts = await window.ethereum.request({ method: "eth_accounts" });
    if (accts.length) await connectWallet();
  }
  
  // Set up refresh button if it exists
  const refreshBtn = $("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshAll);
  }
  
  // Initial render
  refreshAll();
});

// Make functions globally available
window.claimConnected = claimConnected;
window.removeWallet = removeWallet;
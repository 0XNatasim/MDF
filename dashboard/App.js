/* App.js — MMM Dashboard (Monad Testnet) - FIXED ELIGIBILITY
   Layout/DOM contract: matches index.html exactly (IDs, columns, swap options).
   This is a front-end script loaded directly by index.html (no bundler assumed).
   
   FIXED: Hold timer calculation now uses lastNonZeroAt consistently for both
   connected and watched wallets, eliminating divergence after page refresh.
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
  rpcUrls: ["https://testnet-rpc.monad.xyz","https://rpc.ankr.com/monad_testnet","https://rpc-testnet.monadinfra.com"],
  explorerBase: "https://testnet.monadvision.com",
  // === CONTRACTS (MONAD TESTNET) ===
  mmmToken: "0x0705c27638Fc64ccF336e6978292aaaF8784019f",
  rewardVault: "0x43d0D9EBaa8B4Db9e4D774967448Ee4fd24E5391",
  taxVault: "0xDa9Bb0673d1Bc44F6b7e44748a7a614ac819C238",
  router: "0x8f19BA1736bEe66b59628F73bB040150ec912E51",
  pair: "0xfc1714625A7e0CC80AcDA84038DFE7A3214f26b7",
  wmon: "0xBfcE67C05ba97a627b911Ba27B56A3037260C185",
  tracker: "0x8f19BA1736bEe66b59628F73bB040150ec912E51",
  boostNFT: "0xC792E95519ce5F9EBC7b52F0A57f34D659CeA1Ae",


  defaultWatch: ["0x3d0de3A76cd9f856664DC5a3adfd4056E45da9ED"],
  LS_WALLETS: "mmm_watch_wallets",
  LS_ACTIONS: "mmm_action_log",
};

/* =========================
   ABIs
========================= */
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function lastNonZeroAt(address) view returns (uint256)",
];

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)",
];

const WMON_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
];

const REWARD_VAULT_ABI = [
  "function pending(address) view returns (uint256)",
  "function lastClaimAt(address) view returns (uint256)",
  "function minHoldTimeSec() view returns (uint256)",
  "function claimCooldown() view returns (uint256)",
  "function minBalance() view returns (uint256)",
  "function claim()",
];

const BOOSTNFT_ABI = [
  "function getBoost(address user) view returns (tuple(uint32 holdReduction,uint32 cooldownReduction), uint8 rarity)"
];

/* =========================
   STATE
========================= */
let readProvider;
let browserProvider = null;
let signer = null;
let connectedAddress = null;

let tokenRead, rewardVaultRead, routerRead, factoryRead;
let tokenWrite = null, rewardVaultWrite = null, routerWrite = null;

let EFFECTIVE_WMON = null;
let refreshInFlight = false;

let VAULT_PARAMS = {
  minHoldTime: null,
  claimCooldown: null,
  minBalance: null,
};

let MMM_DECIMALS = 18;

let wmonRead = null;
let wmonWrite = null;
let pairRead = null;
let pairAddress = null;

let wallets = [];
let actions = [];

let connectedSnapshot = {
  address: null,
  mmmHoldings: 0,
  claimableMon: 0,
  decimals: 18,
};

let protocolSnapshot = {
  taxesMMM: 0,
  rewardVaultMon: 0,
  mmmPerMon: null,
  lastRefresh: null,
  connectedMon: null,
};

let boostNftRead = null;

/* =========================
   DOM helpers
========================= */
const $ = (id) => document.getElementById(id);

function formatCountdown(sec) {
  if (sec <= 0) return "Ready";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "—";
}

function fmt(n, d = 6) {
  const x = Number(n || 0);
  return x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

function formatMMM(x) {
  return `${fmt(Number(x || 0), 6)} MMM`;
}

function formatMon(x) {
  return `${fmt(Number(x || 0), 6)} MON`;
}

function pad2(n) { return String(n).padStart(2, "0"); }

function nowDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function nowDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtCompact(nStr, decimals = 2) {
  const n = Number(nStr);
  if (!Number.isFinite(n)) return String(nStr);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

function logInfo(...args) {
  console.log("[MMM]", ...args);
}

function showLoading(msg) {
  setText("loadingText", msg || "Processing…");
  $("loadingOverlay")?.classList.remove("hidden");
}

function hideLoading() {
  $("loadingOverlay")?.classList.add("hidden");
}

function uiError(msg, errObj) {
  console.error("[MMM][ERROR]", msg, errObj || "");
  alert(msg);
}

function formatDuration(sec) {
  sec = Math.max(0, Number(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTiny(x, decimals = 10) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

async function getBoostStatus(addr) {
  if (!boostNftRead || !addr) return null;

  try {
    const result = await boostNftRead.getBoost(addr);
    const rarity = Number(result[1]); // uint8

    // Enum:
    // 0 = NONE
    // 1 = COMMON
    // 2 = RARE

    if (rarity === 1) return "COMMON";
    if (rarity === 2) return "RARE";

    return null;
  } catch (e) {
    console.warn("getBoost() failed:", e.message);
    return null;
  }
}


/* =========================
   new function
========================= */
async function loadVaultParams() {
  if (
    VAULT_PARAMS.minHoldTime !== null &&
    VAULT_PARAMS.claimCooldown !== null &&
    VAULT_PARAMS.minBalance !== null
  ) {
    return;
  }

  const [minHold, cooldown, minBalanceRaw] = await Promise.all([
    rewardVaultRead.minHoldTimeSec(),
    rewardVaultRead.claimCooldown(),
    rewardVaultRead.minBalance(),
  ]);

  VAULT_PARAMS.minHoldTime = Number(minHold);
  VAULT_PARAMS.claimCooldown = Number(cooldown);
  VAULT_PARAMS.minBalance = Number(
    ethers.formatUnits(minBalanceRaw, MMM_DECIMALS)
  );
}




/* =========================
   Local storage
========================= */
function loadData() {
  try {
    wallets = JSON.parse(localStorage.getItem(CONFIG.LS_WALLETS) || "[]");
  } catch (_) {
    wallets = [];
  }
  try {
    actions = JSON.parse(localStorage.getItem(CONFIG.LS_ACTIONS) || "[]");
  } catch (_) {
    actions = [];
  }
}

function saveData() {
  localStorage.setItem(CONFIG.LS_WALLETS, JSON.stringify(wallets));
  localStorage.setItem(CONFIG.LS_ACTIONS, JSON.stringify(actions));
}

function mkWallet(name, addr) {
  return {
    id: String(Date.now()) + Math.random().toString(16).slice(2),
    name: name || "Watched",
    address: ethers.getAddress(addr),
    mmmHoldings: 0,
    claimableMon: 0,
    lastClaimAt: 0,
    lastNonZeroAt: 0,
  };
}

/* =========================
   Slider
========================= */
let sliderTimer = null;
let sliderIndex = 0;

function initWatchedSlider() {
  const root = $("watchedSlider");
  if (!root) return;

  const slides = Array.from(root.querySelectorAll(".watched-slide"));
  const dots = Array.from(root.querySelectorAll(".watched-dot"));
  if (slides.length <= 1) return;

  function setActive(i) {
    sliderIndex = (i + slides.length) % slides.length;
    slides.forEach((s, idx) => s.classList.toggle("is-active", idx === sliderIndex));
    dots.forEach((d, idx) => d.classList.toggle("is-active", idx === sliderIndex));
  }

  function restart() {
    if (sliderTimer) clearInterval(sliderTimer);
    sliderTimer = setInterval(() => setActive(sliderIndex + 1), 3500);
  }

  dots.forEach((d) => {
    d.addEventListener("click", () => {
      const i = Number(d.dataset.slide || 0);
      setActive(i);
      restart();
    });
  });

  setActive(0);
  restart();
}

/* =========================
   Chain read setup
========================= */
async function initReadSide() {
  readProvider = new ethers.FallbackProvider(
    CONFIG.rpcUrls.map((url) => new ethers.JsonRpcProvider(url)),
    null,
    { quorum: 1 }
  );

  tokenRead = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, readProvider);
  MMM_DECIMALS = await tokenRead.decimals().catch(() => 18);
  rewardVaultRead = new ethers.Contract(CONFIG.rewardVault, REWARD_VAULT_ABI, readProvider);
  routerRead = new ethers.Contract(CONFIG.router, ROUTER_ABI, readProvider);

  try {
    EFFECTIVE_WMON = CONFIG.wmon;
    pairAddress = CONFIG.pair;
    wmonRead = new ethers.Contract(EFFECTIVE_WMON, WMON_ABI, readProvider);
    pairRead = new ethers.Contract(pairAddress, PAIR_ABI, readProvider);
  } catch (e) {
    console.warn("Could not read factory from router:", e);
  }

  boostNftRead = new ethers.Contract(
    CONFIG.boostNFT,
    BOOSTNFT_ABI,
    readProvider
  );

  logInfo("Read-side initialization complete");
}

/* =========================
   Connect wallet
========================= */
async function connectWallet(silent = false) {
  try {
    if (!window.ethereum) {
      if (!silent) uiError("No wallet detected. Install MetaMask or similar.");
      return;
    }

    browserProvider = new ethers.BrowserProvider(window.ethereum, "any");
    const network = await browserProvider.getNetwork();

    if (Number(network.chainId) !== CONFIG.chainIdDec) {
      await switchOrAddChain();
    }

    const accounts = await browserProvider.send("eth_requestAccounts", []);
    if (!accounts?.length) {
      if (!silent) uiError("No accounts found");
      return;
    }

    connectedAddress = ethers.getAddress(accounts[0]);
    signer = await browserProvider.getSigner();

    tokenWrite = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
    rewardVaultWrite = new ethers.Contract(CONFIG.rewardVault, REWARD_VAULT_ABI, signer);
    routerWrite = new ethers.Contract(CONFIG.router, ROUTER_ABI, signer);
    wmonWrite = new ethers.Contract(CONFIG.wmon, WMON_ABI, signer);

    setHeaderConnectionUI(true);
    await refreshAll();
    logInfo("Wallet connected:", connectedAddress);
  } catch (e) {
    console.error("Connect wallet error:", e);
    if (!silent) uiError(`Connection error: ${e?.message || e}`, e);
  }
}

async function switchOrAddChain() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.chainIdHex }],
    });
  } catch (switchError) {
    if (switchError.code === 4902) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CONFIG.chainIdHex,
              chainName: CONFIG.chainName,
              nativeCurrency: {
                name: CONFIG.nativeSymbol,
                symbol: CONFIG.nativeSymbol,
                decimals: 18,
              },
              rpcUrls: CONFIG.rpcUrls,
              blockExplorerUrls: [CONFIG.explorerBase],
            },
          ],
        });
      } catch (addError) {
        throw addError;
      }
    } else {
      throw switchError;
    }
  }
}

function setHeaderConnectionUI(connected) {
  const btn = $("connectBtn");
  const lbl = $("connectLabel");
  const disc = $("disconnectBtn");

  if (connected && connectedAddress) {
    if (lbl) lbl.textContent = shortAddr(connectedAddress);
    if (btn) btn.classList.replace("btn--secondary", "btn--primary");
    if (disc) disc.disabled = false;
  } else {
    if (lbl) lbl.textContent = "Connect";
    if (btn) btn.classList.replace("btn--primary", "btn--secondary");
    if (disc) disc.disabled = true;
  }
}

function disconnectWallet() {
  browserProvider = null;
  signer = null;
  connectedAddress = null;
  tokenWrite = null;
  rewardVaultWrite = null;
  routerWrite = null;

  connectedSnapshot.address = null;
  connectedSnapshot.mmmHoldings = 0;
  connectedSnapshot.claimableMon = 0;

  setHeaderConnectionUI(false);
  renderConnectedCard();
  renderSendDropdown();
  updateSwapQuoteAndButtons();
  logInfo("Wallet disconnected");
}
/* =========================
   ELIGIBILITY CALCULATION (RPC-SAFE, FIXED)
   - Caches global vault params
   - Uses lastNonZeroAt correctly
   - Fail-soft on RPC throttling
========================= */
async function getWalletEligibility(addr) {
  const nowTs = Math.floor(Date.now() / 1000);

  try {
    // 1️⃣ Load global vault params ONCE (cached)
    await loadVaultParams();

    // 2️⃣ Per-wallet calls ONLY (reduced set)
    const [
      balRaw,
      pendingRaw,
      lastClaimAt,
      lastNonZeroAt,
    ] = await Promise.all([
      tokenRead.balanceOf(addr),
      rewardVaultRead.pending(addr),
      rewardVaultRead.lastClaimAt(addr),
    ]);

    const bal = Number(
      ethers.formatUnits(balRaw, MMM_DECIMALS)
    );

    const pending = Number(
      ethers.formatEther(pendingRaw)
    );

    const minBalance = VAULT_PARAMS.minBalance;

    /* -------------------------
     HOLD (on-chain truth)
    -------------------------- */

    let holdRemaining = 0;

    if (bal >= minBalance) {
      const holdRemainingRaw =
        await rewardVault.holdRemaining(addr);

     holdRemaining = Number(holdRemainingRaw);
    }

    /* -------------------------
       COOLDOWN (after claim)
    -------------------------- */
    let cooldownRemaining = 0;

    if (bal >= minBalance) {
      const cooldownRaw =
        await rewardVault.cooldownRemaining(addr);

      cooldownRemaining = Number(cooldownRaw);
    }

    const canClaim =
      pending > 0 &&
      bal >= minBalance &&
      holdRemaining === 0 &&
      cooldownRemaining === 0;

    return {
      bal,
      pending,
      holdRemaining,
      cooldownRemaining,
      canClaim,
      hasMinBalance: bal >= minBalance,
      lastClaimAt: Number(lastClaimAt),
      lastNonZeroAt: Number(lastNonZeroAt),
    };

  } catch (e) {
    // IMPORTANT: fail-soft, do NOT lie with zeros
    if (!String(e.message).includes("Too Many Requests")) {
      console.warn("[getWalletEligibility skipped]", addr, e.message);
    }
    
    return null;
  }

  console.log("holdRemainingRaw:", holdRemainingRaw.toString())
}

/* =========================
   Claim logic (RewardVault v1)
========================= */
async function getClaimableMon(addr) {
  if (!rewardVaultRead) return 0n;

  try {
    return await rewardVaultRead.pending(addr);
  } catch (e) {
    console.warn("pending() failed:", e);
    return 0n;
  }
}

async function claimRewards(walletAddr) {
  try {
    if (!rewardVaultWrite || !signer || !connectedAddress) {
      return uiError("Wallet not connected.");
    }

    if (
      ethers.getAddress(walletAddr) !==
      ethers.getAddress(connectedAddress)
    ) {
      return uiError("You can only claim for the connected wallet.");
    }

    showLoading("Checking claim eligibility…");

    const pending = await rewardVaultRead.pending(walletAddr);
    if (pending <= 0n) {
      hideLoading();
      return uiError("No rewards available to claim.");
    }

    const now = Math.floor(Date.now() / 1000);
    const lastClaim = Number(await rewardVaultRead.lastClaimAt(walletAddr));
    const cooldown = Number(await rewardVaultRead.claimCooldown());

    if (lastClaim > 0 && now - lastClaim < cooldown) {
      hideLoading();
      const remaining = cooldown - (now - lastClaim);
      return uiError(
        `Claim cooldown active. Try again in ${formatDuration(remaining)}.`
      );
    }

    showLoading("Sending claim transaction…");

    const tx = await rewardVaultWrite.claim({ gasLimit: 300000n });
    const rcpt = await tx.wait();

    const claimedHuman = Number(ethers.formatEther(pending));

    actions.unshift({
      type: "CLAIM",
      amountMon: `${claimedHuman.toFixed(6)} MON`,
      amountMmm: "—",
      quote: "RewardVault claim",
      txHash: rcpt.hash,
      status: "Completed",
      dateTime: nowDateTime(),
    });

    saveData();
    hideLoading();
    await refreshAll();
  } catch (e) {
    hideLoading();
    uiError(`Claim failed: ${e?.message || e}`, e);
  }
}

/* =========================
   Pool reserves
========================= */
async function updatePoolReservesUI() {
  if (!pairRead) {
    setText("poolMmmReserves", "—");
    setText("poolWmonReserves", "—");
    setText("poolMmmValue", "—");
    setText("poolWmonValue", "—");
    setText("poolMmmPct", "—");
    setText("poolWmonPct", "—");
    return;
  }

  try {
    const [token0Addr, token1Addr, reserves] = await Promise.all([
      pairRead.token0(),
      pairRead.token1(),
      pairRead.getReserves(),
    ]);

    const [r0, r1] = reserves;
    const token0Lower = token0Addr.toLowerCase();
    const mmmLower = CONFIG.mmmToken.toLowerCase();

    let mmmReserve, wmonReserve;
    if (token0Lower === mmmLower) {
      mmmReserve = r0;
      wmonReserve = r1;
    } else {
      mmmReserve = r1;
      wmonReserve = r0;
    }

    const mmmHuman = Number(
      ethers.formatUnits(mmmReserve, MMM_DECIMALS)
    );
    const wmonHuman = Number(ethers.formatEther(wmonReserve));

    const mmmPct = ((mmmHuman / (mmmHuman + wmonHuman)) * 100).toFixed(2);
    const wmonPct = ((wmonHuman / (mmmHuman + wmonHuman)) * 100).toFixed(2);

    setText("poolMmmReserves", fmtCompact(mmmHuman, 2));
    setText("poolWmonReserves", fmtCompact(wmonHuman, 2));
    setText("poolMmmValue", `~${fmtCompact(wmonHuman, 2)} MON`);
    setText("poolWmonValue", `~${fmtCompact(wmonHuman, 2)} MON`);
    setText("poolMmmPct", `${mmmPct}%`);
    setText("poolWmonPct", `${wmonPct}%`);
  } catch (e) {
    console.warn("Could not fetch pool reserves:", e);
    setText("poolMmmReserves", "—");
    setText("poolWmonReserves", "—");
    setText("poolMmmValue", "—");
    setText("poolWmonValue", "—");
    setText("poolMmmPct", "—");
    setText("poolWmonPct", "—");
  }
}

/* =========================
   Quote price
========================= */
async function quoteMmmPerMon(decimals = 18) {
  if (!pairRead) return null;

  try {
    const [token0Addr, token1Addr, reserves] = await Promise.all([
      pairRead.token0(),
      pairRead.token1(),
      pairRead.getReserves(),
    ]);

    const [r0, r1] = reserves;
    const token0Lower = token0Addr.toLowerCase();
    const mmmLower = CONFIG.mmmToken.toLowerCase();

    let mmmReserve, wmonReserve;
    if (token0Lower === mmmLower) {
      mmmReserve = r0;
      wmonReserve = r1;
    } else {
      mmmReserve = r1;
      wmonReserve = r0;
    }

    if (!mmmReserve || !wmonReserve || wmonReserve === 0n) return null;

    const mmmHuman = Number(ethers.formatUnits(mmmReserve, decimals));
    const wmonHuman = Number(ethers.formatEther(wmonReserve));

    const mmmPerMon = wmonHuman > 0 ? mmmHuman / wmonHuman : 0;
    return mmmPerMon;
  } catch (e) {
    console.warn("Could not quote MMM/MON:", e);
    return null;
  }
}

async function quoteOutFromReserves(amountIn, tokenIn, tokenOut) {
  if (!pairRead) throw new Error("Pair not available");

  try {
    const [token0Addr, token1Addr, reserves] = await Promise.all([
      pairRead.token0(),
      pairRead.token1(),
      pairRead.getReserves(),
    ]);

    const [r0, r1] = reserves;
    const token0Lower = token0Addr.toLowerCase();
    const tokenInLower = tokenIn.toLowerCase();

    let reserveIn, reserveOut;
    if (token0Lower === tokenInLower) {
      reserveIn = r0;
      reserveOut = r1;
    } else {
      reserveIn = r1;
      reserveOut = r0;
    }

    if (!reserveIn || !reserveOut || reserveIn === 0n || reserveOut === 0n) {
      throw new Error("Insufficient liquidity");
    }

    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;
    const amountOut = numerator / denominator;

    return amountOut;
  } catch (e) {
    console.warn("quoteOutFromReserves error:", e);
    throw e;
  }
}

/* =========================
   KPI updates
========================= */
function updateKPIs() {
  setText("kpiTaxes", formatMMM(protocolSnapshot.taxesMMM));
  setText("kpiTrackerMon", formatMon(protocolSnapshot.rewardVaultMon));

  const price = protocolSnapshot.mmmPerMon;
  if (price !== null && price > 0) {
    const monPerMmm = 1 / price;
    setText("kpiPrice", fmtTiny(monPerMmm, 10));
  } else {
    setText("kpiPrice", "—");
  }

  if (protocolSnapshot.lastRefresh) {
    const d = protocolSnapshot.lastRefresh;
    const str = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    setText("kpiRefresh", str);
  } else {
    setText("kpiRefresh", "—");
  }

  // Network card: show connected wallet MON balance
  const monEl = $("kpiConnectedMon");
  if (monEl) {
    monEl.textContent = protocolSnapshot.connectedMon !== null
      ? `${fmt(protocolSnapshot.connectedMon, 4)} MON`
      : "—";
  }
}


/* =========================
   Connected wallet card (FINAL CLEAN VERSION)
========================= */
async function renderConnectedCard() {
  const container = $("connectedCard");
  if (!container) return;

  if (!connectedAddress) {
    container.innerHTML = "";
    return;
  }

  const [eligibility, boostStatus] = await Promise.all([
    getWalletEligibility(connectedAddress),
    getBoostStatus(connectedAddress),
  ]);

  if (!eligibility) {
    container.innerHTML = `
      <div class="wallet-card">
        <div class="wallet-top">
          <h3 class="wallet-name">Connected Wallet</h3>
        </div>
        <div class="wallet-metrics">
          <div class="metric">
            <span class="k">Status:</span>
            <span class="v mono warn">RPC unavailable</span>
          </div>
        </div>
      </div>
    `;
    return;
  }

  /* ---------- HOLD + COOLDOWN TEXT ---------- */

  const holdText =
    !eligibility.hasMinBalance
      ? `<span class="warn">Insufficient balance</span>`
      : eligibility.holdRemaining === 0
        ? `<span class="ok">Ready</span>`
        : `<span class="mono">${formatCountdown(eligibility.holdRemaining)}</span>`;

  const cooldownText =
    eligibility.cooldownRemaining === 0
      ? `<span class="ok">Ready</span>`
      : `<span class="mono">${formatCountdown(eligibility.cooldownRemaining)}</span>`;

  /* ---------- NFT BADGE ---------- */

  const nftBadgeMap = {
    COMMON: `<span class="nft-badge nft-common" title="Common Boost NFT">C</span>`,
    RARE: `<span class="nft-badge nft-rare" title="Rare Boost NFT">R</span>`
  };

  const nftBadge = nftBadgeMap[boostStatus] || "";

  /* ---------- RENDER ---------- */

  container.innerHTML = `
    <div class="wallet-card">
      <div class="wallet-top">
        <div class="wallet-id">
          <div style="min-width:0;">
            <h3 class="wallet-name">
              Connected Wallet ${nftBadge}
            </h3>
            <div class="wallet-addr mono">
              ${escapeHtml(connectedAddress)}
              <button class="icon-btn"
                      onclick="copyText('${connectedAddress}')"
                      title="Copy address">
                <i class="fas fa-copy"></i>
              </button>
            </div>
          </div>
        </div>

        ${
          eligibility.canClaim
            ? `
              <button class="btn btn--primary"
                      onclick="claimRewards('${connectedAddress}')">
                <i class="fas fa-hand-holding-dollar"></i> Claim
              </button>`
            : `
              <button class="btn btn--ghost" disabled>
                <i class="fas fa-clock"></i> Not eligible
              </button>`
        }
      </div>

      <div class="wallet-metrics">
        <div class="metric">
          <span class="k">MMM Holdings:</span>
          <span class="v mono">${formatMMM(eligibility.bal)}</span>
        </div>

        <div class="metric">
          <span class="k">Claimable MON:</span>
          <span class="v mono">${formatMon(eligibility.pending)}</span>
        </div>

        <div class="metric">
          <span class="k">Hold requirement:</span>
          <span class="v mono">${holdText}</span>
        </div>

        <div class="metric">
          <span class="k">Cooldown:</span>
          <span class="v mono">${cooldownText}</span>
        </div>
      </div>
    </div>
  `;
}
/* =========================
   Watched wallets (FIXED)
========================= */
async function renderWallets() {
  const container = $("walletsContainer");
  if (!container) return;

  if (!wallets.length) {
    container.innerHTML = `
      <div style="padding:16px; color:rgba(255,255,255,0.55); text-align:center;">
        No watched wallets yet.
      </div>`;
    return;
  }

  let html = "";

  for (const w of wallets) {
    const [eligibility, boostStatus] = await Promise.all([
      getWalletEligibility(w.address),
      getBoostStatus(w.address),
    ]);

    const nftBadgeMap = {
      COMMON: `<span class="nft-badge nft-common" title="Common Boost NFT">C</span>`,
      RARE: `<span class="nft-badge nft-rare" title="Rare Boost NFT">R</span>`
    };
    
    const nftBadge = nftBadgeMap[boostStatus] || "";


    if (!eligibility) {
      html += `
        <div class="wallet-card">
          <div class="wallet-top">
            <div class="wallet-id">
              <div style="min-width:0;">
                <h3 class="wallet-name">
                  ${escapeHtml(w.name)} ${nftBadge}</h3>
                <div class="wallet-addr mono">
                  ${escapeHtml(w.address)}
                </div>
              </div>
            </div>
          </div>
  
          <div class="wallet-metrics">
            <div class="metric">
              <span class="k">Status:</span>
              <span class="v mono warn">RPC unavailable</span>
            </div>
          </div>
        </div>
      `;
      continue;
    }






    const holdText =
      !eligibility.hasMinBalance
        ? `<span class="warn">Insufficient balance</span>`
        : eligibility.holdRemaining === 0
          ? `<span class="ok">Ready</span>`
          : formatCountdown(eligibility.holdRemaining);

    const cooldownText =
      eligibility.cooldownRemaining === 0
        ? `<span class="ok">Ready</span>`
        : formatCountdown(eligibility.cooldownRemaining);

    html += `
      <div class="wallet-card">
        <div class="wallet-top">
          <div class="wallet-id">
              ${escapeHtml(w.name.charAt(0).toUpperCase())}
            </div>
            <div style="min-width:0;">
              <h3 class="wallet-name">${escapeHtml(w.name)}</h3>
              <div class="wallet-addr mono">
                ${escapeHtml(w.address)}
                <button class="icon-btn"
                        onclick="copyText('${w.address}')"
                        title="Copy address">
                  <i class="fas fa-copy"></i>
                </button>
              </div>
            </div>
          </div>

          <button class="icon-btn"
                  onclick="removeWallet('${w.id}')"
                  title="Remove">
            <i class="fas fa-trash"></i>
          </button>
        </div>

        <div class="wallet-metrics">
          <div class="metric">
            <span class="k">MMM Holdings:</span>
            <span class="v mono">${formatMMM(eligibility.bal)}</span>
          </div>

          <div class="metric">
            <span class="k">Claimable MON:</span>
            <span class="v mono">${formatMon(eligibility.pending)}</span>
          </div>

          <div class="metric">
            <span class="k">Hold Timer:</span>
            <span class="v mono">${holdText}</span>
          </div>

          <div class="metric">
            <span class="k">Cooldown:</span>
            <span class="v mono">${cooldownText}</span>
          </div>
        </div>

        ${
          eligibility.canClaim
            ? `
        <button class="btn btn--secondary btn--block"
                onclick="claimRewards('${w.address}')">
          <i class="fas fa-hand-holding-dollar"></i>
          Claim Rewards
        </button>`
            : `
        <button class="btn btn--ghost btn--block" disabled>
          <i class="fas fa-clock"></i>
          Not eligible yet
        </button>`
        }
      </div>
    `;
  }

  container.innerHTML = html;
}

function addWallet() {
  const addr = prompt("Enter wallet address to watch:");
  if (!addr) return;

  try {
    const checksummed = ethers.getAddress(addr.trim());
    const exists = wallets.some((w) => w.address.toLowerCase() === checksummed.toLowerCase());

    if (exists) {
      return uiError("This wallet is already being watched.");
    }

    const name = prompt("Name for this wallet:", "Watched");
    const w = mkWallet(name || "Watched", checksummed);
    wallets.push(w);

    saveData();
    refreshAll();
  } catch (e) {
    uiError("Invalid address.", e);
  }
}

function watchConnected() {
  if (!connectedAddress) {
    return uiError("Please connect your wallet first.");
  }

  const exists = wallets.some((w) => w.address.toLowerCase() === connectedAddress.toLowerCase());
  if (exists) {
    return uiError("Connected wallet is already in the watch list.");
  }

  const name = prompt("Name for this wallet:", "My Wallet");
  const w = mkWallet(name || "My Wallet", connectedAddress);
  wallets.push(w);

  saveData();
  refreshAll();
}

function removeWallet(id) {
  if (!confirm("Remove this wallet from watch list?")) return;

  wallets = wallets.filter((w) => w.id !== id);
  saveData();
  renderWallets();
}

/* =========================
   Actions table
========================= */
function renderActions() {
  const tbody = $("txBody");
  if (!tbody) return;

  if (!actions.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:rgba(255,255,255,0.55);">No actions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = actions
    .map((a) => {
      const explorerLink =
        a.txHash && a.txHash !== "—"
          ? `<a class="link mono" href="${CONFIG.explorerBase}/tx/${a.txHash}" target="_blank" rel="noreferrer">${shortAddr(a.txHash)}</a>`
          : escapeHtml(a.txHash || "—");

      const isSell  = a.type === "SELL";
      const isBuy   = a.type === "BUY";
      const badgeCls = isSell ? "badge badge--bad" : "badge badge--good";

      // BUY: amountMmm column shows total MMM holdings at time of buy
      // SELL: amountMmm column shows amount sold
      const mmmCell = isBuy
        ? escapeHtml(a.amountMmm || "—")   // total holdings snapshot logged at buy time
        : isSell
          ? escapeHtml(a.amountMmm || "—") // amount sold
          : escapeHtml(a.amountMmm || "—");

      return `
        <tr>
          <td><span class="${badgeCls}">${escapeHtml(a.type)}</span></td>
          <td class="mono">${escapeHtml(a.amountMon || "—")}</td>
          <td class="mono">${mmmCell}</td>
          <td class="mono">${escapeHtml(a.quote || "—")}</td>
          <td>${explorerLink}</td>
          <td><span class="badge badge--good">${escapeHtml(a.status || "Pending")}</span></td>
          <td class="mono">${escapeHtml(a.dateTime || "—")}</td>
        </tr>
      `;
    })
    .join("");
}

function clearLog() {
  if (!confirm("Clear all logged actions?")) return;

  actions = [];
  saveData();
  renderActions();
}

function resetAll() {
  if (!confirm("Reset all watched wallets and action log?")) return;

  wallets = [];
  actions = [];

  if (CONFIG.defaultWatch?.length) {
    wallets = CONFIG.defaultWatch.map((a, i) => mkWallet(`Watched #${i + 1}`, a));
  }

  saveData();
  renderWallets();
  renderActions();
  refreshAll();
}

/* =========================
   Send MMM
========================= */
function renderSendDropdown() {
  const sel = $("walletSelect");
  if (!sel) return;

  sel.innerHTML = "";

  if (!connectedAddress) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Connect wallet first";
    sel.appendChild(opt);
    return;
  }

  const opt = document.createElement("option");
  opt.value = connectedAddress;
  opt.textContent = `Connected (${shortAddr(connectedAddress)})`;
  sel.appendChild(opt);

  updateAvailableBalance();
}

async function updateAvailableBalance() {
  const sel = $("walletSelect");
  const balSpan = $("availableBalance");

  if (!sel || !balSpan) return;

  const addr = sel.value;
  if (!addr || !tokenRead) {
    balSpan.textContent = "0 MMM";
    return;
  }

  try {
    const bal = await tokenRead.balanceOf(addr);
    const human = Number(ethers.formatUnits(bal, MMM_DECIMALS));
    balSpan.textContent = formatMMM(human);
  } catch (e) {
    balSpan.textContent = "0 MMM";
  }
}

async function sendMmm() {
  try {
    const sel = $("walletSelect");
    const amtInput = $("amountInput");
    const recInput = $("recipientInput");

    if (!sel || !amtInput || !recInput) return;

    const from = sel.value;
    const recipient = recInput.value.trim();
    const amount = parseFloat(amtInput.value || "0");

    if (!from) return uiError("Please select a source wallet.");
    if (!recipient) return uiError("Please enter a recipient address.");
    if (amount <= 0) return uiError("Please enter a valid amount.");

    const checksummedRecipient = ethers.getAddress(recipient);

    if (!signer || !tokenWrite) {
      return uiError("Wallet not connected.");
    }

    showLoading("Preparing transfer…");

    const decimals = connectedSnapshot.decimals || 18;
    const amountBn = ethers.parseUnits(String(amount), decimals);

    const bal = await tokenRead.balanceOf(from);
    if (bal < amountBn) {
      hideLoading();
      return uiError(`Insufficient balance. You have ${ethers.formatUnits(bal, decimals)} MMM`);
    }

    showLoading("Sending transaction…");
    const tx = await tokenWrite.transfer(checksummedRecipient, amountBn, { gasLimit: 200000n });

    showLoading("Waiting for confirmation…");
    const rcpt = await tx.wait();

    actions.unshift({
      type: "SEND",
      amountMon: "—",
      amountMmm: `${amount} MMM`,
      quote: "—",
      txHash: rcpt.hash,
      status: "Completed",
      dateTime: nowDateTime(),
    });

    saveData();
    hideLoading();

    amtInput.value = "";
    recInput.value = "";

    await refreshAll();
  } catch (e) {
    hideLoading();
    uiError(`Send failed: ${e?.message || e}`, e);
  }
}

function fillPercent(pct) {
  const sel = $("walletSelect");
  const amtInput = $("amountInput");
  const balSpan = $("availableBalance");

  if (!sel || !amtInput || !balSpan) return;

  const text = balSpan.textContent || "";
  const num = parseFloat(text.replace(/[^\d.]/g, ""));

  if (Number.isFinite(num) && num > 0) {
    const filled = num * pct;
    amtInput.value = filled.toFixed(6);
  }
}





/* =========================
   Swap logic (safe + deterministic)
========================= */
async function updateSwapQuoteAndButtons() {
  const sideSelect   = $("swapSide");
  const amtInput     = $("swapAmountIn");
  const quoteOut     = $("swapQuoteOut");
  const approveBtn   = $("swapApproveBtn");
  const execBtn      = $("swapExecBtn");

  if (!sideSelect || !amtInput || !quoteOut || !approveBtn || !execBtn) return;

  approveBtn.disabled = true;
  execBtn.disabled = true;

  const side = sideSelect.value;
  const amountIn = Number(amtInput.value || 0);

  if (!signer || !connectedAddress) {
    quoteOut.textContent = "Connect wallet";
    return;
  }

  if (!pairRead) {
    quoteOut.textContent = "Pool not ready";
    return;
  }

  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    quoteOut.textContent = "—";
    return;
  }

  try {
    if (side === "buy") {
      const decimals = MMM_DECIMALS;

      const ethIn = ethers.parseEther(String(amountIn));

      const mmmOut = await quoteOutFromReserves(
        ethIn,
        EFFECTIVE_WMON,
        CONFIG.mmmToken
      );

      const mmmHuman = Number(
        ethers.formatUnits(mmmOut, decimals)
      );

      quoteOut.textContent = `${fmtCompact(mmmHuman, 6)} MMM`;

      execBtn.disabled = false;
      approveBtn.disabled = true;
      return;
    }

    const decimals = MMM_DECIMALS;

    const mmmIn = ethers.parseUnits(String(amountIn), decimals);

    const monOut = await quoteOutFromReserves(
      mmmIn,
      CONFIG.mmmToken,
      EFFECTIVE_WMON
    );

    const monHuman = Number(
      ethers.formatEther(monOut)
    );

    quoteOut.textContent = `${monHuman.toFixed(6)} MON`;

    const allowance = await tokenRead.allowance(
      connectedAddress,
      CONFIG.router
    );

    if (allowance < mmmIn) {
      approveBtn.disabled = false;
      execBtn.disabled = true;
    } else {
      approveBtn.disabled = true;
      execBtn.disabled = false;
    }
  } catch (e) {
    console.error("[SWAP QUOTE ERROR]", e);
    quoteOut.textContent = "Quote failed";
  }
}

async function approveSwap() {
  try {
    if (!signer || !tokenWrite) {
      return uiError("Please connect your wallet first.");
    }

    showLoading("Approving MMM for router…");

    const tx = await tokenWrite.approve(
      CONFIG.router,
      ethers.MaxUint256,
      { gasLimit: 100000n }
    );

    await tx.wait();

    hideLoading();
    await updateSwapQuoteAndButtons();
  } catch (e) {
    hideLoading();
    uiError(`Approval failed: ${e?.message || e}`, e);
  }
}

async function execSwap() {
  try {
    if (!signer || !routerWrite || !wmonWrite) {
      return uiError("Please connect your wallet first.");
    }

    const sideSelect = $("swapSide");
    const amtInput = $("swapAmountIn");
    const slippageSelect = $("swapSlippage");

    if (!sideSelect || !amtInput || !slippageSelect) return;

    const side = sideSelect.value;
    const amountIn = parseFloat(amtInput.value || "0");
    const slippagePct = parseFloat(slippageSelect.value || "1");

    if (amountIn <= 0) return uiError("Enter a valid amount.");

    // ✅ Re-acquire here — after all guards, before any tx
    signer = await browserProvider.getSigner();
    routerWrite = new ethers.Contract(CONFIG.router, ROUTER_ABI, signer);
    wmonWrite   = new ethers.Contract(CONFIG.wmon, WMON_ABI, signer);
    tokenWrite  = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);




    const slippageBps = Math.floor(slippagePct * 100);
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const to = connectedAddress;

    showLoading("Preparing swap…");

    if (side === "buy") {
      // Use swapExactETHForTokensSupportingFeeOnTransferTokens — single tx,
      // handles fee-on-transfer correctly, no wrap/approve steps needed.
      const value = ethers.parseEther(String(amountIn));
      const path  = [CONFIG.wmon, CONFIG.mmmToken];
      const decimals = MMM_DECIMALS;

      // Quote expected MMM out from reserves, then apply slippage
      let minOut = 0n;
      try {
        const expectedOut = await quoteOutFromReserves(value, CONFIG.wmon, CONFIG.mmmToken);
        minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
      } catch (_) {
        // If quote fails, use 0 minOut (rely entirely on slippage protection being disabled)
        minOut = 0n;
      }

      showLoading("Swapping MON → MMM…");
      const tx = await routerWrite.swapExactETHForTokensSupportingFeeOnTransferTokens(
        minOut,
        path,
        to,
        deadline,
        { value, gasLimit: 600_000n }
      );

      const rcpt = await tx.wait();

      // Read actual MMM received from balance delta
      const mmmAfter  = await tokenRead.balanceOf(connectedAddress);
      const amountMonIn   = Number(amountIn);
      const totalMmmHuman = Number(ethers.formatUnits(mmmAfter, decimals));
      const pricePaidMonPerMmm = totalMmmHuman > 0 ? (amountMonIn / totalMmmHuman) : 0;

      actions.unshift({
        type:      "BUY",
        amountMon: `${amountMonIn} MON`,
        amountMmm: `${fmtCompact(totalMmmHuman, 4)} MMM`,  // total holdings after buy
        quote:     `${fmtTiny(pricePaidMonPerMmm, 10)} MON/MMM`,
        txHash:    rcpt.hash,
        status:    "Completed",
        dateTime:  nowDateTime(),
      });

      saveData();
      hideLoading();
      await refreshAll();
      return;
    }

    const decimals = connectedSnapshot.decimals || 18;
    const amountInBn = ethers.parseUnits(String(amountIn), decimals);
    
    const bal = await tokenRead.balanceOf(connectedAddress);
    if (bal < amountInBn) {
      hideLoading();
      return uiError(`Insufficient MMM balance. You have ${ethers.formatUnits(bal, decimals)} MMM`);
    }

    const allowance = await tokenRead.allowance(connectedAddress, CONFIG.router);
    if (allowance < amountInBn) {
      hideLoading();
      return uiError("Insufficient allowance. Click 'Approve MMM' first.");
    }

    const path = [CONFIG.mmmToken, CONFIG.wmon];

    const taxedAmountIn = amountInBn - (amountInBn * 500n) / 10_000n; // 5% tax
    let minOut = 0n;
    try {
      const expectedOut = await quoteOutFromReserves(taxedAmountIn, CONFIG.mmmToken, CONFIG.wmon);
      minOut = expectedOut - (expectedOut * BigInt(slippageBps)) / 10_000n;
    } catch (_) {
      minOut = 0n;
    }

    showLoading("Swapping MMM → WMON...");
    const swapTx = await routerWrite.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      amountInBn,
      minOut,
      path,
      connectedAddress,
      deadline,
      { gasLimit: 600_000n }
    );
    await swapTx.wait();

    showLoading("Unwrapping WMON to MON...");
    const wmonBal = await wmonRead.balanceOf(connectedAddress);
    const unwrapTx = await wmonWrite.withdraw(wmonBal);
    const rcpt = await unwrapTx.wait();

    const amountMmmIn = Number(amountIn);
    const outMonHuman = Number(ethers.formatEther(wmonBal));
    const pricePaidMonPerMmm = amountMmmIn > 0 ? (outMonHuman / amountMmmIn) : 0;

    const amountMmmStr = `${amountMmmIn} MMM`;
    const amountMonStr = `${outMonHuman.toFixed(6)} MON`;
    const quoteStr = fmtTiny(pricePaidMonPerMmm, 10);

    actions.unshift({
      type: "SELL",
      amountMon: amountMonStr,
      amountMmm: amountMmmStr,
      quote: quoteStr,
      txHash: rcpt.hash,
      status: "Completed",
      dateTime: nowDateTime(),
    });

    saveData();
    hideLoading();
    await refreshAll();
  } catch (e) {
    hideLoading();

    let msg = e?.message || String(e);
    const low = msg.toLowerCase();

    if (low.includes("insufficient_output")) msg = "Insufficient output amount. Increase slippage or reduce amount.";
    if (low.includes("insuff_liq")) msg = "Insufficient liquidity in pool.";
    if (low.includes("user rejected")) msg = "Transaction rejected by user.";

    uiError(`Swap failed: ${msg}`, e);
  }
}

/* =========================
   Refresh
========================= */
async function refreshAll() {
  if (refreshInFlight) return;
  refreshInFlight = true;

  try {
    showLoading("Refreshing on-chain data…");

    const decimals = await tokenRead.decimals().catch(() => 18);
    connectedSnapshot.decimals = Number(decimals);

    const taxesRaw = await tokenRead
      .balanceOf(CONFIG.taxVault)
      .catch(() => 0n);

    protocolSnapshot.taxesMMM = Number(
      ethers.formatUnits(taxesRaw, connectedSnapshot.decimals)
    );

    const trackerMonRaw = await readProvider
      .getBalance(CONFIG.tracker)
      .catch(() => 0n);

    protocolSnapshot.rewardVaultMon = Number(
      ethers.formatEther(trackerMonRaw)
    );

    protocolSnapshot.mmmPerMon = await quoteMmmPerMon(
      connectedSnapshot.decimals
    );
    protocolSnapshot.lastRefresh = new Date();

    // Fetch connected wallet MON balance if connected
    if (connectedAddress) {
      const monRaw = await readProvider.getBalance(connectedAddress).catch(() => 0n);
      protocolSnapshot.connectedMon = Number(ethers.formatEther(monRaw));
    } else {
      protocolSnapshot.connectedMon = null;
    }

    await updatePoolReservesUI();
    updateKPIs();
    await renderConnectedCard();
    await renderWallets();
    renderActions();
    renderSendDropdown();
    await updateAvailableBalance();
    await updateSwapQuoteAndButtons();

    saveData();
    hideLoading();
  } catch (e) {
    hideLoading();
    uiError(`Refresh failed: ${e?.message || e}`, e);
  } finally {
    setTimeout(() => { refreshInFlight = false; }, 1500);
  }
}

/* =========================
   Clipboard
========================= */
async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/* =========================
   UI bindings
========================= */
function bindUI() {
  const connectBtn = $("connectBtn");
  const disconnectBtn = $("disconnectBtn");
  const refreshBtn = $("refreshBtn");
  const addWatchBtn = $("addWatchBtn");
  const watchConnectedBtn = $("watchConnectedBtn");
  const clearLogBtn = $("clearLogBtn");
  const resetBtn = $("resetBtn");
  const sendBtn = $("sendBtn");
  const walletSelect = $("walletSelect");
  const swapSide = $("swapSide");
  const swapAmountIn = $("swapAmountIn");
  const swapSlippage = $("swapSlippage");
  const swapApproveBtn = $("swapApproveBtn");
  const swapExecBtn = $("swapExecBtn");

  if (connectBtn) connectBtn.addEventListener("click", () => connectWallet(false));
  if (disconnectBtn) disconnectBtn.addEventListener("click", disconnectWallet);
  if (refreshBtn) refreshBtn.addEventListener("click", refreshAll);
  if (addWatchBtn) addWatchBtn.addEventListener("click", addWallet);
  if (watchConnectedBtn) watchConnectedBtn.addEventListener("click", watchConnected);
  if (clearLogBtn) clearLogBtn.addEventListener("click", clearLog);
  if (resetBtn) resetBtn.addEventListener("click", resetAll);
  if (sendBtn) sendBtn.addEventListener("click", sendMmm);

  if (walletSelect) walletSelect.addEventListener("change", updateAvailableBalance);

  if (swapSide) swapSide.addEventListener("change", updateSwapQuoteAndButtons);
  if (swapAmountIn) swapAmountIn.addEventListener("input", updateSwapQuoteAndButtons);
  if (swapSlippage) swapSlippage.addEventListener("change", updateSwapQuoteAndButtons);
  if (swapApproveBtn) swapApproveBtn.addEventListener("click", approveSwap);
  if (swapExecBtn) swapExecBtn.addEventListener("click", execSwap);

  const chips = document.querySelectorAll(".chip[data-pct]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const pct = parseFloat(chip.dataset.pct || "0");
      fillPercent(pct);
    });
  });
}

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  const mmmLink = $("mmmLink");
  const poolLink = $("poolLink");

  if (mmmLink) {
    mmmLink.textContent = CONFIG.mmmToken;
    mmmLink.href = `${CONFIG.explorerBase}/address/${CONFIG.mmmToken}`;
  }

  const trackerLink = $("trackerLink");
  if (trackerLink) {
    trackerLink.textContent = CONFIG.tracker;
    trackerLink.href = `${CONFIG.explorerBase}/address/${CONFIG.tracker}`;
  }

  // poolLink is set AFTER initReadSide (further below) so pairAddress is populated

  initWatchedSlider();
  loadData();

  if (wallets.length === 0 && CONFIG.defaultWatch?.length) {
    wallets = CONFIG.defaultWatch.map((a, i) => mkWallet(`Watched #${i + 1}`, a));
    saveData();
  }

  bindUI();
  setHeaderConnectionUI(false);

  await initReadSide();

  if (poolLink && pairAddress) {
    poolLink.textContent = pairAddress;
    poolLink.href = `${CONFIG.explorerBase}/address/${pairAddress}`;
  }

  renderConnectedCard();
  renderWallets();
  renderActions();
  updateKPIs();
  await updateSwapQuoteAndButtons();

  await refreshAll();

  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts?.length) await connectWallet(true);
    } catch (_) {}
  }
});

// Make functions globally accessible
window.claimRewards = claimRewards;
window.copyText = copyText;
window.removeWallet = removeWallet;
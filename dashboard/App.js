/* App.js – MMM Dashboard (Monad Testnet) – COMPLETE FIXED VERSION
   Key Fixes:
   1. Complete Router ABI with exact function signatures
   2. Proper slippage calculation (basis points)
   3. Better error handling and logging
   4. Gas limit specifications
   5. Pair existence verification
*/

const CONFIG = {
  chainIdDec: 10143,
  chainIdHex: "0x279F",
  chainName: "Monad Testnet",
  nativeSymbol: "MON",
  rpcUrls: [
    "https://rpc.ankr.com/monad_testnet",
    "https://testnet-rpc.monad.xyz",
  ],
  explorerBase: "https://testnet.monadvision.com",

  // Contracts - VERIFY THESE ADDRESSES
  mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  tracker:  "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B",
  pool:     "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",

  wmon:    "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
  factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
  router:  "0xC3B66EE616286c5e4A0aE6D33238e86104Ec8051",

  defaultWatch: ["0x22BC7a72000faE48a67520c056C0944d9a675412"],
};

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
];

// FIXED: Complete Router ABI matching your Router.sol
const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  
  // Add Liquidity
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
  
  // Swaps - EXACT signatures from Router.sol
  "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable returns (uint256[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)",
  
  // Quote functions
  "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
  "function createPair(address tokenA, address tokenB) returns (address)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

const TRACKER_ABI = [
  "function claimable(address) view returns (uint256)",
  "function pendingReward(address) view returns (uint256)",
  "function withdrawableDividendOf(address) view returns (uint256)",
  "function withdrawableRewardsOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function claim()",
  "function claim(address)",
  "function claimDividend()",
  "function claimForAccount(address)",
  "function processAccount(address,bool) returns (bool)",
];

let readProvider;
let tokenRead, trackerRead, routerRead, factoryRead;
let pairRead = null;

let browserProvider = null;
let signer = null;
let connectedAddress = null;

let tokenWrite = null;
let trackerWrite = null;
let routerWrite = null;

let wallets = [];
let actions = [];

let connectedSnapshot = { address: null, mmmHoldings: 0, claimableMon: 0, decimals: 18 };
let protocolSnapshot  = { taxesMMM: 0, trackerMon: 0, mmmPerMon: null, lastRefresh: null };

let EFFECTIVE_WMON = null;

let sliderTimer = null;
let sliderIndex = 0;

const $ = (id) => document.getElementById(id);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ""; }

function fmt(n, d = 6) {
  const x = Number(n || 0);
  return x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
}

function formatMMM(x) { return `${fmt(Number(x || 0), 6)} MMM`; }
function formatMon(x) { return `${fmt(Number(x || 0), 6)} MON`; }

function nowDate() { return new Date().toISOString().split("T")[0]; }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function err(msg) {
  console.error("ERROR:", msg);
  alert(msg);
}

function log(msg) {
  console.log("INFO:", msg);
}

function loadData() {
  wallets = JSON.parse(localStorage.getItem("mmm_watch_wallets") || "[]");
  actions = JSON.parse(localStorage.getItem("mmm_action_log") || "[]");
}

function saveData() {
  localStorage.setItem("mmm_watch_wallets", JSON.stringify(wallets));
  localStorage.setItem("mmm_action_log", JSON.stringify(actions));
}

function mkWallet(name, addr) {
  return {
    id: String(Date.now()) + Math.random().toString(16).slice(2),
    name,
    address: ethers.getAddress(addr),
    mmmHoldings: 0,
    claimableMon: 0,
  };
}

function showLoading(msg) {
  setText("loadingText", msg || "Processing...");
  $("loadingOverlay")?.classList.remove("hidden");
}
function hideLoading() {
  $("loadingOverlay")?.classList.add("hidden");
}

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

  function restartTimer() {
    if (sliderTimer) clearInterval(sliderTimer);
    sliderTimer = setInterval(() => setActive(sliderIndex + 1), 3500);
  }

  dots.forEach((d) => {
    d.addEventListener("click", () => {
      const i = Number(d.dataset.slide || 0);
      setActive(i);
      restartTimer();
    });
  });

  setActive(0);
  restartTimer();
}

document.addEventListener("DOMContentLoaded", async () => {
  // explorer links
  const mmmLink = $("mmmLink");
  const trackerLink = $("trackerLink");
  const poolLink = $("poolLink");

  if (mmmLink) {
    mmmLink.textContent = CONFIG.mmmToken;
    mmmLink.href = `${CONFIG.explorerBase}/address/${CONFIG.mmmToken}`;
  }
  if (trackerLink) {
    trackerLink.textContent = CONFIG.tracker;
    trackerLink.href = `${CONFIG.explorerBase}/address/${CONFIG.tracker}`;
  }
  if (poolLink) {
    poolLink.textContent = CONFIG.pool;
    poolLink.href = `${CONFIG.explorerBase}/address/${CONFIG.pool}`;
  }

  initWatchedSlider();

  // Read providers
  readProvider = new ethers.FallbackProvider(
    CONFIG.rpcUrls.map((url) => new ethers.JsonRpcProvider(url))
  );

  tokenRead   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, readProvider);
  trackerRead = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, readProvider);
  routerRead  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, readProvider);
  factoryRead = new ethers.Contract(CONFIG.factory,  FACTORY_ABI, readProvider);

  // Resolve effective WMON/WETH from router
  try {
    const routerWeth = await routerRead.WETH();
    EFFECTIVE_WMON = ethers.getAddress(routerWeth);
    log(`Router WETH resolved: ${EFFECTIVE_WMON}`);
  } catch (e) {
    log(`Router WETH failed, using config: ${e.message}`);
    EFFECTIVE_WMON = ethers.getAddress(CONFIG.wmon);
  }
  window.EFFECTIVE_WMON = EFFECTIVE_WMON;

  loadData();
  if (wallets.length === 0 && CONFIG.defaultWatch?.length) {
    wallets = CONFIG.defaultWatch.map((a, i) => mkWallet(`Watched #${i + 1}`, a));
    saveData();
  }

  // Header
  $("connectBtn")?.addEventListener("click", () => connectWallet(false));
  $("disconnectBtn")?.addEventListener("click", () => disconnectWallet(false));
  $("refreshBtn")?.addEventListener("click", refreshAll);

  // Watched mgmt
  $("addWatchBtn")?.addEventListener("click", promptAddWatch);
  $("watchConnectedBtn")?.addEventListener("click", watchConnected);
  $("resetBtn")?.addEventListener("click", resetAll);
  $("clearLogBtn")?.addEventListener("click", clearLog);

  // Send MMM
  $("sendBtn")?.addEventListener("click", sendTokens);
  $("walletSelect")?.addEventListener("change", updateAvailableBalance);
  $("amountInput")?.addEventListener("input", validateAmount);
  document.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => setAmount(parseFloat(btn.dataset.pct)));
  });

  // Swap
  $("swapSide")?.addEventListener("change", updateSwapQuoteAndButtons);
  $("swapAmountIn")?.addEventListener("input", updateSwapQuoteAndButtons);
  $("swapSlippage")?.addEventListener("change", updateSwapQuoteAndButtons);
  $("swapApproveBtn")?.addEventListener("click", approveMMMMax);
  $("swapExecBtn")?.addEventListener("click", executeSwap);

  setHeaderConnectionUI(false);

  renderConnectedCard();
  renderWallets();
  renderActions();
  updateKPIs();
  await updateSwapQuoteAndButtons();
  await refreshAll();

  // Silent auto-connect
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts?.length) await connectWallet(true);
    } catch (_) {}
  }
});

function setHeaderConnectionUI(isConnected) {
  const dis = $("disconnectBtn");
  if (dis) dis.disabled = !isConnected;

  const label = $("connectLabel");
  if (label) label.textContent = isConnected && connectedAddress ? shortAddr(connectedAddress) : "Connect";
}

/* =========================
   Pair / Reserve quoting
========================= */
async function ensurePair() {
  if (pairRead) return pairRead;
  
  log(`Checking pair: WMON=${EFFECTIVE_WMON}, MMM=${CONFIG.mmmToken}`);
  const pairAddr = await factoryRead.getPair(EFFECTIVE_WMON, CONFIG.mmmToken);
  
  if (!pairAddr || pairAddr === ethers.ZeroAddress) {
    log("Pair does not exist!");
    return null;
  }
  
  log(`Pair found at: ${pairAddr}`);
  pairRead = new ethers.Contract(pairAddr, PAIR_ABI, readProvider);
  return pairRead;
}

async function quoteOutFromReserves(amountIn, tokenIn, tokenOut) {
  const pair = await ensurePair();
  if (!pair) throw new Error("Pair not found - no liquidity exists yet");

  const [t0, t1, res] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  const token0 = ethers.getAddress(t0);
  const token1 = ethers.getAddress(t1);

  const A = ethers.getAddress(tokenIn);
  const B = ethers.getAddress(tokenOut);

  const r0 = res[0];
  const r1 = res[1];

  let reserveIn, reserveOut;
  if (A === token0 && B === token1) {
    reserveIn = r0; reserveOut = r1;
  } else if (A === token1 && B === token0) {
    reserveIn = r1; reserveOut = r0;
  } else {
    throw new Error("Tokens not in pair");
  }

  if (reserveIn === 0n || reserveOut === 0n) throw new Error("Empty reserves - add liquidity first");

  log(`Reserves: In=${ethers.formatEther(reserveIn)}, Out=${ethers.formatEther(reserveOut)}`);

  // UniswapV2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 1000n) + amountInWithFee;
  return numerator / denominator;
}

async function quoteMmmPerMon(mmmDecimals) {
  try {
    const one = ethers.parseEther("1");
    const out = await quoteOutFromReserves(one, EFFECTIVE_WMON, CONFIG.mmmToken);
    return Number(ethers.formatUnits(out, mmmDecimals));
  } catch (e) {
    console.warn("quoteMmmPerMon failed:", e);
    return null;
  }
}

/* =========================
   Refresh reads
========================= */
async function refreshAll() {
  try {
    showLoading("Refreshing on-chain data...");

    const decimals = await tokenRead.decimals().catch(() => 18);
    connectedSnapshot.decimals = decimals;

    const taxesRaw = await tokenRead.balanceOf(CONFIG.mmmToken).catch(() => 0n);
    protocolSnapshot.taxesMMM = Number(ethers.formatUnits(taxesRaw, decimals));

    const trackerMonRaw = await readProvider.getBalance(CONFIG.tracker).catch(() => 0n);
    protocolSnapshot.trackerMon = Number(ethers.formatEther(trackerMonRaw));

    protocolSnapshot.mmmPerMon = await quoteMmmPerMon(decimals);

    for (const w of wallets) {
      const bal = await tokenRead.balanceOf(w.address).catch(() => 0n);
      const claimMon = await getClaimableMon(w.address).catch(() => 0n);
      w.mmmHoldings = Number(ethers.formatUnits(bal, decimals));
      w.claimableMon = Number(ethers.formatEther(claimMon));
    }

    if (connectedAddress) {
      const bal = await tokenRead.balanceOf(connectedAddress).catch(() => 0n);
      const claimMon = await getClaimableMon(connectedAddress).catch(() => 0n);
      connectedSnapshot.address = connectedAddress;
      connectedSnapshot.mmmHoldings = Number(ethers.formatUnits(bal, decimals));
      connectedSnapshot.claimableMon = Number(ethers.formatEther(claimMon));
    } else {
      connectedSnapshot.address = null;
      connectedSnapshot.mmmHoldings = 0;
      connectedSnapshot.claimableMon = 0;
    }

    protocolSnapshot.lastRefresh = new Date();

    await updatePoolReservesUI();

    saveData();
    renderConnectedCard();
    renderWallets();
    renderActions();
    updateKPIs();
    updateAvailableBalance();
    await updateSwapQuoteAndButtons();

    setHeaderConnectionUI(Boolean(connectedAddress));
    hideLoading();
  } catch (e) {
    hideLoading();
    err(`Refresh failed: ${e?.message || e}`);
  }
}

async function getClaimableMon(addr) {
  const candidates = [
    { fn: "earned", args: [addr] },
    { fn: "claimable", args: [addr] },
    { fn: "pendingReward", args: [addr] },
    { fn: "withdrawableDividendOf", args: [addr] },
    { fn: "withdrawableRewardsOf", args: [addr] },
  ];

  for (const c of candidates) {
    try {
      trackerRead.getFunction(c.fn);
      const v = await trackerRead[c.fn](...c.args);
      if (typeof v === "bigint") return v;
    } catch (_) {}
  }
  return 0n;
}

function updateKPIs() {
  setText("kpiTaxes", formatMMM(protocolSnapshot.taxesMMM));
  setText("kpiTrackerMon", formatMon(protocolSnapshot.trackerMon));

  let priceText = "—";
  if (protocolSnapshot.mmmPerMon != null) {
    const mmmPerMon = protocolSnapshot.mmmPerMon;
    const monPerMmm = mmmPerMon > 0 ? (1 / mmmPerMon) : 0;
    priceText = `1 MON ≈ ${fmt(mmmPerMon, 6)} MMM | 1 MMM ≈ ${fmt(monPerMmm, 10)} MON`;
  }
  setText("kpiPrice", priceText);
  setText("kpiPriceCardText", priceText);

  setText("kpiRefresh", protocolSnapshot.lastRefresh ? protocolSnapshot.lastRefresh.toLocaleTimeString() : "—");
}

function renderConnectedCard() {
  const el = $("connectedCard");
  if (!el) return;

  const addr = connectedAddress ? connectedAddress : null;
  const canClaim = Boolean(addr) && Number(connectedSnapshot.claimableMon || 0) > 0;
  const explorerLink = addr ? `${CONFIG.explorerBase}/address/${addr}` : "#";

  el.innerHTML = `
    <div class="wallet-top">
      <div class="wallet-id">
        <div class="wallet-mark"><i class="fas fa-user-shield"></i></div>
        <div style="min-width:0;">
          <p class="wallet-name">Connected Wallet</p>
          <div class="wallet-addr">
            ${addr ? shortAddr(addr) : "—"}
            ${addr ? `<a class="link" style="margin-left:10px;" target="_blank" rel="noreferrer" href="${explorerLink}">Explorer</a>` : ""}
            ${addr ? `
              <button class="icon-btn" style="margin-left:10px;" type="button" id="copyConnectedInline" title="Copy address">
                <i class="fas fa-copy"></i>
              </button>` : ""}
          </div>
        </div>
      </div>
      <span class="badge ${addr ? "badge--good" : "badge--warn"}">
        ${addr ? "Connected" : "Not connected"}
      </span>
    </div>

    <div class="wallet-metrics">
      <div class="metric">
        <span class="k">MMM Balance (connected)</span>
        <span class="v">${addr ? formatMMM(connectedSnapshot.mmmHoldings) : "—"}</span>
      </div>

      <div>
        <div class="metric" style="margin-bottom:8px;">
          <span class="k">Claimable Rewards (MON)</span>
          <span class="v">${addr ? formatMon(connectedSnapshot.claimableMon) : "—"}</span>
        </div>
        <div class="progress"><div style="width:${canClaim ? 100 : 0}%;"></div></div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr; gap:10px; margin-top: 6px;">
        <button class="btn ${canClaim ? "btn--primary" : "btn--ghost"}"
          ${canClaim ? "" : "disabled"} id="connectedClaimBtn">
          <i class="fas fa-gift"></i> Claim (MON)
        </button>
      </div>
    </div>
  `;

  $("connectedClaimBtn")?.addEventListener("click", claimConnected);
  $("copyConnectedInline")?.addEventListener("click", copyConnectedAddress);
}

async function updatePoolReservesUI() {
  try {
    const pair = await ensurePair();
    if (!pair) {
      setText("poolMmmReserves", "No liquidity");
      setText("poolWmonReserves", "No liquidity");
      return;
    }

    const [res0, res1] = (await pair.getReserves()).slice(0, 2);
    const token0 = ethers.getAddress(await pair.token0());

    let mmmReserve, wmonReserve;
    if (token0.toLowerCase() === CONFIG.mmmToken.toLowerCase()) {
      mmmReserve = res0; wmonReserve = res1;
    } else {
      mmmReserve = res1; wmonReserve = res0;
    }

    const mmm = Number(ethers.formatUnits(mmmReserve, connectedSnapshot.decimals || 18));
    const wmon = Number(ethers.formatEther(wmonReserve));

    setText("poolMmmReserves", `${fmt(mmm)} MMM`);
    setText("poolWmonReserves", `${fmt(wmon)} WMON`);
  } catch (e) {
    console.warn("Pool reserves UI update failed:", e);
    setText("poolMmmReserves", "Error");
    setText("poolWmonReserves", "Error");
  }
}

/* =========================
   Connect / disconnect
========================= */
async function connectWallet(silent) {
  try {
    if (!window.ethereum) return err("No injected wallet found (MetaMask/Backpack).");

    showLoading("Connecting wallet...");
    browserProvider = new ethers.BrowserProvider(window.ethereum);

    const net = await browserProvider.getNetwork();
    if (Number(net.chainId) !== CONFIG.chainIdDec) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CONFIG.chainIdHex }]
        });
      } catch (e) {
        if (e?.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CONFIG.chainIdHex,
              chainName: CONFIG.chainName,
              nativeCurrency: { name: CONFIG.nativeSymbol, symbol: CONFIG.nativeSymbol, decimals: 18 },
              rpcUrls: CONFIG.rpcUrls,
              blockExplorerUrls: [CONFIG.explorerBase]
            }]
          });
        } else {
          throw e;
        }
      }
    }

    if (!silent) await browserProvider.send("eth_requestAccounts", []);
    signer = await browserProvider.getSigner();
    connectedAddress = await signer.getAddress();

    tokenWrite   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
    trackerWrite = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, signer);
    routerWrite  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, signer);

    log(`Connected: ${connectedAddress}`);
    setHeaderConnectionUI(true);
    renderSendDropdown();
    await refreshAll();
    hideLoading();

    window.ethereum.on?.("accountsChanged", async (accounts) => {
      if (!accounts?.length) { disconnectWallet(true); return; }
      connectedAddress = ethers.getAddress(accounts[0]);
      signer = await browserProvider.getSigner();
      tokenWrite   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
      trackerWrite = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, signer);
      routerWrite  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, signer);
      setHeaderConnectionUI(true);
      renderSendDropdown();
      await refreshAll();
    });

    window.ethereum.on?.("chainChanged", () => location.reload());
  } catch (e) {
    hideLoading();
    err(`Connect failed: ${e?.message || e}`);
  }
}

function disconnectWallet() {
  connectedAddress = null;
  signer = null;
  tokenWrite = null;
  trackerWrite = null;
  routerWrite = null;

  connectedSnapshot.address = null;
  connectedSnapshot.mmmHoldings = 0;
  connectedSnapshot.claimableMon = 0;

  setHeaderConnectionUI(false);
  renderSendDropdown();
  renderConnectedCard();
  renderWallets();
  updateKPIs();
  updateAvailableBalance();
  updateSwapQuoteAndButtons();
}

async function copyConnectedAddress() {
  if (!connectedAddress) return;
  await copyText(connectedAddress);
}

async function copyText(text) {
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
   Claim MON rewards
========================= */
async function claimConnected() {
  if (!connectedAddress) return err("Connect wallet first.");
  return claimTokens(connectedAddress);
}

async function claimTokens(addr) {
  try {
    if (!connectedAddress) return err("Connect wallet first.");
    if (ethers.getAddress(addr) !== ethers.getAddress(connectedAddress)) {
      return err("Claim only works for the connected signer address.");
    }
    if (!trackerWrite) return err("Tracker signer not ready. Reconnect wallet.");

    showLoading("Claiming rewards (MON) ...");

    const claimMethods = [
      { fn: "claim", args: [] },
      { fn: "claimDividend", args: [] },
      { fn: "claim", args: [connectedAddress] },
      { fn: "claimForAccount", args: [connectedAddress] },
      { fn: "processAccount", args: [connectedAddress, true] },
    ];

    let tx = null;
    for (const m of claimMethods) {
      try {
        trackerWrite.getFunction(m.fn);
        tx = await trackerWrite[m.fn](...m.args);
        log(`Claim method ${m.fn} succeeded`);
        break;
      } catch (_) {}
    }

    if (!tx) {
      hideLoading();
      return err("No compatible claim function found on tracker.");
    }

    const rcpt = await tx.wait();
    log(`Claim confirmed in block ${rcpt.blockNumber}`);

    actions.unshift({
      type: "Claim (MON)",
      amount: 0,
      address: "",
      txHash: rcpt?.hash || tx?.hash,
      status: "Completed",
      date: nowDate(),
    });

    saveData();
    await refreshAll();
    renderActions();
    hideLoading();
  } catch (e) {
    hideLoading();
    err(`Claim failed: ${e?.message || e}`);
  }
}

/* =========================
   Watched wallets
========================= */
function renderWallets() {
  const container = $("walletsContainer");
  if (!container) return;
  container.innerHTML = "";

  wallets.forEach((w) => {
    const isConn = connectedAddress && ethers.getAddress(w.address) === ethers.getAddress(connectedAddress);

    const card = document.createElement("div");
    card.className = "wallet-card watched-card";
    card.innerHTML = `
      <div class="wallet-top">
        <div class="wallet-id">
          <button class="wallet-mark wallet-mark--btn" type="button" data-copy="${w.address}" title="Copy address">
            <i class="fas fa-copy"></i>
          </button>
          <div style="min-width:0;">
            <p class="wallet-name">${escapeHtml(w.name)}</p>
            <div class="wallet-addr">
              ${shortAddr(w.address)}
              <a class="link" style="margin-left:10px;" target="_blank" rel="noreferrer"
                 href="${CONFIG.explorerBase}/address/${w.address}">Explorer</a>
            </div>
          </div>
        </div>
        <span class="badge ${isConn ? "badge--good" : "badge--warn"}">
          ${isConn ? "Connected" : "Watched"}
        </span>
      </div>

      <div class="wallet-metrics">
        <div class="metric">
          <span class="k">MMM Balance</span>
          <span class="v">${formatMMM(w.mmmHoldings)}</span>
        </div>

        <div class="metric">
          <span class="k">Claimable Rewards (MON)</span>
          <span class="v">${formatMon(w.claimableMon)}</span>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 48px; gap:10px; margin-top: 6px;">
          <button class="btn btn--ghost" data-remove="${w.address}" title="Remove watch">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => removeWatch(btn.dataset.remove));
  });
  container.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => copyText(btn.dataset.copy));
  });

  renderSendDropdown();
}

/* =========================
   Actions table
========================= */
function renderActions() {
  const tbody = $("txBody");
  if (!tbody) return;
  tbody.innerHTML = "";

  actions.slice(0, 25).forEach((a) => {
    const tr = document.createElement("tr");

    const linkCell = a.txHash
      ? `<a class="link" target="_blank" rel="noreferrer" href="${CONFIG.explorerBase}/tx/${a.txHash}">
           <span class="mono">${shortAddr(a.txHash)}</span>
         </a>`
      : "—";

    const statusBadge =
      a.status === "Completed"
        ? `<span class="badge badge--good">Completed</span>`
        : `<span class="badge badge--warn">${escapeHtml(a.status)}</span>`;

    tr.innerHTML = `
      <td>${escapeHtml(a.type)}</td>
      <td>${linkCell}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(a.date)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* =========================
   Send MMM
========================= */
function renderSendDropdown() {
  const sel = $("walletSelect");
  if (!sel) return;

  sel.innerHTML = "";
  if (!connectedAddress) {
    sel.innerHTML = `<option value="">Connect wallet first</option>`;
    return;
  }

  const opt = document.createElement("option");
  opt.value = connectedAddress;
  opt.textContent = `Connected (${shortAddr(connectedAddress)})`;
  sel.appendChild(opt);
}

async function sendTokens() {
  try {
    if (!connectedAddress || !tokenWrite) return err("Connect wallet first.");

    const amount = parseFloat($("amountInput")?.value) || 0;
    const recipient = $("recipientInput")?.value?.trim() || "";

    if (!recipient || recipient.length !== 42 || !recipient.startsWith("0x")) {
      return err("Enter a valid recipient address (0x...).");
    }
    if (amount <= 0) return err("Enter a valid amount.");

    const decimals = connectedSnapshot.decimals ?? 18;
    const bnAmount = ethers.parseUnits(String(amount), decimals);

    showLoading("Sending MMM transfer...");
    const tx = await tokenWrite.transfer(ethers.getAddress(recipient), bnAmount);
    const rcpt = await tx.wait();

    actions.unshift({
      type: "Send MMM",
      txHash: rcpt?.hash || tx?.hash,
      status: "Completed",
      date: nowDate(),
    });

    $("amountInput").value = "";
    $("recipientInput").value = "";

    saveData();
    await refreshAll();
    renderActions();
    hideLoading();
  } catch (e) {
    hideLoading();
    err(`Send failed: ${e?.message || e}`);
  }
}

function updateAvailableBalance() {}
function validateAmount() {}
function setAmount() {}

/* =========================
   Swap: FIXED VERSION
========================= */
// FIXED: Proper slippage calculation
function getSlippageBps() {
  const v = parseFloat(($("swapSlippage")?.value || "1"));
  // Convert percentage to basis points: 1% = 100 bps, 5% = 500 bps
  return Math.floor((Number.isFinite(v) ? v : 1) * 100);
}

function deadlineTs() {
  return Math.floor(Date.now() / 1000) + 600; // 10 minutes
}

async function updateSwapQuoteAndButtons() {
  try {
    const side = $("swapSide")?.value || "BUY";
    const inAmt = parseFloat($("swapAmountIn")?.value || "0");

    const approveBtn = $("swapApproveBtn");
    const execBtn = $("swapExecBtn");

    if (!connectedAddress || !signer) {
      approveBtn && (approveBtn.disabled = true);
      execBtn && (execBtn.disabled = true);
      setText("swapQuoteOut", "—");
      return;
    }

    // BUY needs no approve, SELL needs approve
    approveBtn && (approveBtn.disabled = side === "BUY");
    execBtn && (execBtn.disabled = !(inAmt > 0));

    // Quote from reserves
    const pair = await ensurePair();
    if (!pair || inAmt <= 0) { 
      setText("swapQuoteOut", pair ? "Enter amount" : "No liquidity"); 
      return; 
    }

    if (side === "BUY") {
      const out = await quoteOutFromReserves(
        ethers.parseEther(String(inAmt)), 
        EFFECTIVE_WMON, 
        CONFIG.mmmToken
      );
      setText("swapQuoteOut", `≈ ${fmt(Number(ethers.formatUnits(out, connectedSnapshot.decimals || 18)), 6)} MMM`);
    } else {
      const out = await quoteOutFromReserves(
        ethers.parseUnits(String(inAmt), connectedSnapshot.decimals || 18), 
        CONFIG.mmmToken, 
        EFFECTIVE_WMON
      );
      setText("swapQuoteOut", `≈ ${fmt(Number(ethers.formatEther(out)), 6)} MON`);
    }
  } catch (e) {
    console.warn("updateSwapQuoteAndButtons failed:", e);
    setText("swapQuoteOut", "Error");
  }
}

async function approveMMMMax() {
  try {
    if (!tokenWrite || !connectedAddress) return err("Connect wallet first.");
    showLoading("Approving MMM...");
    
    log(`Approving ${CONFIG.router} to spend MMM...`);
    const tx = await tokenWrite.approve(CONFIG.router, ethers.MaxUint256);
    log(`Approval tx sent: ${tx.hash}`);
    
    await tx.wait();
    log("Approval confirmed");
    
    hideLoading();
    await updateSwapQuoteAndButtons();
  } catch (e) {
    hideLoading();
    err(`Approve failed: ${e?.message || e}`);
  }
}

async function executeSwap() {
  try {
    if (!routerWrite || !signer || !connectedAddress) return err("Connect wallet first.");

    const side = $("swapSide")?.value || "BUY";
    const amountInStr = ($("swapAmountIn")?.value || "").trim();
    const amountIn = parseFloat(amountInStr);

    if (!amountInStr || !Number.isFinite(amountIn) || amountIn <= 0) {
      return err("Enter a valid amount.");
    }

    // Verify pair exists
    const pair = await ensurePair();
    if (!pair) {
      return err("No liquidity pair exists. Add liquidity first!");
    }

    const slippageBps = getSlippageBps();
    const to = connectedAddress;
    const deadline = deadlineTs();

    log(`Executing ${side} swap: ${amountIn}, slippage: ${slippageBps} bps`);

    showLoading("Preparing swap...");

    if (side === "BUY") {
      // BUY: MON -> MMM
      const value = ethers.parseEther(String(amountIn));
      const path = [EFFECTIVE_WMON, CONFIG.mmmToken];

      // Quote output and apply slippage
      const out = await quoteOutFromReserves(value, EFFECTIVE_WMON, CONFIG.mmmToken);
      const minOut = out - (out * BigInt(slippageBps)) / 10_000n;

      log(`BUY: ${amountIn} MON -> ${ethers.formatUnits(out, connectedSnapshot.decimals)} MMM (min: ${ethers.formatUnits(minOut, connectedSnapshot.decimals)})`);

      // Use fee-on-transfer variant for taxed tokens
      const txReq = await routerWrite.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
        minOut,
        path,
        to,
        deadline,
        { value }
      );

      if (!txReq.data || txReq.data === "0x") {
        throw new Error("Swap calldata is empty. ABI/method mismatch.");
      }

      log(`BUY calldata: ${txReq.data.slice(0, 66)}... (${txReq.data.length} chars)`);

      showLoading("Sending buy swap transaction...");
      const tx = await signer.sendTransaction({
        to: CONFIG.router,
        data: txReq.data,
        value,
        gasLimit: 500000n, // Explicit gas limit
      });

      log(`BUY tx sent: ${tx.hash}`);
      const rcpt = await tx.wait();
      log(`BUY tx confirmed in block ${rcpt.blockNumber}`);

      actions.unshift({ 
        type: "BUY", 
        txHash: rcpt.hash, 
        status: "Completed", 
        date: nowDate() 
      });
      saveData();

      hideLoading();
      await refreshAll();
      renderActions();
      return;
    }

    // SELL: MMM -> MON
    const decimals = connectedSnapshot.decimals || 18;
    const amountInBn = ethers.parseUnits(String(amountIn), decimals);
    const path = [CONFIG.mmmToken, EFFECTIVE_WMON];

    // Check balance
    const balance = await tokenRead.balanceOf(connectedAddress);
    if (balance < amountInBn) {
      hideLoading();
      return err(`Insufficient MMM balance. You have ${ethers.formatUnits(balance, decimals)} MMM`);
    }

    // Check allowance
    const allowance = await tokenRead.allowance(connectedAddress, CONFIG.router);
    if (allowance < amountInBn) {
      hideLoading();
      return err("Insufficient allowance. Click 'Approve' first.");
    }

    // Quote output and apply slippage
    const out = await quoteOutFromReserves(amountInBn, CONFIG.mmmToken, EFFECTIVE_WMON);
    const minOut = out - (out * BigInt(slippageBps)) / 10_000n;

    log(`SELL: ${amountIn} MMM -> ${ethers.formatEther(out)} MON (min: ${ethers.formatEther(minOut)})`);

    const txReq = await routerWrite.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
      amountInBn,
      minOut,
      path,
      to,
      deadline
    );

    if (!txReq.data || txReq.data === "0x") {
      throw new Error("Swap calldata is empty. ABI/method mismatch.");
    }

    log(`SELL calldata: ${txReq.data.slice(0, 66)}... (${txReq.data.length} chars)`);

    showLoading("Sending sell swap transaction...");
    const tx = await signer.sendTransaction({
      to: CONFIG.router,
      data: txReq.data,
      gasLimit: 500000n, // Explicit gas limit
    });

    log(`SELL tx sent: ${tx.hash}`);
    const rcpt = await tx.wait();
    log(`SELL tx confirmed in block ${rcpt.blockNumber}`);

    actions.unshift({ 
      type: "SELL", 
      txHash: rcpt.hash, 
      status: "Completed", 
      date: nowDate() 
    });
    saveData();

    hideLoading();
    await refreshAll();
    renderActions();
  } catch (e) {
    hideLoading();
    log(`Swap error details: ${JSON.stringify(e, null, 2)}`);
    
    // Better error messages
    let errorMsg = e?.message || String(e);
    
    if (errorMsg.includes("INSUFFICIENT_OUTPUT")) {
      errorMsg = "Insufficient output amount. Try increasing slippage or reducing amount.";
    } else if (errorMsg.includes("INSUFFICIENT_INPUT")) {
      errorMsg = "Insufficient input amount.";
    } else if (errorMsg.includes("INSUFF_LIQ")) {
      errorMsg = "Insufficient liquidity in pool.";
    } else if (errorMsg.includes("TRANSFER_FAILED")) {
      errorMsg = "Token transfer failed. Check allowance and balance.";
    } else if (errorMsg.includes("user rejected")) {
      errorMsg = "Transaction rejected by user.";
    }
    
    err(`Swap failed: ${errorMsg}`);
  }
}

/* =========================
   Watch mgmt + reset/log
========================= */
function promptAddWatch() {
  const addr = prompt("Enter address to watch (0x...)");
  if (!addr) return;
  addWatch(addr);
}

function addWatch(addr) {
  try {
    const a = ethers.getAddress(addr);
    if (wallets.some(w => ethers.getAddress(w.address) === a)) return;
    wallets.push(mkWallet(`Watched #${wallets.length + 1}`, a));
    saveData();
    renderWallets();
    refreshAll();
  } catch (_) {
    err("Invalid address.");
  }
}

function watchConnected() {
  if (!connectedAddress) return err("Connect wallet first.");
  addWatch(connectedAddress);
}

function removeWatch(addr) {
  try {
    const a = ethers.getAddress(addr);
    wallets = wallets.filter(w => ethers.getAddress(w.address) !== a);
    saveData();
    renderWallets();
  } catch (_) {
    err("Could not remove (invalid address).");
  }
}

function resetAll() {
  if (!confirm("Reset watched addresses and local action log?")) return;
  wallets = [];
  actions = [];
  saveData();
  renderWallets();
  renderActions();
  updateKPIs();
}

function clearLog() {
  if (!confirm("Clear local action log?")) return;
  actions = [];
  saveData();
  renderActions();
}
/* App.js — MMM Dashboard (Monad Testnet)
   Layout/DOM contract: matches index.html exactly (IDs, columns, swap options).
   This is a front-end script loaded directly by index.html (no bundler assumed).
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
  rpcUrls: ["https://rpc.ankr.com/monad_testnet", "https://testnet-rpc.monad.xyz"],
  explorerBase: "https://testnet.monadvision.com",

  // Contracts
  mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  tracker: "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B",
  pool: "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",

  wmon: "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
  factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
  router: "0xC3B66EE616286c5e4A0aE6D33238e86104Ec8051",

  // Default watch list
  defaultWatch: ["0x22BC7a72000faE48a67520c056C0944d9a675412"],

  // Local storage keys
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
];

const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH() view returns (address)",

  "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable returns (uint256[] memory amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)",

  "function getAmountsOut(uint256 amountIn, address[] memory path) view returns (uint256[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) view returns (address)",
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
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

/* =========================
   STATE
========================= */
let readProvider;
let browserProvider = null;
let signer = null;
let connectedAddress = null;

let tokenRead, trackerRead, routerRead, factoryRead;
let tokenWrite = null, trackerWrite = null, routerWrite = null;

let EFFECTIVE_WMON = null;
let pairRead = null;

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
  trackerMon: 0,
  mmmPerMon: null,
  lastRefresh: null,
};

/* =========================
   DOM helpers
========================= */
const $ = (id) => document.getElementById(id);

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

// keep nowDate() if you still use it elsewhere
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
    CONFIG.rpcUrls.map((url) => new ethers.JsonRpcProvider(url))
  );

  tokenRead = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, readProvider);
  trackerRead = new ethers.Contract(CONFIG.tracker, TRACKER_ABI, readProvider);
  routerRead = new ethers.Contract(CONFIG.router, ROUTER_ABI, readProvider);
  factoryRead = new ethers.Contract(CONFIG.factory, FACTORY_ABI, readProvider);

  // Resolve WMON/WETH used by router
  try {
    const routerWeth = await routerRead.WETH();
    EFFECTIVE_WMON = ethers.getAddress(routerWeth);
  } catch (e) {
    logInfo("Router.WETH() failed; using CONFIG.wmon", e?.message || e);
    EFFECTIVE_WMON = ethers.getAddress(CONFIG.wmon);
  }
  window.EFFECTIVE_WMON = EFFECTIVE_WMON;
  logInfo("Effective WMON:", EFFECTIVE_WMON);
}

/* =========================
   Pair / Reserves / Pricing
========================= */
async function ensurePair() {
  if (pairRead) return pairRead;

  const pairAddr = await factoryRead.getPair(EFFECTIVE_WMON, CONFIG.mmmToken);
  if (!pairAddr || pairAddr === ethers.ZeroAddress) return null;

  pairRead = new ethers.Contract(pairAddr, PAIR_ABI, readProvider);
  return pairRead;
}

async function getPairReserves() {
  const pair = await ensurePair();
  if (!pair) return null;

  const [t0, t1, reserves] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  const token0 = ethers.getAddress(t0);
  const token1 = ethers.getAddress(t1);

  // reserves: (reserve0, reserve1, ts)
  const r0 = reserves[0];
  const r1 = reserves[1];

  return { token0, token1, r0, r1 };
}

function uniswapV2AmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0n) return 0n;
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 1000n) + amountInWithFee;
  return numerator / denominator;
}

async function quoteOutFromReserves(amountIn, tokenIn, tokenOut) {
  const pr = await getPairReserves();
  if (!pr) throw new Error("Pair not found (no liquidity).");

  const A = ethers.getAddress(tokenIn);
  const B = ethers.getAddress(tokenOut);

  let reserveIn, reserveOut;
  if (A === pr.token0 && B === pr.token1) {
    reserveIn = pr.r0;
    reserveOut = pr.r1;
  } else if (A === pr.token1 && B === pr.token0) {
    reserveIn = pr.r1;
    reserveOut = pr.r0;
  } else {
    throw new Error("Tokens not in pair.");
  }

  const out = uniswapV2AmountOut(amountIn, reserveIn, reserveOut);
  if (out === 0n) throw new Error("Empty reserves / output is zero.");
  return out;
}

async function quoteMmmPerMon(mmmDecimals) {
  try {
    const oneMon = ethers.parseEther("1");
    const out = await quoteOutFromReserves(oneMon, EFFECTIVE_WMON, CONFIG.mmmToken);
    return Number(ethers.formatUnits(out, mmmDecimals));
  } catch (_) {
    return null;
  }
}

/* =========================
   UI binding
========================= */
function setHeaderConnectionUI(isConnected) {
  const dis = $("disconnectBtn");
  if (dis) dis.disabled = !isConnected;

  const label = $("connectLabel");
  if (label) label.textContent = isConnected && connectedAddress ? shortAddr(connectedAddress) : "Connect";
}

function bindUI() {
  // topbar
  $("connectBtn")?.addEventListener("click", () => connectWallet(false));
  $("disconnectBtn")?.addEventListener("click", () => disconnectWallet());
  $("refreshBtn")?.addEventListener("click", refreshAll);

  // watched mgmt
  $("addWatchBtn")?.addEventListener("click", promptAddWatch);
  $("watchConnectedBtn")?.addEventListener("click", watchConnected);

  // log mgmt
  $("resetBtn")?.addEventListener("click", resetAll);
  $("clearLogBtn")?.addEventListener("click", clearLog);

  // send MMM
  $("sendBtn")?.addEventListener("click", sendTokens);
  $("walletSelect")?.addEventListener("change", updateAvailableBalance);
  $("amountInput")?.addEventListener("input", validateAmount);
  document.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => setAmount(parseFloat(btn.dataset.pct || "0")));
  });

  // swap (HTML values are: buy/sell)
  $("swapSide")?.addEventListener("change", updateSwapQuoteAndButtons);
  $("swapAmountIn")?.addEventListener("input", updateSwapQuoteAndButtons);
  $("swapSlippage")?.addEventListener("change", updateSwapQuoteAndButtons);
  $("swapApproveBtn")?.addEventListener("click", approveMMMMax);
  $("swapExecBtn")?.addEventListener("click", executeSwap);
}

/* =========================
   Renderers
========================= */
function renderConnectedCard() {
  const el = $("connectedCard");
  if (!el) return;

  const addr = connectedAddress ? connectedAddress : null;
  const explorerLink = addr ? `${CONFIG.explorerBase}/address/${addr}` : "#";
  const canClaim = Boolean(addr) && Number(connectedSnapshot.claimableMon || 0) > 0;

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
        <button class="btn ${canClaim ? "btn--primary" : "btn--ghost"}" ${canClaim ? "" : "disabled"} id="connectedClaimBtn">
          <i class="fas fa-gift"></i> Claim (MON)
        </button>
      </div>
    </div>
  `;

  $("connectedClaimBtn")?.addEventListener("click", claimConnected);
  $("copyConnectedInline")?.addEventListener("click", () => copyText(connectedAddress));
}

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
              <a class="link" style="margin-left:10px;" target="_blank" rel="noreferrer" href="${CONFIG.explorerBase}/address/${w.address}">Explorer</a>
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

  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeWatch(btn.dataset.remove));
  });
  container.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copyText(btn.dataset.copy));
  });

  renderSendDropdown();
}

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
      : (a.address
          ? `<span class="mono">${shortAddr(a.address)}</span>`
          : "—");

    const statusBadge =
      a.status === "Completed"
        ? `<span class="badge badge--good">Completed</span>`
        : `<span class="badge badge--warn">${escapeHtml(a.status || "Unknown")}</span>`;

    const monCell = a.amountMon ? escapeHtml(a.amountMon) : "—";
    const mmmCell = a.amountMmm ? escapeHtml(a.amountMmm) : "—";
    const quoteCell = a.quote ? escapeHtml(a.quote) : "—";

    // Prefer dateTime, fallback to date
    const dt = a.dateTime || a.date || "—";

    tr.innerHTML = `
      <td>${escapeHtml(a.type || "—")}</td>
      <td>${monCell}</td>
      <td>${mmmCell}</td>
      <td>${quoteCell}</td>
      <td>${linkCell}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(dt)}</td>
    `;

    tbody.appendChild(tr);
  });
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
  setText("kpiRefresh", protocolSnapshot.lastRefresh ? protocolSnapshot.lastRefresh.toLocaleTimeString() : "—");
}

/* =========================
   Pool UI (reserves + meta)
========================= */
async function updatePoolReservesUI() {
  const no = () => {
    setText("poolMmmReserves", "No liquidity");
    setText("poolWmonReserves", "No liquidity");
    setText("poolMmmValue", "—");
    setText("poolWmonValue", "—");
    setText("poolMmmPct", "—");
    setText("poolWmonPct", "—");
  };

  try {
    const pr = await getPairReserves();
    if (!pr) return no();

    const mmmDecimals = connectedSnapshot.decimals || 18;

    // identify which reserve is MMM vs WMON
    let mmmReserveRaw, wmonReserveRaw;
    if (pr.token0.toLowerCase() === CONFIG.mmmToken.toLowerCase()) {
      mmmReserveRaw = pr.r0;
      wmonReserveRaw = pr.r1;
    } else {
      mmmReserveRaw = pr.r1;
      wmonReserveRaw = pr.r0;
    }

    const mmm = Number(ethers.formatUnits(mmmReserveRaw, mmmDecimals));
    const wmon = Number(ethers.formatEther(wmonReserveRaw));

    setText("poolMmmReserves", `${fmt(mmm)} MMM`);
    setText("poolWmonReserves", `${fmt(wmon)} WMON`);

    // lightweight meta: show as “value” same as reserves for now (no USD oracle),
    // and percentage split by notional MON using current implied price if available.
    setText("poolMmmValue", `≈ ${fmt(mmm)} MMM`);
    setText("poolWmonValue", `≈ ${fmt(wmon)} MON`);

    const mmmPerMon = protocolSnapshot.mmmPerMon;
    if (mmmPerMon && mmmPerMon > 0) {
      const mmmAsMon = mmm / mmmPerMon; // MMM -> MON (approx)
      const totalMonNotional = mmmAsMon + wmon;
      const mmmPct = totalMonNotional > 0 ? (mmmAsMon / totalMonNotional) * 100 : 0;
      const wmonPct = totalMonNotional > 0 ? (wmon / totalMonNotional) * 100 : 0;
      setText("poolMmmPct", `${fmt(mmmPct, 2)}%`);
      setText("poolWmonPct", `${fmt(wmonPct, 2)}%`);
    } else {
      setText("poolMmmPct", "—");
      setText("poolWmonPct", "—");
    }
  } catch (e) {
    console.warn("updatePoolReservesUI failed:", e);
    setText("poolMmmReserves", "Error");
    setText("poolWmonReserves", "Error");
    setText("poolMmmValue", "—");
    setText("poolWmonValue", "—");
    setText("poolMmmPct", "—");
    setText("poolWmonPct", "—");
  }
}

/* =========================
   Connect / Disconnect
========================= */
async function connectWallet(silent) {
  try {
    if (!window.ethereum) return uiError("No injected wallet found (MetaMask/Backpack).");

    showLoading("Connecting wallet…");

    browserProvider = new ethers.BrowserProvider(window.ethereum);

    // Ensure chain
    const net = await browserProvider.getNetwork();
    if (Number(net.chainId) !== CONFIG.chainIdDec) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: CONFIG.chainIdHex }],
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
              blockExplorerUrls: [CONFIG.explorerBase],
            }],
          });
        } else {
          throw e;
        }
      }
    }

    if (!silent) await browserProvider.send("eth_requestAccounts", []);
    signer = await browserProvider.getSigner();
    connectedAddress = await signer.getAddress();

    tokenWrite = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
    trackerWrite = new ethers.Contract(CONFIG.tracker, TRACKER_ABI, signer);
    routerWrite = new ethers.Contract(CONFIG.router, ROUTER_ABI, signer);

    setHeaderConnectionUI(true);
    renderSendDropdown();

    // listeners
    window.ethereum.on?.("accountsChanged", async (accounts) => {
      if (!accounts?.length) return disconnectWallet();
      connectedAddress = ethers.getAddress(accounts[0]);
      signer = await browserProvider.getSigner();
      tokenWrite = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
      trackerWrite = new ethers.Contract(CONFIG.tracker, TRACKER_ABI, signer);
      routerWrite = new ethers.Contract(CONFIG.router, ROUTER_ABI, signer);
      setHeaderConnectionUI(true);
      renderSendDropdown();
      await refreshAll();
    });

    window.ethereum.on?.("chainChanged", () => location.reload());

    hideLoading();
    await refreshAll();
  } catch (e) {
    hideLoading();
    uiError(`Connect failed: ${e?.message || e}`, e);
  }
}

function disconnectWallet() {
  connectedAddress = null;
  signer = null;
  tokenWrite = null;
  trackerWrite = null;
  routerWrite = null;

  connectedSnapshot = { address: null, mmmHoldings: 0, claimableMon: 0, decimals: connectedSnapshot.decimals || 18 };

  setHeaderConnectionUI(false);
  renderSendDropdown();
  renderConnectedCard();
  updateAvailableBalance();
  updateSwapQuoteAndButtons();
  updateKPIs();
}

/* =========================
   Claim
========================= */
async function claimConnected() {
  if (!connectedAddress) return uiError("Connect wallet first.");
  return claimTokens(connectedAddress);
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

async function claimTokens(addr) {
  try {
    if (!connectedAddress) return uiError("Connect wallet first.");
    if (ethers.getAddress(addr) !== ethers.getAddress(connectedAddress)) {
      return uiError("Claim only works for the connected signer address.");
    }
    if (!trackerWrite) return uiError("Tracker signer not ready. Reconnect wallet.");

    showLoading("Claiming rewards (MON)…");

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
        break;
      } catch (_) {}
    }
    if (!tx) {
      hideLoading();
      return uiError("No compatible claim function found on tracker.");
    }

    const rcpt = await tx.wait();

    actions.unshift({
      type: "CLAIM",
      amountMon: "",          // you can fill actual claimed amount later if you read logs
      amountMmm: "",
      quote: "Rewards claim",
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
   Watched wallets
========================= */
function promptAddWatch() {
  const addr = prompt("Enter address to watch (0x...)");
  if (!addr) return;
  addWatch(addr);
}

function addWatch(addr) {
  try {
    const a = ethers.getAddress(addr);
    if (wallets.some((w) => ethers.getAddress(w.address) === a)) return;
    wallets.push(mkWallet(`Watched #${wallets.length + 1}`, a));
    saveData();
    renderWallets();
    refreshAll();
  } catch (_) {
    uiError("Invalid address.");
  }
}

function watchConnected() {
  if (!connectedAddress) return uiError("Connect wallet first.");
  addWatch(connectedAddress);
}

function removeWatch(addr) {
  try {
    const a = ethers.getAddress(addr);
    wallets = wallets.filter((w) => ethers.getAddress(w.address) !== a);
    saveData();
    renderWallets();
  } catch (_) {
    uiError("Could not remove (invalid address).");
  }
}

/* =========================
   Actions log mgmt
========================= */
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

async function updateAvailableBalance() {
  const el = $("availableBalance");
  if (!el) return;

  if (!connectedAddress) {
    el.textContent = "0 MMM";
    return;
  }

  try {
    const decimals = connectedSnapshot.decimals || 18;
    const raw = await tokenRead.balanceOf(connectedAddress);
    const v = Number(ethers.formatUnits(raw, decimals));
    el.textContent = formatMMM(v);
  } catch (e) {
    console.warn("updateAvailableBalance failed:", e);
    el.textContent = "—";
  }
}

function validateAmount() {
  const inp = $("amountInput");
  if (!inp) return;
  const v = parseFloat(inp.value || "0");
  inp.classList.toggle("is-invalid", !(Number.isFinite(v) && v >= 0));
}

async function setAmount(pct) {
  if (!connectedAddress) return uiError("Connect wallet first.");
  if (!(pct > 0)) return;

  try {
    const decimals = connectedSnapshot.decimals || 18;
    const raw = await tokenRead.balanceOf(connectedAddress);
    const bal = Number(ethers.formatUnits(raw, decimals));
    const target = pct >= 1 ? bal : bal * pct;

    const inp = $("amountInput");
    if (inp) inp.value = String(target > 0 ? target : 0);

    validateAmount();
  } catch (e) {
    uiError("Could not set amount from balance.", e);
  }
}

async function sendTokens() {
  try {
    if (!connectedAddress || !tokenWrite) return uiError("Connect wallet first.");

    const amount = parseFloat($("amountInput")?.value || "0");
    const recipient = ($("recipientInput")?.value || "").trim();

    if (!recipient || recipient.length !== 42 || !recipient.startsWith("0x")) {
      return uiError("Enter a valid recipient address (0x...).");
    }
    if (!(amount > 0)) return uiError("Enter a valid amount.");

    const decimals = connectedSnapshot.decimals || 18;
    const bnAmount = ethers.parseUnits(String(amount), decimals);

    showLoading("Sending MMM transfer…");
    const tx = await tokenWrite.transfer(ethers.getAddress(recipient), bnAmount);
    const rcpt = await tx.wait();

    actions.unshift({
      type: "SEND",
      amountMon: "",
      amountMmm: `${amount} MMM`,
      quote: `To ${shortAddr(recipient)}`,
      txHash: rcpt.hash,
      status: "Completed",
      dateTime: nowDateTime(),
    });

    if ($("amountInput")) $("amountInput").value = "";
    if ($("recipientInput")) $("recipientInput").value = "";

    saveData();
    hideLoading();
    await refreshAll();
  } catch (e) {
    hideLoading();
    uiError(`Send failed: ${e?.message || e}`, e);
  }
}

/* =========================
   Swap
========================= */
function getSlippageBps() {
  const v = parseFloat(($("swapSlippage")?.value || "1"));
  return Math.floor((Number.isFinite(v) ? v : 1) * 100); // 1% -> 100 bps
}

function deadlineTs() {
  return Math.floor(Date.now() / 1000) + 600; // +10 minutes
}

async function updateSwapQuoteAndButtons() {
  const approveBtn = $("swapApproveBtn");
  const execBtn = $("swapExecBtn");

  try {
    const side = ($("swapSide")?.value || "buy").toLowerCase(); // buy/sell
    const inAmt = parseFloat($("swapAmountIn")?.value || "0");

    if (!connectedAddress || !signer) {
      if (approveBtn) approveBtn.disabled = true;
      if (execBtn) execBtn.disabled = true;
      setText("swapQuoteOut", "—");
      return;
    }

    // BUY needs no approve, SELL needs approve
    if (approveBtn) approveBtn.disabled = (side !== "sell");
    if (execBtn) execBtn.disabled = !(inAmt > 0);

    const pair = await ensurePair();
    if (!pair || !(inAmt > 0)) {
      setText("swapQuoteOut", pair ? "Enter amount" : "No liquidity");
      return;
    }

    const decimals = connectedSnapshot.decimals || 18;

    if (side === "buy") {
      const out = await quoteOutFromReserves(
        ethers.parseEther(String(inAmt)),
        EFFECTIVE_WMON,
        CONFIG.mmmToken
      );
      setText("swapQuoteOut", `≈ ${fmt(Number(ethers.formatUnits(out, decimals)), 6)} MMM`);
    } else {
      const out = await quoteOutFromReserves(
        ethers.parseUnits(String(inAmt), decimals),
        CONFIG.mmmToken,
        EFFECTIVE_WMON
      );
      setText("swapQuoteOut", `≈ ${fmt(Number(ethers.formatEther(out)), 6)} MON`);
    }
  } catch (e) {
    console.warn("updateSwapQuoteAndButtons failed:", e);
    setText("swapQuoteOut", "Error");
    if (approveBtn) approveBtn.disabled = true;
    if (execBtn) execBtn.disabled = true;
  }
}

async function approveMMMMax() {
  try {
    if (!tokenWrite || !connectedAddress) return uiError("Connect wallet first.");

    showLoading("Approving MMM…");
    const tx = await tokenWrite.approve(CONFIG.router, ethers.MaxUint256);
    await tx.wait();
    hideLoading();
    await updateSwapQuoteAndButtons();
  } catch (e) {
    hideLoading();
    uiError(`Approve failed: ${e?.message || e}`, e);
  }
}

async function executeSwap() {
  try {
    if (!routerWrite || !signer || !connectedAddress) return uiError("Connect wallet first.");

    const side = ($("swapSide")?.value || "buy").toLowerCase();
    const amountInStr = ($("swapAmountIn")?.value || "").trim();
    const amountIn = parseFloat(amountInStr);

    if (!amountInStr || !Number.isFinite(amountIn) || !(amountIn > 0)) {
      return uiError("Enter a valid amount.");
    }

    const pair = await ensurePair();
    if (!pair) return uiError("No liquidity pair exists. Add liquidity first.");

    const slippageBps = getSlippageBps();
    const deadline = deadlineTs();
    const to = connectedAddress;

    showLoading("Preparing swap…");

    // BUY: MON -> MMM
    if (side === "buy") {
      const value = ethers.parseEther(String(amountIn));
      const path = [EFFECTIVE_WMON, CONFIG.mmmToken];

      const out = await quoteOutFromReserves(value, EFFECTIVE_WMON, CONFIG.mmmToken);
      const minOut = out - (out * BigInt(slippageBps)) / 10_000n;

      const txReq =
        await routerWrite.swapExactETHForTokensSupportingFeeOnTransferTokens.populateTransaction(
          minOut, path, to, deadline, { value }
        );

      if (!txReq.data || txReq.data === "0x") throw new Error("Swap calldata is empty (ABI mismatch).");

      showLoading("Sending buy swap transaction…");
      const tx = await signer.sendTransaction({
        to: CONFIG.router,
        data: txReq.data,
        value,
        gasLimit: 500000n,
      });

      const rcpt = await tx.wait();

      const amountMonIn = Number(amountIn); // user input (e.g. 0.05)
      const outMmmHuman = Number(ethers.formatUnits(out, connectedSnapshot.decimals || 18));

      const pricePaidMonPerMmm = outMmmHuman > 0 ? (amountMonIn / outMmmHuman) : 0;

      // cells
      const amountMonStr = `${amountMonIn} MON`;
      const amountMmmStr = `${fmtCompact(outMmmHuman)} MMM`;

      // quote column will now show: 0.0000235377 (MON/MMM)
      const quoteStr = `${fmtTiny(pricePaidMonPerMmm, 10)} MON/MMM`;


      actions.unshift({
        type: "BUY",
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
      return;
    }

    // SELL: MMM -> MON
    const decimals = connectedSnapshot.decimals || 18;
    const amountInBn = ethers.parseUnits(String(amountIn), decimals);
    const path = [CONFIG.mmmToken, EFFECTIVE_WMON];

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

    const out = await quoteOutFromReserves(amountInBn, CONFIG.mmmToken, EFFECTIVE_WMON);
    const minOut = out - (out * BigInt(slippageBps)) / 10_000n;

    const txReq =
      await routerWrite.swapExactTokensForETHSupportingFeeOnTransferTokens.populateTransaction(
        amountInBn, minOut, path, to, deadline
      );

    if (!txReq.data || txReq.data === "0x") throw new Error("Swap calldata is empty (ABI mismatch).");

    showLoading("Sending sell swap transaction…");
    const tx = await signer.sendTransaction({
      to: CONFIG.router,
      data: txReq.data,
      gasLimit: 500000n,
    });

    const rcpt = await tx.wait();

    const amountMmmIn = Number(amountIn);
    const outMonHuman = Number(ethers.formatEther(out));
    const pricePaidMonPerMmm = amountMmmIn > 0 ? (outMonHuman / amountMmmIn) : 0;

    const amountMmmStr = `${amountMmmIn} MMM`;
    const amountMonStr = `${outMonHuman.toFixed(6)} MON`;
    const quoteStr = fmtTiny(pricePaidMonPerMmm, 10); // << unit price

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
  try {
    showLoading("Refreshing on-chain data…");

    // decimals
    const decimals = await tokenRead.decimals().catch(() => 18);
    connectedSnapshot.decimals = Number(decimals);

    // protocol KPIs
    const taxesRaw = await tokenRead.balanceOf(CONFIG.mmmToken).catch(() => 0n);
    protocolSnapshot.taxesMMM = Number(ethers.formatUnits(taxesRaw, connectedSnapshot.decimals));

    const trackerMonRaw = await readProvider.getBalance(CONFIG.tracker).catch(() => 0n);
    protocolSnapshot.trackerMon = Number(ethers.formatEther(trackerMonRaw));

    protocolSnapshot.mmmPerMon = await quoteMmmPerMon(connectedSnapshot.decimals);
    protocolSnapshot.lastRefresh = new Date();

    // watched wallets
    for (const w of wallets) {
      const [bal, claimMon] = await Promise.all([
        tokenRead.balanceOf(w.address).catch(() => 0n),
        getClaimableMon(w.address).catch(() => 0n),
      ]);

      w.mmmHoldings = Number(ethers.formatUnits(bal, connectedSnapshot.decimals));
      w.claimableMon = Number(ethers.formatEther(claimMon));
    }

    // connected wallet snapshot
    if (connectedAddress) {
      const [bal, claimMon] = await Promise.all([
        tokenRead.balanceOf(connectedAddress).catch(() => 0n),
        getClaimableMon(connectedAddress).catch(() => 0n),
      ]);

      connectedSnapshot.address = connectedAddress;
      connectedSnapshot.mmmHoldings = Number(ethers.formatUnits(bal, connectedSnapshot.decimals));
      connectedSnapshot.claimableMon = Number(ethers.formatEther(claimMon));
    } else {
      connectedSnapshot.address = null;
      connectedSnapshot.mmmHoldings = 0;
      connectedSnapshot.claimableMon = 0;
    }

    // UI updates
    await updatePoolReservesUI();
    updateKPIs();
    renderConnectedCard();
    renderWallets();
    renderActions();
    renderSendDropdown();
    await updateAvailableBalance();
    await updateSwapQuoteAndButtons();

    saveData();
    hideLoading();
  } catch (e) {
    hideLoading();
    uiError(`Refresh failed: ${e?.message || e}`, e);
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
   Boot
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  // explorer links (must exist in your HTML)
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
  loadData();

  if (wallets.length === 0 && CONFIG.defaultWatch?.length) {
    wallets = CONFIG.defaultWatch.map((a, i) => mkWallet(`Watched #${i + 1}`, a));
    saveData();
  }

  bindUI();
  setHeaderConnectionUI(false);

  await initReadSide();

  // initial renders (before refresh)
  renderConnectedCard();
  renderWallets();
  renderActions();
  updateKPIs();
  await updateSwapQuoteAndButtons();

  // initial refresh
  await refreshAll();

  // silent auto-connect
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts?.length) await connectWallet(true);
    } catch (_) {}
  }
});

function fmtTiny(x, decimals = 10) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return "—";
  // show more precision for tiny numbers, but trim trailing zeros
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

/* App.js — MMM Dashboard (Monad Testnet) — FINAL (Router quote fix)
   Key fix:
   - STOP using router.getAmountsOut (it reverts on your router)
   - Quote using Pair reserves (UniswapV2 math) via Factory -> Pair -> getReserves()
   - Swaps still execute through router swapExact* methods

   Assumes your existing index.html IDs/classes:
   - Links: mmmLink, trackerLink, poolLink
   - KPI: kpiTaxes, kpiTrackerMon, kpiPrice, kpiPriceCardText, kpiRefresh
   - Header: connectBtn, disconnectBtn, refreshBtn, connectLabel
   - Cards/containers: connectedCard, walletsContainer
   - Log: txBody, clearLogBtn
   - Watch mgmt: addWatchBtn, watchConnectedBtn, resetBtn
   - Send panel: walletSelect, amountInput, recipientInput, sendBtn, availableBalance, .chip
   - Swap panel: swapSide, swapAmountIn, swapSlippage, swapQuoteOut, swapApproveBtn, swapExecBtn
   - Slider: watchedSlider with .watched-slide and .watched-dot
   - Loading: loadingOverlay, loadingText
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

  // MMM / Tracker / Pool
  mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
  tracker:  "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B",
  pool:     "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",

  // Swap stack (confirmed by your console)
  wmon:    "0x51C0bb68b65bd84De6518C939CB9dbe2d6Fa7079",
  factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
  router:  "0x53FE6D2499742779BF2Bd12a23e3c102fAe9fEcA",

  // Watch list defaults
  defaultWatch: ["0x22BC7a72000faE48a67520c056C0944d9a675412"],
};

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

const ROUTER_ABI = [
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
  "function WETH() view returns (address)",
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
  "function claim()",
  "function claim(address)",
  "function claimDividend()",
  "function processAccount(address,bool) returns (bool)",
];

/* =========================
   State
========================= */
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

let connectedSnapshot = { address: null, mmmHoldings: 0, claimable: 0, decimals: 18 };
let protocolSnapshot  = { taxesMMM: 0, trackerMon: 0, mmmPerMon: null, lastRefresh: null };

// Router-resolved WMON/WETH
let EFFECTIVE_WMON = null;

// slider
let sliderTimer = null;
let sliderIndex = 0;

/* =========================
   Helpers
========================= */
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
  console.error(msg);
  alert(msg);
}

/* =========================
   Local storage
========================= */
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
    claimable: 0,
  };
}

/* =========================
   Loading overlay
========================= */
function showLoading(msg) {
  setText("loadingText", msg || "Processing...");
  $("loadingOverlay")?.classList.remove("hidden");
}
function hideLoading() {
  $("loadingOverlay")?.classList.add("hidden");
}

/* =========================
   Slider (PNG) — unchanged
========================= */
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

/* =========================
   DOM Ready
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  // MMM + Tracker + Pool links
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
  } catch (_) {
    EFFECTIVE_WMON = ethers.getAddress(CONFIG.wmon);
  }
  window.EFFECTIVE_WMON = EFFECTIVE_WMON; // for your console debugging

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

/* =========================
   Header UI
========================= */
function setHeaderConnectionUI(isConnected) {
  const dis = $("disconnectBtn");
  if (dis) dis.disabled = !isConnected;

  const label = $("connectLabel");
  if (label) label.textContent = isConnected && connectedAddress ? shortAddr(connectedAddress) : "Connect";
}

/* =========================
   Pair/Reserve quoting (NO router.getAmountsOut)
========================= */
async function ensurePair() {
  if (pairRead) return pairRead;

  if (!factoryRead || !EFFECTIVE_WMON) return null;

  const pairAddr = await factoryRead.getPair(EFFECTIVE_WMON, CONFIG.mmmToken);
  if (!pairAddr || pairAddr === ethers.ZeroAddress) return null;

  pairRead = new ethers.Contract(pairAddr, PAIR_ABI, readProvider);
  return pairRead;
}

// UniswapV2 output formula with 0.3% fee:
// Fixed UniswapV2 output formula with proper decimal handling
async function quoteOutFromReserves(amountIn, tokenIn, tokenOut) {
  const pair = await ensurePair();
  if (!pair) throw new Error("Pair not found (no liquidity / wrong factory)");

  const [t0, t1, res] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
  const token0 = ethers.getAddress(t0);
  const token1 = ethers.getAddress(t1);

  const A = ethers.getAddress(tokenIn);
  const B = ethers.getAddress(tokenOut);

  const r0 = res[0];
  const r1 = res[1];

  let reserveIn, reserveOut;
  if (A === token0 && B === token1) { 
    reserveIn = r0; 
    reserveOut = r1; 
  } else if (A === token1 && B === token0) { 
    reserveIn = r1; 
    reserveOut = r0; 
  } else {
    throw new Error("Tokens not in pair");
  }

  if (reserveIn === 0n || reserveOut === 0n) {
    throw new Error("Empty reserves");
  }

  // Uniswap V2 formula: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * 1000n) + amountInWithFee;
  
  // Ensure we don't divide by 0 and result is reasonable
  if (denominator === 0n) {
    throw new Error("Denominator is zero");
  }
  
  const result = numerator / denominator;
  
  // Debug logging
  console.log("quoteOutFromReserves debug:", {
    amountIn: amountIn.toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    amountInWithFee: amountInWithFee.toString(),
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    result: result.toString(),
    resultHuman: tokenOut === CONFIG.mmmToken ? 
      ethers.formatUnits(result, connectedSnapshot.decimals || 18) : 
      ethers.formatEther(result)
  });
  
  return result;
}

async function quoteMmmPerMon(mmmDecimals) {
  try {
    if (!EFFECTIVE_WMON) return null;
    const one = ethers.parseEther("1"); // 1 MON (as WMON unit)
    const out = await quoteOutFromReserves(one, EFFECTIVE_WMON, CONFIG.mmmToken);
    return Number(ethers.formatUnits(out, mmmDecimals));
  } catch (e) {
    console.warn("quoteMmmPerMon (reserves) failed:", e);
    return null;
  }
}

/* =========================
   Refresh / On-chain reads
========================= */
async function refreshAll() {
  try {
    showLoading("Refreshing on-chain data...");

    const decimals = await tokenRead.decimals().catch(() => 18);
    connectedSnapshot.decimals = decimals;

    // Taxes in MMM contract address
    const taxesRaw = await tokenRead.balanceOf(CONFIG.mmmToken).catch(() => 0n);
    protocolSnapshot.taxesMMM = Number(ethers.formatUnits(taxesRaw, decimals));

    // Tracker native MON
    const trackerMonRaw = await readProvider.getBalance(CONFIG.tracker).catch(() => 0n);
    protocolSnapshot.trackerMon = Number(ethers.formatEther(trackerMonRaw));

    // Price quote from reserves
    protocolSnapshot.mmmPerMon = await quoteMmmPerMon(decimals);

    // Watched balances
    for (const w of wallets) {
      const bal = await tokenRead.balanceOf(w.address).catch(() => 0n);
      const claim = await getClaimable(w.address).catch(() => 0n);
      w.mmmHoldings = Number(ethers.formatUnits(bal, decimals));
      w.claimable = Number(ethers.formatUnits(claim, decimals));
    }

    // Connected snapshot
    if (connectedAddress) {
      const bal = await tokenRead.balanceOf(connectedAddress).catch(() => 0n);
      const claim = await getClaimable(connectedAddress).catch(() => 0n);
      connectedSnapshot.address = connectedAddress;
      connectedSnapshot.mmmHoldings = Number(ethers.formatUnits(bal, decimals));
      connectedSnapshot.claimable = Number(ethers.formatUnits(claim, decimals));
    } else {
      connectedSnapshot.address = null;
      connectedSnapshot.mmmHoldings = 0;
      connectedSnapshot.claimable = 0;
    }

    protocolSnapshot.lastRefresh = new Date();

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

/* =========================
   Claimable probing
========================= */
async function getClaimable(addr) {
  const candidates = [
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

/* =========================
   KPIs
========================= */
function updateKPIs() {
  setText("kpiTaxes", formatMMM(protocolSnapshot.taxesMMM));
  setText("kpiTrackerMon", formatMon(protocolSnapshot.trackerMon));

  let priceText = "—";
  if (protocolSnapshot.mmmPerMon !== null && protocolSnapshot.mmmPerMon !== undefined) {
    const mmmPerMon = protocolSnapshot.mmmPerMon;
    const monPerMmm = mmmPerMon > 0 ? (1 / mmmPerMon) : 0;
    priceText = `1 MON ≈ ${fmt(mmmPerMon, 6)} MMM | 1 MMM ≈ ${fmt(monPerMmm, 8)} MON`;
  }

  setText("kpiPrice", priceText);
  setText("kpiPriceCardText", priceText);

  setText(
    "kpiRefresh",
    protocolSnapshot.lastRefresh ? protocolSnapshot.lastRefresh.toLocaleTimeString() : "—"
  );
}

/* =========================
   Connected card
========================= */
function renderConnectedCard() {
  const el = $("connectedCard");
  if (!el) return;

  const addr = connectedAddress ? connectedAddress : null;
  const canClaim = Boolean(addr) && Number(connectedSnapshot.claimable || 0) > 0;
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
          <span class="k">Claimable (connected)</span>
          <span class="v">${addr ? formatMMM(connectedSnapshot.claimable) : "—"}</span>
        </div>
        <div class="progress"><div style="width:${canClaim ? 100 : 0}%;"></div></div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr; gap:10px; margin-top: 6px;">
        <button class="btn ${canClaim ? "btn--primary" : "btn--ghost"}"
          ${canClaim ? "" : "disabled"} id="connectedClaimBtn">
          <i class="fas fa-gift"></i> Claim (connected)
        </button>
      </div>
    </div>
  `;

  $("connectedClaimBtn")?.addEventListener("click", claimConnected);
  $("copyConnectedInline")?.addEventListener("click", copyConnectedAddress);
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
    const canClaim = isConn && Number(w.claimable) > 0;

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

        <div>
          <div class="metric" style="margin-bottom:8px;">
            <span class="k">Claimable</span>
            <span class="v">${formatMMM(w.claimable)}</span>
          </div>
          <div class="progress"><div style="width:${Number(w.claimable) > 0 ? 100 : 0}%;"></div></div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 48px; gap:10px; margin-top: 6px;">
          <button class="btn ${canClaim ? "btn--primary" : "btn--ghost"}"
            ${canClaim ? "" : "disabled"} data-claim="${w.address}">
            <i class="fas fa-gift"></i> Claim
          </button>
          <button class="btn btn--ghost" data-remove="${w.address}" title="Remove watch">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-claim]").forEach(btn => {
    btn.addEventListener("click", () => claimTokens(btn.dataset.claim));
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
    const amt = Number(a.amount || 0);
    const amtColor =
      amt > 0 ? "rgba(0,255,170,0.85)" :
      amt < 0 ? "rgba(255,95,130,0.85)" :
      "rgba(255,255,255,0.75)";

    const linkCell = a.txHash
      ? `<a class="link" target="_blank" rel="noreferrer" href="${CONFIG.explorerBase}/tx/${a.txHash}">
           <span class="mono">${shortAddr(a.txHash)}</span>
         </a>`
      : (a.address ? `<span class="mono">${escapeHtml(a.address)}</span>` : "—");

    const statusBadge =
      a.status === "Completed"
        ? `<span class="badge badge--good">Completed</span>`
        : `<span class="badge badge--warn">${escapeHtml(a.status)}</span>`;

    tr.innerHTML = `
      <td>${escapeHtml(a.type)}</td>
      <td style="font-weight:900; color:${amtColor};">
        ${amt > 0 ? "+" : ""}${fmt(amt)} MMM
      </td>
      <td>${linkCell}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(a.date)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* =========================
   Connect / disconnect / copy
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
    if (!silent) err(`Connect failed: ${e?.message || e}`);
  }
}

function disconnectWallet(silent = false) {
  connectedAddress = null;
  signer = null;
  tokenWrite = null;
  trackerWrite = null;
  routerWrite = null;

  connectedSnapshot.address = null;
  connectedSnapshot.mmmHoldings = 0;
  connectedSnapshot.claimable = 0;

  setHeaderConnectionUI(false);
  renderSendDropdown();
  renderConnectedCard();
  renderWallets();
  updateKPIs();
  updateAvailableBalance();
  updateSwapQuoteAndButtons();

  if (!silent) console.log("Disconnected.");
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
   Claim
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

    showLoading("Claiming from tracker...");

    const claimMethods = [
      { fn: "claim", args: [] },
      { fn: "claimDividend", args: [] },
      { fn: "claim", args: [connectedAddress] },
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
      return err("No compatible claim function found on tracker.");
    }

    const rcpt = await tx.wait();

    actions.unshift({
      type: "Claim",
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

    const from = $("walletSelect")?.value;
    const amount = parseFloat($("amountInput")?.value) || 0;
    const recipient = $("recipientInput")?.value?.trim() || "";

    if (!from || ethers.getAddress(from) !== ethers.getAddress(connectedAddress)) {
      return err("Source must be the connected wallet.");
    }
    if (!recipient || recipient.length !== 42 || !recipient.startsWith("0x")) {
      return err("Enter a valid recipient address (0x...).");
    }
    if (amount <= 0) return err("Enter a valid amount.");

    const decimals = connectedSnapshot.decimals ?? (await tokenRead.decimals().catch(() => 18));
    const bnAmount = ethers.parseUnits(String(amount), decimals);

    showLoading("Checking balance...");
    const bal = await tokenRead.balanceOf(connectedAddress);
    if (bnAmount > bal) {
      hideLoading();
      return err("Insufficient MMM balance.");
    }

    showLoading("Sending MMM transfer...");
    const tx = await tokenWrite.transfer(ethers.getAddress(recipient), bnAmount);
    const rcpt = await tx.wait();

    actions.unshift({
      type: "Send",
      amount: -amount,
      address: recipient,
      txHash: rcpt?.hash || tx?.hash,
      status: "Completed",
      date: nowDate(),
    });

    if ($("amountInput")) $("amountInput").value = "";
    if ($("recipientInput")) $("recipientInput").value = "";

    saveData();
    await refreshAll();
    renderActions();

    hideLoading();
  } catch (e) {
    hideLoading();
    err(`Send failed: ${e?.message || e}`);
  }
}

function setAmount(pct) {
  if (!connectedAddress) return err("Connect wallet first.");
  const amt = Number(connectedSnapshot.mmmHoldings || 0) * pct;
  if ($("amountInput")) $("amountInput").value = String(amt);
  validateAmount();
}

function validateAmount() {
  if (!connectedAddress) return true;
  const input = $("amountInput");
  if (!input) return true;

  const val = parseFloat(input.value) || 0;
  const ok = val <= Number(connectedSnapshot.mmmHoldings || 0);
  input.style.borderColor = ok ? "rgba(255,255,255,0.14)" : "rgba(255,95,130,0.85)";
  return ok;
}

function updateAvailableBalance() {
  if (!connectedAddress) return setText("availableBalance", "0 MMM");
  setText("availableBalance", formatMMM(connectedSnapshot.mmmHoldings));
}

/* =========================
   Swap (Buy / Sell) — Quotes from reserves, swaps via router
========================= */
function getSlippageBps() {
  const v = parseFloat(($("swapSlippage")?.value || "1"));
  const pct = Number.isFinite(v) ? v : 1;
  return Math.floor(pct * 100); // 1% => 100 bps
}

function deadlineTs() { return Math.floor(Date.now() / 1000) + 600; }

function parseAmountToUnits(amountStr, decimals) {
  const s = String(amountStr || "").trim();
  if (!s || Number(s) <= 0) return 0n;
  return ethers.parseUnits(s, decimals);
}

function applySlippage(amountOut, slippageBps) {
  return (amountOut * BigInt(10000 - slippageBps)) / 10000n;
}

async function updateSwapQuoteAndButtons() {
  const approveBtn = $("swapApproveBtn");
  const execBtn = $("swapExecBtn");

  try {
    const side = $("swapSide")?.value || "buy";
    const amountStr = $("swapAmountIn")?.value || "";

    if (approveBtn) approveBtn.disabled = true;
    if (execBtn) execBtn.disabled = true;

    if (!EFFECTIVE_WMON) {
      setText("swapQuoteOut", "Router not ready");
      return;
    }

    const inDecimals = side === "buy" ? 18 : (connectedSnapshot.decimals ?? 18);
    const amountIn = parseAmountToUnits(amountStr, inDecimals);

    if (amountIn <= 0n) {
      setText("swapQuoteOut", "—");
      return;
    }

    // Quote from reserves (NO router.getAmountsOut)
    const tokenIn  = side === "buy" ? EFFECTIVE_WMON : CONFIG.mmmToken;
    const tokenOut = side === "buy" ? CONFIG.mmmToken : EFFECTIVE_WMON;

    const quotedOut = await quoteOutFromReserves(amountIn, tokenIn, tokenOut);

    const outDecimals = side === "buy" ? (connectedSnapshot.decimals ?? 18) : 18;
    const outHuman = ethers.formatUnits(quotedOut, outDecimals);

    setText("swapQuoteOut", side === "buy"
      ? `${fmt(outHuman, 6)} MMM`
      : `${fmt(outHuman, 6)} MON`
    );

    if (!connectedAddress) return;

    if (execBtn) execBtn.disabled = false;

    if (side === "sell") {
      const allowance = await tokenRead.allowance(connectedAddress, CONFIG.router).catch(() => 0n);
      const needsApprove = allowance < amountIn;
      if (approveBtn) approveBtn.disabled = !needsApprove;
    }
  } catch (e) {
    console.warn("Swap quote failed (reserves):", e);
    setText("swapQuoteOut", `Quote failed (check liquidity/pair)`);
    if (approveBtn) approveBtn.disabled = true;
    if (execBtn) execBtn.disabled = true;
  }
}

async function approveMMMMax() {
  try {
    if (!connectedAddress || !tokenWrite) return err("Connect wallet first.");
    showLoading("Approving MMM...");

    const tx = await tokenWrite.approve(CONFIG.router, ethers.MaxUint256);
    await tx.wait();

    hideLoading();
    await updateSwapQuoteAndButtons();
  } catch (e) {
    hideLoading();
    err(`Approve failed: ${e?.message || e}`);
  }
}

async function executeSwap() {
  try {
    if (!connectedAddress || !routerWrite) return err("Connect wallet first.");

    const side = $("swapSide")?.value || "buy";
    const amountStr = $("swapAmountIn")?.value || "";
    const slippageBps = getSlippageBps();

    const inDecimals = side === "buy" ? 18 : (connectedSnapshot.decimals ?? 18);
    const amountIn = parseAmountToUnits(amountStr, inDecimals);
    if (amountIn <= 0n) return err("Enter an amount > 0.");

    if (!EFFECTIVE_WMON) return err("Router WETH/WMON not resolved.");

    // Quote from reserves
    showLoading("Quoting...");
    const tokenIn  = side === "buy" ? EFFECTIVE_WMON : CONFIG.mmmToken;
    const tokenOut = side === "buy" ? CONFIG.mmmToken : EFFECTIVE_WMON;

    const quotedOut = await quoteOutFromReserves(amountIn, tokenIn, tokenOut);
    
    // SAFETY CHECK: Make sure quotedOut is reasonable
    const maxReasonable = side === "buy" ? 
      ethers.parseUnits("1000000000", connectedSnapshot.decimals || 18) : // 1B MMM max
      ethers.parseEther("1000000"); // 1M MON max
    
    if (quotedOut <= 0n) {
      hideLoading();
      return err("Quote returned 0. Check liquidity / reserves.");
    }
    
    if (quotedOut > maxReasonable) {
      hideLoading();
      return err("Quote seems unreasonably large. Please check amount.");
    }

    const amountOutMin = applySlippage(quotedOut, slippageBps);
    
    // Debug logging
    console.log("Swap execution debug:", {
      side,
      amountIn: amountIn.toString(),
      amountInHuman: side === "buy" ? ethers.formatEther(amountIn) : 
        ethers.formatUnits(amountIn, connectedSnapshot.decimals || 18),
      quotedOut: quotedOut.toString(),
      quotedOutHuman: side === "buy" ? 
        ethers.formatUnits(quotedOut, connectedSnapshot.decimals || 18) : 
        ethers.formatEther(quotedOut),
      slippageBps,
      amountOutMin: amountOutMin.toString(),
      amountOutMinHuman: side === "buy" ? 
        ethers.formatUnits(amountOutMin, connectedSnapshot.decimals || 18) : 
        ethers.formatEther(amountOutMin)
    });

    let tx;
    if (side === "buy") {
      const path = [EFFECTIVE_WMON, CONFIG.mmmToken];

      showLoading("Swapping (Buy MON → MMM)...");
      tx = await routerWrite.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin,
        path,
        connectedAddress,
        deadlineTs(),
        { value: amountIn }
      );
    } else {
      const allowance = await tokenRead.allowance(connectedAddress, CONFIG.router).catch(() => 0n);
      if (allowance < amountIn) {
        hideLoading();
        return err("Need approval first. Click Approve MMM.");
      }

      const path = [CONFIG.mmmToken, EFFECTIVE_WMON];

      showLoading("Swapping (Sell MMM → MON)...");
      tx = await routerWrite.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountIn,
        amountOutMin,
        path,
        connectedAddress,
        deadlineTs()
      );
    }

    const rcpt = await tx.wait();

    actions.unshift({
      type: side === "buy" ? "Buy" : "Sell",
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
    console.error("Swap execution error:", e);
    err(`Swap failed: ${e?.message || e}`);
  }
}

/* =========================
   Watched management
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

/* =========================
   Log / reset
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
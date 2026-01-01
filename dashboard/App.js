/* App.js — MMM Dashboard (Monad Testnet) — Router/UI FIX
   - Hard pins NEW Router (0xC3B66...)
   - Swaps sent using populateTransaction + signer.sendTransaction
   - Quotes use Pair reserves
*/

const CONFIG = {
    chainIdDec: 10143,
    chainIdHex: "0x279F",
    chainName: "Monad Testnet",
    nativeSymbol: "MON",
    rpcUrls: ["https://rpc.ankr.com/monad_testnet", "https://testnet-rpc.monad.xyz"],
    explorerBase: "https://testnet.monadvision.com",
  
    mmmToken: "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16",
    tracker:  "0x5B870DAa512DB9DADEbD53d55045BAE798B4B86B",
    pool:     "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD",
  
    wmon:    "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079",
    factory: "0x8e8a713Be23d9be017d7A5f4D649982B5dD24615",
  
    // IMPORTANT: MUST be your NEW router deployed at:
    // Router deployed at: 0xC3B66EE616286c5e4A0aE6D33238e86104Ec8051
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
  ];
  
  const ROUTER_ABI = [
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)",
    "function WETH() view returns (address)",
    "function factory() view returns (address)",
  ];
  
  const FACTORY_ABI = ["function getPair(address tokenA, address tokenB) view returns (address)"];
  
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
  
  const $ = (id) => document.getElementById(id);
  
  function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
  function shortAddr(a) { return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : ""; }
  function fmt(n, d = 6) {
    const x = Number(n || 0);
    return x.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  function formatMMM(x) { return `${fmt(Number(x || 0), 6)} MMM`; }
  function formatMon(x) { return `${fmt(Number(x || 0), 6)} MON`; }
  function nowDate() { return new Date().toISOString().split("T")[0]; }
  function err(msg) { console.error(msg); alert(msg); }
  
  function showLoading(msg) {
    setText("loadingText", msg || "Processing...");
    $("loadingOverlay")?.classList.remove("hidden");
  }
  function hideLoading() { $("loadingOverlay")?.classList.add("hidden"); }
  
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
  
  document.addEventListener("DOMContentLoaded", async () => {
    // links
    if ($("mmmLink")) {
      $("mmmLink").textContent = CONFIG.mmmToken;
      $("mmmLink").href = `${CONFIG.explorerBase}/address/${CONFIG.mmmToken}`;
    }
    if ($("trackerLink")) {
      $("trackerLink").textContent = CONFIG.tracker;
      $("trackerLink").href = `${CONFIG.explorerBase}/address/${CONFIG.tracker}`;
    }
    if ($("poolLink")) {
      $("poolLink").textContent = CONFIG.pool;
      $("poolLink").href = `${CONFIG.explorerBase}/address/${CONFIG.pool}`;
    }
  
    readProvider = new ethers.FallbackProvider(
      CONFIG.rpcUrls.map((url) => new ethers.JsonRpcProvider(url))
    );
  
    tokenRead   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, readProvider);
    trackerRead = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, readProvider);
    routerRead  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, readProvider);
    factoryRead = new ethers.Contract(CONFIG.factory,  FACTORY_ABI, readProvider);
  
    // effective WMON from router
    try {
      const routerWeth = await routerRead.WETH();
      EFFECTIVE_WMON = ethers.getAddress(routerWeth);
    } catch {
      EFFECTIVE_WMON = ethers.getAddress(CONFIG.wmon);
    }
  
    loadData();
    if (wallets.length === 0 && CONFIG.defaultWatch?.length) {
      wallets = CONFIG.defaultWatch.map((a, i) => mkWallet(`Watched #${i + 1}`, a));
      saveData();
    }
  
    $("connectBtn")?.addEventListener("click", () => connectWallet(false));
    $("disconnectBtn")?.addEventListener("click", () => disconnectWallet());
    $("refreshBtn")?.addEventListener("click", refreshAll);
  
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
  
    // auto-connect if already authorized
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts?.length) await connectWallet(true);
      } catch {}
    }
  });
  
  function setHeaderConnectionUI(isConnected) {
    const dis = $("disconnectBtn");
    if (dis) dis.disabled = !isConnected;
    const label = $("connectLabel");
    if (label) label.textContent = isConnected && connectedAddress ? shortAddr(connectedAddress) : "Connect";
  }
  
  async function ensurePair() {
    if (pairRead) return pairRead;
    const pairAddr = await factoryRead.getPair(EFFECTIVE_WMON, CONFIG.mmmToken);
    if (!pairAddr || pairAddr === ethers.ZeroAddress) return null;
    pairRead = new ethers.Contract(pairAddr, PAIR_ABI, readProvider);
    return pairRead;
  }
  
  // Uniswap v2 quote from reserves
  async function quoteOutFromReserves(amountIn, tokenIn, tokenOut) {
    const pair = await ensurePair();
    if (!pair) throw new Error("Pair not found");
    const [t0, t1, res] = await Promise.all([pair.token0(), pair.token1(), pair.getReserves()]);
    const token0 = ethers.getAddress(t0);
    const token1 = ethers.getAddress(t1);
  
    const A = ethers.getAddress(tokenIn);
    const B = ethers.getAddress(tokenOut);
  
    const r0 = res[0];
    const r1 = res[1];
  
    let reserveIn, reserveOut;
    if (A === token0 && B === token1) { reserveIn = r0; reserveOut = r1; }
    else if (A === token1 && B === token0) { reserveIn = r1; reserveOut = r0; }
    else throw new Error("Tokens not in pair");
  
    if (reserveIn === 0n || reserveOut === 0n) throw new Error("Empty reserves");
  
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
    } catch {
      return null;
    }
  }
  
  async function updatePoolReservesUI() {
    try {
      const pair = await ensurePair();
      if (!pair) return;
  
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
    }
  }
  
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
      } catch {}
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
  }
  
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
  
      tokenWrite   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
      trackerWrite = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, signer);
      routerWrite  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, signer);
  
      setHeaderConnectionUI(true);
      await refreshAll();
      hideLoading();
  
      window.ethereum.on?.("accountsChanged", async (accounts) => {
        if (!accounts?.length) { disconnectWallet(); return; }
        connectedAddress = ethers.getAddress(accounts[0]);
        signer = await browserProvider.getSigner();
        tokenWrite   = new ethers.Contract(CONFIG.mmmToken, ERC20_ABI, signer);
        trackerWrite = new ethers.Contract(CONFIG.tracker,  TRACKER_ABI, signer);
        routerWrite  = new ethers.Contract(CONFIG.router,   ROUTER_ABI, signer);
        setHeaderConnectionUI(true);
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
    renderConnectedCard();
    renderWallets();
    renderActions();
    updateKPIs();
    updateSwapQuoteAndButtons();
  }
  
  async function claimConnected() {
    if (!connectedAddress) return err("Connect wallet first.");
    if (!trackerWrite) return err("Tracker signer not ready. Reconnect wallet.");
  
    try {
      showLoading("Claiming rewards (MON) ...");
  
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
        } catch {}
      }
      if (!tx) { hideLoading(); return err("No compatible claim function found on tracker."); }
  
      const rcpt = await tx.wait();
      actions.unshift({ type: "Claim (MON)", txHash: rcpt?.hash || tx?.hash, status: "Completed", date: nowDate() });
      saveData();
  
      hideLoading();
      await refreshAll();
    } catch (e) {
      hideLoading();
      err(`Claim failed: ${e?.message || e}`);
    }
  }
  
  function renderWallets() {
    const container = $("walletsContainer");
    if (!container) return;
    container.innerHTML = "";
  
    wallets.forEach((w) => {
      const card = document.createElement("div");
      card.className = "wallet-card watched-card";
      card.innerHTML = `
        <div class="wallet-top">
          <div class="wallet-id">
            <div class="wallet-mark wallet-mark--btn" title="Watched"><i class="fas fa-eye"></i></div>
            <div style="min-width:0;">
              <p class="wallet-name">${w.name}</p>
              <div class="wallet-addr">
                ${shortAddr(w.address)}
                <a class="link" style="margin-left:10px;" target="_blank" rel="noreferrer"
                   href="${CONFIG.explorerBase}/address/${w.address}">Explorer</a>
              </div>
            </div>
          </div>
          <span class="badge badge--warn">Watched</span>
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
        </div>
      `;
      container.appendChild(card);
    });
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
        : "—";
      tr.innerHTML = `
        <td>${a.type}</td>
        <td>${linkCell}</td>
        <td><span class="badge badge--good">${a.status}</span></td>
        <td>${a.date}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  
  function getSlippageBps() {
    const v = parseFloat(($("swapSlippage")?.value || "1"));
    return Math.floor((Number.isFinite(v) ? v : 1) * 100);
  }
  function deadlineTs() { return Math.floor(Date.now() / 1000) + 600; }
  
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
  
      approveBtn && (approveBtn.disabled = side === "BUY");
      execBtn && (execBtn.disabled = !(inAmt > 0));
  
      const pair = await ensurePair();
      if (!pair || inAmt <= 0) { setText("swapQuoteOut", "—"); return; }
  
      if (side === "BUY") {
        const out = await quoteOutFromReserves(ethers.parseEther(String(inAmt)), EFFECTIVE_WMON, CONFIG.mmmToken);
        setText("swapQuoteOut", `${fmt(Number(ethers.formatUnits(out, connectedSnapshot.decimals || 18)), 6)} MMM`);
      } else {
        const out = await quoteOutFromReserves(
          ethers.parseUnits(String(inAmt), connectedSnapshot.decimals || 18),
          CONFIG.mmmToken,
          EFFECTIVE_WMON
        );
        setText("swapQuoteOut", `${fmt(Number(ethers.formatEther(out)), 6)} MON`);
      }
    } catch (e) {
      console.warn("updateSwapQuoteAndButtons failed:", e);
      setText("swapQuoteOut", "—");
    }
  }
  
  async function approveMMMMax() {
    try {
      if (!tokenWrite || !connectedAddress) return err("Connect wallet first.");
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
      if (!routerWrite || !signer || !connectedAddress) return err("Connect wallet first.");
  
      const side = $("swapSide")?.value || "BUY";
      const amountInStr = ($("swapAmountIn")?.value || "").trim();
      const amountIn = parseFloat(amountInStr);
  
      if (!amountInStr || !Number.isFinite(amountIn) || amountIn <= 0) return err("Enter a valid amount.");
  
      const slippageBps = getSlippageBps();
      const to = connectedAddress;
      const deadline = deadlineTs();
  
      showLoading("Preparing swap...");
  
      if (side === "BUY") {
        const value = ethers.parseEther(String(amountIn));
        const path = [EFFECTIVE_WMON, CONFIG.mmmToken];
  
        const out = await quoteOutFromReserves(value, EFFECTIVE_WMON, CONFIG.mmmToken);
        const minOut = out - (out * BigInt(slippageBps)) / 10_000n;
  
        const txReq = await routerWrite
          .swapExactETHForTokensSupportingFeeOnTransferTokens
          .populateTransaction(minOut, path, to, deadline, { value });
  
        if (!txReq.data || txReq.data === "0x") throw new Error("Swap calldata is empty (wrong ABI or wrong router).");
  
        console.log("BUY router:", CONFIG.router);
        console.log("BUY calldata prefix:", txReq.data.slice(0, 10), "len:", txReq.data.length);
  
        showLoading("Sending buy swap...");
        const tx = await signer.sendTransaction({ to: CONFIG.router, data: txReq.data, value });
        const rcpt = await tx.wait();
  
        actions.unshift({ type: "BUY", txHash: rcpt.hash, status: "Completed", date: nowDate() });
        saveData();
  
        hideLoading();
        await refreshAll();
        renderActions();
        return;
      }
  
      // SELL
      const decimals = connectedSnapshot.decimals || 18;
      const amountInBn = ethers.parseUnits(String(amountIn), decimals);
      const path = [CONFIG.mmmToken, EFFECTIVE_WMON];
  
      const out = await quoteOutFromReserves(amountInBn, CONFIG.mmmToken, EFFECTIVE_WMON);
      const minOut = out - (out * BigInt(slippageBps)) / 10_000n;
  
      const allowance = await tokenRead.allowance(connectedAddress, CONFIG.router).catch(() => 0n);
      if (allowance < amountInBn) { hideLoading(); return err("Not approved. Click Approve first."); }
  
      const txReq = await routerWrite
        .swapExactTokensForETHSupportingFeeOnTransferTokens
        .populateTransaction(amountInBn, minOut, path, to, deadline);
  
      if (!txReq.data || txReq.data === "0x") throw new Error("Swap calldata is empty (wrong ABI or wrong router).");
  
      console.log("SELL router:", CONFIG.router);
      console.log("SELL calldata prefix:", txReq.data.slice(0, 10), "len:", txReq.data.length);
  
      showLoading("Sending sell swap...");
      const tx = await signer.sendTransaction({ to: CONFIG.router, data: txReq.data });
      const rcpt = await tx.wait();
  
      actions.unshift({ type: "SELL", txHash: rcpt.hash, status: "Completed", date: nowDate() });
      saveData();
  
      hideLoading();
      await refreshAll();
      renderActions();
    } catch (e) {
      hideLoading();
      err(`Swap failed: ${e?.message || e}`);
    }
  }
  
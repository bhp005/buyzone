import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const REFRESH_OPTIONS = [
  { label: "10m", ms: 10 * 60 * 1000 },
  { label: "15m", ms: 15 * 60 * 1000 },
  { label: "20m", ms: 20 * 60 * 1000 },
  { label: "30m", ms: 30 * 60 * 1000 },
];

const STATUS_CFG = {
  "DEEP CORRECTION": { color: "#00ff88", bg: "rgba(0,255,136,0.13)", border: "#00ff88", icon: "▲▲" },
  "CORRECTION":      { color: "#7dff6b", bg: "rgba(125,255,107,0.11)", border: "#7dff6b", icon: "▲"  },
  "PULLBACK":        { color: "#ffd166", bg: "rgba(255,209,102,0.11)", border: "#ffd166", icon: "◆"  },
  "WATCH":           { color: "#ff9f43", bg: "rgba(255,159,67,0.11)",  border: "#ff9f43", icon: "▼"  },
  "HEALTHY":         { color: "#ff4757", bg: "rgba(255,71,87,0.11)",   border: "#ff4757", icon: "▼▼" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getStatus = (p) =>
  p <= -27 ? "DEEP CORRECTION" : p <= -10 ? "CORRECTION" : p <= -5 ? "PULLBACK" : p < 0 ? "WATCH" : "HEALTHY";

const fmt     = (n) => (n != null ? `$${Number(n).toFixed(2)}` : "—");
const fmtTime = (ms) => {
  if (ms <= 0) return "00:00";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// ─── API Key: env var on Netlify, auto-injected in Claude sandbox ─────────────
// ─── Finnhub real-time data ───────────────────────────────────────────────────
const getFinnhubKey = () =>
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_FINNHUB_KEY)
    ? import.meta.env.VITE_FINNHUB_KEY
    : null;

async function fetchOneTicker(ticker, key) {
  const base = "https://finnhub.io/api/v1";
  const [quoteRes, metricRes, targetRes, profileRes] = await Promise.all([
    fetch(`${base}/quote?symbol=${ticker}&token=${key}`),
    fetch(`${base}/stock/metric?symbol=${ticker}&metric=all&token=${key}`),
    fetch(`${base}/stock/price-target?symbol=${ticker}&token=${key}`),
    fetch(`${base}/stock/profile2?symbol=${ticker}&token=${key}`),
  ]);
  const [quote, metric, target, profile] = await Promise.all([
    quoteRes.json(), metricRes.json(), targetRes.json(), profileRes.json(),
  ]);

  const cur    = quote.c;
  const high52 = metric?.metric?.["52WeekHigh"];
  const low52  = metric?.metric?.["52WeekLow"];
  if (!cur || cur === 0) return { ticker, error: "Invalid ticker or no data" };
  if (!high52 || !low52) return { ticker, error: "Insufficient market data" };

  const dayChangePct  = quote.dp ?? 0;
  const analystTarget = target?.targetMean ?? cur * 1.12;
  const name          = profile?.name || ticker;
  const pct           = ((cur - high52) / high52) * 100;
  const status        = getStatus(pct);
  const bestBuy       = high52 * 0.73;
  const upside        = ((analystTarget - cur) / cur * 100);
  const dn            = Math.abs(pct).toFixed(0);

  const strategy = {
    "DEEP CORRECTION": `Down ${dn}% from high. Exceeds the 27% "Best Buy" buffer — high value zone.`,
    "CORRECTION":      `${dn}% pullback. Significant discount, approaching strategic buy floor.`,
    "PULLBACK":        `${dn}% off highs. Minor weakness — set alerts for the 10–15% range.`,
    "WATCH":           `Only ${dn}% below high. Wait for a 10%+ correction before scaling in.`,
    "HEALTHY":         `At or near 52W high. Expensive — avoid chasing, wait for a pullback.`,
  }[status];

  return {
    ticker, name, price: cur, high52, low52,
    pct, upside, dayChangePct,
    target: analystTarget, bestBuy, status, strategy,
    updatedAt: Date.now(),
  };
}

async function fetchAllStocks(tickers) {
  if (!tickers.length) return {};
  const key = getFinnhubKey();
  if (!key) throw new Error("No Finnhub API key. Set VITE_FINNHUB_KEY in Netlify environment variables.");

  const settled = await Promise.allSettled(tickers.map(t => fetchOneTicker(t, key)));
  const results = {};
  settled.forEach((res, i) => {
    results[tickers[i]] = res.status === "fulfilled" ? res.value : { ticker: tickers[i], error: "Fetch failed" };
  });
  return results;
}

// ─── DataCell ─────────────────────────────────────────────────────────────────
function DataCell({ label, value, color }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"3px" }}>
      <div style={{ fontSize:"7px", color:"#264426", letterSpacing:"1.5px" }}>{label}</div>
      <div style={{ fontSize:"13px", fontWeight:"bold", color: color || "#c8d8c8" }}>{value}</div>
    </div>
  );
}

// ─── StockCard ────────────────────────────────────────────────────────────────
function StockCard({ data, onRemove }) {
  if (!data || data.loading) return (
    <div style={S.card}>
      <div style={S.loadBox}>
        <div className="spin" style={{ fontSize:"22px", color:"#00ff88" }}>◈</div>
        <div style={{ color:"#446644", fontSize:"9px", letterSpacing:"3px", marginTop:"8px" }}>FETCHING {data?.ticker}</div>
      </div>
    </div>
  );

  if (data.error) return (
    <div style={{ ...S.card, borderColor:"#3a1515" }} className="card">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:"20px", fontWeight:900, color:"#ff4757", letterSpacing:"2px" }}>{data.ticker}</div>
          <div style={{ fontSize:"9px", color:"#ff4757", opacity:.5, marginTop:"4px" }}>⚠ {data.error}</div>
        </div>
        <button style={S.iconBtn} onClick={() => onRemove(data.ticker)}>✕</button>
      </div>
    </div>
  );

  const cfg    = STATUS_CFG[data.status] || STATUS_CFG["WATCH"];
  const barPct = Math.min(98, Math.max(2, ((data.price - data.low52) / (data.high52 - data.low52)) * 100));

  return (
    <div style={{ ...S.card, borderColor: cfg.border }} className="card">

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:"20px", fontWeight:900, color:"#e8f8e8", letterSpacing:"2px" }}>{data.ticker}</div>
          <div style={{ fontSize:"9px", color:"#446644", marginTop:"2px", maxWidth:"170px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{data.name}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px" }}>
          <div style={{ ...S.badge, background:cfg.bg, color:cfg.color, borderColor:cfg.border }}>{cfg.icon} {data.status}</div>
          <button style={{ ...S.iconBtn, color:"#2a4a2a" }} onClick={() => onRemove(data.ticker)}>✕ REMOVE</button>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"baseline", gap:"10px", flexWrap:"wrap" }}>
        <div style={{ fontSize:"24px", fontWeight:900, color:"#c8d8c8" }}>{fmt(data.price)}</div>
        <div style={{ fontSize:"11px", color: data.dayChangePct >= 0 ? "#00ff88" : "#ff4757" }}>
          {data.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(data.dayChangePct).toFixed(2)}% today
        </div>
        <div style={{ ...S.pctChip, color:cfg.color, background:cfg.bg, borderColor:cfg.border }}>
          {data.pct?.toFixed(1)}% from 52W high
        </div>
      </div>

      <div>
        <div style={S.barTrack}>
          <div style={{ ...S.barFill, width:`${barPct}%`, background:cfg.color }} />
          <div style={{ ...S.barDot, left:`${barPct}%`, background:cfg.color }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:"8px", color:"#1a3a1a", marginTop:"4px" }}>
          <span>52W LOW {fmt(data.low52)}</span>
          <span>52W HIGH {fmt(data.high52)}</span>
        </div>
      </div>

      <div style={S.dataGrid}>
        <DataCell label="BEST BUY TARGET"  value={fmt(data.bestBuy)}             color="#00ff88" />
        <DataCell label="ANALYST TARGET"   value={fmt(data.target)} />
        <DataCell label="UPSIDE TO TARGET" value={`${data.upside?.toFixed(1)}%`} color={data.upside >= 0 ? "#00ff88" : "#ff4757"} />
        <DataCell label="% FROM HIGH"      value={`${data.pct?.toFixed(2)}%`}    color={cfg.color} />
      </div>

      <div style={S.stratBox}>
        <span style={{ color:"#00ff88", fontWeight:"bold", letterSpacing:"2px", fontSize:"9px" }}>STRATEGY </span>
        <span style={{ color:"#778877", fontSize:"10px" }}>{data.strategy}</span>
      </div>

      <div style={{ fontSize:"8px", color:"#1a3a1a" }}>
        ⏱ {data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" }) : "—"}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [watchlist,    setWatchlist]    = useState([]);
  const [stockData,    setStockData]    = useState({});
  const [inputVal,     setInputVal]     = useState("");
  const [inputError,   setInputError]   = useState("");
  const [refreshIdx,   setRefreshIdx]   = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastPoll,     setLastPoll]     = useState(null);
  const [countdown,    setCountdown]    = useState(0);
  const [statusMsg,    setStatusMsg]    = useState("");

  const nextRefreshAt = useRef(null);
  const pollTimer     = useRef(null);
  const watchlistRef  = useRef([]);
  watchlistRef.current = watchlist;

  const refreshMs = REFRESH_OPTIONS[refreshIdx].ms;

  // ── Core fetch ───────────────────────────────────────────────────────────────
  const doFetch = useCallback(async (tickers) => {
    if (!tickers.length || isRefreshing) return;
    setIsRefreshing(true);
    setStatusMsg(`Fetching ${tickers.length} stock${tickers.length > 1 ? "s" : ""}…`);
    try {
      const results = await fetchAllStocks(tickers);
      setStockData(prev => {
        const next = { ...prev };
        for (const t of tickers) next[t] = results[t] || { ticker: t, error: "Not found" };
        return next;
      });
      setLastPoll(Date.now());
      setStatusMsg(`✓ Updated ${tickers.length} stock${tickers.length > 1 ? "s" : ""}`);
      setTimeout(() => setStatusMsg(""), 3000);
    } catch (e) {
      setStatusMsg(`⚠ ${e.message}`);
      setTimeout(() => setStatusMsg(""), 5000);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // ── Scheduler ────────────────────────────────────────────────────────────────
  const schedule = useCallback((interval) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    nextRefreshAt.current = Date.now() + interval;
    pollTimer.current = setTimeout(() => {
      const list = watchlistRef.current;
      if (list.length) doFetch(list);
      schedule(interval);
    }, interval);
  }, [doFetch]);

  // Countdown tick
  useEffect(() => {
    const t = setInterval(() => {
      if (nextRefreshAt.current)
        setCountdown(Math.max(0, nextRefreshAt.current - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (watchlist.length) schedule(refreshMs);
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [refreshMs]); // eslint-disable-line

  // ── Refresh Now ──────────────────────────────────────────────────────────────
  const refreshNow = useCallback(async () => {
    const list = watchlistRef.current;
    if (!list.length || isRefreshing) return;
    schedule(refreshMs);
    await doFetch(list);
  }, [isRefreshing, doFetch, schedule, refreshMs]);

  // ── Add tickers ──────────────────────────────────────────────────────────────
  const addTickers = useCallback(async () => {
    const tokens = inputVal.split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, ""))
      .filter(Boolean);
    const newOnes = tokens.filter(t => t && !watchlistRef.current.includes(t));
    if (!newOnes.length) {
      setInputError(tokens.length ? "Already tracking those tickers" : "Enter a ticker symbol");
      return;
    }
    setInputError(""); setInputVal("");
    setWatchlist(prev => [...prev, ...newOnes]);
    setStockData(prev => ({ ...prev, ...Object.fromEntries(newOnes.map(t => [t, { ticker: t, loading: true }])) }));
    if (!pollTimer.current) schedule(refreshMs);
    await doFetch(newOnes);
  }, [inputVal, doFetch, schedule, refreshMs]);

  const removeTicker = useCallback((t) => {
    setWatchlist(prev => prev.filter(x => x !== t));
    setStockData(prev => { const n = { ...prev }; delete n[t]; return n; });
  }, []);

  const counts = Object.values(stockData).reduce((acc, s) => {
    if (s?.status) acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={S.root}>
      <style>{css}</style>

      {/* HEADER */}
      <div style={S.hdr}>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"22px", color:"#00ff88" }}>◈</span>
          <div>
            <div style={{ fontSize:"17px", fontWeight:900, color:"#00ff88", letterSpacing:"4px" }}>BUYZONE</div>
            <div style={{ fontSize:"8px", color:"#264426", letterSpacing:"3px" }}>STOCK INTELLIGENCE TERMINAL</div>
          </div>
        </div>

        {/* REFRESH NOW */}
        <button
          className="rnBtn"
          style={{ ...S.rnBtn, ...(isRefreshing || !watchlist.length ? S.rnBtnOff : {}) }}
          onClick={refreshNow}
          disabled={isRefreshing || !watchlist.length}
        >
          <span className={isRefreshing ? "spin" : ""} style={{ display:"inline-block" }}>↺</span>
          <span style={{ marginLeft:"8px" }}>{isRefreshing ? "REFRESHING…" : "REFRESH NOW"}</span>
        </button>

        {/* Countdown + interval */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
            <div className={isRefreshing ? "pulse" : watchlist.length ? "pulse-slow" : ""}
              style={{ width:"7px", height:"7px", borderRadius:"50%",
                background: isRefreshing ? "#ffd166" : watchlist.length ? "#00ff88" : "#264426" }} />
            <span style={{ fontSize:"9px", color: isRefreshing ? "#ffd166" : "#446644", letterSpacing:"2px" }}>
              {isRefreshing ? statusMsg || "FETCHING…" : watchlist.length ? `NEXT AUTO-REFRESH ${fmtTime(countdown)}` : "ADD STOCKS TO BEGIN"}
            </span>
          </div>
          <div style={{ display:"flex", gap:"4px", alignItems:"center" }}>
            <span style={{ fontSize:"8px", color:"#264426", marginRight:"2px" }}>INTERVAL</span>
            {REFRESH_OPTIONS.map((o, i) => (
              <button key={i} className="intBtn"
                style={{ ...S.intBtn, ...(i === refreshIdx ? { borderColor:"#00ff88", color:"#00ff88", background:"rgba(0,255,136,0.08)" } : {}) }}
                onClick={() => setRefreshIdx(i)}>{o.label}
              </button>
            ))}
          </div>
          {lastPoll && (
            <div style={{ fontSize:"8px", color:"#1a3a1a" }}>
              LAST UPDATED {new Date(lastPoll).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
            </div>
          )}
        </div>
      </div>

      {/* STATUS STRIP */}
      {watchlist.length > 0 && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 20px", borderBottom:"1px solid #0d1a0d", background:"#060c06", flexWrap:"wrap", gap:"8px" }}>
          <div style={{ display:"flex", gap:"12px", flexWrap:"wrap" }}>
            {Object.entries(STATUS_CFG).map(([name, cfg]) => (
              <span key={name} style={{ fontSize:"9px", letterSpacing:"1px", color: counts[name] ? cfg.color : "#1a3a1a", whiteSpace:"nowrap" }}>
                {cfg.icon} {name}{counts[name] ? ` (${counts[name]})` : ""}
              </span>
            ))}
          </div>
          {statusMsg && !isRefreshing && <span style={{ fontSize:"9px", color:"#00ff88" }}>{statusMsg}</span>}
          <span style={{ fontSize:"9px", color:"#264426" }}>{watchlist.length} TRACKED</span>
        </div>
      )}

      {/* ADD BAR */}
      <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"12px 20px", borderBottom:"1px solid #0d1a0d", flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", background:"#09120a", border:"1px solid #183018", borderRadius:"4px", padding:"0 12px", flex:1, maxWidth:"400px" }}>
          <span style={{ color:"#00ff88", fontSize:"15px", fontWeight:"bold", marginRight:"6px" }}>$</span>
          <input
            style={S.inp}
            value={inputVal}
            onChange={e => { setInputVal(e.target.value.toUpperCase()); setInputError(""); }}
            onKeyDown={e => e.key === "Enter" && addTickers()}
            placeholder="AAPL  or  AAPL, TSLA, NVDA, MSFT…"
            disabled={isRefreshing}
          />
        </div>
        <button className="addBtn" style={S.addBtn} onClick={addTickers} disabled={isRefreshing}>
          + ADD
        </button>
      </div>
      {inputError && <div style={{ color:"#ff4757", fontSize:"10px", padding:"5px 20px", background:"rgba(255,71,87,0.05)" }}>⚠ {inputError}</div>}

      {/* EMPTY STATE */}
      {watchlist.length === 0 && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"70px 24px", gap:"10px" }}>
          <div style={{ fontSize:"40px", color:"#0d1f0d" }}>◈</div>
          <div style={{ color:"#1a3a1a", fontSize:"13px", letterSpacing:"4px" }}>NO STOCKS TRACKED</div>
          <div style={{ color:"#0d1f0d", fontSize:"10px", letterSpacing:"2px", marginTop:"4px" }}>Add tickers above, or click a suggestion:</div>
          <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap", justifyContent:"center" }}>
            {["AAPL","TSLA","NVDA","MSFT","AMZN","META","GOOGL"].map(t => (
              <button key={t} className="suggBtn" style={S.suggBtn} onClick={() => setInputVal(p => p ? p+","+t : t)}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {/* GRID */}
      {watchlist.length > 0 && (
        <div style={S.grid}>
          {watchlist.map(t => (
            <StockCard key={t} data={stockData[t] || { ticker: t, loading: true }} onRemove={removeTicker} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root:    { minHeight:"100vh", background:"#070b09", color:"#c8d8c8", fontFamily:"'Courier New',monospace" },
  hdr:     { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", borderBottom:"1px solid #0d1a0d", background:"rgba(0,255,136,0.015)", flexWrap:"wrap", gap:"12px" },
  rnBtn:   { display:"flex", alignItems:"center", background:"transparent", border:"2px solid #00ff88", color:"#00ff88", padding:"10px 22px", fontFamily:"'Courier New',monospace", fontSize:"13px", letterSpacing:"3px", fontWeight:"bold", cursor:"pointer", borderRadius:"5px", boxShadow:"0 0 14px rgba(0,255,136,0.2)", transition:"all 0.15s" },
  rnBtnOff:{ opacity:.35, cursor:"not-allowed", boxShadow:"none" },
  intBtn:  { background:"transparent", border:"1px solid #1a2a1a", color:"#264426", padding:"3px 7px", fontFamily:"'Courier New',monospace", fontSize:"8px", letterSpacing:"1px", cursor:"pointer", borderRadius:"3px" },
  inp:     { background:"transparent", border:"none", outline:"none", color:"#00ff88", fontSize:"12px", fontFamily:"'Courier New',monospace", letterSpacing:"2px", padding:"11px 0", width:"100%" },
  addBtn:  { background:"transparent", border:"1px solid #00ff88", color:"#00ff88", padding:"10px 16px", fontFamily:"'Courier New',monospace", fontSize:"11px", letterSpacing:"2px", cursor:"pointer", borderRadius:"4px", fontWeight:"bold" },
  grid:    { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:"14px", padding:"18px 20px" },
  card:    { background:"#090f0a", border:"1px solid #1a2a1a", borderRadius:"6px", padding:"16px", display:"flex", flexDirection:"column", gap:"11px", transition:"border-color 0.3s" },
  loadBox: { display:"flex", flexDirection:"column", alignItems:"center", padding:"28px 0" },
  badge:   { padding:"3px 8px", borderRadius:"3px", fontSize:"8px", fontWeight:"bold", letterSpacing:"1px", border:"1px solid", whiteSpace:"nowrap" },
  pctChip: { fontSize:"10px", padding:"2px 7px", borderRadius:"3px", border:"1px solid", letterSpacing:"1px" },
  iconBtn: { background:"transparent", border:"none", cursor:"pointer", fontFamily:"'Courier New',monospace", fontSize:"9px", padding:"2px 4px", color:"#2a4a2a", letterSpacing:"1px" },
  barTrack:{ height:"4px", background:"#0d1a0d", borderRadius:"2px", position:"relative", overflow:"visible" },
  barFill: { height:"100%", borderRadius:"2px", transition:"width 0.8s ease" },
  barDot:  { position:"absolute", top:"-3px", width:"10px", height:"10px", borderRadius:"50%", transform:"translateX(-50%)", border:"2px solid #090f0a" },
  dataGrid:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px", background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" },
  stratBox:{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"8px 10px", lineHeight:"1.6" },
  suggBtn: { background:"transparent", border:"1px solid #183018", color:"#264426", padding:"5px 10px", fontFamily:"'Courier New',monospace", fontSize:"9px", letterSpacing:"2px", cursor:"pointer", borderRadius:"3px" },
};

const css = `
  * { box-sizing:border-box; margin:0; padding:0; }
  input::placeholder { color:#0f200f; }
  .addBtn:hover:not(:disabled) { background:rgba(0,255,136,0.08)!important; }
  .addBtn:disabled { opacity:.4; cursor:not-allowed; }
  .rnBtn:hover:not(:disabled) { background:rgba(0,255,136,0.1)!important; box-shadow:0 0 28px rgba(0,255,136,0.35)!important; }
  .intBtn:hover { border-color:#446644!important; color:#446644!important; }
  .card:hover { box-shadow:0 0 18px rgba(0,255,136,0.05); }
  .suggBtn:hover { border-color:#446644!important; color:#446644!important; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .spin { display:inline-block; animation:spin 0.8s linear infinite; }
  @keyframes fadein { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
  .card { animation:fadein 0.3s ease; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.8)} }
  @keyframes pulse-slow { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .pulse { animation:pulse 0.7s ease infinite; }
  .pulse-slow { animation:pulse-slow 3s ease infinite; }
`;

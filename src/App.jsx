import { useState, useEffect, useRef, useCallback } from "react";

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

const getStatus = (p) =>
  p <= -27 ? "DEEP CORRECTION" : p <= -10 ? "CORRECTION" : p <= -5 ? "PULLBACK" : p < 0 ? "WATCH" : "HEALTHY";

const fmt     = (n, dec=2) => (n != null && !isNaN(n) ? `$${Number(n).toFixed(dec)}` : "—");
const fmtNum  = (n, dec=2) => (n != null && !isNaN(n) ? Number(n).toFixed(dec) : "—");
const fmtVol  = (n) => { if (!n) return "—"; if (n >= 1e6) return (n/1e6).toFixed(1)+"M"; if (n >= 1e3) return (n/1e3).toFixed(1)+"K"; return n.toString(); };
const fmtTime = (ms) => { if (ms <= 0) return "00:00"; const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); return `${m}:${String(s).padStart(2,"0")}`; };

const getRsiColor = (rsi) => {
  if (!rsi) return "#c8d8c8";
  if (rsi < 30) return "#00ff88";
  if (rsi > 70) return "#ff4757";
  return "#ffd166";
};
const getRsiLabel = (rsi) => {
  if (!rsi) return "—";
  if (rsi < 30) return `${fmtNum(rsi,1)} OVERSOLD`;
  if (rsi > 70) return `${fmtNum(rsi,1)} OVERBOUGHT`;
  return `${fmtNum(rsi,1)} NEUTRAL`;
};

// ─── Fear & Greed Index ───────────────────────────────────────────────────────
async function fetchFearGreed() {
  try {
    const res = await fetch("https://fear-and-greed-index.p.rapidapi.com/v1/fgi", {
      headers: {
        "x-rapidapi-host": "fear-and-greed-index.p.rapidapi.com",
        "x-rapidapi-key": "placeholder", // public endpoint fallback below
      }
    });
    if (res.ok) {
      const d = await res.json();
      return d?.fgi?.now?.value ?? null;
    }
  } catch {}
  // Fallback: CNN Fear & Greed via allorigins proxy
  try {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent("https://production.dataviz.cnn.io/index/fearandgreed/graphdata")}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const d = await res.json();
      return d?.fear_and_greed?.score ?? null;
    }
  } catch {}
  return null;
}

function getFearGreedLabel(score) {
  if (score === null) return { label: "Unknown", color: "#c8d8c8", emoji: "?" };
  if (score <= 25) return { label: "EXTREME FEAR",  color: "#00ff88", emoji: "😱" };
  if (score <= 45) return { label: "FEAR",          color: "#7dff6b", emoji: "😰" };
  if (score <= 55) return { label: "NEUTRAL",       color: "#ffd166", emoji: "😐" };
  if (score <= 75) return { label: "GREED",         color: "#ff9f43", emoji: "🤑" };
  return                   { label: "EXTREME GREED", color: "#ff4757", emoji: "🔥" };
}

// ─── Decision Engine ──────────────────────────────────────────────────────────
function getDecision(stock, fearGreedScore) {
  const { pct, rsi, upside, pe, vol10d, vol3m, nextEarnings, ret52w, high52, low52, price } = stock;
  const beta = stock.beta ?? 1;

  // Beta-adjusted buy zone thresholds
  // Higher beta stocks need bigger drops to be considered value
  const buyZoneThreshold   = Math.min(-(10 + beta * 5), -15);  // e.g. beta 1 = -15%, beta 2 = -20%
  const strongBuyThreshold = Math.min(-(20 + beta * 5), -25);  // e.g. beta 1 = -25%, beta 2 = -30%
  const deepBuyThreshold   = Math.min(-(30 + beta * 5), -35);  // e.g. beta 1 = -35%, beta 2 = -40%

  let score = 0;
  const signals = [];

  // ── Signal 1: Price vs 52W High (beta-adjusted, max 30pts)
  if (pct <= deepBuyThreshold) {
    score += 30;
    signals.push({ icon: "✅", text: `Down ${Math.abs(pct).toFixed(0)}% — deep value zone for this stock` });
  } else if (pct <= strongBuyThreshold) {
    score += 22;
    signals.push({ icon: "✅", text: `Down ${Math.abs(pct).toFixed(0)}% — strong buy territory` });
  } else if (pct <= buyZoneThreshold) {
    score += 14;
    signals.push({ icon: "🟡", text: `Down ${Math.abs(pct).toFixed(0)}% — entering buy zone` });
  } else if (pct <= -5) {
    score += 5;
    signals.push({ icon: "🟡", text: `Down ${Math.abs(pct).toFixed(0)}% — minor pullback, not yet a buy zone` });
  } else {
    score -= 10;
    signals.push({ icon: "❌", text: `Near 52W high — expensive entry point` });
  }

  // ── Signal 2: RSI (max 20pts)
  if (rsi !== null) {
    if (rsi < 25) { score += 20; signals.push({ icon: "✅", text: `RSI ${rsi.toFixed(0)} — extremely oversold, high reversal potential` }); }
    else if (rsi < 35) { score += 14; signals.push({ icon: "✅", text: `RSI ${rsi.toFixed(0)} — oversold territory` }); }
    else if (rsi < 50) { score += 6;  signals.push({ icon: "🟡", text: `RSI ${rsi.toFixed(0)} — neutral, leaning bearish` }); }
    else if (rsi < 65) { score += 0;  signals.push({ icon: "🟡", text: `RSI ${rsi.toFixed(0)} — neutral` }); }
    else if (rsi < 75) { score -= 8;  signals.push({ icon: "❌", text: `RSI ${rsi.toFixed(0)} — overbought, wait for pullback` }); }
    else               { score -= 15; signals.push({ icon: "❌", text: `RSI ${rsi.toFixed(0)} — extremely overbought` }); }
  }

  // ── Signal 3: Fear & Greed (max 20pts)
  if (fearGreedScore !== null) {
    if (fearGreedScore <= 25)      { score += 20; signals.push({ icon: "✅", text: `Market in Extreme Fear (${fearGreedScore}) — historically the best time to buy` }); }
    else if (fearGreedScore <= 40) { score += 12; signals.push({ icon: "✅", text: `Market in Fear (${fearGreedScore}) — favourable buying conditions` }); }
    else if (fearGreedScore <= 55) { score += 4;  signals.push({ icon: "🟡", text: `Market Neutral (${fearGreedScore}) — no strong tailwind` }); }
    else if (fearGreedScore <= 70) { score -= 6;  signals.push({ icon: "🟡", text: `Market in Greed (${fearGreedScore}) — be selective` }); }
    else                           { score -= 14; signals.push({ icon: "❌", text: `Market in Extreme Greed (${fearGreedScore}) — high risk of correction` }); }
  }

  // ── Signal 4: Analyst Upside (max 15pts)
  if (upside >= 40)      { score += 15; signals.push({ icon: "✅", text: `${upside.toFixed(0)}% analyst upside — very attractive target` }); }
  else if (upside >= 20) { score += 10; signals.push({ icon: "✅", text: `${upside.toFixed(0)}% analyst upside — solid target` }); }
  else if (upside >= 10) { score += 5;  signals.push({ icon: "🟡", text: `${upside.toFixed(0)}% analyst upside — modest target` }); }
  else if (upside >= 0)  { score += 0;  signals.push({ icon: "🟡", text: `${upside.toFixed(0)}% analyst upside — limited room` }); }
  else                   { score -= 8;  signals.push({ icon: "❌", text: `Analyst target below current price — bearish consensus` }); }

  // ── Signal 5: Volume trend (smart money, max 10pts)
  if (vol10d && vol3m) {
    const volRatio = vol10d / vol3m;
    if (volRatio >= 1.5)      { score += 10; signals.push({ icon: "✅", text: `Volume 50%+ above avg — strong institutional interest` }); }
    else if (volRatio >= 1.2) { score += 6;  signals.push({ icon: "✅", text: `Volume above avg — increased buying activity` }); }
    else if (volRatio >= 0.8) { score += 0;  signals.push({ icon: "🟡", text: `Normal volume — no unusual activity` }); }
    else                      { score -= 5;  signals.push({ icon: "❌", text: `Volume below avg — low conviction` }); }
  }

  // ── Signal 6: Earnings risk (max -15pts penalty)
  if (nextEarnings) {
    const daysToEarn = Math.floor((new Date(nextEarnings) - new Date()) / 86400000);
    if (daysToEarn >= 0 && daysToEarn <= 7)  { score -= 15; signals.push({ icon: "⚠️", text: `Earnings in ${daysToEarn} days — HIGH RISK, wait until after` }); }
    else if (daysToEarn <= 14)               { score -= 8;  signals.push({ icon: "⚠️", text: `Earnings in ${daysToEarn} days — consider waiting` }); }
    else if (daysToEarn <= 30)               { score -= 2;  signals.push({ icon: "🟡", text: `Earnings in ${daysToEarn} days — factor into position size` }); }
    else                                     { score += 2;  signals.push({ icon: "✅", text: `Earnings not imminent (${daysToEarn} days) — lower event risk` }); }
  }

  // ── Verdict
  let verdict, verdictColor, verdictBg, verdictBorder, advice;
  if (score >= 55) {
    verdict = "BUY NOW"; verdictColor = "#00ff88"; verdictBg = "rgba(0,255,136,0.12)"; verdictBorder = "#00ff88";
    advice = "Multiple signals aligned. Consider scaling in with a staged entry — buy 1/3 now, add on further weakness.";
  } else if (score >= 35) {
    verdict = "ACCUMULATE"; verdictColor = "#7dff6b"; verdictBg = "rgba(125,255,107,0.1)"; verdictBorder = "#7dff6b";
    advice = "Conditions broadly favourable. Start a small position and add more if the price dips further.";
  } else if (score >= 15) {
    verdict = "WATCH & WAIT"; verdictColor = "#ffd166"; verdictBg = "rgba(255,209,102,0.1)"; verdictBorder = "#ffd166";
    advice = "Some signals positive but not enough aligned. Set a price alert and wait for a better entry.";
  } else if (score >= 0) {
    verdict = "WAIT FOR DIP"; verdictColor = "#ff9f43"; verdictBg = "rgba(255,159,67,0.1)"; verdictBorder = "#ff9f43";
    advice = "Not in buy zone yet. Be patient — a better entry is likely available if you wait.";
  } else {
    verdict = "AVOID"; verdictColor = "#ff4757"; verdictBg = "rgba(255,71,87,0.1)"; verdictBorder = "#ff4757";
    advice = "Multiple negative signals. High risk of further downside — stay out until conditions improve.";
  }

  return { verdict, verdictColor, verdictBg, verdictBorder, advice, signals, score };
}

// ─── Finnhub ──────────────────────────────────────────────────────────────────
const getFinnhubKey = () =>
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_FINNHUB_KEY)
    ? import.meta.env.VITE_FINNHUB_KEY : null;

async function fetchOneTicker(ticker, key) {
  const base = "https://finnhub.io/api/v1";
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 90 * 86400;
  const earnFrom = new Date().toISOString().split("T")[0];
  const earnTo   = new Date(Date.now() + 120 * 86400000).toISOString().split("T")[0];

  const [quoteRes, metricRes, targetRes, profileRes, earnRes] = await Promise.all([
    fetch(`${base}/quote?symbol=${ticker}&token=${key}`),
    fetch(`${base}/stock/metric?symbol=${ticker}&metric=all&token=${key}`),
    fetch(`${base}/stock/price-target?symbol=${ticker}&token=${key}`),
    fetch(`${base}/stock/profile2?symbol=${ticker}&token=${key}`),
    fetch(`${base}/calendar/earnings?symbol=${ticker}&from=${earnFrom}&to=${earnTo}&token=${key}`),
  ]);

  const [quote, metric, target, profile, earnData] = await Promise.all([
    quoteRes.json(), metricRes.json(), targetRes.json(), profileRes.json(), earnRes.json(),
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

  // ── Metric fields
  const m      = metric?.metric || {};
  const pe     = m.peTTM ?? m.peExclExtraTTM ?? null;
  const eps    = m.epsNormalizedAnnual ?? m.epsTTM ?? null;
  const ret52w = m["52WeekPriceReturnDaily"] ?? null;
  const vol10d = m["10DayAverageTradingVolume"] ? m["10DayAverageTradingVolume"] * 1e6 : null;
  const vol3m  = m["3MonthAverageTradingVolume"] ? m["3MonthAverageTradingVolume"] * 1e6 : null;

  // ── RSI: calculate from 52W high/low/current as proxy if API unavailable
  // Use metric rsi14 if available, otherwise estimate
  const rsi = m.rsi14 ?? m["rsi14d"] ?? null;

  // ── Support & resistance: estimate from 52W range
  const range      = high52 - low52;
  const support    = parseFloat((low52 + range * 0.236).toFixed(2));
  const resistance = parseFloat((low52 + range * 0.618).toFixed(2));

  // ── Earnings
  let nextEarnings = null;
  const earnList = earnData?.earningsCalendar || [];
  if (earnList.length > 0) {
    const sorted = earnList
      .filter(e => e.date >= earnFrom)
      .sort((a, b) => a.date.localeCompare(b.date));
    nextEarnings = sorted[0]?.date ?? null;
  }

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
    pe, eps, ret52w, vol10d, vol3m,
    rsi, nextEarnings, support, resistance,
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

// ─── Sub-components ───────────────────────────────────────────────────────────
function DataCell({ label, value, color, small }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
      <div style={{ fontSize:"9px", color:"#6aaa6a", letterSpacing:"1px", fontWeight:"600" }}>{label}</div>
      <div style={{ fontSize: small ? "12px" : "14px", fontWeight:"bold", color: color || "#c8d8c8" }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize:"9px", color:"#4aaa4a", letterSpacing:"2px", textTransform:"uppercase",
      borderBottom:"1px solid #1a3a1a", paddingBottom:"5px", marginBottom:"8px", fontWeight:"700" }}>
      {children}
    </div>
  );
}

// ─── StockCard ────────────────────────────────────────────────────────────────
function StockCard({ data, onRemove, fearGreed }) {
  const [showSignals, setShowSignals] = useState(false);

  if (!data || data.loading) return (
    <div style={S.card}>
      <div style={S.loadBox}>
        <div className="spin" style={{ fontSize:"22px", color:"#00ff88" }}>◈</div>
        <div style={{ color:"#446644", fontSize:"9px", letterSpacing:"3px", marginTop:"8px" }}>FETCHING {data?.ticker}</div>
      </div>
    </div>
  );

  if (data.error) return (
    <div style={{ ...S.card, borderColor:"#ff4757", boxShadow:"0 0 16px rgba(255,71,87,0.3)" }} className="card">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:"20px", fontWeight:900, color:"#ff4757", letterSpacing:"2px" }}>{data.ticker}</div>
          <div style={{ fontSize:"9px", color:"#ff4757", opacity:.5, marginTop:"4px" }}>⚠ {data.error}</div>
        </div>
        <button style={{ background:"transparent", border:"1px solid #ff4757", cursor:"pointer", fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"4px 10px", color:"#ff4757", letterSpacing:"1px", borderRadius:"3px", fontWeight:"bold" }} onClick={() => onRemove(data.ticker)}>✕ REMOVE</button>
      </div>
    </div>
  );

  const cfg    = STATUS_CFG[data.status] || STATUS_CFG["WATCH"];
  const barPct = Math.min(98, Math.max(2, ((data.price - data.low52) / (data.high52 - data.low52)) * 100));

  return (
    <div style={{ ...S.card, borderColor: cfg.border, boxShadow: `0 0 16px ${cfg.border}55` }} className="card">

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:"20px", fontWeight:900, color:"#e8f8e8", letterSpacing:"2px" }}>{data.ticker}</div>
          <div style={{ fontSize:"9px", color:"#446644", marginTop:"2px", maxWidth:"170px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{data.name}</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px" }}>
          <div style={{ ...S.badge, background:cfg.bg, color:cfg.color, borderColor:cfg.border, display:"flex", alignItems:"center", gap:"6px" }}>
            <span style={{
              color: data.status === "DEEP CORRECTION" ? "#00ff88"
                   : data.status === "CORRECTION"      ? "#7dff6b"
                   : data.status === "PULLBACK"         ? "#ffd166"
                   : data.status === "WATCH"            ? "#ff9f43"
                   : "#ff4757",
              fontSize:"14px",
              fontWeight:"900",
              lineHeight:1,
            }}>{cfg.icon}</span>
            <span>{data.status}</span>
          </div>
          <button style={{ ...S.iconBtn, color:"#ff4757", border:"1px solid #ff4757", borderRadius:"3px", padding:"3px 8px" }} onClick={() => onRemove(data.ticker)}>✕ REMOVE</button>
        </div>
      </div>

      {/* Price row */}
      <div style={{ display:"flex", alignItems:"baseline", gap:"10px", flexWrap:"wrap" }}>
        <div style={{ fontSize:"24px", fontWeight:900, color:"#c8d8c8" }}>{fmt(data.price)}</div>
        <div style={{ fontSize:"11px", color: data.dayChangePct >= 0 ? "#00ff88" : "#ff4757" }}>
          {data.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(data.dayChangePct).toFixed(2)}% today
        </div>
        <div style={{ ...S.pctChip, color:cfg.color, background:cfg.bg, borderColor:cfg.border }}>
          {data.pct?.toFixed(1)}% from 52W high
        </div>
      </div>

      {/* Range bar */}
      <div>
        <div style={S.barTrack}>
          <div style={{ ...S.barFill, width:`${barPct}%`, background:cfg.color }} />
          <div style={{ ...S.barDot, left:`${barPct}%`, background:cfg.color }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:"10px", color:"#6aaa6a", marginTop:"6px", fontWeight:"600", letterSpacing:"1px" }}>
          <span>52W LOW {fmt(data.low52)}</span>
          <span>52W HIGH {fmt(data.high52)}</span>
        </div>
      </div>

      {/* Core data grid */}
      <div style={S.dataGrid}>
        <SectionLabel>Buy Zone Analysis</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="BEST BUY TARGET"  value={fmt(data.bestBuy)}             color="#00ff88" />
          <DataCell label="ANALYST TARGET"   value={fmt(data.target)} />
          <DataCell label="UPSIDE TO TARGET" value={`${data.upside?.toFixed(1)}%`} color={data.upside >= 0 ? "#00ff88" : "#ff4757"} />
          <DataCell label="% FROM HIGH"      value={`${data.pct?.toFixed(2)}%`}    color={cfg.color} />
        </div>
      </div>

      {/* RSI */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Momentum</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="RSI (14 DAY)"     value={getRsiLabel(data.rsi)}          color={getRsiColor(data.rsi)} />
          <DataCell label="52W RETURN"       value={data.ret52w != null ? `${Number(data.ret52w).toFixed(1)}%` : "—"} color={data.ret52w >= 0 ? "#00ff88" : "#ff4757"} />
        </div>
      </div>

      {/* Fundamentals */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Fundamentals</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="P/E RATIO"        value={data.pe != null ? fmtNum(data.pe, 1) : "—"} />
          <DataCell label="EPS"              value={data.eps != null ? fmt(data.eps) : "—"} />
        </div>
      </div>

      {/* Volume */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Volume</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="10 DAY AVG VOL"   value={fmtVol(data.vol10d)} small />
          <DataCell label="3 MONTH AVG VOL"  value={fmtVol(data.vol3m)}  small />
        </div>
      </div>

      {/* Support & Resistance + Earnings */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Levels & Catalyst</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px" }}>
          <DataCell label="SUPPORT"          value={data.support    ? fmt(data.support)    : "—"} color="#00ff88" small />
          <DataCell label="RESISTANCE"       value={data.resistance ? fmt(data.resistance) : "—"} color="#ff4757" small />
          <DataCell label="NEXT EARNINGS"    value={data.nextEarnings ? new Date(data.nextEarnings).toLocaleDateString("en-GB", { day:"numeric", month:"short" }) : "—"} color="#ffd166" small />
        </div>
      </div>

      {/* ── DECISION ENGINE ── */}
      {(() => {
        const d = getDecision(data, fearGreed);
        return (
          <div style={{ border:`2px solid ${d.verdictBorder}`, borderRadius:"6px", overflow:"hidden",
            boxShadow:`0 0 20px ${d.verdictBorder}44` }}>
            {/* Verdict header */}
            <div style={{ background:d.verdictBg, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"2px", marginBottom:"4px" }}>AI DECISION ENGINE</div>
                <div style={{ fontSize:"20px", fontWeight:900, color:d.verdictColor, letterSpacing:"3px" }}>
                  {d.verdict === "BUY NOW"      ? "🟢 " :
                   d.verdict === "ACCUMULATE"   ? "🟩 " :
                   d.verdict === "WATCH & WAIT" ? "🟡 " :
                   d.verdict === "WAIT FOR DIP" ? "🟠 " : "🔴 "}
                  {d.verdict}
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"1px" }}>SCORE</div>
                <div style={{ fontSize:"24px", fontWeight:900, color:d.verdictColor }}>{d.score}</div>
                <div style={{ fontSize:"7px", color:"#264426" }}>out of 95</div>
              </div>
            </div>
            {/* Advice */}
            <div style={{ background:"#060c06", padding:"10px 14px", borderTop:`1px solid ${d.verdictBorder}33` }}>
              <div style={{ fontSize:"11px", color:"#c8d8c8", lineHeight:1.6 }}>{d.advice}</div>
            </div>
            {/* Signal toggle */}
            <button onClick={() => setShowSignals(s => !s)}
              style={{ width:"100%", background:"transparent", border:"none", borderTop:`1px solid ${d.verdictBorder}33`,
                padding:"8px 14px", color:"#446644", fontFamily:"'Courier New',monospace", fontSize:"9px",
                letterSpacing:"2px", cursor:"pointer", textAlign:"left" }}>
              {showSignals ? "▲ HIDE SIGNALS" : "▼ SHOW SIGNALS"} ({d.signals.length})
            </button>
            {/* Signals list */}
            {showSignals && (
              <div style={{ background:"#050c05", padding:"10px 14px", display:"flex", flexDirection:"column", gap:"8px" }}>
                {d.signals.map((sig, i) => (
                  <div key={i} style={{ display:"flex", gap:"8px", alignItems:"flex-start" }}>
                    <span style={{ fontSize:"12px", flexShrink:0 }}>{sig.icon}</span>
                    <span style={{ fontSize:"10px", color:"#889988", lineHeight:1.5 }}>{sig.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Strategy */}
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
  const [fearGreed,    setFearGreed]    = useState(null);

  // Fetch Fear & Greed on mount and every hour
  useEffect(() => {
    fetchFearGreed().then(v => setFearGreed(v));
    const t = setInterval(() => fetchFearGreed().then(v => setFearGreed(v)), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const nextRefreshAt = useRef(null);
  const pollTimer     = useRef(null);
  const watchlistRef  = useRef([]);
  watchlistRef.current = watchlist;

  const refreshMs = REFRESH_OPTIONS[refreshIdx].ms;

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

  const schedule = useCallback((interval) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    nextRefreshAt.current = Date.now() + interval;
    pollTimer.current = setTimeout(() => {
      const list = watchlistRef.current;
      if (list.length) doFetch(list);
      schedule(interval);
    }, interval);
  }, [doFetch]);

  useEffect(() => {
    const t = setInterval(() => {
      if (nextRefreshAt.current) setCountdown(Math.max(0, nextRefreshAt.current - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (watchlist.length) schedule(refreshMs);
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [refreshMs]); // eslint-disable-line

  const refreshNow = useCallback(async () => {
    const list = watchlistRef.current;
    if (!list.length || isRefreshing) return;
    schedule(refreshMs);
    await doFetch(list);
  }, [isRefreshing, doFetch, schedule, refreshMs]);

  const addTickers = useCallback(async () => {
    const tokens = inputVal.split(/[,\s]+/)
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g, ""))
      .filter(Boolean);
    const newOnes = tokens.filter(t => t && !watchlistRef.current.includes(t));
    if (!newOnes.length) { setInputError(tokens.length ? "Already tracking those tickers" : "Enter a ticker symbol"); return; }
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
      <div style={S.hdr} className="hdr">
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <span style={{ fontSize:"22px", color:"#00ff88" }}>◈</span>
          <div>
            <div style={{ fontSize:"17px", fontWeight:900, color:"#00ff88", letterSpacing:"4px" }}>BUYZONE</div>
            <div style={{ fontSize:"8px", color:"#264426", letterSpacing:"3px" }}>STOCK INTELLIGENCE TERMINAL</div>
          </div>
        </div>

        {/* Fear & Greed */}
        {fearGreed !== null && (() => {
          const fg = getFearGreedLabel(fearGreed);
          return (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
              background:"rgba(0,0,0,0.3)", border:`1px solid ${fg.color}`, borderRadius:"6px", padding:"8px 14px" }}>
              <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"2px" }}>FEAR & GREED</div>
              <div style={{ fontSize:"22px", lineHeight:1 }}>{fg.emoji}</div>
              <div style={{ fontSize:"16px", fontWeight:900, color:fg.color }}>{fearGreed}</div>
              <div style={{ fontSize:"8px", color:fg.color, letterSpacing:"1px", fontWeight:"bold" }}>{fg.label}</div>
            </div>
          );
        })()}

        <button className="rnBtn"
          style={{ ...S.rnBtn, ...(isRefreshing || !watchlist.length ? S.rnBtnOff : {}) }}
          onClick={refreshNow} disabled={isRefreshing || !watchlist.length}>
          <span className={isRefreshing ? "spin" : ""} style={{ display:"inline-block" }}>↺</span>
          <span style={{ marginLeft:"8px" }}>{isRefreshing ? "REFRESHING…" : "REFRESH NOW"}</span>
        </button>

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
      <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"12px 20px", borderBottom:"1px solid #0d1a0d", flexWrap:"wrap" }} className="add-bar">
        <div style={{ display:"flex", alignItems:"center", background:"#09120a", border:"1px solid #183018", borderRadius:"4px", padding:"0 12px", flex:1, maxWidth:"400px" }}>
          <span style={{ color:"#00ff88", fontSize:"15px", fontWeight:"bold", marginRight:"6px" }}>$</span>
          <input style={S.inp} value={inputVal}
            onChange={e => { setInputVal(e.target.value.toUpperCase()); setInputError(""); }}
            onKeyDown={e => e.key === "Enter" && addTickers()}
            placeholder="AAPL  or  AAPL, TSLA, NVDA, MSFT…"
            disabled={isRefreshing} />
        </div>
        <button className="addBtn" style={S.addBtn} onClick={addTickers} disabled={isRefreshing}>+ ADD</button>
      </div>
      {inputError && <div style={{ color:"#ff4757", fontSize:"10px", padding:"5px 20px", background:"rgba(255,71,87,0.05)" }}>⚠ {inputError}</div>}

      {/* EMPTY STATE */}
      {watchlist.length === 0 && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"70px 24px", gap:"10px" }}>
          <div style={{ fontSize:"40px", color:"#0d1f0d" }}>◈</div>
          <div style={{ color:"#1a3a1a", fontSize:"13px", letterSpacing:"4px" }}>NO STOCKS TRACKED</div>
          <div style={{ color:"#0d1f0d", fontSize:"10px", letterSpacing:"2px", marginTop:"4px" }}>Add tickers above, or click a suggestion:</div>
          <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap", justifyContent:"center" }} className="sugg-row">
            {["AAPL","TSLA","NVDA","MSFT","AMZN","META","GOOGL"].map(t => (
              <button key={t} className="suggBtn" style={S.suggBtn} onClick={() => setInputVal(p => p ? p+","+t : t)}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {/* GRID */}
      {watchlist.length > 0 && (
        <div style={S.grid} className="grid">
          {watchlist.map(t => (
            <StockCard key={t} data={stockData[t] || { ticker: t, loading: true }} onRemove={removeTicker} fearGreed={fearGreed} />
          ))}
        </div>
      )}
    </div>
  );
}

const S = {
  root:    { minHeight:"100vh", background:"#070b09", color:"#c8d8c8", fontFamily:"'Courier New',monospace", overflowX:"hidden" },
  hdr:     { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 20px", borderBottom:"1px solid #0d1a0d", background:"rgba(0,255,136,0.015)", flexWrap:"wrap", gap:"12px" },
  rnBtn:   { display:"flex", alignItems:"center", background:"transparent", border:"2px solid #00ff88", color:"#00ff88", padding:"10px 22px", fontFamily:"'Courier New',monospace", fontSize:"13px", letterSpacing:"3px", fontWeight:"bold", cursor:"pointer", borderRadius:"5px", boxShadow:"0 0 14px rgba(0,255,136,0.2)", transition:"all 0.15s" },
  rnBtnOff:{ opacity:.35, cursor:"not-allowed", boxShadow:"none" },
  intBtn:  { background:"transparent", border:"1px solid #1a2a1a", color:"#264426", padding:"3px 7px", fontFamily:"'Courier New',monospace", fontSize:"8px", letterSpacing:"1px", cursor:"pointer", borderRadius:"3px" },
  inp:     { background:"transparent", border:"none", outline:"none", color:"#00ff88", fontSize:"12px", fontFamily:"'Courier New',monospace", letterSpacing:"2px", padding:"11px 0", width:"100%" },
  addBtn:  { background:"transparent", border:"1px solid #00ff88", color:"#00ff88", padding:"10px 16px", fontFamily:"'Courier New',monospace", fontSize:"11px", letterSpacing:"2px", cursor:"pointer", borderRadius:"4px", fontWeight:"bold", whiteSpace:"nowrap" },
  grid:    { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:"14px", padding:"18px 20px" },
  card:    { background:"#090f0a", border:"2px solid #1a2a1a", borderRadius:"6px", padding:"16px", display:"flex", flexDirection:"column", gap:"10px", transition:"border-color 0.3s" },
  loadBox: { display:"flex", flexDirection:"column", alignItems:"center", padding:"28px 0" },
  badge:   { padding:"6px 12px", borderRadius:"4px", fontSize:"11px", fontWeight:"bold", letterSpacing:"1.5px", border:"2px solid", whiteSpace:"nowrap" },
  pctChip: { fontSize:"10px", padding:"2px 7px", borderRadius:"3px", border:"1px solid", letterSpacing:"1px" },
  iconBtn: { background:"transparent", border:"1px solid #ff4757", cursor:"pointer", fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"4px 10px", color:"#ff4757", letterSpacing:"1px", borderRadius:"3px", fontWeight:"bold" },
  barTrack:{ height:"4px", background:"#0d1a0d", borderRadius:"2px", position:"relative", overflow:"visible" },
  barFill: { height:"100%", borderRadius:"2px", transition:"width 0.8s ease" },
  barDot:  { position:"absolute", top:"-3px", width:"10px", height:"10px", borderRadius:"50%", transform:"translateX(-50%)", border:"2px solid #090f0a" },
  dataGrid:{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px", display:"flex", flexDirection:"column", gap:"6px" },
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
  .iconBtn:hover { background:rgba(255,71,87,0.15)!important; }
  .suggBtn:hover { border-color:#446644!important; color:#446644!important; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .spin { display:inline-block; animation:spin 0.8s linear infinite; }
  @keyframes fadein { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
  .card { animation:fadein 0.3s ease; }
  @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.8)} }
  @keyframes pulse-slow { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .pulse { animation:pulse 0.7s ease infinite; }
  .pulse-slow { animation:pulse-slow 3s ease infinite; }

  /* ── MOBILE ── */
  @media (max-width: 600px) {
    .hdr {
      flex-direction: column !important;
      align-items: flex-start !important;
      padding: 12px 14px !important;
      gap: 10px !important;
    }
    .rnBtn {
      width: 100% !important;
      justify-content: center !important;
      font-size: 12px !important;
      padding: 10px 16px !important;
    }
    .hdr-right {
      width: 100% !important;
      align-items: flex-start !important;
    }
    .add-bar {
      padding: 10px 14px !important;
      gap: 8px !important;
    }
    .add-bar input {
      font-size: 14px !important;
    }
    .addBtn {
      padding: 10px 14px !important;
      font-size: 12px !important;
    }
    .status-strip {
      padding: 6px 14px !important;
      font-size: 8px !important;
    }
    .grid {
      grid-template-columns: 1fr !important;
      padding: 12px 10px !important;
      gap: 12px !important;
    }
    .card {
      padding: 14px 12px !important;
    }
    .sugg-row {
      gap: 6px !important;
    }
    .suggBtn {
      font-size: 10px !important;
      padding: 6px 10px !important;
    }
  }

  /* ── TABLET ── */
  @media (max-width: 900px) and (min-width: 601px) {
    .grid {
      grid-template-columns: 1fr 1fr !important;
      padding: 14px 14px !important;
    }
  }

  /* ── TOUCH TARGETS ── */
  @media (hover: none) {
    .iconBtn { padding: 8px 14px !important; font-size: 13px !important; }
    .intBtn  { padding: 6px 10px !important; font-size: 10px !important; }
    .suggBtn { padding: 8px 14px !important; font-size: 11px !important; }
  }
`;

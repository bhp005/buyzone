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

const getStatus = (p) =>
  p <= -27 ? "DEEP CORRECTION" : p <= -10 ? "CORRECTION" : p <= -5 ? "PULLBACK" : p < 0 ? "WATCH" : "HEALTHY";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt     = (n, dec=2, currency="USD") => {
  if (n == null || isNaN(n)) return "—";
  const sym = { USD:"$", GBP:"£", INR:"₹" }[currency] || "$";
  return `${sym}${Number(n).toFixed(dec)}`;
};
const fmtNum  = (n, dec=2) => (n != null && !isNaN(n) ? Number(n).toFixed(dec) : "—");
const fmtVol  = (n) => { if (!n) return "—"; if (n >= 1e6) return (n/1e6).toFixed(1)+"M"; if (n >= 1e3) return (n/1e3).toFixed(1)+"K"; return String(n); };
const fmtTime = (ms) => { if (ms <= 0) return "00:00"; const m = Math.floor(ms/60000); const s = Math.floor((ms%60000)/1000); return `${m}:${String(s).padStart(2,"0")}`; };

const getRsiColor = (rsi) => { if (!rsi) return "#c8d8c8"; if (rsi < 30) return "#00ff88"; if (rsi > 70) return "#ff4757"; return "#ffd166"; };
const getRsiLabel = (rsi) => { if (!rsi) return "—"; if (rsi < 30) return `${fmtNum(rsi,1)} OVERSOLD`; if (rsi > 70) return `${fmtNum(rsi,1)} OVERBOUGHT`; return `${fmtNum(rsi,1)} NEUTRAL`; };

// ─── Exchanges ────────────────────────────────────────────────────────────────
const EXCHANGES = {
  US: {
    id: "US", flag: "🇺🇸", label: "USA", sublabel: "NYSE / NASDAQ",
    currency: "USD", symbol: "$",
    suggestions: ["AAPL","TSLA","NVDA","MSFT","AMZN","META","GOOGL"],
    placeholder: "AAPL, TSLA, NVDA…",
    color: "#00ff88",
  },
  UK: {
    id: "UK", flag: "🇬🇧", label: "London", sublabel: "LSE",
    currency: "GBP", symbol: "£",
    suggestions: ["AZN.L","SHEL.L","HSBA.L","ULVR.L","BP.L","GSK.L","RIO.L"],
    placeholder: "AZN.L, SHEL.L, HSBA.L…",
    color: "#4a9eff",
    tip: "Add .L suffix — e.g. AZN.L for AstraZeneca",
  },
  IN: {
    id: "IN", flag: "🇮🇳", label: "India", sublabel: "NSE / BSE",
    currency: "INR", symbol: "₹",
    suggestions: ["RELIANCE.NS","TCS.NS","INFY.NS","HDFCBANK.NS","WIPRO.NS","BAJFINANCE.NS"],
    placeholder: "RELIANCE.NS, TCS.NS…",
    color: "#ff9f43",
    tip: "Add .NS for NSE or .BO for BSE — e.g. TCS.NS",
  },
};

// Currency-aware formatter
const fmtCurrency = (n, currency="USD", dec=2) => {
  if (n == null || isNaN(n)) return "—";
  const sym = { USD:"$", GBP:"£", INR:"₹" }[currency] || "$";
  return `${sym}${Number(n).toFixed(dec)}`;
};

// Detect exchange from ticker suffix
const getExchangeForTicker = (ticker) => {
  if (ticker.endsWith(".L"))  return "UK";
  if (ticker.endsWith(".NS") || ticker.endsWith(".BO")) return "IN";
  return "US";
};
const LS = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v)  => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── Notification helper ──────────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

function sendNotification(title, body, icon = "📈") {
  if (Notification.permission !== "granted") return;
  try { new Notification(`${icon} ${title}`, { body, icon: "/favicon.ico" }); } catch {}
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────
async function fetchFearGreed() {
  try {
    const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent("https://production.dataviz.cnn.io/index/fearandgreed/graphdata")}`;
    const res = await fetch(proxy, { signal: AbortSignal.timeout(5000) });
    if (res.ok) { const d = await res.json(); return d?.fear_and_greed?.score ?? null; }
  } catch {}
  return null;
}

function getFearGreedLabel(score) {
  if (score === null) return { label: "Unknown", color: "#c8d8c8", emoji: "❓" };
  if (score <= 25) return { label: "EXTREME FEAR",  color: "#00ff88", emoji: "😱" };
  if (score <= 45) return { label: "FEAR",          color: "#7dff6b", emoji: "😰" };
  if (score <= 55) return { label: "NEUTRAL",       color: "#ffd166", emoji: "😐" };
  if (score <= 75) return { label: "GREED",         color: "#ff9f43", emoji: "🤑" };
  return                   { label: "EXTREME GREED", color: "#ff4757", emoji: "🔥" };
}

// ─── Decision Engine ──────────────────────────────────────────────────────────
function getDecision(stock, fearGreedScore) {
  const { pct, rsi, upside, vol10d, vol3m, nextEarnings } = stock;
  const beta = stock.beta ?? 1;

  const buyZoneThreshold   = Math.min(-(10 + beta * 5), -15);
  const strongBuyThreshold = Math.min(-(20 + beta * 5), -25);
  const deepBuyThreshold   = Math.min(-(30 + beta * 5), -35);

  let score = 0;
  const signals = [];

  // Signal 1: Price vs 52W High (30pts)
  if (pct <= deepBuyThreshold)       { score += 30; signals.push({ icon:"✅", text:`Down ${Math.abs(pct).toFixed(0)}% — deep value zone for this stock` }); }
  else if (pct <= strongBuyThreshold){ score += 22; signals.push({ icon:"✅", text:`Down ${Math.abs(pct).toFixed(0)}% — strong buy territory` }); }
  else if (pct <= buyZoneThreshold)  { score += 14; signals.push({ icon:"✅", text:`Down ${Math.abs(pct).toFixed(0)}% — entering buy zone` }); }
  else if (pct <= -5)                { score += 5;  signals.push({ icon:"🟡", text:`Down ${Math.abs(pct).toFixed(0)}% — minor pullback, not yet a buy zone` }); }
  else                               { score -= 10; signals.push({ icon:"❌", text:`Near 52W high — expensive entry point` }); }

  // Signal 2: RSI (20pts)
  if (rsi !== null) {
    if (rsi < 25)      { score += 20; signals.push({ icon:"✅", text:`RSI ${rsi.toFixed(0)} — extremely oversold, high reversal potential` }); }
    else if (rsi < 35) { score += 14; signals.push({ icon:"✅", text:`RSI ${rsi.toFixed(0)} — oversold territory` }); }
    else if (rsi < 50) { score += 6;  signals.push({ icon:"🟡", text:`RSI ${rsi.toFixed(0)} — neutral, leaning bearish` }); }
    else if (rsi < 65) { score += 0;  signals.push({ icon:"🟡", text:`RSI ${rsi.toFixed(0)} — neutral` }); }
    else if (rsi < 75) { score -= 8;  signals.push({ icon:"❌", text:`RSI ${rsi.toFixed(0)} — overbought, wait for pullback` }); }
    else               { score -= 15; signals.push({ icon:"❌", text:`RSI ${rsi.toFixed(0)} — extremely overbought` }); }
  }

  // Signal 3: Fear & Greed (20pts)
  if (fearGreedScore !== null) {
    if (fearGreedScore <= 25)      { score += 20; signals.push({ icon:"✅", text:`Market in Extreme Fear (${fearGreedScore}) — historically the best time to buy` }); }
    else if (fearGreedScore <= 40) { score += 12; signals.push({ icon:"✅", text:`Market in Fear (${fearGreedScore}) — favourable buying conditions` }); }
    else if (fearGreedScore <= 55) { score += 4;  signals.push({ icon:"🟡", text:`Market Neutral (${fearGreedScore}) — no strong tailwind` }); }
    else if (fearGreedScore <= 70) { score -= 6;  signals.push({ icon:"🟡", text:`Market in Greed (${fearGreedScore}) — be selective` }); }
    else                           { score -= 14; signals.push({ icon:"❌", text:`Market in Extreme Greed (${fearGreedScore}) — high risk of correction` }); }
  }

  // Signal 4: Analyst Upside (15pts)
  if (upside >= 40)      { score += 15; signals.push({ icon:"✅", text:`${upside.toFixed(0)}% analyst upside — very attractive target` }); }
  else if (upside >= 20) { score += 10; signals.push({ icon:"✅", text:`${upside.toFixed(0)}% analyst upside — solid target` }); }
  else if (upside >= 10) { score += 5;  signals.push({ icon:"🟡", text:`${upside.toFixed(0)}% analyst upside — modest target` }); }
  else if (upside >= 0)  { score += 0;  signals.push({ icon:"🟡", text:`${upside.toFixed(0)}% analyst upside — limited room` }); }
  else                   { score -= 8;  signals.push({ icon:"❌", text:`Analyst target below current price — bearish consensus` }); }

  // Signal 5: Volume (10pts)
  if (vol10d && vol3m) {
    const r = vol10d / vol3m;
    if (r >= 1.5)      { score += 10; signals.push({ icon:"✅", text:`Volume 50%+ above avg — strong institutional interest` }); }
    else if (r >= 1.2) { score += 6;  signals.push({ icon:"✅", text:`Volume above avg — increased buying activity` }); }
    else if (r >= 0.8) { score += 0;  signals.push({ icon:"🟡", text:`Normal volume — no unusual activity` }); }
    else               { score -= 5;  signals.push({ icon:"❌", text:`Volume below avg — low conviction` }); }
  }

  // Signal 6: Earnings risk (-15pts max penalty)
  if (nextEarnings) {
    const days = Math.floor((new Date(nextEarnings) - new Date()) / 86400000);
    if (days >= 0 && days <= 7)   { score -= 15; signals.push({ icon:"⚠️", text:`Earnings in ${days} days — HIGH RISK, wait until after` }); }
    else if (days <= 14)          { score -= 8;  signals.push({ icon:"⚠️", text:`Earnings in ${days} days — consider waiting` }); }
    else if (days <= 30)          { score -= 2;  signals.push({ icon:"🟡", text:`Earnings in ${days} days — factor into position size` }); }
    else                          { score += 2;  signals.push({ icon:"✅", text:`Earnings not imminent (${days} days) — lower event risk` }); }
  }

  let verdict, verdictColor, verdictBg, verdictBorder, advice;
  if (score >= 55) {
    verdict="BUY NOW";      verdictColor="#00ff88"; verdictBg="rgba(0,255,136,0.12)";   verdictBorder="#00ff88";
    advice="Multiple signals aligned. Scale in with a staged entry — buy 1/3 now, add on further weakness.";
  } else if (score >= 35) {
    verdict="ACCUMULATE";   verdictColor="#7dff6b"; verdictBg="rgba(125,255,107,0.1)";  verdictBorder="#7dff6b";
    advice="Conditions broadly favourable. Start a small position and add more if the price dips further.";
  } else if (score >= 15) {
    verdict="WATCH & WAIT"; verdictColor="#ffd166"; verdictBg="rgba(255,209,102,0.1)";  verdictBorder="#ffd166";
    advice="Some signals positive but not enough aligned. Set a price alert and wait for a better entry.";
  } else if (score >= 0) {
    verdict="WAIT FOR DIP"; verdictColor="#ff9f43"; verdictBg="rgba(255,159,67,0.1)";   verdictBorder="#ff9f43";
    advice="Not in buy zone yet. Be patient — a better entry is likely available if you wait.";
  } else {
    verdict="AVOID";        verdictColor="#ff4757"; verdictBg="rgba(255,71,87,0.1)";    verdictBorder="#ff4757";
    advice="Multiple negative signals. High risk of further downside — stay out until conditions improve.";
  }

  return { verdict, verdictColor, verdictBg, verdictBorder, advice, signals, score };
}

// ─── Finnhub fetch ────────────────────────────────────────────────────────────
const getFinnhubKey = () =>
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_FINNHUB_KEY)
    ? import.meta.env.VITE_FINNHUB_KEY : null;

async function fetchOneTicker(ticker, key) {
  const base = "https://finnhub.io/api/v1";
  const now      = Math.floor(Date.now() / 1000);
  const earnFrom = new Date().toISOString().split("T")[0];
  const earnTo   = new Date(Date.now() + 120 * 86400000).toISOString().split("T")[0];
  const alphaKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_ALPHA_KEY)
    ? import.meta.env.VITE_ALPHA_KEY : null;

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
  const m             = metric?.metric || {};
  const pe     = m.peTTM ?? m.peExclExtraTTM ?? null;
  const eps    = m.epsNormalizedAnnual ?? m.epsTTM ?? null;
  const ret52w = m["52WeekPriceReturnDaily"] ?? null;
  const vol10d = m["10DayAverageTradingVolume"]  ? m["10DayAverageTradingVolume"]  * 1e6 : null;
  const vol3m  = m["3MonthAverageTradingVolume"] ? m["3MonthAverageTradingVolume"] * 1e6 : null;
  const rsi    = m.rsi14 ?? null;
  const range  = high52 - low52;
  const support    = parseFloat((low52 + range * 0.236).toFixed(2));
  const resistance = parseFloat((low52 + range * 0.618).toFixed(2));

  let nextEarnings = null;
  const earnList = earnData?.earningsCalendar || [];
  if (earnList.length) {
    const sorted = earnList.filter(e => e.date >= earnFrom).sort((a,b) => a.date.localeCompare(b.date));
    nextEarnings = sorted[0]?.date ?? null;
  }

  const strategy = {
    "DEEP CORRECTION": `Down ${dn}% from high. Exceeds the 27% "Best Buy" buffer — high value zone.`,
    "CORRECTION":      `${dn}% pullback. Significant discount, approaching strategic buy floor.`,
    "PULLBACK":        `${dn}% off highs. Minor weakness — set alerts for the 10–15% range.`,
    "WATCH":           `Only ${dn}% below high. Wait for a 10%+ correction before scaling in.`,
    "HEALTHY":         `At or near 52W high. Expensive — avoid chasing, wait for a pullback.`,
  }[status];

  // ── Candle data from Alpha Vantage (real) with simulation fallback
  let closes = [], timestamps = [], chartIsReal = false;

  if (alphaKey) {
    try {
      const avUrl = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${alphaKey}`;
      const avRes = await fetch(avUrl, { signal: AbortSignal.timeout(8000) });
      if (avRes.ok) {
        const avData = await avRes.json();
        const series = avData["Time Series (Daily)"];
        if (series) {
          const entries = Object.entries(series)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-60); // last 60 trading days
          closes     = entries.map(([, v]) => parseFloat(v["4. close"]));
          timestamps = entries.map(([d]) => Math.floor(new Date(d).getTime() / 1000));
          chartIsReal = closes.length >= 10;
        }
      }
    } catch { /* fall through to simulation */ }
  }

  // Simulation fallback if Alpha Vantage fails or no key
  if (!chartIsReal) {
    const days = 60;
    const prices = [];
    const vol = ((high52 - low52) / low52) * 0.015;
    let p = cur;
    for (let i = days - 1; i >= 0; i--) {
      prices[i] = p;
      const seed = ticker.charCodeAt(i % ticker.length) / 128;
      const move = (seed - 0.5) * 2 * vol * p;
      p = Math.max(low52 * 0.95, Math.min(high52 * 1.02, p - move));
    }
    closes     = prices;
    timestamps = Array.from({ length: days }, (_, i) =>
      Math.floor((Date.now() - (days - 1 - i) * 86400000) / 1000));
    chartIsReal = false;
  }

  return {
    ticker, name, price: cur, high52, low52,
    pct, upside, dayChangePct,
    target: analystTarget, bestBuy, status, strategy,
    pe, eps, ret52w, vol10d, vol3m, rsi, nextEarnings, support, resistance,
    closes, timestamps, chartIsReal,
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

// ─── EMA Calculator ───────────────────────────────────────────────────────────
function calcEMA(prices, period) {
  if (prices.length < period) return [];
  const k = 2 / (period + 1);
  const result = new Array(prices.length).fill(null);
  // Seed with SMA
  let sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = sma;
  for (let i = period; i < prices.length; i++) {
    result[i] = prices[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ─── Price Chart (SVG) ────────────────────────────────────────────────────────
function PriceChart({ closes, timestamps, color, isReal }) {
  if (!closes || closes.length < 10) return (
    <div style={{ height:"120px", display:"flex", alignItems:"center", justifyContent:"center",
      fontSize:"9px", color:"#264426", letterSpacing:"2px" }}>
      INSUFFICIENT DATA FOR CHART
    </div>
  );

  const ema10 = calcEMA(closes, 10);
  const ema30 = calcEMA(closes, 30);

  const W = 320, H = 130, PL = 8, PR = 8, PT = 12, PB = 20;
  const chartW = W - PL - PR;
  const chartH = H - PT - PB;

  const allValues = [...closes, ...ema10.filter(Boolean), ...ema30.filter(Boolean)];
  const minV = Math.min(...allValues) * 0.998;
  const maxV = Math.max(...allValues) * 1.002;
  const range = maxV - minV || 1;

  const xScale = (i) => PL + (i / (closes.length - 1)) * chartW;
  const yScale = (v) => PT + chartH - ((v - minV) / range) * chartH;

  const toPath = (arr) => arr.reduce((path, v, i) => {
    if (v === null) return path;
    const x = xScale(i).toFixed(1);
    const y = yScale(v).toFixed(1);
    // Find previous valid
    const prevNull = i === 0 || arr[i-1] === null;
    return path + (prevNull ? `M${x},${y}` : `L${x},${y}`);
  }, "");

  // Price area fill
  const priceAreaPath = closes.reduce((path, v, i) => {
    const x = xScale(i).toFixed(1);
    const y = yScale(v).toFixed(1);
    if (i === 0) return `M${x},${yScale(minV).toFixed(1)} L${x},${y}`;
    return path + `L${x},${y}`;
  }, "") + ` L${xScale(closes.length-1).toFixed(1)},${yScale(minV).toFixed(1)} Z`;

  // Date labels (first, mid, last)
  const dateLabels = [0, Math.floor(closes.length/2), closes.length-1].map(i => ({
    x: xScale(i),
    label: timestamps[i] ? new Date(timestamps[i]*1000).toLocaleDateString("en-GB",{day:"numeric",month:"short"}) : "",
  }));

  const lastEma10 = ema10.filter(Boolean).pop();
  const lastEma30 = ema30.filter(Boolean).pop();
  const crossover = lastEma10 && lastEma30
    ? lastEma10 > lastEma30 ? "BULLISH" : "BEARISH"
    : null;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }}>
        <defs>
          <linearGradient id={`fill-${color?.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
            <stop offset="100%" stopColor={color} stopOpacity="0.01"/>
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0.25,0.5,0.75].map(p => (
          <line key={p} x1={PL} y1={PT + chartH*p} x2={W-PR} y2={PT + chartH*p}
            stroke="#1a2a1a" strokeWidth="0.5" strokeDasharray="3,3"/>
        ))}

        {/* Price area */}
        <path d={priceAreaPath} fill={`url(#fill-${color?.replace("#","")})`} />

        {/* Price line */}
        <path d={toPath(closes)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>

        {/* EMA 10 */}
        <path d={toPath(ema10)} fill="none" stroke="#ffd166" strokeWidth="1.2"
          strokeDasharray="none" strokeLinejoin="round"/>

        {/* EMA 30 */}
        <path d={toPath(ema30)} fill="none" stroke="#ff9f43" strokeWidth="1.2"
          strokeDasharray="4,2" strokeLinejoin="round"/>

        {/* Current price dot */}
        <circle cx={xScale(closes.length-1)} cy={yScale(closes[closes.length-1])}
          r="3" fill={color} stroke="#090f0a" strokeWidth="1.5"/>

        {/* Date labels */}
        {dateLabels.map((dl,i) => (
          <text key={i} x={dl.x} y={H-4} fontSize="7" fill="#264426"
            textAnchor={i===0?"start":i===2?"end":"middle"} fontFamily="Courier New">
            {dl.label}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div style={{ display:"flex", gap:"14px", flexWrap:"wrap", marginTop:"4px", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
          <div style={{ width:"16px", height:"2px", background:color, borderRadius:"1px" }}/>
          <span style={{ fontSize:"8px", color:"#446644", letterSpacing:"1px" }}>PRICE</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
          <div style={{ width:"16px", height:"2px", background:"#ffd166", borderRadius:"1px" }}/>
          <span style={{ fontSize:"8px", color:"#ffd166", letterSpacing:"1px" }}>
            EMA10 {lastEma10 ? `$${lastEma10.toFixed(2)}` : ""}
          </span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"5px" }}>
          <div style={{ width:"16px", height:"2px", background:"#ff9f43", borderRadius:"1px" }}/>
          <span style={{ fontSize:"8px", color:"#ff9f43", letterSpacing:"1px" }}>
            EMA30 {lastEma30 ? `$${lastEma30.toFixed(2)}` : ""}
          </span>
        </div>
        {crossover && (
          <span style={{ fontSize:"8px", letterSpacing:"1px", fontWeight:"bold",
            color: crossover==="BULLISH" ? "#00ff88" : "#ff4757" }}>
            {crossover==="BULLISH" ? "▲" : "▼"} {crossover} CROSS
          </span>
        )}
        <span style={{ marginLeft:"auto", fontSize:"7px", letterSpacing:"1px",
          color: isReal ? "#00ff88" : "#ff9f43",
          background: isReal ? "rgba(0,255,136,0.08)" : "rgba(255,159,67,0.08)",
          border: `1px solid ${isReal ? "#00ff8833" : "#ff9f4333"}`,
          borderRadius:"3px", padding:"1px 6px" }}>
          {isReal ? "◉ LIVE DATA" : "◎ ESTIMATED"}
        </span>
      </div>
    </div>
  );
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

// ─── Alert Panel (per card) ───────────────────────────────────────────────────
function AlertPanel({ ticker, price, alerts, onSetAlert, onRemoveAlert }) {
  const [inputPrice, setInputPrice] = useState("");
  const [alertType, setAlertType]   = useState("price");
  const tickerAlerts = (alerts[ticker] || []);

  const addAlert = () => {
    const p = parseFloat(inputPrice);
    if (isNaN(p) || p <= 0) return;
    onSetAlert(ticker, { type: alertType, price: p, id: Date.now(), triggered: false });
    setInputPrice("");
  };

  return (
    <div style={{ background:"#060c06", border:"1px solid #1a3a1a", borderRadius:"4px", padding:"10px" }}>
      <SectionLabel>🔔 Price Alerts</SectionLabel>

      {/* Add alert */}
      <div style={{ display:"flex", gap:"6px", marginBottom:"10px", flexWrap:"wrap" }}>
        <select value={alertType} onChange={e => setAlertType(e.target.value)}
          style={{ background:"#0a150a", border:"1px solid #1a3a1a", color:"#6aaa6a",
            fontFamily:"'Courier New',monospace", fontSize:"9px", padding:"4px 6px",
            borderRadius:"3px", cursor:"pointer", flex:1 }}>
          <option value="price">Price drops to</option>
          <option value="buyzone">Enters buy zone</option>
          <option value="verdict">Verdict → BUY NOW</option>
        </select>
        {alertType === "price" && (
          <input
            value={inputPrice}
            onChange={e => setInputPrice(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addAlert()}
            placeholder={`e.g. ${(price * 0.9).toFixed(0)}`}
            style={{ background:"#0a150a", border:"1px solid #1a3a1a", color:"#00ff88",
              fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"4px 8px",
              borderRadius:"3px", width:"90px", outline:"none" }}
          />
        )}
        <button onClick={addAlert}
          style={{ background:"transparent", border:"1px solid #00ff88", color:"#00ff88",
            fontFamily:"'Courier New',monospace", fontSize:"9px", padding:"4px 10px",
            borderRadius:"3px", cursor:"pointer", letterSpacing:"1px", whiteSpace:"nowrap" }}>
          + SET
        </button>
      </div>

      {/* Active alerts */}
      {tickerAlerts.length === 0
        ? <div style={{ fontSize:"9px", color:"#264426", letterSpacing:"1px" }}>No alerts set — add one above</div>
        : tickerAlerts.map(a => (
          <div key={a.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"5px 0", borderBottom:"1px solid #0d1a0d", gap:"8px" }}>
            <div>
              <span style={{ fontSize:"9px", color: a.triggered ? "#ffd166" : "#00ff88", letterSpacing:"1px" }}>
                {a.triggered ? "✓ TRIGGERED" : "◉ ACTIVE"}
              </span>
              <span style={{ fontSize:"10px", color:"#889988", marginLeft:"8px" }}>
                {a.type === "price"   ? `Price ≤ ${fmt(a.price)}`
               : a.type === "buyzone" ? `Enters Buy Zone`
               : `Verdict → BUY NOW`}
              </span>
            </div>
            <button onClick={() => onRemoveAlert(ticker, a.id)}
              style={{ background:"transparent", border:"none", color:"#ff4757",
                fontFamily:"'Courier New',monospace", fontSize:"10px", cursor:"pointer" }}>✕</button>
          </div>
        ))
      }
    </div>
  );
}

// ─── StockCard ────────────────────────────────────────────────────────────────
function StockCard({ data, onRemove, fearGreed, alerts, onSetAlert, onRemoveAlert, currency="USD" }) {
  const [showSignals,  setShowSignals]  = useState(false);
  const [showAlerts,   setShowAlerts]   = useState(false);
  const fmtC = (n, dec=2) => fmt(n, dec, currency);

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
        <button style={S.iconBtn} onClick={() => onRemove(data.ticker)}>✕ REMOVE</button>
      </div>
    </div>
  );

  const cfg    = STATUS_CFG[data.status] || STATUS_CFG["WATCH"];
  const barPct = Math.min(98, Math.max(2, ((data.price - data.low52) / (data.high52 - data.low52)) * 100));
  const dec    = getDecision(data, fearGreed);
  const activeAlerts = (alerts[data.ticker] || []).filter(a => !a.triggered).length;

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
              color: data.status==="DEEP CORRECTION" ? "#00ff88" : data.status==="CORRECTION" ? "#7dff6b"
                   : data.status==="PULLBACK" ? "#ffd166" : data.status==="WATCH" ? "#ff9f43" : "#ff4757",
              fontSize:"14px", fontWeight:"900", lineHeight:1
            }}>{cfg.icon}</span>
            <span>{data.status}</span>
          </div>
          <button style={S.iconBtn} onClick={() => onRemove(data.ticker)}>✕ REMOVE</button>
        </div>
      </div>

      {/* Price row */}
      <div style={{ display:"flex", alignItems:"baseline", gap:"10px", flexWrap:"wrap" }}>
        <div style={{ fontSize:"24px", fontWeight:900, color:"#c8d8c8" }}>{ fmtC(data.price)}</div>
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
          <span>52W LOW {fmtC(data.low52)}</span>
          <span>52W HIGH {fmtC(data.high52)}</span>
        </div>
      </div>

      {/* Price Chart */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Price Chart — EMA 10 & EMA 30</SectionLabel>
        <PriceChart closes={data.closes} timestamps={data.timestamps} color={cfg.color} isReal={data.chartIsReal} />
      </div>

      {/* Buy Zone Analysis */}
      <div style={S.dataGrid}>
        <SectionLabel>Buy Zone Analysis</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="BEST BUY TARGET"  value={fmtC(data.bestBuy)}             color="#00ff88" />
          <DataCell label="ANALYST TARGET"   value={fmtC(data.target)} />
          <DataCell label="UPSIDE TO TARGET" value={`${data.upside?.toFixed(1)}%`} color={data.upside >= 0 ? "#00ff88" : "#ff4757"} />
          <DataCell label="% FROM HIGH"      value={`${data.pct?.toFixed(2)}%`}    color={cfg.color} />
        </div>
      </div>

      {/* Momentum */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Momentum</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="RSI (14 DAY)" value={getRsiLabel(data.rsi)} color={getRsiColor(data.rsi)} />
          <DataCell label="52W RETURN"   value={data.ret52w != null ? `${Number(data.ret52w).toFixed(1)}%` : "—"} color={data.ret52w >= 0 ? "#00ff88" : "#ff4757"} />
        </div>
      </div>

      {/* Fundamentals */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Fundamentals</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="P/E RATIO" value={data.pe  != null ? fmtNum(data.pe, 1) : "—"} />
          <DataCell label="EPS"       value={data.eps != null ? fmtC(data.eps)       : "—"} />
        </div>
      </div>

      {/* Volume */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Volume</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px" }}>
          <DataCell label="10 DAY AVG VOL"  value={fmtVol(data.vol10d)} small />
          <DataCell label="3 MONTH AVG VOL" value={fmtVol(data.vol3m)}  small />
        </div>
      </div>

      {/* Levels & Catalyst */}
      <div style={{ background:"#060c06", border:"1px solid #0d1a0d", borderRadius:"4px", padding:"10px" }}>
        <SectionLabel>Levels & Catalyst</SectionLabel>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"8px" }}>
          <DataCell label="SUPPORT"      value={data.support    ? fmtC(data.support)    : "—"} color="#00ff88" small />
          <DataCell label="RESISTANCE"   value={data.resistance ? fmtC(data.resistance) : "—"} color="#ff4757" small />
          <DataCell label="NEXT EARNINGS" value={data.nextEarnings ? new Date(data.nextEarnings).toLocaleDateString("en-GB",{day:"numeric",month:"short"}) : "—"} color="#ffd166" small />
        </div>
      </div>

      {/* Decision Engine */}
      <div style={{ border:`2px solid ${dec.verdictBorder}`, borderRadius:"6px", overflow:"hidden", boxShadow:`0 0 20px ${dec.verdictBorder}44` }}>
        <div style={{ background:dec.verdictBg, padding:"12px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"2px", marginBottom:"4px" }}>AI DECISION ENGINE</div>
            <div style={{ fontSize:"20px", fontWeight:900, color:dec.verdictColor, letterSpacing:"3px" }}>
              {dec.verdict==="BUY NOW" ? "🟢 " : dec.verdict==="ACCUMULATE" ? "🟩 " : dec.verdict==="WATCH & WAIT" ? "🟡 " : dec.verdict==="WAIT FOR DIP" ? "🟠 " : "🔴 "}
              {dec.verdict}
            </div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"1px" }}>SCORE</div>
            <div style={{ fontSize:"24px", fontWeight:900, color:dec.verdictColor }}>{dec.score}</div>
            <div style={{ fontSize:"7px", color:"#264426" }}>out of 95</div>
          </div>
        </div>
        <div style={{ background:"#060c06", padding:"10px 14px", borderTop:`1px solid ${dec.verdictBorder}33` }}>
          <div style={{ fontSize:"11px", color:"#c8d8c8", lineHeight:1.6 }}>{dec.advice}</div>
        </div>
        <button onClick={() => setShowSignals(s => !s)}
          style={{ width:"100%", background:"transparent", border:"none", borderTop:`1px solid ${dec.verdictBorder}33`,
            padding:"8px 14px", color:"#446644", fontFamily:"'Courier New',monospace", fontSize:"9px",
            letterSpacing:"2px", cursor:"pointer", textAlign:"left" }}>
          {showSignals ? "▲ HIDE SIGNALS" : "▼ SHOW SIGNALS"} ({dec.signals.length})
        </button>
        {showSignals && (
          <div style={{ background:"#050c05", padding:"10px 14px", display:"flex", flexDirection:"column", gap:"8px" }}>
            {dec.signals.map((sig,i) => (
              <div key={i} style={{ display:"flex", gap:"8px", alignItems:"flex-start" }}>
                <span style={{ fontSize:"12px", flexShrink:0 }}>{sig.icon}</span>
                <span style={{ fontSize:"10px", color:"#889988", lineHeight:1.5 }}>{sig.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alert toggle button */}
      <button onClick={() => setShowAlerts(s => !s)}
        style={{ background:"transparent", border:"1px solid #1a3a1a", color: activeAlerts > 0 ? "#ffd166" : "#446644",
          fontFamily:"'Courier New',monospace", fontSize:"9px", padding:"7px 12px",
          borderRadius:"4px", cursor:"pointer", letterSpacing:"2px", textAlign:"left",
          borderColor: activeAlerts > 0 ? "#ffd166" : "#1a3a1a" }}>
        🔔 {activeAlerts > 0 ? `${activeAlerts} ACTIVE ALERT${activeAlerts > 1 ? "S" : ""}` : "SET PRICE ALERT"} {showAlerts ? "▲" : "▼"}
      </button>

      {/* Alert panel */}
      {showAlerts && (
        <AlertPanel
          ticker={data.ticker}
          price={data.price}
          alerts={alerts}
          onSetAlert={onSetAlert}
          onRemoveAlert={onRemoveAlert}
        />
      )}

      {/* Strategy */}
      <div style={S.stratBox}>
        <span style={{ color:"#00ff88", fontWeight:"bold", letterSpacing:"2px", fontSize:"9px" }}>STRATEGY </span>
        <span style={{ color:"#778877", fontSize:"10px" }}>{data.strategy}</span>
      </div>

      <div style={{ fontSize:"8px", color:"#1a3a1a" }}>
        ⏱ {data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}) : "—"}
      </div>
    </div>
  );
}

// ─── Alert History Panel ──────────────────────────────────────────────────────
function AlertHistory({ history, onClear }) {
  if (!history.length) return null;
  return (
    <div style={{ margin:"0 20px 16px", background:"#060c06", border:"1px solid #ffd16644", borderRadius:"6px", overflow:"hidden" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"8px 14px", borderBottom:"1px solid #1a3a1a", background:"rgba(255,209,102,0.06)" }}>
        <span style={{ fontSize:"9px", color:"#ffd166", letterSpacing:"2px", fontWeight:"bold" }}>
          🔔 ALERT HISTORY ({history.length})
        </span>
        <button onClick={onClear}
          style={{ background:"transparent", border:"none", color:"#446644",
            fontFamily:"'Courier New',monospace", fontSize:"9px", cursor:"pointer" }}>
          CLEAR ALL
        </button>
      </div>
      {history.slice(0,10).map((h,i) => (
        <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"7px 14px",
          borderBottom:"1px solid #0d1a0d", alignItems:"center" }}>
          <div>
            <span style={{ fontSize:"10px", color:"#ffd166", fontWeight:"bold" }}>{h.ticker}</span>
            <span style={{ fontSize:"10px", color:"#889988", marginLeft:"8px" }}>{h.message}</span>
          </div>
          <span style={{ fontSize:"8px", color:"#264426" }}>{h.time}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── State (all persisted to localStorage) ─────────────────────────────────
  const [activeExchange, setActiveExchange] = useState(() => LS.get("bz_exchange", "US"));
  const [watchlist,    setWatchlist]    = useState(() => LS.get("bz_watchlist_v2", { US:[], UK:[], IN:{} }));
  const [stockData,    setStockData]    = useState({});
  const [alerts,       setAlerts]       = useState(() => LS.get("bz_alerts", {}));
  const [alertHistory, setAlertHistory] = useState(() => LS.get("bz_history", []));
  const [inputVal,     setInputVal]     = useState("");
  const [inputError,   setInputError]   = useState("");
  const [refreshIdx,   setRefreshIdx]   = useState(() => LS.get("bz_refreshIdx", 1));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastPoll,     setLastPoll]     = useState(null);
  const [countdown,    setCountdown]    = useState(0);
  const [statusMsg,    setStatusMsg]    = useState("");
  const [fearGreed,    setFearGreed]    = useState(null);
  const [notifGranted, setNotifGranted] = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);

  // ── Persist to localStorage ────────────────────────────────────────────────
  useEffect(() => { LS.set("bz_watchlist_v2", watchlist);  }, [watchlist]);
  useEffect(() => { LS.set("bz_exchange",    activeExchange); }, [activeExchange]);
  useEffect(() => { LS.set("bz_alerts",      alerts);     }, [alerts]);
  useEffect(() => { LS.set("bz_history",     alertHistory);}, [alertHistory]);
  useEffect(() => { LS.set("bz_refreshIdx",  refreshIdx); }, [refreshIdx]);

  // ── Request notification permission ───────────────────────────────────────
  useEffect(() => {
    requestNotifPermission().then(setNotifGranted);
  }, []);

  // ── Fear & Greed ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchFearGreed().then(v => setFearGreed(v));
    const t = setInterval(() => fetchFearGreed().then(v => setFearGreed(v)), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const prevDecisions = useRef({});
  const nextRefreshAt = useRef(null);
  const pollTimer     = useRef(null);
  const watchlistRef  = useRef([]);
  const currentList   = watchlist[activeExchange] || [];
  watchlistRef.current = currentList;

  // ── Alert checker ──────────────────────────────────────────────────────────
  const checkAlerts = useCallback((results, currentAlerts, currentFG) => {
    const newAlerts   = { ...currentAlerts };
    const newHistory  = [];
    let changed = false;

    for (const [ticker, stock] of Object.entries(results)) {
      if (stock.error || !stock.price) continue;
      const tickerAlerts = newAlerts[ticker] || [];
      const dec = getDecision(stock, currentFG);

      // Check verdict changes
      const prevDec = prevDecisions.current[ticker];
      if (prevDec && prevDec !== dec.verdict && dec.verdict === "BUY NOW") {
        const msg = `Verdict changed to BUY NOW (score: ${dec.score})`;
        sendNotification(`${ticker} — BUY NOW`, msg, "🟢");
        newHistory.push({ ticker, message: msg, time: new Date().toLocaleTimeString() });
      }
      prevDecisions.current[ticker] = dec.verdict;

      // Check per-stock alerts
      const updated = tickerAlerts.map(a => {
        if (a.triggered) return a;
        let triggered = false;
        let msg = "";

        if (a.type === "price" && stock.price <= a.price) {
          triggered = true;
          msg = `Price hit ${fmt(stock.price)} (target: ${fmt(a.price)})`;
          sendNotification(`${ticker} — Price Alert`, msg, "🔔");
        } else if (a.type === "buyzone" && ["DEEP CORRECTION","CORRECTION"].includes(stock.status)) {
          triggered = true;
          msg = `Entered Buy Zone — ${stock.status} (${stock.pct.toFixed(1)}% from high)`;
          sendNotification(`${ticker} — Buy Zone`, msg, "✅");
        } else if (a.type === "verdict" && dec.verdict === "BUY NOW") {
          triggered = true;
          msg = `Decision Engine says BUY NOW (score: ${dec.score})`;
          sendNotification(`${ticker} — BUY NOW Signal`, msg, "🟢");
        }

        if (triggered) {
          changed = true;
          newHistory.push({ ticker, message: msg, time: new Date().toLocaleTimeString() });
          return { ...a, triggered: true };
        }
        return a;
      });

      if (JSON.stringify(updated) !== JSON.stringify(tickerAlerts)) {
        newAlerts[ticker] = updated;
        changed = true;
      }
    }

    if (changed || newHistory.length) {
      setAlerts(newAlerts);
      if (newHistory.length) setAlertHistory(prev => [...newHistory, ...prev].slice(0, 50));
    }
  }, []);

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
      // Check alerts after fetch
      checkAlerts(results, alerts, fearGreed);
    } catch (e) {
      setStatusMsg(`⚠ ${e.message}`);
      setTimeout(() => setStatusMsg(""), 5000);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, alerts, fearGreed, checkAlerts]);

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
      if (nextRefreshAt.current) setCountdown(Math.max(0, nextRefreshAt.current - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-load saved watchlist on mount
  useEffect(() => {
    const list = watchlist[activeExchange] || [];
    if (list.length) {
      setStockData(Object.fromEntries(list.map(t => [t, { ticker: t, loading: true }])));
      doFetch(list);
      schedule(refreshMs);
    }
  }, []); // eslint-disable-line

  // Re-load when switching exchange
  useEffect(() => {
    const list = watchlist[activeExchange] || [];
    if (list.length) {
      const missing = list.filter(t => !stockData[t] || stockData[t].loading === undefined);
      if (missing.length) {
        setStockData(prev => ({ ...prev, ...Object.fromEntries(missing.map(t => [t,{ticker:t,loading:true}])) }));
        doFetch(missing);
      }
    }
  }, [activeExchange]); // eslint-disable-line

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
      .map(t => t.trim().toUpperCase().replace(/[^A-Z0-9.^-]/g,""))
      .filter(Boolean);
    const currentList = watchlistRef.current;
    const newOnes = tokens.filter(t => t && !currentList.includes(t));
    if (!newOnes.length) { setInputError(tokens.length ? "Already tracking those tickers" : "Enter a ticker symbol"); return; }
    setInputError(""); setInputVal("");
    setWatchlist(prev => ({ ...prev, [activeExchange]: [...(prev[activeExchange]||[]), ...newOnes] }));
    setStockData(prev => ({ ...prev, ...Object.fromEntries(newOnes.map(t => [t,{ticker:t,loading:true}])) }));
    if (!pollTimer.current) schedule(refreshMs);
    await doFetch(newOnes);
  }, [inputVal, doFetch, schedule, refreshMs, activeExchange]);

  const removeTicker = useCallback((t) => {
    setWatchlist(prev => ({ ...prev, [activeExchange]: (prev[activeExchange]||[]).filter(x => x !== t) }));
    setStockData(prev => { const n={...prev}; delete n[t]; return n; });
    setAlerts(prev => { const n={...prev}; delete n[t]; return n; });
  }, [activeExchange]);

  const onSetAlert = useCallback((ticker, alert) => {
    setAlerts(prev => ({ ...prev, [ticker]: [...(prev[ticker]||[]), alert] }));
  }, []);

  const onRemoveAlert = useCallback((ticker, id) => {
    setAlerts(prev => ({ ...prev, [ticker]: (prev[ticker]||[]).filter(a => a.id !== id) }));
  }, []);

  const totalActiveAlerts = Object.values(alerts).flat().filter(a => !a.triggered).length;

  const counts = Object.values(stockData).reduce((acc,s) => {
    if (s?.status && currentList.includes(s.ticker)) acc[s.status] = (acc[s.status]||0)+1;
    return acc;
  }, {});

  const exCfg = EXCHANGES[activeExchange] || EXCHANGES.US;

  const fg = getFearGreedLabel(fearGreed);

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
        {fearGreed !== null && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"3px",
            background:"rgba(0,0,0,0.3)", border:`1px solid ${fg.color}`, borderRadius:"6px", padding:"8px 14px" }}>
            <div style={{ fontSize:"8px", color:"#446644", letterSpacing:"2px" }}>FEAR & GREED</div>
            <div style={{ fontSize:"22px", lineHeight:1 }}>{fg.emoji}</div>
            <div style={{ fontSize:"16px", fontWeight:900, color:fg.color }}>{Math.round(fearGreed)}</div>
            <div style={{ fontSize:"8px", color:fg.color, letterSpacing:"1px", fontWeight:"bold" }}>{fg.label}</div>
          </div>
        )}

        {/* Refresh + Alerts */}
        <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
          <button className="rnBtn"
            style={{ ...S.rnBtn, ...(isRefreshing || !watchlist.length ? S.rnBtnOff : {}) }}
            onClick={refreshNow} disabled={isRefreshing || !watchlist.length}>
            <span className={isRefreshing ? "spin" : ""} style={{ display:"inline-block" }}>↺</span>
            <span style={{ marginLeft:"8px" }}>{isRefreshing ? "REFRESHING…" : "REFRESH NOW"}</span>
          </button>

          {/* Alert bell */}
          <button onClick={() => setShowHistory(s => !s)}
            style={{ background:"transparent", border:`1px solid ${alertHistory.length ? "#ffd166" : "#1a3a1a"}`,
              color: alertHistory.length ? "#ffd166" : "#264426",
              fontFamily:"'Courier New',monospace", fontSize:"11px", padding:"10px 14px",
              borderRadius:"5px", cursor:"pointer", position:"relative" }}>
            🔔
            {totalActiveAlerts > 0 && (
              <span style={{ position:"absolute", top:"-6px", right:"-6px", background:"#ff4757",
                color:"#fff", fontSize:"8px", fontWeight:"bold", borderRadius:"50%",
                width:"16px", height:"16px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                {totalActiveAlerts}
              </span>
            )}
          </button>

          {!notifGranted && (
            <button onClick={() => requestNotifPermission().then(setNotifGranted)}
              style={{ background:"transparent", border:"1px solid #ffd166", color:"#ffd166",
                fontFamily:"'Courier New',monospace", fontSize:"8px", padding:"6px 10px",
                borderRadius:"4px", cursor:"pointer", letterSpacing:"1px" }}>
              ENABLE NOTIFICATIONS
            </button>
          )}
        </div>

        {/* Countdown */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"6px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
            <div className={isRefreshing ? "pulse" : watchlist.length ? "pulse-slow" : ""}
              style={{ width:"7px", height:"7px", borderRadius:"50%",
                background: isRefreshing ? "#ffd166" : watchlist.length ? "#00ff88" : "#264426" }} />
            <span style={{ fontSize:"9px", color: isRefreshing ? "#ffd166" : "#446644", letterSpacing:"2px" }}>
              {isRefreshing ? statusMsg||"FETCHING…" : watchlist.length ? `NEXT ${fmtTime(countdown)}` : "ADD STOCKS TO BEGIN"}
            </span>
          </div>
          <div style={{ display:"flex", gap:"4px", alignItems:"center" }}>
            <span style={{ fontSize:"8px", color:"#264426", marginRight:"2px" }}>INTERVAL</span>
            {REFRESH_OPTIONS.map((o,i) => (
              <button key={i} className="intBtn"
                style={{ ...S.intBtn, ...(i===refreshIdx ? {borderColor:"#00ff88",color:"#00ff88",background:"rgba(0,255,136,0.08)"} : {}) }}
                onClick={() => setRefreshIdx(i)}>{o.label}
              </button>
            ))}
          </div>
          {lastPoll && (
            <div style={{ fontSize:"8px", color:"#1a3a1a" }}>
              LAST {new Date(lastPoll).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
            </div>
          )}
        </div>
      </div>

      {/* EXCHANGE SELECTOR */}
      <div style={{ display:"flex", gap:"0", borderBottom:"1px solid #0d1a0d", background:"#060c06" }}>
        {Object.values(EXCHANGES).map(ex => (
          <button key={ex.id}
            onClick={() => { setActiveExchange(ex.id); setInputVal(""); setInputError(""); }}
            style={{
              flex:1, background: activeExchange===ex.id ? `${ex.color}18` : "transparent",
              border:"none", borderBottom: activeExchange===ex.id ? `2px solid ${ex.color}` : "2px solid transparent",
              borderRight:"1px solid #0d1a0d",
              color: activeExchange===ex.id ? ex.color : "#264426",
              fontFamily:"'Courier New',monospace", fontSize:"11px", fontWeight: activeExchange===ex.id ? "bold" : "normal",
              padding:"10px 8px", cursor:"pointer", transition:"all 0.2s",
              display:"flex", flexDirection:"column", alignItems:"center", gap:"2px",
            }}>
            <span style={{ fontSize:"18px" }}>{ex.flag}</span>
            <span style={{ letterSpacing:"1px" }}>{ex.label}</span>
            <span style={{ fontSize:"7px", color: activeExchange===ex.id ? ex.color : "#1a3a1a", letterSpacing:"1px" }}>
              {ex.sublabel}
            </span>
            {(watchlist[ex.id]||[]).length > 0 && (
              <span style={{ fontSize:"7px", background: activeExchange===ex.id ? ex.color : "#1a3a1a",
                color: activeExchange===ex.id ? "#030712" : "#264426",
                borderRadius:"999px", padding:"1px 6px", marginTop:"2px" }}>
                {(watchlist[ex.id]||[]).length} stocks
              </span>
            )}
          </button>
        ))}
      </div>

      {/* EXCHANGE TIP */}
      {exCfg.tip && (
        <div style={{ padding:"6px 20px", background:"rgba(255,159,67,0.06)", borderBottom:"1px solid #0d1a0d",
          fontSize:"9px", color:"#ff9f43", letterSpacing:"1px" }}>
          💡 {exCfg.tip}
        </div>
      )}
      {currentList.length > 0 && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 20px", borderBottom:"1px solid #0d1a0d", background:"#060c06", flexWrap:"wrap", gap:"8px" }}>
          <div style={{ display:"flex", gap:"12px", flexWrap:"wrap" }}>
            {Object.entries(STATUS_CFG).map(([name,cfg]) => (
              <span key={name} style={{ fontSize:"9px", letterSpacing:"1px", color: counts[name] ? cfg.color : "#1a3a1a", whiteSpace:"nowrap" }}>
                {cfg.icon} {name}{counts[name] ? ` (${counts[name]})` : ""}
              </span>
            ))}
          </div>
          {statusMsg && !isRefreshing && <span style={{ fontSize:"9px", color:"#00ff88" }}>{statusMsg}</span>}
          <span style={{ fontSize:"9px", color:"#264426" }}>{currentList.length} TRACKED · {totalActiveAlerts} ALERTS</span>
        </div>
      )}

      {/* ADD BAR */}
      <div style={{ display:"flex", alignItems:"center", gap:"10px", padding:"12px 20px", borderBottom:"1px solid #0d1a0d", flexWrap:"wrap" }} className="add-bar">
        <div style={{ display:"flex", alignItems:"center", background:"#09120a", border:`1px solid ${exCfg.color}33`, borderRadius:"4px", padding:"0 12px", flex:1, maxWidth:"400px" }}>
          <span style={{ color: exCfg.color, fontSize:"15px", fontWeight:"bold", marginRight:"6px" }}>{exCfg.flag}</span>
          <input style={{ ...S.inp, color: exCfg.color }} value={inputVal}
            onChange={e => { setInputVal(e.target.value.toUpperCase()); setInputError(""); }}
            onKeyDown={e => e.key==="Enter" && addTickers()}
            placeholder={exCfg.placeholder}
            disabled={isRefreshing} />
        </div>
        <button className="addBtn" style={{ ...S.addBtn, borderColor: exCfg.color, color: exCfg.color }}
          onClick={addTickers} disabled={isRefreshing}>+ ADD</button>
      </div>
      {inputError && <div style={{ color:"#ff4757", fontSize:"10px", padding:"5px 20px", background:"rgba(255,71,87,0.05)" }}>⚠ {inputError}</div>}

      {/* ALERT HISTORY */}
      {showHistory && (
        <AlertHistory
          history={alertHistory}
          onClear={() => { setAlertHistory([]); setShowHistory(false); }}
        />
      )}

      {/* EMPTY STATE */}
      {currentList.length === 0 && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", padding:"70px 24px", gap:"10px" }}>
          <div style={{ fontSize:"40px" }}>{exCfg.flag}</div>
          <div style={{ color: exCfg.color, fontSize:"13px", letterSpacing:"4px", fontWeight:"bold" }}>{exCfg.label} — {exCfg.sublabel}</div>
          <div style={{ color:"#1a3a1a", fontSize:"10px", letterSpacing:"2px", marginTop:"4px" }}>No stocks tracked. Add a ticker above or click a suggestion:</div>
          <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap", justifyContent:"center" }} className="sugg-row">
            {exCfg.suggestions.map(t => (
              <button key={t} className="suggBtn" style={{ ...S.suggBtn, borderColor:`${exCfg.color}44`, color: exCfg.color }}
                onClick={() => setInputVal(p => p ? p+","+t : t)}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {/* GRID */}
      {currentList.length > 0 && (
        <div style={S.grid} className="grid">
          {currentList.map(t => (
            <StockCard key={t}
              data={stockData[t] || { ticker:t, loading:true }}
              onRemove={removeTicker}
              fearGreed={fearGreed}
              alerts={alerts}
              onSetAlert={onSetAlert}
              onRemoveAlert={onRemoveAlert}
              currency={exCfg.currency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
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
  select option { background:#0a150a; }
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
  @media (max-width:600px) {
    .hdr { flex-direction:column!important; align-items:flex-start!important; padding:12px 14px!important; gap:10px!important; }
    .rnBtn { width:100%!important; justify-content:center!important; font-size:12px!important; }
    .add-bar { padding:10px 14px!important; }
    .addBtn { padding:10px 14px!important; font-size:12px!important; }
    .grid { grid-template-columns:1fr!important; padding:12px 10px!important; gap:12px!important; }
    .card { padding:14px 12px!important; }
    .sugg-row { gap:6px!important; }
    .suggBtn { font-size:10px!important; padding:6px 10px!important; }
  }
  @media (max-width:900px) and (min-width:601px) {
    .grid { grid-template-columns:1fr 1fr!important; padding:14px!important; }
  }
  @media (hover:none) {
    .iconBtn { padding:8px 14px!important; font-size:13px!important; }
    .intBtn  { padding:6px 10px!important; font-size:10px!important; }
  }
`;

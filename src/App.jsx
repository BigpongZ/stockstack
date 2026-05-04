import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "stock_watchlist_v1";
const MARKET_EXAMPLES = {
  TH: ["PTT", "KBANK", "AOT", "CPALL", "SCB", "GULF", "ADVANC", "TRUE", "IVL", "SCC"],
  US: ["AAPL", "NVDA", "TSLA", "AMZN", "MSFT", "META", "GOOGL", "AMD", "PLTR", "SMCI"],
};

const analysisCache = {};
const CACHE_TTL = 30 * 60 * 1000;
function getCached(symbol, market, type) {
  const key = `${symbol}_${market}_${type}`;
  const cached = analysisCache[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.result;
  return null;
}
function setCache(symbol, market, type, result) {
  analysisCache[`${symbol}_${market}_${type}`] = { result, ts: Date.now() };
}

const THEMES = {
  light: {
    bg: "#f8f9fa", card: "#ffffff", border: "#e2e8f0", borderHover: "#cbd5e1",
    text: "#0f172a", textMuted: "#64748b", textFaint: "#94a3b8",
    green: "#059669", greenBg: "#ecfdf5", greenBorder: "#a7f3d0",
    red: "#dc2626", redBg: "#fef2f2", redBorder: "#fecaca",
    blue: "#2563eb", blueBg: "#eff6ff", blueBorder: "#bfdbfe",
    teal: "#0d9488", tealBg: "#f0fdfa", tealBorder: "#99f6e4",
    gold: "#d97706", header: "#ffffff", shadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  dark: {
    bg: "#010409", card: "#0d1117", border: "#21262d", borderHover: "#30363d",
    text: "#e6edf3", textMuted: "#8b949e", textFaint: "#484f58",
    green: "#00d4aa", greenBg: "#00d4aa11", greenBorder: "#00d4aa33",
    red: "#ff4d6d", redBg: "#ff4d6d11", redBorder: "#ff4d6d33",
    blue: "#58a6ff", blueBg: "#58a6ff18", blueBorder: "#58a6ff44",
    teal: "#00d4aa", tealBg: "#00d4aa18", tealBorder: "#00d4aa44",
    gold: "#f0a500", header: "#010409", shadow: "0 1px 3px rgba(0,0,0,0.3)",
  },
};

let T = THEMES.light;

function useWatchlist() {
  const [list, setList] = useState(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  });
  const save = useCallback((newList) => {
    setList(newList);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newList)); } catch {}
  }, []);
  const add = (item) => save([...list, { ...item, id: Date.now(), addedAt: new Date().toLocaleDateString("th-TH") }]);
  const remove = (id) => save(list.filter(i => i.id !== id));
  const update = (id, patch) => save(list.map(i => i.id === id ? { ...i, ...patch } : i));
  return { list, add, remove, update };
}

async function fetchQuote(symbol, market) {
  const ticker = market === "TH" ? `${symbol}.BK` : symbol;
  try {
    const res = await fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return { ...data, symbol, market };
  } catch { return null; }
}

async function fetchUSDTHB() {
  try {
    const res = await fetch("/api/quote?symbol=USDTHB%3DX");
    if (!res.ok) throw new Error("failed");
    const data = await res.json();
    return data.price || 35;
  } catch { return 35; }
}

async function analyzeStock(stockInfo, analysisType) {
  const cached = getCached(stockInfo.symbol, stockInfo.market, analysisType);
  if (cached) return cached;
  const portfolioContext = stockInfo.shares && stockInfo.avgCost
    ? `นักลงทุนถือหุ้น ${stockInfo.shares} หุ้น ราคาเฉลี่ย ${stockInfo.avgCost} ${stockInfo.currency} กำไร/ขาดทุน: ${((stockInfo.price - stockInfo.avgCost) * stockInfo.shares).toFixed(2)} ${stockInfo.currency} วิเคราะห์ว่าควรถือต่อหรือขาย`
    : "";
  const prompts = {
    technical: `วิเคราะห์หุ้น ${stockInfo.symbol} เชิงเทคนิค ตลาด${stockInfo.market === "TH" ? "ไทย (SET)" : "สหรัฐฯ"} ราคา ${stockInfo.price} ${stockInfo.currency} ปิดก่อนหน้า ${stockInfo.prev} ${portfolioContext} วิเคราะห์แนวโน้ม momentum แนวรับแนวต้าน 3-4 ประโยค`,
    fundamental: `วิเคราะห์ปัจจัยพื้นฐาน ${stockInfo.symbol} ${stockInfo.market === "TH" ? "SET" : "US"} ราคา ${stockInfo.price} ${stockInfo.currency} ${portfolioContext} valuation การเติบโต ความสามารถแข่งขัน 3-4 ประโยค`,
    news: `สรุปข่าวและ sentiment ล่าสุด ${stockInfo.symbol} ${stockInfo.market === "TH" ? "หุ้นไทย" : "หุ้น US"} ${portfolioContext} ปัจจัยบวก/ลบสำคัญ 3-4 ประโยค`,
  };
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompts[analysisType] }),
    });
    const data = await res.json();
    const result = data.result || "ไม่สามารถวิเคราะห์ได้ในขณะนี้";
    if (data.result) setCache(stockInfo.symbol, stockInfo.market, analysisType, result);
    return result;
  } catch { return "ไม่สามารถวิเคราะห์ได้ในขณะนี้"; }
}

function extractSignal(text) {
  if (text.includes("ซื้อ") || text.includes("BUY")) return { label: "ซื้อ", color: T.green };
  if (text.includes("ขาย") || text.includes("SELL")) return { label: "ขาย", color: T.red };
  return { label: "ถือ", color: T.gold };
}

function PriceChange({ price, prev }) {
  if (!price || !prev) return null;
  const diff = price - prev;
  const pct = ((diff / prev) * 100).toFixed(2);
  const up = diff >= 0;
  return (
    <span style={{ color: up ? T.green : T.red, fontFamily: "monospace", fontSize: "0.82rem", fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(diff).toFixed(2)} ({up ? "+" : ""}{pct}%)
    </span>
  );
}

function PnL({ shares, avgCost, currentPrice, currency }) {
  const [usdthb, setUsdthb] = useState(null);
  useEffect(() => { if (currency === "USD") fetchUSDTHB().then(setUsdthb); }, [currency]);
  if (!shares || !avgCost || !currentPrice) return null;
  const pnl = (currentPrice - avgCost) * shares;
  const pct = ((currentPrice - avgCost) / avgCost * 100).toFixed(2);
  const up = pnl >= 0;
  const pnlTHB = usdthb ? pnl * usdthb : null;
  return (
    <div style={{ marginTop: "0.4rem", background: up ? T.greenBg : T.redBg, border: `1px solid ${up ? T.greenBorder : T.redBorder}`, borderRadius: "8px", padding: "0.5rem 0.75rem" }}>
      <div style={{ fontSize: "0.68rem", color: T.textMuted, marginBottom: "0.2rem" }}>กำไร/ขาดทุน ({shares} หุ้น @ {avgCost})</div>
      <div style={{ fontFamily: "monospace", fontWeight: 700, color: up ? T.green : T.red, fontSize: "0.92rem" }}>
        {up ? "+" : ""}{pnl.toFixed(2)} {currency}
        <span style={{ fontSize: "0.75rem", marginLeft: "0.5rem", fontWeight: 400 }}>({up ? "+" : ""}{pct}%)</span>
      </div>
      {pnlTHB !== null && (
        <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: up ? T.teal : T.red, marginTop: "0.15rem" }}>
          {up ? "+" : ""}{pnlTHB.toFixed(0)} THB
          <span style={{ color: T.textFaint, marginLeft: "0.4rem" }}>(1 USD = {usdthb.toFixed(2)} THB)</span>
        </div>
      )}
    </div>
  );
}

function NewsPanel({ stock, onClose }) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    fetch(`/api/news?symbol=${encodeURIComponent(stock.symbol)}&name=${encodeURIComponent(stock.name || stock.symbol)}`)
      .then(r => r.json())
      .then(data => { setNews(data.items || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stock]);

  const summarizeNews = async () => {
    if (!news.length) return;
    setSummarizing(true);
    const headlines = news.map(n => n.title).join("\n");
    const prompt = `สรุปข่าวหุ้น ${stock.symbol}:\n${headlines}\n\nสรุปประเด็นสำคัญ 2-3 ข้อ บอก sentiment บวก/ลบ จบด้วย ซื้อ / ถือ / ขาย`;
    try {
      const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await res.json();
      setSummary(data.result || "");
    } catch {}
    setSummarizing(false);
  };

  const formatDate = (d) => {
    try { return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "16px", width: "100%", maxWidth: "580px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.1rem", color: T.text }}>{stock.symbol}</span>
            <span style={{ color: T.textMuted, fontSize: "0.8rem" }}>ข่าวล่าสุด</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: "1.3rem" }}>✕</button>
        </div>
        <div style={{ padding: "1.25rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: T.textMuted }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟳</div>
              <div style={{ fontSize: "0.85rem" }}>กำลังโหลดข่าว...</div>
            </div>
          ) : news.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: T.textMuted, fontSize: "0.85rem" }}>ไม่พบข่าวที่เกี่ยวข้อง</div>
          ) : (
            <div>
              {news.map((item, i) => (
                <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "0.75rem", marginBottom: "0.5rem", background: T.bg, borderRadius: "8px", border: `1px solid ${T.border}`, textDecoration: "none" }}>
                  <div style={{ color: T.text, fontSize: "0.85rem", lineHeight: 1.5, marginBottom: "0.35rem" }}>{item.title}</div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    {item.source && <span style={{ color: T.blue, fontSize: "0.7rem" }}>{item.source}</span>}
                    {item.pubDate && <span style={{ color: T.textFaint, fontSize: "0.7rem" }}>{formatDate(item.pubDate)}</span>}
                  </div>
                </a>
              ))}
              {!summary && (
                <button onClick={summarizeNews} disabled={summarizing} style={{ width: "100%", background: T.tealBg, border: `1px solid ${T.tealBorder}`, color: T.teal, borderRadius: "8px", padding: "10px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", marginTop: "0.5rem" }}>
                  {summarizing ? "AI กำลังสรุปข่าว..." : "✦ ให้ AI สรุปข่าวทั้งหมด"}
                </button>
              )}
              {summary && (
                <div style={{ background: T.tealBg, borderRadius: "10px", padding: "1rem", border: `1px solid ${T.tealBorder}`, marginTop: "0.75rem" }}>
                  <div style={{ fontSize: "0.72rem", color: T.teal, marginBottom: "0.5rem", fontWeight: 600 }}>AI สรุปข่าว</div>
                  <div style={{ color: T.text, fontSize: "0.88rem", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{summary}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ stock, onClose }) {
  const [tab, setTab] = useState("technical");
  const [result, setResult] = useState({});
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);

  useEffect(() => { fetchQuote(stock.symbol, stock.market).then(setQuote); }, [stock]);

  const analyze = async (type) => {
    setTab(type);
    if (result[type]) return;
    setLoading(true);
    const info = quote || { symbol: stock.symbol, market: stock.market, price: stock.price || 0, prev: stock.price, currency: stock.market === "TH" ? "THB" : "USD" };
    const text = await analyzeStock({ ...info, shares: stock.shares, avgCost: stock.avgCost }, type);
    setResult(r => ({ ...r, [type]: text }));
    setLoading(false);
  };

  useEffect(() => { if (quote !== null) analyze("technical"); }, [quote]);
  const signal = result[tab] ? extractSignal(result[tab]) : null;
  const price = quote?.price || stock.price;
  const currency = quote?.currency || (stock.market === "TH" ? "THB" : "USD");

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "16px", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.5rem", fontWeight: 700, color: T.text, fontFamily: "monospace" }}>{stock.symbol}</span>
                <span style={{ background: stock.market === "TH" ? "#ecfdf5" : "#eff6ff", color: stock.market === "TH" ? T.teal : T.blue, padding: "2px 8px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 600 }}>{stock.market}</span>
                {signal && <span style={{ background: signal.color + "18", color: signal.color, padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, border: `1px solid ${signal.color}44` }}>{signal.label}</span>}
              </div>
              {quote && (
                <div style={{ marginTop: "0.35rem", fontSize: "1.1rem", color: T.text, fontFamily: "monospace" }}>
                  {quote.price?.toFixed(2)} <span style={{ color: T.textMuted, fontSize: "0.8rem" }}>{quote.currency}</span>
                  {" "}<PriceChange price={quote.price} prev={quote.prev} />
                </div>
              )}
              {stock.shares && stock.avgCost && <PnL shares={stock.shares} avgCost={stock.avgCost} currentPrice={price} currency={currency} />}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: "1.3rem" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            {[["technical", "📈 เทคนิค"], ["fundamental", "🏦 พื้นฐาน"], ["news", "📰 ข่าว"]].map(([key, label]) => (
              <button key={key} onClick={() => analyze(key)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", border: tab === key ? `1px solid ${T.teal}` : `1px solid ${T.border}`, background: tab === key ? T.tealBg : "transparent", color: tab === key ? T.teal : T.textMuted }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "1.5rem" }}>
          {loading
            ? <div style={{ textAlign: "center", padding: "2rem", color: T.textMuted }}><div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟳</div><div style={{ fontSize: "0.85rem" }}>AI กำลังวิเคราะห์...</div></div>
            : result[tab] ? <div style={{ color: T.text, lineHeight: 1.8, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{result[tab]}</div>
            : null}
        </div>
      </div>
    </div>
  );
}

function AddStockModal({ onAdd, onClose }) {
  const [market, setMarket] = useState("TH");
  const [symbol, setSymbol] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [basket, setBasket] = useState([]);
  const [editIdx, setEditIdx] = useState(null);
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");

  const search = async () => {
    if (!symbol.trim()) return;
    const sym = symbol.trim().toUpperCase();
    if (basket.find(b => b.symbol === sym && b.market === market)) { setError("มีหุ้นนี้ในตะกร้าแล้ว"); return; }
    setLoading(true); setError("");
    const q = await fetchQuote(sym, market);
    if (q) { setBasket(prev => [...prev, { ...q, shares: null, avgCost: null, target: null, note: "" }]); setSymbol(""); }
    else setError("ไม่พบหุ้นนี้ ลองเช็ค symbol อีกครั้ง");
    setLoading(false);
  };

  const removeFromBasket = (idx) => setBasket(prev => prev.filter((_, i) => i !== idx));

  const startEdit = (idx) => {
    const item = basket[idx];
    setEditIdx(idx); setShares(item.shares || ""); setAvgCost(item.avgCost || ""); setTarget(item.target || ""); setNote(item.note || "");
  };

  const saveEdit = () => {
    setBasket(prev => prev.map((item, i) => i === editIdx ? { ...item, shares: shares ? parseFloat(shares) : null, avgCost: avgCost ? parseFloat(avgCost) : null, target: target ? parseFloat(target) : null, note } : item));
    setEditIdx(null); setShares(""); setAvgCost(""); setTarget(""); setNote("");
  };

  const handleAddAll = () => {
    basket.forEach(item => onAdd({ symbol: item.symbol, market: item.market, name: item.name, price: item.price, currency: item.currency, shares: item.shares, avgCost: item.avgCost, target: item.target, note: item.note }));
    onClose();
  };

  const inp = { background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: "8px", padding: "8px 12px", fontSize: "0.88rem", boxSizing: "border-box" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "16px", width: "100%", maxWidth: "480px", padding: "1.5rem", maxHeight: "92vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <span style={{ color: T.text, fontWeight: 700 }}>เพิ่มหุ้นใน Watchlist</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textMuted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          {["TH", "US"].map(m => (
            <button key={m} onClick={() => { setMarket(m); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: "8px", fontWeight: 600, cursor: "pointer", border: market === m ? `1px solid ${T.teal}` : `1px solid ${T.border}`, background: market === m ? T.tealBg : "transparent", color: market === m ? T.teal : T.textMuted }}>
              {m === "TH" ? "🇹🇭 ไทย (SET)" : "🇺🇸 US"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input placeholder={market === "TH" ? "เช่น PTT, KBANK, AOT" : "เช่น AAPL, NVDA, TSLA"} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && search()} style={{ ...inp, flex: 1, fontFamily: "monospace" }} />
          <button onClick={search} style={{ background: T.teal, color: "#fff", border: "none", borderRadius: "8px", padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>{loading ? "..." : "+ เพิ่ม"}</button>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {MARKET_EXAMPLES[market].slice(0, 6).map(s => (
            <button key={s} onClick={() => setSymbol(s)} style={{ background: T.bg, border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "4px", padding: "2px 8px", fontSize: "0.7rem", cursor: "pointer" }}>{s}</button>
          ))}
        </div>
        {error && <div style={{ color: T.red, fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</div>}
        {basket.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ fontSize: "0.72rem", color: T.textMuted, marginBottom: "0.5rem" }}>ตะกร้า ({basket.length} หุ้น)</div>
            {basket.map((item, idx) => (
              <div key={idx} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: "10px", padding: "0.75rem", marginBottom: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.text }}>{item.symbol}</span>
                    <span style={{ marginLeft: "0.5rem", color: T.teal, fontFamily: "monospace", fontSize: "0.9rem" }}>{item.price?.toFixed(2)} {item.currency}</span>
                    {item.shares && <span style={{ marginLeft: "0.5rem", color: T.textMuted, fontSize: "0.75rem" }}>{item.shares} หุ้น @ {item.avgCost}</span>}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button onClick={() => startEdit(idx)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "5px", padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer" }}>✏️</button>
                    <button onClick={() => removeFromBasket(idx)} style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: "0.9rem" }}>✕</button>
                  </div>
                </div>
                {editIdx === idx && (
                  <div style={{ marginTop: "0.6rem", borderTop: `1px solid ${T.border}`, paddingTop: "0.6rem" }}>
                    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
                      <input placeholder="จำนวนหุ้น" value={shares} onChange={e => setShares(e.target.value)} type="number" style={{ ...inp, flex: 1 }} />
                      <input placeholder="ราคาที่ซื้อเฉลี่ย" value={avgCost} onChange={e => setAvgCost(e.target.value)} type="number" style={{ ...inp, flex: 1 }} />
                    </div>
                    <input placeholder="ราคาเป้าหมาย" value={target} onChange={e => setTarget(e.target.value)} type="number" style={{ ...inp, width: "100%", marginBottom: "0.4rem" }} />
                    <textarea placeholder="โน้ต..." value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inp, width: "100%", resize: "none", marginBottom: "0.4rem" }} />
                    <button onClick={saveEdit} style={{ background: T.teal, color: "#fff", border: "none", borderRadius: "6px", padding: "5px 14px", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}>บันทึก</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {basket.length > 0 && (
          <button onClick={handleAddAll} style={{ width: "100%", background: T.teal, color: "#fff", border: "none", borderRadius: "8px", padding: "11px", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem" }}>
            + เพิ่ม {basket.length} หุ้น เข้า Watchlist
          </button>
        )}
      </div>
    </div>
  );
}

function StockCard({ item, onRemove, onAnalyze, onUpdate, onShowNews, refreshTick }) {
  const [quote, setQuote] = useState(null);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note || "");
  const [target, setTarget] = useState(item.target || "");
  const [shares, setShares] = useState(item.shares || "");
  const [avgCost, setAvgCost] = useState(item.avgCost || "");

  useEffect(() => { fetchQuote(item.symbol, item.market).then(setQuote); }, [item.symbol, item.market, refreshTick]);

  const price = quote?.price || item.price;
  const currency = quote?.currency || item.currency || (item.market === "TH" ? "THB" : "USD");
  const upside = item.target && price ? (((item.target - price) / price) * 100).toFixed(1) : null;
  const upsideUp = upside > 0;

  const saveEdit = () => {
    onUpdate(item.id, { note, target: target ? parseFloat(target) : null, shares: shares ? parseFloat(shares) : null, avgCost: avgCost ? parseFloat(avgCost) : null });
    setEditing(false);
  };

  const inp = { background: T.bg, border: `1px solid ${T.border}`, color: T.text, borderRadius: "6px", padding: "6px 10px", fontSize: "0.82rem", boxSizing: "border-box" };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: "14px", padding: "1.1rem", boxShadow: T.shadow, transition: "box-shadow 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = T.shadow}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1rem", color: T.text }}>{item.symbol}</span>
            <span style={{ background: item.market === "TH" ? T.greenBg : T.blueBg, color: item.market === "TH" ? T.teal : T.blue, padding: "1px 6px", borderRadius: "3px", fontSize: "0.65rem", fontWeight: 600 }}>{item.market}</span>
          </div>
          {quote?.name && <div style={{ color: T.textMuted, fontSize: "0.72rem", marginTop: "0.15rem" }}>{quote.name}</div>}
        </div>
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={() => onAnalyze(item)} style={{ background: T.tealBg, border: `1px solid ${T.tealBorder}`, color: T.teal, borderRadius: "6px", padding: "4px 8px", fontSize: "0.68rem", cursor: "pointer", fontWeight: 600 }}>AI ✦</button>
          <button onClick={() => onShowNews(item)} style={{ background: T.blueBg, border: `1px solid ${T.blueBorder}`, color: T.blue, borderRadius: "6px", padding: "4px 8px", fontSize: "0.68rem", cursor: "pointer", fontWeight: 600 }}>ข่าว</button>
          <button onClick={() => setEditing(!editing)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "6px", padding: "4px 8px", fontSize: "0.68rem", cursor: "pointer" }}>✏️</button>
          <button onClick={() => onRemove(item.id)} style={{ background: "transparent", border: "none", color: T.textFaint, cursor: "pointer", fontSize: "0.9rem" }}>✕</button>
        </div>
      </div>
      <div style={{ marginTop: "0.6rem" }}>
        <span style={{ fontFamily: "monospace", fontSize: "1.15rem", color: T.text, fontWeight: 700 }}>{price ? price.toFixed(2) : "—"}</span>
        {" "}{quote && <PriceChange price={quote.price} prev={quote.prev} />}
      </div>
      {item.shares && item.avgCost && price && <PnL shares={item.shares} avgCost={item.avgCost} currentPrice={price} currency={currency} />}
      {item.target && (
        <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ color: T.textMuted, fontSize: "0.75rem" }}>เป้าหมาย: <span style={{ color: T.text, fontFamily: "monospace" }}>{item.target}</span></span>
          {upside && <span style={{ color: upsideUp ? T.green : T.red, fontSize: "0.75rem", fontWeight: 700 }}>{upsideUp ? "▲" : "▼"} {Math.abs(upside)}% {upsideUp ? "upside" : "downside"}</span>}
        </div>
      )}
      {item.note && !editing && <div style={{ marginTop: "0.5rem", color: T.textMuted, fontSize: "0.75rem", fontStyle: "italic", borderLeft: `2px solid ${T.border}`, paddingLeft: "0.5rem" }}>{item.note}</div>}
      <div style={{ marginTop: "0.5rem", color: T.textFaint, fontSize: "0.68rem" }}>เพิ่มเมื่อ {item.addedAt}</div>
      {editing && (
        <div style={{ marginTop: "0.75rem", borderTop: `1px solid ${T.border}`, paddingTop: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <input value={shares} onChange={e => setShares(e.target.value)} placeholder="จำนวนหุ้น" type="number" style={{ ...inp, flex: 1 }} />
            <input value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="ราคาที่ซื้อ" type="number" style={{ ...inp, flex: 1 }} />
          </div>
          <input value={target} onChange={e => setTarget(e.target.value)} placeholder="ราคาเป้าหมาย" type="number" style={{ ...inp, width: "100%", marginBottom: "0.4rem" }} />
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="โน้ต..." rows={2} style={{ ...inp, width: "100%", resize: "none", marginBottom: "0.4rem" }} />
          <button onClick={saveEdit} style={{ background: T.teal, color: "#fff", border: "none", borderRadius: "6px", padding: "5px 14px", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}>บันทึก</button>
        </div>
      )}
    </div>
  );
}

function PortfolioSummary({ items, usdthb }) {
  const [quotes, setQuotes] = useState({});

  useEffect(() => {
    items.filter(i => i.shares && i.avgCost).forEach(item => {
      fetchQuote(item.symbol, item.market).then(q => {
        if (q) setQuotes(prev => ({ ...prev, [item.id]: q }));
      });
    });
  }, [items]);

  const portfolioItems = items.filter(i => i.shares && i.avgCost);
  if (portfolioItems.length === 0) return null;

  let totalCostTHB = 0, totalValueTHB = 0;
  let hasUS = false;

  portfolioItems.forEach(item => {
    const price = quotes[item.id]?.price || item.price;
    const rate = item.market === "US" ? usdthb : 1;
    if (price) {
      if (item.market === "US") hasUS = true;
      totalCostTHB += item.avgCost * item.shares * rate;
      totalValueTHB += price * item.shares * rate;
    }
  });

  const totalPnlTHB = totalValueTHB - totalCostTHB;
  const totalPct = totalCostTHB > 0 ? ((totalPnlTHB / totalCostTHB) * 100).toFixed(2) : 0;
  const up = totalPnlTHB >= 0;

  return (
    <div style={{ background: up ? T.greenBg : T.redBg, border: `1px solid ${up ? T.greenBorder : T.redBorder}`, borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.25rem", boxShadow: T.shadow }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <div style={{ fontSize: "0.72rem", color: T.textMuted, fontWeight: 600 }}>📊 สรุปพอร์ต ({portfolioItems.length} หุ้น)</div>
        {hasUS && <div style={{ fontSize: "0.65rem", color: T.textFaint }}>USD/THB = {usdthb.toFixed(2)}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: T.textMuted }}>ต้นทุนรวม</div>
          <div style={{ fontFamily: "monospace", color: T.text, fontWeight: 600 }}>{totalCostTHB.toFixed(0)}</div>
          <div style={{ fontSize: "0.65rem", color: T.textFaint }}>THB</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: T.textMuted }}>มูลค่าปัจจุบัน</div>
          <div style={{ fontFamily: "monospace", color: T.text, fontWeight: 600 }}>{totalValueTHB.toFixed(0)}</div>
          <div style={{ fontSize: "0.65rem", color: T.textFaint }}>THB</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", color: T.textMuted }}>กำไร/ขาดทุนรวม</div>
          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.15rem", color: up ? T.green : T.red }}>
            {up ? "+" : ""}{totalPnlTHB.toFixed(0)} THB
          </div>
          <div style={{ fontSize: "0.8rem", color: up ? T.green : T.red }}>({up ? "+" : ""}{totalPct}%)</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { list, add, remove, update } = useWatchlist();
  const [showAdd, setShowAdd] = useState(false);
  const [analyzing, setAnalyzing] = useState(null);
  const [showingNews, setShowingNews] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [sort, setSort] = useState("default");
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [usdthb, setUsdthb] = useState(35);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    T = isDark ? THEMES.dark : THEMES.light;
    localStorage.setItem("theme", isDark ? "dark" : "light");
  }, [isDark]);

  useEffect(() => { fetchUSDTHB().then(setUsdthb); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshTick(t => t + 1);
    setTimeout(() => setRefreshing(false), 2000);
  };

  const handleExport = () => {
    const rows = [["Symbol", "Market", "ราคาปัจจุบัน", "จำนวนหุ้น", "ราคาที่ซื้อ", "ต้นทุน(THB)", "Target", "Note", "เพิ่มเมื่อ"]];
    list.forEach(item => {
      const rate = item.market === "US" ? usdthb : 1;
      const cost = item.shares && item.avgCost ? (item.avgCost * item.shares * rate).toFixed(0) : "";
      rows.push([item.symbol, item.market, item.price || "", item.shares || "", item.avgCost || "", cost, item.target || "", item.note || "", item.addedAt || ""]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "watchlist.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  let filtered = filter === "ALL" ? list : list.filter(i => i.market === filter);

  if (sort === "pnl_desc") {
    filtered = [...filtered].sort((a, b) => {
      const pnlA = a.price && a.avgCost ? ((a.price - a.avgCost) / a.avgCost) : -999;
      const pnlB = b.price && b.avgCost ? ((b.price - b.avgCost) / b.avgCost) : -999;
      return pnlB - pnlA;
    });
  } else if (sort === "pnl_asc") {
    filtered = [...filtered].sort((a, b) => {
      const pnlA = a.price && a.avgCost ? ((a.price - a.avgCost) / a.avgCost) : 999;
      const pnlB = b.price && b.avgCost ? ((b.price - b.avgCost) / b.avgCost) : 999;
      return pnlA - pnlB;
    });
  } else if (sort === "upside") {
    filtered = [...filtered].sort((a, b) => {
      const rateA = a.market === "US" ? usdthb : 1;
      const rateB = b.market === "US" ? usdthb : 1;
      const uA = a.price && a.target ? ((a.target - a.price) * (a.shares || 1) * rateA) : -999999;
      const uB = b.price && b.target ? ((b.target - b.price) * (b.shares || 1) * rateB) : -999999;
      return uB - uA;
    });
  } else if (sort === "pnl_thb") {
    filtered = [...filtered].sort((a, b) => {
      const rateA = a.market === "US" ? usdthb : 1;
      const rateB = b.market === "US" ? usdthb : 1;
      const pA = a.price && a.avgCost && a.shares ? ((a.price - a.avgCost) * a.shares * rateA) : -999999;
      const pB = b.price && b.avgCost && b.shares ? ((b.price - b.avgCost) * b.shares * rateB) : -999999;
      return pB - pA;
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: isDark ? THEMES.dark.bg : THEMES.light.bg, fontFamily: "system-ui, sans-serif", color: isDark ? THEMES.dark.text : THEMES.light.text }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } input::placeholder, textarea::placeholder { color: #94a3b8; } select { appearance: none; }`}</style>
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "0.85rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: T.header, zIndex: 100, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.2rem" }}>◈</span>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: T.text }}>StockWatch</span>
          <span style={{ color: T.teal, fontSize: "0.7rem", fontWeight: 600, background: T.tealBg, padding: "2px 7px", borderRadius: "20px", border: `1px solid ${T.tealBorder}` }}>AI</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={() => setIsDark(d => !d)} title="เปลี่ยน theme" style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "0.85rem" }}>
            {isDark ? "☀️" : "🌙"}
          </button>
          <button onClick={handleRefresh} title="รีเฟรชราคา" style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "0.85rem" }}>
            {refreshing ? "⟳" : "↻"}
          </button>
          <button onClick={handleExport} title="Export CSV" style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "0.8rem" }}>
            ⬇ CSV
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background: T.teal, color: "#fff", border: "none", borderRadius: "8px", padding: "7px 14px", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>+ เพิ่มหุ้น</button>
        </div>
      </div>

      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "1.25rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {["ALL", "TH", "US"].map(m => (
              <button key={m} onClick={() => setFilter(m)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", border: filter === m ? `1px solid ${T.teal}` : `1px solid ${T.border}`, background: filter === m ? T.tealBg : T.card, color: filter === m ? T.teal : T.textMuted }}>
                {m === "ALL" ? "ทั้งหมด" : m === "TH" ? "🇹🇭 ไทย" : "🇺🇸 US"}
                <span style={{ marginLeft: "0.35rem", fontSize: "0.7rem", color: T.textFaint }}>{m === "ALL" ? list.length : list.filter(i => i.market === m).length}</span>
              </button>
            ))}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ marginLeft: "auto", background: T.card, border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: "8px", padding: "6px 12px", fontSize: "0.78rem", cursor: "pointer" }}>
            <option value="default">เรียง: ปกติ</option>
            <option value="pnl_thb">กำไร (THB) มากสุด</option>
            <option value="pnl_desc">กำไร % มากสุด</option>
            <option value="pnl_asc">ขาดทุน % มากสุด</option>
            <option value="upside">Upside (THB) มากสุด</option>
          </select>
        </div>

        <PortfolioSummary items={filtered} usdthb={usdthb} />

        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: T.textFaint }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>◈</div>
            <div style={{ fontSize: "0.95rem", marginBottom: "0.35rem", color: T.textMuted }}>Watchlist ว่างอยู่</div>
            <div style={{ fontSize: "0.8rem" }}>กด "+ เพิ่มหุ้น" เพื่อเริ่มติดตามหุ้น</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(265px, 1fr))", gap: "0.85rem" }}>
          {filtered.map(item => (
            <StockCard key={item.id} item={item} onRemove={remove} onAnalyze={setAnalyzing} onUpdate={update} onShowNews={setShowingNews} refreshTick={refreshTick} />
          ))}
        </div>
      </div>

      {showAdd && <AddStockModal onAdd={add} onClose={() => setShowAdd(false)} />}
      {analyzing && <AnalysisPanel stock={analyzing} onClose={() => setAnalyzing(null)} />}
      {showingNews && <NewsPanel stock={showingNews} onClose={() => setShowingNews(null)} />}
    </div>
  );
}

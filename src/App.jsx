import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "stock_watchlist_v1";

const MARKET_EXAMPLES = {
  TH: ["PTT", "KBANK", "AOT", "CPALL", "SCB", "GULF", "ADVANC", "TRUE", "IVL", "SCC"],
  US: ["AAPL", "NVDA", "TSLA", "AMZN", "MSFT", "META", "GOOGL", "AMD", "PLTR", "SMCI"],
};

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
    const res = await fetch(`/api/quote?symbol=${ticker}`);
    if (!res.ok) throw new Error("fetch failed");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return { ...data, symbol, market };
  } catch { return null; }
}

async function analyzeStock(stockInfo, analysisType) {
  const portfolioContext = stockInfo.shares && stockInfo.avgCost
    ? `นักลงทุนถือหุ้น ${stockInfo.shares} หุ้น ราคาเฉลี่ย ${stockInfo.avgCost} ${stockInfo.currency} กำไร/ขาดทุนปัจจุบัน: ${((stockInfo.price - stockInfo.avgCost) * stockInfo.shares).toFixed(2)} ${stockInfo.currency} (${(((stockInfo.price - stockInfo.avgCost) / stockInfo.avgCost) * 100).toFixed(2)}%) วิเคราะห์ว่าควรถือต่อหรือขายทำกำไร/ตัดขาดทุน`
    : "";
  const prompts = {
    technical: `วิเคราะห์หุ้น ${stockInfo.symbol} เชิงเทคนิค ตลาด${stockInfo.market === "TH" ? "ไทย (SET)" : "สหรัฐฯ"} ราคาปัจจุบัน ${stockInfo.price} ${stockInfo.currency} ราคาปิดก่อนหน้า ${stockInfo.prev} ${portfolioContext} วิเคราะห์แนวโน้ม momentum และแนวรับแนวต้านสำคัญ`,
    fundamental: `วิเคราะห์ปัจจัยพื้นฐานของหุ้น ${stockInfo.symbol} ใน${stockInfo.market === "TH" ? "ตลาดหุ้นไทย (SET)" : "ตลาดหุ้นสหรัฐฯ"} ราคา ${stockInfo.price} ${stockInfo.currency} ${portfolioContext} วิเคราะห์ valuation การเติบโต และความสามารถในการแข่งขัน`,
    news: `สรุปข่าวและ sentiment ล่าสุดของหุ้น ${stockInfo.symbol} ${stockInfo.market === "TH" ? "หุ้นไทย" : "หุ้นสหรัฐฯ"} ${portfolioContext} ปัจจัยบวก/ลบที่สำคัญในตอนนี้`,
  };
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompts[analysisType] }),
    });
    const data = await res.json();
    return data.result || "ไม่สามารถวิเคราะห์ได้ในขณะนี้";
  } catch { return "ไม่สามารถวิเคราะห์ได้ในขณะนี้"; }
}

function extractSignal(text) {
  if (text.includes("ซื้อ") || text.includes("BUY")) return { label: "ซื้อ", color: "#00d4aa" };
  if (text.includes("ขาย") || text.includes("SELL")) return { label: "ขาย", color: "#ff4d6d" };
  return { label: "ถือ", color: "#f0a500" };
}

function PriceChange({ price, prev }) {
  if (!price || !prev) return null;
  const diff = price - prev;
  const pct = ((diff / prev) * 100).toFixed(2);
  const up = diff >= 0;
  return (
    <span style={{ color: up ? "#00d4aa" : "#ff4d6d", fontFamily: "monospace", fontSize: "0.85rem" }}>
      {up ? "▲" : "▼"} {Math.abs(diff).toFixed(2)} ({up ? "+" : ""}{pct}%)
    </span>
  );
}

function PnL({ shares, avgCost, currentPrice, currency }) {
  if (!shares || !avgCost || !currentPrice) return null;
  const pnl = (currentPrice - avgCost) * shares;
  const pct = ((currentPrice - avgCost) / avgCost * 100).toFixed(2);
  const up = pnl >= 0;
  return (
    <div style={{ marginTop: "0.4rem", background: up ? "#00d4aa11" : "#ff4d6d11", border: `1px solid ${up ? "#00d4aa33" : "#ff4d6d33"}`, borderRadius: "8px", padding: "0.5rem 0.75rem" }}>
      <div style={{ fontSize: "0.7rem", color: "#8b949e", marginBottom: "0.2rem" }}>กำไร/ขาดทุน ({shares} หุ้น @ {avgCost})</div>
      <div style={{ fontFamily: "monospace", fontWeight: 700, color: up ? "#00d4aa" : "#ff4d6d", fontSize: "0.95rem" }}>
        {up ? "+" : ""}{pnl.toFixed(2)} {currency}
        <span style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>({up ? "+" : ""}{pct}%)</span>
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "16px", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 0 60px rgba(0,212,170,0.15)" }}>
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: "1px solid #21262d" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <span style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e6edf3", fontFamily: "monospace" }}>{stock.symbol}</span>
                <span style={{ background: stock.market === "TH" ? "#1a3a2a" : "#1a2a3a", color: stock.market === "TH" ? "#00d4aa" : "#58a6ff", padding: "2px 8px", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 600 }}>{stock.market}</span>
                {signal && <span style={{ background: signal.color + "22", color: signal.color, padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, border: `1px solid ${signal.color}44` }}>{signal.label}</span>}
              </div>
              {quote && (
                <div style={{ marginTop: "0.35rem", fontSize: "1.1rem", color: "#e6edf3", fontFamily: "monospace" }}>
                  {quote.price?.toFixed(2)} <span style={{ color: "#8b949e", fontSize: "0.8rem" }}>{quote.currency}</span>
                  {" "}<PriceChange price={quote.price} prev={quote.prev} />
                </div>
              )}
              {stock.shares && stock.avgCost && <PnL shares={stock.shares} avgCost={stock.avgCost} currentPrice={price} currency={currency} />}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "1.3rem" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            {[["technical", "📈 เทคนิค"], ["fundamental", "🏦 พื้นฐาน"], ["news", "📰 ข่าว"]].map(([key, label]) => (
              <button key={key} onClick={() => analyze(key)} style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", border: tab === key ? "1px solid #00d4aa" : "1px solid #30363d", background: tab === key ? "#00d4aa18" : "transparent", color: tab === key ? "#00d4aa" : "#8b949e" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: "1.5rem" }}>
          {loading
            ? <div style={{ textAlign: "center", padding: "2rem", color: "#8b949e" }}><div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟳</div><div style={{ fontSize: "0.85rem" }}>AI กำลังวิเคราะห์...</div></div>
            : result[tab] ? <div style={{ color: "#c9d1d9", lineHeight: 1.8, fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{result[tab]}</div>
            : null}
        </div>
      </div>
    </div>
  );
}

function AddStockModal({ onAdd, onClose }) {
  const [market, setMarket] = useState("TH");
  const [symbol, setSymbol] = useState("");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");

  const search = async () => {
    if (!symbol.trim()) return;
    setLoading(true); setError(""); setQuote(null);
    const q = await fetchQuote(symbol.trim().toUpperCase(), market);
    if (q) setQuote(q); else setError("ไม่พบหุ้นนี้ ลองเช็ค symbol อีกครั้ง");
    setLoading(false);
  };

  const handleAdd = () => {
    if (!quote) return;
    onAdd({ symbol: quote.symbol, market, name: quote.name, price: quote.price, currency: quote.currency, target: target ? parseFloat(target) : null, note, shares: shares ? parseFloat(shares) : null, avgCost: avgCost ? parseFloat(avgCost) : null });
    onClose();
  };

  const pnlPreview = shares && avgCost && quote ? ((quote.price - parseFloat(avgCost)) * parseFloat(shares)) : null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "16px", width: "100%", maxWidth: "440px", padding: "1.5rem", maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1.25rem" }}>
          <span style={{ color: "#e6edf3", fontWeight: 700 }}>เพิ่มหุ้นใน Watchlist</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          {["TH", "US"].map(m => (
            <button key={m} onClick={() => { setMarket(m); setQuote(null); setError(""); }} style={{ flex: 1, padding: "8px", borderRadius: "8px", fontWeight: 600, cursor: "pointer", border: market === m ? "1px solid #00d4aa" : "1px solid #30363d", background: market === m ? "#00d4aa18" : "transparent", color: market === m ? "#00d4aa" : "#8b949e" }}>
              {m === "TH" ? "🇹🇭 ไทย (SET)" : "🇺🇸 US"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <input placeholder={market === "TH" ? "เช่น PTT, KBANK" : "เช่น AAPL, NVDA"} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && search()} style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "8px", padding: "8px 12px", fontSize: "0.9rem", fontFamily: "monospace" }} />
          <button onClick={search} style={{ background: "#00d4aa", color: "#000", border: "none", borderRadius: "8px", padding: "8px 16px", fontWeight: 700, cursor: "pointer" }}>{loading ? "..." : "ค้นหา"}</button>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {MARKET_EXAMPLES[market].slice(0, 6).map(s => (
            <button key={s} onClick={() => setSymbol(s)} style={{ background: "#21262d", border: "1px solid #30363d", color: "#8b949e", borderRadius: "4px", padding: "2px 8px", fontSize: "0.7rem", cursor: "pointer" }}>{s}</button>
          ))}
        </div>
        {error && <div style={{ color: "#ff4d6d", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</div>}
        {quote && (
          <div style={{ background: "#161b22", borderRadius: "10px", padding: "0.85rem", marginBottom: "1rem", border: "1px solid #00d4aa44" }}>
            <div style={{ color: "#e6edf3", fontWeight: 600 }}>{quote.name}</div>
            <div style={{ color: "#00d4aa", fontFamily: "monospace", fontSize: "1.1rem", marginTop: "0.25rem" }}>
              {quote.price?.toFixed(2)} <span style={{ color: "#8b949e", fontSize: "0.8rem" }}>{quote.currency}</span>
              {" "}<PriceChange price={quote.price} prev={quote.prev} />
            </div>
          </div>
        )}
        {quote && (
          <>
            <div style={{ color: "#8b949e", fontSize: "0.75rem", marginBottom: "0.4rem" }}>📊 พอร์ต (ไม่บังคับ)</div>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <input placeholder="จำนวนหุ้น" value={shares} onChange={e => setShares(e.target.value)} type="number" style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "8px", padding: "8px 12px", fontSize: "0.88rem", boxSizing: "border-box" }} />
              <input placeholder="ราคาที่ซื้อเฉลี่ย" value={avgCost} onChange={e => setAvgCost(e.target.value)} type="number" style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "8px", padding: "8px 12px", fontSize: "0.88rem", boxSizing: "border-box" }} />
            </div>
            {pnlPreview !== null && (
              <div style={{ background: pnlPreview >= 0 ? "#00d4aa11" : "#ff4d6d11", border: `1px solid ${pnlPreview >= 0 ? "#00d4aa33" : "#ff4d6d33"}`, borderRadius: "8px", padding: "0.5rem 0.75rem", marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.7rem", color: "#8b949e" }}>กำไร/ขาดทุนตอนนี้</div>
                <div style={{ fontFamily: "monospace", fontWeight: 700, color: pnlPreview >= 0 ? "#00d4aa" : "#ff4d6d" }}>
                  {pnlPreview >= 0 ? "+" : ""}{pnlPreview.toFixed(2)} {quote.currency} ({(((quote.price - parseFloat(avgCost)) / parseFloat(avgCost)) * 100).toFixed(2)}%)
                </div>
              </div>
            )}
            <input placeholder="ราคาเป้าหมาย (ไม่บังคับ)" value={target} onChange={e => setTarget(e.target.value)} type="number" style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "8px", padding: "8px 12px", fontSize: "0.88rem", marginBottom: "0.5rem", boxSizing: "border-box" }} />
            <textarea placeholder="โน้ต / เหตุผลที่ดูหุ้นนี้..." value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "8px", padding: "8px 12px", fontSize: "0.88rem", resize: "none", marginBottom: "1rem", boxSizing: "border-box" }} />
            <button onClick={handleAdd} style={{ width: "100%", background: "#00d4aa", color: "#000", border: "none", borderRadius: "8px", padding: "10px", fontWeight: 700, cursor: "pointer" }}>+ เพิ่มใน Watchlist</button>
          </>
        )}
      </div>
    </div>
  );
}

function StockCard({ item, onRemove, onAnalyze, onUpdate }) {
  const [quote, setQuote] = useState(null);
  const [editing, setEditing] = useState(false);
  const [showNews, setShowNews] = useState(false);
  const [note, setNote] = useState(item.note || "");
  const [target, setTarget] = useState(item.target || "");
  const [shares, setShares] = useState(item.shares || "");
  const [avgCost, setAvgCost] = useState(item.avgCost || "");

  useEffect(() => { fetchQuote(item.symbol, item.market).then(setQuote); }, [item.symbol, item.market]);

  const price = quote?.price || item.price;
  const currency = quote?.currency || item.currency || (item.market === "TH" ? "THB" : "USD");
  const upside = item.target && price ? (((item.target - price) / price) * 100).toFixed(1) : null;
  const upsideUp = upside > 0;

  const saveEdit = () => {
    onUpdate(item.id, { note, target: target ? parseFloat(target) : null, shares: shares ? parseFloat(shares) : null, avgCost: avgCost ? parseFloat(avgCost) : null });
    setEditing(false);
  };

  return (
    <>
    <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "14px", padding: "1.1rem", transition: "border-color 0.2s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#30363d"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#21262d"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1rem", color: "#e6edf3" }}>{item.symbol}</span>
            <span style={{ background: item.market === "TH" ? "#1a3a2a" : "#1a2a3a", color: item.market === "TH" ? "#00d4aa" : "#58a6ff", padding: "1px 6px", borderRadius: "3px", fontSize: "0.65rem", fontWeight: 600 }}>{item.market}</span>
          </div>
          {quote?.name && <div style={{ color: "#8b949e", fontSize: "0.72rem", marginTop: "0.15rem" }}>{quote.name}</div>}
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <button onClick={() => onAnalyze(item)} style={{ background: "#00d4aa18", border: "1px solid #00d4aa44", color: "#00d4aa", borderRadius: "6px", padding: "4px 8px", fontSize: "0.7rem", cursor: "pointer", fontWeight: 600 }}>AI ✦</button>
          <button onClick={() => setShowNews(true)} style={{ background: "#58a6ff18", border: "1px solid #58a6ff44", color: "#58a6ff", borderRadius: "6px", padding: "4px 8px", fontSize: "0.7rem", cursor: "pointer", fontWeight: 600 }}>ข่าว</button>
          <button onClick={() => setEditing(!editing)} style={{ background: "transparent", border: "1px solid #30363d", color: "#8b949e", borderRadius: "6px", padding: "4px 8px", fontSize: "0.7rem", cursor: "pointer" }}>✏️</button>
          <button onClick={() => onRemove(item.id)} style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "0.9rem" }}>✕</button>
        </div>
      </div>
      <div style={{ marginTop: "0.6rem" }}>
        <span style={{ fontFamily: "monospace", fontSize: "1.15rem", color: "#e6edf3", fontWeight: 600 }}>{price ? price.toFixed(2) : "—"}</span>
        {" "}{quote && <PriceChange price={quote.price} prev={quote.prev} />}
      </div>
      {item.shares && item.avgCost && price && <PnL shares={item.shares} avgCost={item.avgCost} currentPrice={price} currency={currency} />}
      {item.target && (
        <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span style={{ color: "#8b949e", fontSize: "0.75rem" }}>เป้าหมาย: <span style={{ color: "#e6edf3", fontFamily: "monospace" }}>{item.target}</span></span>
          {upside && <span style={{ color: upsideUp ? "#00d4aa" : "#ff4d6d", fontSize: "0.75rem", fontWeight: 700 }}>{upsideUp ? "▲" : "▼"} {Math.abs(upside)}% {upsideUp ? "upside" : "downside"}</span>}
        </div>
      )}
      {item.note && !editing && <div style={{ marginTop: "0.5rem", color: "#8b949e", fontSize: "0.75rem", fontStyle: "italic", borderLeft: "2px solid #21262d", paddingLeft: "0.5rem" }}>{item.note}</div>}
      <div style={{ marginTop: "0.5rem", color: "#484f58", fontSize: "0.68rem" }}>เพิ่มเมื่อ {item.addedAt}</div>
      {editing && (
        <div style={{ marginTop: "0.75rem", borderTop: "1px solid #21262d", paddingTop: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <input value={shares} onChange={e => setShares(e.target.value)} placeholder="จำนวนหุ้น" type="number" style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "6px", padding: "6px 10px", fontSize: "0.82rem", boxSizing: "border-box" }} />
            <input value={avgCost} onChange={e => setAvgCost(e.target.value)} placeholder="ราคาที่ซื้อ" type="number" style={{ flex: 1, background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "6px", padding: "6px 10px", fontSize: "0.82rem", boxSizing: "border-box" }} />
          </div>
          <input value={target} onChange={e => setTarget(e.target.value)} placeholder="ราคาเป้าหมาย" type="number" style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "6px", padding: "6px 10px", fontSize: "0.82rem", marginBottom: "0.4rem", boxSizing: "border-box" }} />
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="โน้ต..." rows={2} style={{ width: "100%", background: "#161b22", border: "1px solid #30363d", color: "#e6edf3", borderRadius: "6px", padding: "6px 10px", fontSize: "0.82rem", resize: "none", marginBottom: "0.4rem", boxSizing: "border-box" }} />
          <button onClick={saveEdit} style={{ background: "#00d4aa", color: "#000", border: "none", borderRadius: "6px", padding: "5px 14px", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}>บันทึก</button>
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
    fetch(`/api/news?symbol=${stock.symbol}&name=${encodeURIComponent(stock.name || stock.symbol)}`)
      .then(r => r.json())
      .then(data => {
        setNews(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [stock]);

  const summarizeNews = async () => {
    if (!news.length) return;
    setSummarizing(true);
    const headlines = news.map(n => n.title).join("\n");
    const prompt = `สรุปข่าวหุ้น ${stock.symbol} จากหัวข้อข่าวเหล่านี้เป็นภาษาไทย:\n${headlines}\n\nสรุปประเด็นสำคัญ 2-3 ข้อ และบอกว่า sentiment โดยรวมเป็นบวกหรือลบ จบด้วย ซื้อ / ถือ / ขาย`;
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      setSummary(data.result || "");
    } catch {}
    setSummarizing(false);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
      <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: "16px", width: "100%", maxWidth: "600px", maxHeight: "90vh", overflow: "auto", boxShadow: "0 0 60px rgba(0,212,170,0.15)" }}>
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.1rem", color: "#e6edf3" }}>{stock.symbol}</span>
              <span style={{ color: "#8b949e", fontSize: "0.8rem" }}>ข่าวล่าสุด</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "1.3rem" }}>✕</button>
        </div>

        <div style={{ padding: "1.25rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#8b949e" }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⟳</div>
              <div style={{ fontSize: "0.85rem" }}>กำลังโหลดข่าว...</div>
            </div>
          ) : news.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#8b949e", fontSize: "0.85rem" }}>ไม่พบข่าวที่เกี่ยวข้อง</div>
          ) : (
            <>
              <div style={{ marginBottom: "1rem" }}>
                {news.map((item, i) => (
                  <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "0.75rem", marginBottom: "0.5rem", background: "#161b22", borderRadius: "8px", border: "1px solid #21262d", textDecoration: "none", transition: "border-color 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = "#30363d"}
                    onMouseLeave={e => e.currentTarget.style.borderColor = "#21262d"}>
                    <div style={{ color: "#e6edf3", fontSize: "0.85rem", lineHeight: 1.5, marginBottom: "0.35rem" }}>{item.title}</div>
                    <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                      {item.source && <span style={{ color: "#58a6ff", fontSize: "0.7rem" }}>{item.source}</span>}
                      {item.pubDate && <span style={{ color: "#484f58", fontSize: "0.7rem" }}>{formatDate(item.pubDate)}</span>}
                    </div>
                  </a>
                ))}
              </div>

              {!summary && (
                <button onClick={summarizeNews} disabled={summarizing} style={{ width: "100%", background: "#00d4aa18", border: "1px solid #00d4aa44", color: "#00d4aa", borderRadius: "8px", padding: "10px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}>
                  {summarizing ? "AI กำลังสรุปข่าว..." : "✦ ให้ AI สรุปข่าวทั้งหมด"}
                </button>
              )}

              {summary && (
                <div style={{ background: "#161b22", borderRadius: "10px", padding: "1rem", border: "1px solid #00d4aa33", marginTop: "0.5rem" }}>
                  <div style={{ fontSize: "0.72rem", color: "#00d4aa", marginBottom: "0.5rem", fontWeight: 600 }}>AI สรุปข่าว</div>
                  <div style={{ color: "#c9d1d9", fontSize: "0.88rem", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{summary}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {showNews && <NewsPanel stock={item} onClose={function() { setShowNews(false); }} />}
    </>
  );
}

function PortfolioSummary({ items }) {
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

  let totalCost = 0;
  let totalValue = 0;
  portfolioItems.forEach(item => {
    const price = quotes[item.id]?.price || item.price;
    if (price) {
      totalCost += item.avgCost * item.shares;
      totalValue += price * item.shares;
    }
  });

  const totalPnl = totalValue - totalCost;
  const totalPct = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(2) : 0;
  const up = totalPnl >= 0;

  return (
    <div style={{ background: "#0d1117", border: `1px solid ${up ? "#00d4aa33" : "#ff4d6d33"}`, borderRadius: "12px", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
      <div style={{ fontSize: "0.72rem", color: "#8b949e", marginBottom: "0.6rem" }}>สรุปพอร์ต ({portfolioItems.length} หุ้น)</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: "#8b949e" }}>ต้นทุนรวม</div>
          <div style={{ fontFamily: "monospace", color: "#e6edf3", fontWeight: 600 }}>{totalCost.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.7rem", color: "#8b949e" }}>มูลค่าปัจจุบัน</div>
          <div style={{ fontFamily: "monospace", color: "#e6edf3", fontWeight: 600 }}>{totalValue.toFixed(2)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.7rem", color: "#8b949e" }}>กำไร/ขาดทุนรวม</div>
          <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.15rem", color: up ? "#00d4aa" : "#ff4d6d" }}>
            {up ? "+" : ""}{totalPnl.toFixed(2)}
            <span style={{ fontSize: "0.8rem", marginLeft: "0.4rem" }}>({up ? "+" : ""}{totalPct}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { list, add, remove, update } = useWatchlist();
  const [showAdd, setShowAdd] = useState(false);
  const [analyzing, setAnalyzing] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const filtered = filter === "ALL" ? list : list.filter(i => i.market === filter);

  return (
    <div style={{ minHeight: "100vh", background: "#010409", fontFamily: "system-ui, sans-serif", color: "#e6edf3" }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } input::placeholder, textarea::placeholder { color: #484f58; }`}</style>
      <div style={{ borderBottom: "1px solid #21262d", padding: "1rem 1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, background: "#010409", zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.2rem" }}>◈</span>
          <span style={{ fontWeight: 700, fontSize: "1rem", color: "#e6edf3" }}>StockWatch</span>
          <span style={{ color: "#00d4aa", fontSize: "0.7rem", fontWeight: 600, background: "#00d4aa18", padding: "2px 7px", borderRadius: "20px", border: "1px solid #00d4aa33" }}>AI</span>
        </div>
        <button onClick={() => setShowAdd(true)} style={{ background: "#00d4aa", color: "#000", border: "none", borderRadius: "8px", padding: "7px 14px", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}>+ เพิ่มหุ้น</button>
      </div>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1.25rem 1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
          {["ALL", "TH", "US"].map(m => (
            <button key={m} onClick={() => setFilter(m)} style={{ padding: "6px 16px", borderRadius: "8px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", border: filter === m ? "1px solid #00d4aa" : "1px solid #21262d", background: filter === m ? "#00d4aa18" : "transparent", color: filter === m ? "#00d4aa" : "#8b949e" }}>
              {m === "ALL" ? "ทั้งหมด" : m === "TH" ? "🇹🇭 ไทย" : "🇺🇸 US"}
              <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", color: "#484f58" }}>{m === "ALL" ? list.length : list.filter(i => i.market === m).length}</span>
            </button>
          ))}
        </div>
        <PortfolioSummary items={filtered} />
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#484f58" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>◈</div>
            <div style={{ fontSize: "0.95rem", marginBottom: "0.35rem", color: "#8b949e" }}>Watchlist ว่างอยู่</div>
            <div style={{ fontSize: "0.8rem" }}>กด "+ เพิ่มหุ้น" เพื่อเริ่มติดตามหุ้นที่มี upside potential</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "0.85rem" }}>
          {filtered.map(item => <StockCard key={item.id} item={item} onRemove={remove} onAnalyze={setAnalyzing} onUpdate={update} />)}
        </div>
      </div>
      {showAdd && <AddStockModal onAdd={add} onClose={() => setShowAdd(false)} />}
      {analyzing && <AnalysisPanel stock={analyzing} onClose={() => setAnalyzing(null)} />}
    </div>
  );
}

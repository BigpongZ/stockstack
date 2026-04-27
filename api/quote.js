export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error(`Yahoo returned ${r.status}`);
    const data = await r.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No data");
    res.status(200).json({ symbol, price: meta.regularMarketPrice, prev: meta.chartPreviousClose, currency: meta.currency, name: meta.shortName || symbol });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

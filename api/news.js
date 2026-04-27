export default async function handler(req, res) {
  const { symbol, name } = req.query;
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });

  const query = encodeURIComponent(`${name || symbol} หุ้น`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=th&gl=TH&ceid=TH:th`;

  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await r.text();

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 5) {
      const item = match[1];
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || "";
      const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || "";
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || "";
      const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || "";
      if (title) items.push({ title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), link, pubDate, source });
    }

    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { prompt } = req.body;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "คุณเป็นนักวิเคราะห์หุ้นมืออาชีพที่เชี่ยวชาญตลาดหุ้นไทย (SET) และสหรัฐฯ ตอบเป็นภาษาไทยเสมอ วิเคราะห์กระชับ 3-4 ประโยค และจบด้วยคำแนะนำ ซื้อ / ถือ / ขาย พร้อมเหตุผลสั้นๆ" }] }
        }),
      }
    );
    const data = await r.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || data.error?.message || JSON.stringify(data);
    res.status(200).json({ result });
  } catch (err) {
    res.status(500).json({ result: "Error: " + err.message });
  }
}

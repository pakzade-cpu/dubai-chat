import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM = `You are Dubai, a general assistant. Answer the question asked, in the user's language.
If the question is about Dubai, the UAE, projects, government, aviation, records, or current events, say what you know and do not invent links, numbers, titles, or quotes.
Separate Dubai government from UAE federal government. Do not help with crime, hacking, visa fraud, document fraud, or scams. No personal investment advice.`;

app.post("/chat", async (req, res) => {
  const key = process.env.XAI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing XAI_API_KEY" });

  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
  const clean = messages.filter(
    (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
  );
  if (!clean.length) return res.status(400).json({ error: "No message" });

  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-3",
      messages: [{ role: "system", content: SYSTEM }, ...clean],
    }),
  });

  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: "Model request failed" });
  const text = data.choices?.[0]?.message?.content || "";
  res.json({ text });
});

app.listen(process.env.PORT || 3000);

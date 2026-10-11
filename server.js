import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM = `You are Dubai, a practical assistant for visitors and residents.
Answer the question first, in plain language, then give the useful detail.
If they name a service, explain what it does, who it is for, the usual public steps, and the official website. Do not refuse a general explanation.
You cannot log in, pay, book, or change an account. Mention that only if they ask you to do one of those things.
Do not invent fees, laws, dates, or phone numbers. If a rule changes often, say to confirm it on the official page.
Keep a short, direct tone. No lecture. No "as an AI" line.


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

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.error?.message || data.error || "Model request failed";
    return res.status(502).json({ error: String(detail) });
  }
  const text = data.choices?.[0]?.message?.content || "";
  res.json({ text });
});

app.listen(process.env.PORT || 3000);

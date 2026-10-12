import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SYSTEM, topics } from "./guides.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

const LANGS = new Set(["en", "ar", "hi", "ur", "ru", "zh", "fr", "tl"]);

app.get("/guides", (_req, res) => {
  res.json({ topics });
});

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join(" ")
    .trim();
}

function cleanContent(content, keepImage) {
  if (typeof content === "string") return content.slice(0, 4000);
  if (!Array.isArray(content)) return null;
  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text.slice(0, 4000) });
    } else if (
      keepImage &&
      part.type === "image_url" &&
      part.image_url &&
      typeof part.image_url.url === "string" &&
      /^data:image\/(jpeg|png);base64,/.test(part.image_url.url) &&
      part.image_url.url.length < 5_500_000
    ) {
      parts.push({
        type: "image_url",
        image_url: { url: part.image_url.url, detail: "high" },
      });
    }
  }
  if (!parts.length) return null;
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts;
}

function pickModel(hasImage) {
  const base = process.env.XAI_MODEL || "grok-3";
  if (!hasImage) return base;
  if (/vision|grok-4|grok-2/i.test(base) && !/grok-3$/i.test(base)) return base;
  return "grok-2-vision-1212";
}

app.post("/chat", async (req, res) => {
  const key = process.env.XAI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing XAI_API_KEY" });

  const lang = LANGS.has(req.body.language) ? req.body.language : "en";
  const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
  const lastImage = [...messages]
    .reverse()
    .findIndex((m) => m && m.role === "user" && Array.isArray(m.content) && m.content.some((p) => p && p.type === "image_url"));
  const keepAt = lastImage === -1 ? -1 : messages.length - 1 - lastImage;

  const clean = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    const content = cleanContent(m.content, m.role === "user" && i === keepAt);
    if (!content) continue;
    if (m.role === "assistant" && typeof content !== "string") continue;
    clean.push({ role: m.role, content });
  }
  if (!clean.some((m) => m.role === "user")) return res.status(400).json({ error: "No message" });
  const last = [...clean].reverse().find((m) => m.role === "user");
  if (last && Array.isArray(last.content) && !textOf(last.content)) {
    last.content.push({
      type: "text",
      text: "What is this, and what should I know about it in Dubai?",
    });
  }

  const hasImage = clean.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
  const system =
    SYSTEM +
    "\n\nReply in this language unless the user writes in a different one: " +
    lang +
    "." +
    (req.body.voice
      ? "\nThe user asked by voice. Keep the reply concise and easy to hear: short sentences, no long tables."
      : "");

  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: pickModel(hasImage),
      messages: [{ role: "system", content: system }, ...clean],
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

import crypto from "crypto";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SYSTEM, topics } from "./guides.js";
import { MAP_OFFLINE, readHere, resolveMaps, roundCoord, stripMapTags } from "./maps.js";
import { countryOf, sanitizeTopic, stripPii, csvCell } from "./privacy.js";
import {
  closeStore,
  exportQuestions,
  getStats,
  initStore,
  recordTopicClick,
  recordVisit,
  saveQuestion,
  setFeedback,
  storageKind,
} from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "8mb" }));

const LANGS = new Set(["en", "ar", "hi", "ur", "ru", "zh", "fr", "tl"]);
const buckets = new Map();

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

function rateOk(req, max = 60) {
  const ip = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim() || req.socket.remoteAddress || "x";
  const now = Date.now();
  if (buckets.size > 2000) {
    for (const [key, row] of buckets) {
      if (now - row.t > 60_000) buckets.delete(key);
    }
  }
  const row = buckets.get(ip);
  if (!row || now - row.t > 60_000) {
    buckets.set(ip, { t: now, n: 1 });
    return true;
  }
  if (row.n >= max) return false;
  row.n += 1;
  return true;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function adminPassword(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    return idx >= 0 ? decoded.slice(idx + 1) : decoded;
  }
  return String(req.headers["x-admin-password"] || "");
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return res.status(404).json({ error: "Admin is disabled" });
  if (!safeEqual(adminPassword(req), expected)) {
    return res.status(401).json({ error: "Password required" });
  }
  next();
}

async function replyWithLog(res, body, question, topic) {
  const id = crypto.randomUUID();
  try {
    await saveQuestion({
      id,
      question: stripPii(question || "[photo]").slice(0, 2000),
      topic: sanitizeTopic(topic),
      answer: stripPii(body.text || "").slice(0, 4000),
    });
  } catch (err) {
    console.error("question log failed:", err.message);
  }
  res.json({ ...body, id });
}

app.get("/guides", (_req, res) => {
  res.json({ topics });
});

app.get("/analytics-config.js", (_req, res) => {
  const goat = process.env.GOATCOUNTER_URL || "";
  const plausible = process.env.PLAUSIBLE_DOMAIN || "";
  const plausibleSrc = process.env.PLAUSIBLE_SRC || "https://plausible.io/js/script.js";
  res.set("Cache-Control", "no-store");
  res.type("js").send(`window.ANALYTICS_CONFIG=${JSON.stringify({ goat, plausible, plausibleSrc })};`);
});

app.post("/api/event", async (req, res) => {
  if (!rateOk(req, 80)) return res.status(429).json({ error: "Too many requests" });
  const type = req.body && req.body.type;
  try {
    if (type === "pageview") {
      await recordVisit(countryOf(req));
      return res.json({ ok: true });
    }
    if (type === "topic") {
      await recordTopicClick(sanitizeTopic(req.body.topic));
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown event" });
  } catch (err) {
    console.error("event failed:", err.message);
    return res.status(500).json({ error: "Could not record event" });
  }
});

app.post("/api/feedback", async (req, res) => {
  if (!rateOk(req, 40)) return res.status(429).json({ error: "Too many requests" });
  const id = typeof req.body?.id === "string" ? req.body.id : "";
  const vote = req.body?.vote;
  if (!/^[0-9a-f-]{36}$/i.test(id) || (vote !== "up" && vote !== "down")) {
    return res.status(400).json({ error: "Invalid feedback" });
  }
  try {
    const ok = await setFeedback(id, vote);
    if (!ok) return res.status(404).json({ error: "Unknown answer" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("feedback failed:", err.message);
    return res.status(500).json({ error: "Could not save feedback" });
  }
});

app.get("/admin", (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(404).send("Admin is disabled");
  res.sendFile(path.join(__dirname, "views", "admin.html"));
});

app.get("/admin/stats", requireAdmin, async (_req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    console.error("stats failed:", err.message);
    res.status(500).json({ error: "Could not load stats" });
  }
});

app.get("/admin/export.csv", requireAdmin, async (_req, res) => {
  try {
    const rows = await exportQuestions();
    const header = ["dubai_time", "topic", "question", "answer", "feedback"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(header.map((key) => csvCell(row[key])).join(","));
    }
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dubai-questions.csv"',
    });
    res.send("\uFEFF" + lines.join("\n"));
  } catch (err) {
    console.error("export failed:", err.message);
    res.status(500).json({ error: "Could not export" });
  }
});

app.post("/chat", async (req, res) => {
  const key = process.env.XAI_API_KEY;
  const lang = LANGS.has(req.body.language) ? req.body.language : "en";
  const here = readHere(req.body);
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
  const userText = last ? textOf(last.content) : "";
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
      : "") +
    (here
      ? "\nThe user shared their approximate current location: " +
        roundCoord(here.lat) +
        ", " +
        roundCoord(here.lng) +
        ". Use it only as a starting point for nearby places and directions. Do not read the numbers back."
      : "");

  async function withMaps(text) {
    const maps = await resolveMaps({ assistantText: text || "", userText, here });
    return { text: stripMapTags(text || ""), maps };
  }

  if (!key) {
    const fallback = await withMaps("");
    if (fallback.maps.length) {
      return replyWithLog(
        res,
        { text: MAP_OFFLINE[lang] || MAP_OFFLINE.en, maps: fallback.maps, offline: true },
        userText,
        req.body?.topic
      );
    }
    return res.status(500).json({ error: "Server is missing XAI_API_KEY" });
  }

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
    const fallback = await withMaps("");
    if (fallback.maps.length) {
      return replyWithLog(
        res,
        { text: MAP_OFFLINE[lang] || MAP_OFFLINE.en, maps: fallback.maps, offline: true },
        userText,
        req.body?.topic
      );
    }
    const detail = data.error?.message || data.error || "Model request failed";
    return res.status(502).json({ error: String(detail) });
  }
  const text = data.choices?.[0]?.message?.content || "";
  const out = await withMaps(text);
  await replyWithLog(res, out, userText, req.body?.topic);
});

app.use(express.static(path.join(__dirname, "public")));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export const ready = initStore();
export { app, closeStore, storageKind };

if (isMain) {
  ready
    .then((kind) => {
      const port = process.env.PORT || 3000;
      app.listen(port, () => {
        console.log(`Dubai guide on http://localhost:${port} (${kind} store)`);
      });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

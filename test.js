import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { csvCell, dubaiDay, dubaiStamp, sanitizeTopic, stripPii } from "./privacy.js";
import { SYSTEM } from "./guides.js";

test("stripPii removes emails and phone numbers", () => {
  assert.equal(stripPii("Ask jane.doe@example.com about visas"), "Ask [email] about visas");
  assert.equal(stripPii("Call +971 50 123 4567 please"), "Call [phone] please");
  assert.equal(stripPii("My number is 0501234567"), "My number is [phone]");
  assert.equal(stripPii("Plan a 4-day Dubai trip"), "Plan a 4-day Dubai trip");
});

test("sanitizeTopic only keeps short ids", () => {
  assert.equal(sanitizeTopic("visa"), "visa");
  assert.equal(sanitizeTopic("bot"), "bot");
  assert.equal(sanitizeTopic("not a topic"), "chat");
  assert.equal(sanitizeTopic(""), "chat");
});

test("dubai timestamps use Asia/Dubai", () => {
  const date = new Date("2026-10-12T20:00:00.000Z");
  assert.equal(dubaiDay(date), "2026-10-13");
  assert.match(dubaiStamp(date), /^2026-10-13 00:00:00 GST$/);
});

test("csvCell guards spreadsheet formulas", () => {
  assert.equal(csvCell("=cmd"), "'=cmd");
  assert.equal(csvCell("hello, world"), '"hello, world"');
});

const dir = await mkdtemp(path.join(os.tmpdir(), "dubai-"));
process.env.ADMIN_PASSWORD = "test-pass";
process.env.DATA_FILE = path.join(dir, "store.json");
process.env.XAI_API_KEY = "test-key";
delete process.env.DATABASE_URL;
delete process.env.GOATCOUNTER_URL;
delete process.env.PLAUSIBLE_DOMAIN;
process.env.DATABASE_SSL = "disable";

const origFetch = global.fetch;
global.fetch = async () => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: "Metro to Downtown is on the Red Line." } }] }),
});

const { app, ready, closeStore } = await import("./server.js");
await ready;
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function json(url, opts) {
  const r = await origFetch(url, opts);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, headers: r.headers };
}

test("public pages and analytics events", async () => {
  const home = await origFetch(base + "/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Dubai Bot/);
  assert.match(html, /x\.ai\/bot\/pNVDukpGRUUOx_wtyRhiV/);
  assert.match(html, /logged anonymously/);
  assert.match(html, /id="here-btn"/);
  assert.match(html, /id="voice-btn"/);
  assert.match(html, /id="tools-menu"/);
  assert.match(html, /emirates-mark\.png/);
  assert.match(html, /id="more-topics"/);
  assert.match(html, /Take your time/);
  assert.doesNotMatch(html, /Official websites/);
  assert.match(SYSTEM, /Which app or portal/);
  assert.match(SYSTEM, /App and payment troubles/);

  const page = await json(base + "/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-ipcountry": "AE" },
    body: JSON.stringify({ type: "pageview" }),
  });
  assert.equal(page.status, 200);

  const topic = await json(base + "/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "topic", topic: "visa" }),
  });
  assert.equal(topic.status, 200);

  const bot = await json(base + "/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "topic", topic: "bot" }),
  });
  assert.equal(bot.status, 200);
});

test("chat logs a sanitized question and returns an id", async () => {
  const r = await json(base + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: "en",
      topic: "transport",
      messages: [{ role: "user", content: "How do I get around Dubai? Email me at leak@example.com" }],
    }),
  });
  assert.equal(r.status, 200);
  assert.match(r.data.text, /Metro/);
  assert.match(r.data.id, /^[0-9a-f-]{36}$/i);
  assert.ok(Array.isArray(r.data.maps));

  const down = await json(base + "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: r.data.id, vote: "down" }),
  });
  assert.equal(down.status, 200);

  const up = await json(base + "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: r.data.id, vote: "up" }),
  });
  assert.equal(up.status, 200);
});

test("admin is password-protected and shows stats", async () => {
  const missing = await origFetch(base + "/admin/stats");
  assert.equal(missing.status, 401);

  const page = await origFetch(base + "/admin");
  assert.equal(page.status, 200);

  const stats = await json(base + "/admin/stats", {
    headers: { Authorization: "Bearer test-pass" },
  });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.storage, "json");
  assert.ok(stats.data.visitsPerDay.length >= 1);
  assert.equal(stats.data.countries[0].country, "AE");
  assert.ok(stats.data.topTopics.some((row) => row.topic === "visa"));
  assert.equal(stats.data.usage.bot, 1);
  assert.ok(stats.data.recent.some((row) => row.question.includes("[email]")));
  assert.ok(!JSON.stringify(stats.data.recent).includes("leak@example.com"));
  assert.equal(stats.data.feedback.up, 1);

  const csv = await origFetch(base + "/admin/export.csv", {
    headers: { Authorization: "Bearer test-pass" },
  });
  assert.equal(csv.status, 200);
  const text = await csv.text();
  assert.match(text, /dubai_time,topic,question,answer,feedback/);
  assert.match(text, /transport/);
  assert.match(text, /\[email\]/);
});

test("hosted analytics config is empty when env vars are unset", async () => {
  const r = await origFetch(base + "/analytics-config.js");
  const js = await r.text();
  assert.match(js, /"goat":""/);
  assert.match(js, /"plausible":""/);
});

test.after(async () => {
  global.fetch = origFetch;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await closeStore();
  await rm(dir, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import test from "node:test";
import { matchBusinesses, validateApplication } from "./directory.js";
import { csvCell, dubaiDay, dubaiStamp, sanitizeTopic, stripPii } from "./privacy.js";
import { buildTurn, publicBots, sanitizeSpeaker } from "./bots.js";
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
  assert.equal(sanitizeTopic("desk"), "desk");
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

test("directory validation rejects an incomplete application", () => {
  const bad = validateApplication({ companyName: "Only a name" });
  assert.equal(bad.ok, false);
  const rows = [
    {
      id: "1",
      companyName: "Marina Dental",
      category: "health",
      businessType: "Dental clinic",
      services: "Family dentistry",
      extra: "Saturday clinic",
      phone: "+971400000000",
      mobile: "+971500000000",
      whatsapp: "+971500000000",
      website: "https://example.com",
      location: "Dubai Marina",
      logo: "data:image/png;base64,iVBORw0KGgo=",
    },
  ];
  assert.equal(matchBusinesses(rows, "dentist in dubai marina")[0].companyName, "Marina Dental");
  assert.equal(matchBusinesses(rows, "what is the weather").length, 0);
});

test("business registration stays private until approved", async () => {
  const logo = "data:image/png;base64,iVBORw0KGgo=";
  const pdf = "data:application/pdf;base64,JVBERi0=";
  const application = {
    companyName: "Marina Dental",
    tradeLicenseNo: "DED-100",
    tradeLicenseFile: pdf,
    vatNo: "100234567800003",
    vatFile: pdf,
    phone: "+971 4 123 4567",
    mobile: "+971 50 123 4567",
    whatsapp: "+971501234567",
    website: "https://example.com",
    location: "Dubai Marina",
    logo,
    category: "health",
    businessType: "Dental clinic",
    services: "Family dentistry and cleaning",
    extra: "Open Saturday",
  };
  const created = await json(base + "/api/businesses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(application),
  });
  assert.equal(created.status, 201);
  assert.match(created.data.updateCode, /^[a-f0-9]{16}$/);
  assert.equal(created.data.status, "pending");

  const hidden = await json(base + "/api/businesses?q=dental");
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.businesses.length, 0);
  const raw = JSON.stringify(hidden.data);
  assert.equal(raw.includes("DED-100"), false);
  assert.equal(raw.includes("JVBERi0"), false);

  const admin = await json(base + "/admin/businesses", {
    headers: { Authorization: "Bearer test-pass" },
  });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.businesses[0].tradeLicenseNo, "DED-100");
  assert.equal(admin.data.businesses[0].hasLicenseFile, true);
  assert.equal(JSON.stringify(admin.data).includes("JVBERi0"), false);

  const approved = await json(base + "/admin/businesses/" + created.data.id + "/status", {
    method: "POST",
    headers: { Authorization: "Bearer test-pass", "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  assert.equal(approved.status, 200);

  const listed = await json(base + "/api/businesses?q=dentist");
  assert.equal(listed.data.businesses[0].companyName, "Marina Dental");
  assert.equal(listed.data.businesses[0].tradeLicenseNo, undefined);

  const chat = await json(base + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: "en",
      messages: [{ role: "user", content: "I need a dentist in Dubai Marina" }],
    }),
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.data.businesses[0].companyName, "Marina Dental");
  assert.equal(JSON.stringify(chat.data.businesses).includes("DED-100"), false);

  const home = await origFetch(base + "/directory");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Find a business in Dubai/);
  const guide = await origFetch(base + "/");
  assert.match(await guide.text(), /id="dock"/);
});

test("bot desk lists the four bots and takes a turn", async () => {
  assert.equal(publicBots().length, 4);
  assert.equal(sanitizeSpeaker("uae-directory-bot"), "uae-directory-bot");
  assert.equal(sanitizeSpeaker("dubai-bot"), "dubai-bot");
  assert.equal(sanitizeSpeaker("nope"), "");
  const emptyReply = buildTurn({ speaker: "dubai-bot", messages: [], mode: "reply" });
  assert.equal(emptyReply.ok, false);
  const talk = buildTurn({
    speaker: "abu-dhabi-bot",
    mode: "talk",
    messages: [{ speaker: "dubai-agent", text: "I will cover DXB arrival." }],
  });
  assert.equal(talk.ok, true);
  assert.equal(talk.bot.id, "abu-dhabi-bot");
  assert.match(talk.payload[1].content, /Dubai AI Agent/);

  const listed = await json(base + "/api/bots");
  assert.equal(listed.status, 200);
  assert.equal(listed.data.bots.length, 4);
  assert.equal(listed.data.bots[0].name, "Dubai AI Agent");
  assert.equal(listed.data.bots[3].name, "UAE Directory Bot");
  assert.equal(listed.data.bots[3].href, "https://x.ai/bot/x6_fe5ztdhaHfDPUdeuvb");
  assert.equal(JSON.stringify(listed.data).includes("system"), false);

  const desk = await origFetch(base + "/desk");
  assert.equal(desk.status, 200);
  const deskHtml = await desk.text();
  assert.match(deskHtml, /Let them talk/);
  assert.match(deskHtml, /Won't reply/);
  assert.match(deskHtml, /Bot desk/);

  const turn = await json(base + "/bots/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speaker: "dubai-bot",
      mode: "talk",
      messages: [{ speaker: "user", text: "Compare Dubai and Abu Dhabi for a first visit." }],
    }),
  });
  assert.equal(turn.status, 200);
  assert.equal(turn.data.speaker, "dubai-bot");
  assert.match(turn.data.text, /Metro/);
  assert.match(turn.data.id, /^[0-9a-f-]{36}$/i);

  const bad = await json(base + "/bots/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaker: "unknown", mode: "talk", messages: [] }),
  });
  assert.equal(bad.status, 400);
});

test("araslab home shows the agent and both bots", async () => {
  const home = await origFetch(base + "/", { headers: { "x-forwarded-host": "www.araslab.ae" } });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Aras Lab/);
  assert.match(html, /ARAS-LAB-wordmark\.mp4/);
  assert.match(html, /Dubai AI Agent/);
  assert.match(html, /www\.dubaiaiagent\.ae\/directory/);
  assert.match(html, /www\.dubaiaiagent\.ae\/join/);
  assert.match(html, /Dubai Bot/);
  assert.match(html, /Abu Dhabi Bot/);
  assert.match(html, /Final Path/);
  assert.match(html, /Stocks market/);
  assert.match(html, /github\.com\/pakzade-cpu\/final-path/);
  assert.match(html, /x\.ai\/bot\/pNVDukpGRUUOx_wtyRhiV/);
  assert.match(html, /x\.ai\/bot\/uDcN3ZKoXAGUqcHC-7haq/);
  assert.match(html, /UAE Directory Bot/);
  assert.match(html, /x\.ai\/bot\/x6_fe5ztdhaHfDPUdeuvb/);
  assert.match(html, /Bot desk/);
  assert.match(html, /href="\/desk"/);

  const agentHost = await origFetch(base + "/", { headers: { "x-forwarded-host": "www.dubaiaiagent.ae" } });
  const agentHtml = await agentHost.text();
  assert.match(agentHtml, /Dubai AI Agent/);
  assert.match(agentHtml, /id="dock"/);
  assert.doesNotMatch(agentHtml, /<h1>Aras Lab<\/h1>/);

  const moved = await origFetch(base + "/directory", {
    headers: { "x-forwarded-host": "www.araslab.ae" },
    redirect: "manual",
  });
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get("location"), "https://www.dubaiaiagent.ae/directory");

  const guide = await origFetch(base + "/agent");
  assert.equal(guide.status, 200);
  assert.match(await guide.text(), /id="dock"/);

  const local = await origFetch(base + "/");
  assert.match(await local.text(), /Ask about Dubai/);
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

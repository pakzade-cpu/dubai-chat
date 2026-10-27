import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { dubaiDay, dubaiStamp } from "./privacy.js";

const MAX_VISITS = 10000;
const MAX_CLICKS = 8000;
const MAX_QUESTIONS = 5000;

let backend = "json";
let pool = null;
let filePath = "";
let state = emptyState();
let chain = Promise.resolve();

function emptyState() {
  return { visits: [], clicks: [], questions: [], businesses: [], touches: [] };
}

function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function newId() {
  return crypto.randomUUID();
}

export function storageKind() {
  return backend;
}

export async function initStore() {
  if (process.env.DATABASE_URL) {
    try {
      const pg = await import("pg");
      const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === "disable" || local ? false : { rejectUnauthorized: false },
        max: 4,
      });
      await pool.query(`
        CREATE TABLE IF NOT EXISTS visits (
          id TEXT PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          day TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT 'unknown'
        );
        CREATE INDEX IF NOT EXISTS visits_day_idx ON visits (day);
        CREATE TABLE IF NOT EXISTS topic_clicks (
          id TEXT PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          day TEXT NOT NULL,
          topic TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS topic_clicks_topic_idx ON topic_clicks (topic);
        CREATE TABLE IF NOT EXISTS questions (
          id TEXT PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          day TEXT NOT NULL,
          dubai_time TEXT NOT NULL,
          topic TEXT NOT NULL DEFAULT 'chat',
          question TEXT NOT NULL,
          answer TEXT,
          feedback TEXT
        );
        CREATE INDEX IF NOT EXISTS questions_ts_idx ON questions (ts DESC);
        CREATE INDEX IF NOT EXISTS questions_feedback_idx ON questions (feedback);
        CREATE TABLE IF NOT EXISTS businesses (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          status TEXT NOT NULL DEFAULT 'pending',
          code_hash TEXT NOT NULL,
          company_name TEXT NOT NULL,
          trade_license_no TEXT NOT NULL,
          trade_license_file TEXT NOT NULL,
          vat_no TEXT NOT NULL,
          vat_file TEXT NOT NULL,
          phone TEXT NOT NULL,
          mobile TEXT NOT NULL,
          whatsapp TEXT NOT NULL,
          website TEXT NOT NULL,
          location TEXT NOT NULL,
          logo TEXT NOT NULL,
          category TEXT NOT NULL,
          business_type TEXT NOT NULL,
          services TEXT NOT NULL,
          extra TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS businesses_status_idx ON businesses (status);
        CREATE INDEX IF NOT EXISTS businesses_category_idx ON businesses (category);
        CREATE TABLE IF NOT EXISTS directory_touches (
          id TEXT PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          day TEXT NOT NULL,
          dubai_time TEXT NOT NULL,
          business_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT 'unknown'
        );
        CREATE INDEX IF NOT EXISTS directory_touches_business_idx ON directory_touches (business_id, ts DESC);
      `);
      backend = "postgres";
      return backend;
    } catch (err) {
      console.error("Postgres unavailable, using JSON file:", err.message);
      pool = null;
    }
  }
  backend = "json";
  filePath = process.env.DATA_FILE || path.join(process.cwd(), "data", "store.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      visits: Array.isArray(parsed.visits) ? parsed.visits : [],
      clicks: Array.isArray(parsed.clicks) ? parsed.clicks : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      businesses: Array.isArray(parsed.businesses) ? parsed.businesses : [],
      touches: Array.isArray(parsed.touches) ? parsed.touches : [],
    };
  } catch {
    state = emptyState();
    await persistJson();
  }
  return backend;
}

async function persistJson() {
  if (!filePath) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, filePath);
}

export async function recordVisit(country = "unknown") {
  const row = { id: newId(), ts: new Date().toISOString(), day: dubaiDay(), country };
  if (backend === "postgres") {
    await pool.query(
      "INSERT INTO visits (id, ts, day, country) VALUES ($1, $2, $3, $4)",
      [row.id, row.ts, row.day, row.country]
    );
    return;
  }
  await withLock(async () => {
    state.visits.push(row);
    if (state.visits.length > MAX_VISITS) state.visits = state.visits.slice(-MAX_VISITS);
    await persistJson();
  });
}

export async function recordTopicClick(topic) {
  const row = { id: newId(), ts: new Date().toISOString(), day: dubaiDay(), topic };
  if (backend === "postgres") {
    await pool.query(
      "INSERT INTO topic_clicks (id, ts, day, topic) VALUES ($1, $2, $3, $4)",
      [row.id, row.ts, row.day, row.topic]
    );
    return;
  }
  await withLock(async () => {
    state.clicks.push(row);
    if (state.clicks.length > MAX_CLICKS) state.clicks = state.clicks.slice(-MAX_CLICKS);
    await persistJson();
  });
}

export async function saveQuestion({ id, question, topic, answer }) {
  const now = new Date();
  const row = {
    id: id || newId(),
    ts: now.toISOString(),
    day: dubaiDay(now),
    dubai_time: dubaiStamp(now),
    topic: topic || "chat",
    question,
    answer: answer || "",
    feedback: null,
  };
  if (backend === "postgres") {
    await pool.query(
      `INSERT INTO questions (id, ts, day, dubai_time, topic, question, answer, feedback)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.id, row.ts, row.day, row.dubai_time, row.topic, row.question, row.answer, row.feedback]
    );
    return row.id;
  }
  await withLock(async () => {
    state.questions.push(row);
    if (state.questions.length > MAX_QUESTIONS) state.questions = state.questions.slice(-MAX_QUESTIONS);
    await persistJson();
  });
  return row.id;
}

export async function setFeedback(id, vote) {
  if (vote !== "up" && vote !== "down") return false;
  if (backend === "postgres") {
    const result = await pool.query("UPDATE questions SET feedback = $1 WHERE id = $2", [vote, id]);
    return result.rowCount > 0;
  }
  return withLock(async () => {
    const row = state.questions.find((q) => q.id === id);
    if (!row) return false;
    row.feedback = vote;
    await persistJson();
    return true;
  });
}

function countBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key] || "unknown";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ [key]: name, count }))
    .sort((a, b) => b.count - a.count || String(a[key]).localeCompare(String(b[key])));
}

function shapeQuestion(row) {
  return {
    id: row.id,
    day: row.day,
    dubai_time: row.dubai_time,
    topic: row.topic,
    question: row.question,
    answer: row.answer || "",
    feedback: row.feedback || "",
  };
}

export async function getStats() {
  if (backend === "postgres") {
    const [visits, countries, topics, feedback, recent, downvoted] = await Promise.all([
      pool.query("SELECT day, COUNT(*)::int AS count FROM visits GROUP BY day ORDER BY day DESC LIMIT 60"),
      pool.query("SELECT country, COUNT(*)::int AS count FROM visits GROUP BY country ORDER BY count DESC, country ASC"),
      pool.query("SELECT topic, COUNT(*)::int AS count FROM topic_clicks GROUP BY topic ORDER BY count DESC, topic ASC"),
      pool.query("SELECT feedback, COUNT(*)::int AS count FROM questions GROUP BY feedback"),
      pool.query("SELECT id, day, dubai_time, topic, question, answer, feedback FROM questions ORDER BY ts DESC LIMIT 80"),
      pool.query("SELECT id, day, dubai_time, topic, question, answer, feedback FROM questions WHERE feedback = 'down' ORDER BY ts DESC LIMIT 80"),
    ]);
    return assemble(visits.rows, countries.rows, topics.rows, feedback.rows, recent.rows, downvoted.rows);
  }
  return assemble(
    countBy(state.visits, "day").sort((a, b) => String(b.day).localeCompare(String(a.day))),
    countBy(state.visits, "country"),
    countBy(state.clicks, "topic"),
    countBy(state.questions, "feedback").map((row) => ({ feedback: row.feedback, count: row.count })),
    [...state.questions].reverse().slice(0, 80).map(shapeQuestion),
    [...state.questions].filter((q) => q.feedback === "down").reverse().slice(0, 80).map(shapeQuestion)
  );
}

function assemble(visitsPerDay, countries, topTopics, feedbackRows, recent, downvoted) {
  const feedback = { up: 0, down: 0, none: 0 };
  for (const row of feedbackRows) {
    if (row.feedback === "up") feedback.up = row.count;
    else if (row.feedback === "down") feedback.down = row.count;
    else feedback.none += row.count;
  }
  const voted = feedback.up + feedback.down;
  const ratio = voted ? Math.round((feedback.up / voted) * 100) : null;
  const usage = Object.fromEntries(
    ["bot", "desk", "voice", "photo", "map"].map((topic) => [
      topic,
      (topTopics.find((row) => row.topic === topic) || { count: 0 }).count || 0,
    ])
  );
  return {
    storage: backend,
    visitsPerDay,
    countries,
    topTopics,
    usage,
    feedback: { ...feedback, voted, ratio },
    recent: recent.map(shapeQuestion),
    downvoted: downvoted.map(shapeQuestion),
  };
}

export async function exportQuestions() {
  if (backend === "postgres") {
    const result = await pool.query(
      "SELECT dubai_time, topic, question, answer, feedback FROM questions ORDER BY ts DESC"
    );
    return result.rows;
  }
  return [...state.questions].reverse().map((row) => ({
    dubai_time: row.dubai_time,
    topic: row.topic,
    question: row.question,
    answer: row.answer || "",
    feedback: row.feedback || "",
  }));
}

function businessFromDb(row) {
  return {
    id: row.id,
    status: row.status,
    codeHash: row.code_hash,
    companyName: row.company_name,
    tradeLicenseNo: row.trade_license_no,
    tradeLicenseFile: row.trade_license_file,
    vatNo: row.vat_no,
    vatFile: row.vat_file,
    phone: row.phone,
    mobile: row.mobile,
    whatsapp: row.whatsapp,
    website: row.website,
    location: row.location,
    logo: row.logo,
    category: row.category,
    businessType: row.business_type,
    services: row.services,
    extra: row.extra,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BUSINESS_PUBLIC_SQL = `id, status, company_name, trade_license_no, vat_no, phone, mobile, whatsapp,
  website, location, logo, category, business_type, services, extra, created_at, updated_at`;

export async function createBusiness(fields) {
  const now = new Date().toISOString();
  const row = {
    id: newId(),
    status: "pending",
    codeHash: fields.codeHash,
    companyName: fields.companyName,
    tradeLicenseNo: fields.tradeLicenseNo,
    tradeLicenseFile: fields.tradeLicenseFile,
    vatNo: fields.vatNo,
    vatFile: fields.vatFile,
    phone: fields.phone,
    mobile: fields.mobile,
    whatsapp: fields.whatsapp,
    website: fields.website,
    location: fields.location,
    logo: fields.logo,
    category: fields.category,
    businessType: fields.businessType,
    services: fields.services,
    extra: fields.extra,
    createdAt: now,
    updatedAt: now,
  };
  if (backend === "postgres") {
    await pool.query(
      `INSERT INTO businesses (
        id, created_at, updated_at, status, code_hash, company_name, trade_license_no, trade_license_file,
        vat_no, vat_file, phone, mobile, whatsapp, website, location, logo, category, business_type, services, extra
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        row.id, row.createdAt, row.updatedAt, row.status, row.codeHash, row.companyName, row.tradeLicenseNo,
        row.tradeLicenseFile, row.vatNo, row.vatFile, row.phone, row.mobile, row.whatsapp, row.website,
        row.location, row.logo, row.category, row.businessType, row.services, row.extra,
      ]
    );
    return { id: row.id, status: row.status };
  }
  await withLock(async () => {
    state.businesses.push(row);
    if (state.businesses.length > 5000) state.businesses = state.businesses.slice(-5000);
    await persistJson();
  });
  return { id: row.id, status: row.status };
}

export async function getBusiness(id) {
  if (backend === "postgres") {
    const result = await pool.query("SELECT * FROM businesses WHERE id = $1", [id]);
    return result.rows[0] ? businessFromDb(result.rows[0]) : null;
  }
  return state.businesses.find((row) => row.id === id) || null;
}

export async function findBusinessByCode(codeHash) {
  if (backend === "postgres") {
    const result = await pool.query("SELECT * FROM businesses WHERE code_hash = $1", [codeHash]);
    return result.rows[0] ? businessFromDb(result.rows[0]) : null;
  }
  return state.businesses.find((row) => row.codeHash === codeHash) || null;
}

export async function updateBusiness(id, fields) {
  const now = new Date().toISOString();
  if (backend === "postgres") {
    const result = await pool.query(
      `UPDATE businesses SET
        updated_at = $2, status = 'pending', company_name = $3, trade_license_no = $4, trade_license_file = $5,
        vat_no = $6, vat_file = $7, phone = $8, mobile = $9, whatsapp = $10, website = $11, location = $12,
        logo = $13, category = $14, business_type = $15, services = $16, extra = $17
       WHERE id = $1`,
      [
        id, now, fields.companyName, fields.tradeLicenseNo, fields.tradeLicenseFile, fields.vatNo, fields.vatFile,
        fields.phone, fields.mobile, fields.whatsapp, fields.website, fields.location, fields.logo,
        fields.category, fields.businessType, fields.services, fields.extra,
      ]
    );
    return result.rowCount > 0;
  }
  return withLock(async () => {
    const row = state.businesses.find((item) => item.id === id);
    if (!row) return false;
    Object.assign(row, fields, { status: "pending", updatedAt: now });
    await persistJson();
    return true;
  });
}

export async function setBusinessStatus(id, status) {
  if (backend === "postgres") {
    const result = await pool.query(
      "UPDATE businesses SET status = $2, updated_at = NOW() WHERE id = $1",
      [id, status]
    );
    return result.rowCount > 0;
  }
  return withLock(async () => {
    const row = state.businesses.find((item) => item.id === id);
    if (!row) return false;
    row.status = status;
    row.updatedAt = new Date().toISOString();
    await persistJson();
    return true;
  });
}

export async function listBusinesses(status) {
  if (backend === "postgres") {
    const result = status
      ? await pool.query(
          `SELECT ${BUSINESS_PUBLIC_SQL}, (trade_license_file <> '') AS has_license, (vat_file <> '') AS has_vat
           FROM businesses WHERE status = $1 ORDER BY created_at DESC LIMIT 500`,
          [status]
        )
      : await pool.query(
          `SELECT ${BUSINESS_PUBLIC_SQL}, (trade_license_file <> '') AS has_license, (vat_file <> '') AS has_vat
           FROM businesses ORDER BY created_at DESC LIMIT 500`
        );
    return result.rows.map((row) => ({
      ...businessFromDb(row),
      tradeLicenseFile: row.has_license ? "yes" : "",
      vatFile: row.has_vat ? "yes" : "",
      codeHash: "",
    }));
  }
  const rows = status ? state.businesses.filter((row) => row.status === status) : state.businesses;
  return [...rows].reverse().slice(0, 500).map((row) => ({
    ...row,
    tradeLicenseFile: row.tradeLicenseFile ? "yes" : "",
    vatFile: row.vatFile ? "yes" : "",
    logo: row.logo,
    codeHash: "",
  }));
}

const MAX_TOUCHES = 20000;

function touchFromDb(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    kind: row.kind,
    day: row.day,
    dubaiTime: row.dubai_time,
    country: row.country || "unknown",
    ts: row.ts,
  };
}

export async function recordTouch({ businessId, kind, country }) {
  const row = {
    id: newId(),
    ts: new Date().toISOString(),
    day: dubaiDay(),
    dubaiTime: dubaiStamp(),
    businessId,
    kind,
    country: String(country || "unknown").slice(0, 40) || "unknown",
  };
  if (backend === "postgres") {
    await pool.query(
      `INSERT INTO directory_touches (id, ts, day, dubai_time, business_id, kind, country)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, row.ts, row.day, row.dubaiTime, row.businessId, row.kind, row.country]
    );
    return row;
  }
  await withLock(async () => {
    state.touches.push(row);
    if (state.touches.length > MAX_TOUCHES) state.touches = state.touches.slice(-MAX_TOUCHES);
    await persistJson();
  });
  return row;
}

export async function listTouches(businessId) {
  if (backend === "postgres") {
    const result = businessId
      ? await pool.query(
          "SELECT * FROM directory_touches WHERE business_id = $1 ORDER BY ts DESC LIMIT 5000",
          [businessId]
        )
      : await pool.query("SELECT * FROM directory_touches ORDER BY ts DESC LIMIT 20000");
    return result.rows.map(touchFromDb);
  }
  const rows = businessId ? state.touches.filter((row) => row.businessId === businessId) : state.touches;
  return [...rows].reverse();
}

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

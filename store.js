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
  return { visits: [], clicks: [], questions: [] };
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
  return {
    storage: backend,
    visitsPerDay,
    countries,
    topTopics,
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

export async function closeStore() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

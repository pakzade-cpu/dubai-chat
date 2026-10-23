const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const INTL_PHONE = /(?<!\w)(?:\+|00)(?:[\s()-]*\d){8,15}\b/g;
const LOCAL_PHONE = /(?<!\w)0\d(?:[\s()-]*\d){7,12}\b/g;
const NANP_PHONE = /(?<!\w)\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const TOPIC = /^[a-z0-9-]{1,40}$/;

export const TOPIC_IDS = new Set([
  "itinerary",
  "visa",
  "events",
  "cost",
  "business",
  "prayer",
  "property",
  "schools",
  "health",
  "transport",
  "safety",
  "airport",
  "chat",
  "official",
  "bot",
  "desk",
  "voice",
  "photo",
  "map",
]);

export function stripPii(input) {
  let s = String(input || "");
  s = s.replace(EMAIL, "[email]");
  s = s.replace(INTL_PHONE, "[phone]");
  s = s.replace(LOCAL_PHONE, "[phone]");
  s = s.replace(NANP_PHONE, "[phone]");
  return s.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

export function sanitizeTopic(value) {
  const topic = String(value || "").toLowerCase().trim();
  if (TOPIC_IDS.has(topic)) return topic;
  if (TOPIC.test(topic)) return topic;
  return "chat";
}

export function dubaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dubaiStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const g = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")} GST`;
}

export function countryOf(req) {
  const headers = [
    "cf-ipcountry",
    "x-vercel-ip-country",
    "cloudfront-viewer-country",
    "x-country-code",
    "x-appengine-country",
    "x-geo-country",
  ];
  for (const name of headers) {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && /^[A-Z]{2}$/i.test(value.trim()) && value.trim().toUpperCase() !== "XX") {
      return value.trim().toUpperCase();
    }
  }
  return "unknown";
}

export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

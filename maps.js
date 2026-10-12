const TAG = /\[\[\[map:\s*([^\]]+?)\]\]\]/gi;

const cache = new Map();
let lastNet = 0;

export const MAP_OFFLINE = {
  en: "Here is that place on the map.",
  ar: "هذا الموقع على الخريطة.",
  hi: "यह जगह मैप पर है।",
  ur: "یہ جگہ نقشے پر ہے۔",
  ru: "Это место на карте.",
  zh: "地图上就是这个地点。",
  fr: "Voici cet endroit sur la carte.",
  tl: "Narito ang lugar sa mapa.",
};

export function cleanQuery(raw) {
  let s = String(raw || "")
    .replace(/["“”'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.?!،,;:]+$/g, "")
    .trim();
  if (s.length < 2 || s.length > 120) return "";
  if (/https?:|javascript:|data:|<|>|[\u0000-\u001f]/i.test(s)) return "";
  return s;
}

export function parseMapTags(text) {
  const out = [];
  const seen = new Set();
  const re = new RegExp(TAG.source, "gi");
  let m;
  while ((m = re.exec(String(text || "")))) {
    const query = cleanQuery(m[1]);
    const key = query.toLowerCase();
    if (!query || seen.has(key)) continue;
    seen.add(key);
    out.push(query);
    if (out.length >= 3) break;
  }
  return out;
}

export function stripMapTags(text) {
  return String(text || "")
    .replace(TAG, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function looksLikeLocationQuestion(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return /where(?:'s|’s| is| are)|where to find|how (?:do i |can i |to )?get to|directions? to|on the map|location of|map of|nearest |how far is|أين|وين |موقع |خريطة|कहाँ|कहां|کہاں|где |как добраться|où (?:est|sont)|comment (?:y )?aller|saan |nasaan |malapit /i.test(
    s
  );
}

export function placeFromQuestion(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:where(?:'s|’s| is)|where are|how (?:do i |can i |to )?get to|directions? to|location of|map of|how far is(?: it from here to)?)\s+(.+?)(?:\?|$)/i,
    /(?:أين|وين)\s+(.+?)(?:\?|؟|$)/,
    /(?:où (?:est|sont))\s+(.+?)(?:\?|$)/i,
    /(?:где)\s+(.+?)(?:\?|$)/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (!m) continue;
    const place = cleanQuery(
      m[1]
        .replace(/\b(?:in dubai|dubai,?\s*uae|the uae|uae)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (place) return place;
  }
  return "";
}

export function readHere(body) {
  const here = body && body.here;
  if (!here || typeof here !== "object") return null;
  const lat = Number(here.lat);
  const lng = Number(here.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function roundCoord(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

export function osmEmbed(lat, lng) {
  lat = roundCoord(lat);
  lng = roundCoord(lng);
  const d = 0.02;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map(roundCoord).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function mapCard(pin, origin) {
  const lat = roundCoord(pin.lat);
  const lng = roundCoord(pin.lng);
  const label = String(pin.name || pin.query || "Dubai").slice(0, 80);
  const q = encodeURIComponent(pin.query || pin.name || "Dubai, UAE");
  const card = {
    name: label,
    query: String(pin.query || pin.name || "").slice(0, 120),
    lat,
    lng,
    embed: osmEmbed(lat, lng),
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    apple: `https://maps.apple.com/?q=${q}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`,
  };
  if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    card.directions = `https://www.google.com/maps/dir/?api=1&origin=${roundCoord(origin.lat)},${roundCoord(origin.lng)}&destination=${q}`;
  }
  return card;
}

async function nominatim(query, fetchImpl) {
  const q = /dubai|uae|\bdxb\b|\bdwc\b|abu dhabi|sharjah|ajman|ras al|fujairah|umm al/i.test(query)
    ? query
    : `${query}, Dubai, UAE`;
  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      q,
      format: "jsonv2",
      limit: "1",
      countrycodes: "ae",
    });
  const wait = 1100 - (Date.now() - lastNet);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNet = Date.now();
  const r = await fetchImpl(url, {
    headers: {
      "User-Agent": "DubaiGuide/1.0 (https://www.araslab.ae; maps for public location answers)",
      Accept: "application/json",
    },
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  const hit = Array.isArray(data) && data[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name: query, query: q, lat, lng };
}

export async function geocode(query, fetchImpl = fetch) {
  const cleaned = cleanQuery(query);
  if (!cleaned) return null;
  const key = cleaned.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const pin = await nominatim(cleaned, fetchImpl);
  cache.set(key, pin);
  return pin;
}

export async function resolveMaps({ assistantText, userText, here, geocodeFn = geocode }) {
  let queries = parseMapTags(assistantText);
  if (!queries.length && looksLikeLocationQuestion(userText)) {
    const place = placeFromQuestion(userText);
    if (place) queries = [place];
  }
  const maps = [];
  const seen = new Set();
  for (const query of queries.slice(0, 3)) {
    const pin = await geocodeFn(query);
    if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue;
    const id = `${roundCoord(pin.lat)},${roundCoord(pin.lng)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    maps.push(mapCard(pin, here || null));
  }
  return maps;
}

export async function selfCheck() {
  const tags = parseMapTags("Hello\n[[[map: Burj Khalifa, Downtown Dubai]]]\n[[[map: Burj Khalifa, Downtown Dubai]]]");
  if (tags.length !== 1 || !tags[0].includes("Burj")) throw new Error("parse tags");
  if (stripMapTags("Hi [[[map: Dubai Mall]]] there").replace(/\s+/g, " ") !== "Hi there") {
    throw new Error("strip tags");
  }
  if (!looksLikeLocationQuestion("Where is Dubai Mall?")) throw new Error("detect where");
  if (looksLikeLocationQuestion("Do I need a visa for Dubai?")) throw new Error("visa is not a map question");
  if (placeFromQuestion("Where is Dubai Mall?") !== "Dubai Mall") throw new Error("extract place");
  if (placeFromQuestion("How do I get to DXB?") !== "DXB") throw new Error("extract dxb");
  if (cleanQuery("http://evil") || cleanQuery("<script>")) throw new Error("reject bad query");
  if (readHere({ here: { lat: 25.2, lng: 55.27 } }).lat !== 25.2) throw new Error("read here");
  if (readHere({ here: { lat: 200, lng: 0 } })) throw new Error("reject bad here");
  const card = mapCard({ name: "Dubai Mall", query: "Dubai Mall, Dubai", lat: 25.1972, lng: 55.2796 }, { lat: 25.08, lng: 55.14 });
  if (!card.embed.startsWith("https://www.openstreetmap.org/export/embed.html?")) throw new Error("embed");
  if (!card.google.startsWith("https://www.google.com/maps/search/")) throw new Error("google");
  if (!card.directions.includes("origin=25.08")) throw new Error("directions");
  const maps = await resolveMaps({
    assistantText: "It is in Downtown. [[[map: Dubai Mall]]]",
    userText: "hello",
    geocodeFn: async () => ({ name: "Dubai Mall", query: "Dubai Mall, Dubai", lat: 25.1972, lng: 55.2796 }),
  });
  if (maps.length !== 1 || maps[0].name !== "Dubai Mall") throw new Error("resolve maps");
}

import { fileURLToPath } from "url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await selfCheck();
}

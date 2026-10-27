import crypto from "crypto";

export const CATEGORIES = [
  { id: "food", name: "Food and cafes" },
  { id: "stay", name: "Hotels and stays" },
  { id: "retail", name: "Retail and shopping" },
  { id: "health", name: "Health and clinics" },
  { id: "beauty", name: "Beauty and wellness" },
  { id: "education", name: "Education" },
  { id: "property", name: "Real estate" },
  { id: "professional", name: "Professional services" },
  { id: "construction", name: "Construction and fit-out" },
  { id: "transport", name: "Transport and logistics" },
  { id: "tourism", name: "Tourism and activities" },
  { id: "technology", name: "Technology" },
  { id: "home", name: "Home services" },
  { id: "auto", name: "Automotive" },
  { id: "other", name: "Other" },
];

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const STOP = new Set([
  "the", "and", "for", "with", "from", "this", "that", "what", "how", "where", "when",
  "dubai", "uae", "about", "your", "have", "does", "can", "you", "please", "want",
  "need", "near", "into", "are", "any", "who", "which", "find", "show", "tell",
]);

const LIMITS = {
  companyName: 120,
  tradeLicenseNo: 40,
  vatNo: 40,
  phone: 30,
  mobile: 30,
  whatsapp: 30,
  website: 200,
  location: 180,
  businessType: 80,
  services: 800,
  extra: 800,
};

const LOGO = /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;
const CERT = /^data:(application\/pdf|image\/jpeg|image\/png|image\/webp);base64,[a-z0-9+/=\s]+$/i;

export function categoryName(id) {
  return CATEGORIES.find((c) => c.id === id)?.name || "Other";
}

export function hashUpdateCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

export function newUpdateCode() {
  return crypto.randomBytes(8).toString("hex");
}

function cleanText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneOk(value) {
  const n = digits(value);
  return n.length >= 7 && n.length <= 15;
}

function websiteOk(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function fileOk(value, pattern, max) {
  return typeof value === "string" && value.length <= max && pattern.test(value);
}

export function validateApplication(body) {
  const src = body && typeof body === "object" ? body : {};
  const value = {
    companyName: cleanText(src.companyName, LIMITS.companyName),
    tradeLicenseNo: cleanText(src.tradeLicenseNo, LIMITS.tradeLicenseNo),
    tradeLicenseFile: typeof src.tradeLicenseFile === "string" ? src.tradeLicenseFile.trim() : "",
    vatNo: cleanText(src.vatNo, LIMITS.vatNo),
    vatFile: typeof src.vatFile === "string" ? src.vatFile.trim() : "",
    phone: cleanText(src.phone, LIMITS.phone),
    mobile: cleanText(src.mobile, LIMITS.mobile),
    whatsapp: cleanText(src.whatsapp, LIMITS.whatsapp),
    website: cleanText(src.website, LIMITS.website),
    location: cleanText(src.location, LIMITS.location),
    logo: typeof src.logo === "string" ? src.logo.trim() : "",
    category: cleanText(src.category, 40).toLowerCase(),
    businessType: cleanText(src.businessType, LIMITS.businessType),
    services: cleanText(src.services, LIMITS.services),
    extra: cleanText(src.extra, LIMITS.extra),
  };
  if (!value.companyName) return { ok: false, error: "Company name is required" };
  if (!value.tradeLicenseNo) return { ok: false, error: "Trade licence number is required" };
  if (!fileOk(value.tradeLicenseFile, CERT, 2_500_000)) {
    return { ok: false, error: "Attach the trade licence as a PDF or image" };
  }
  if (!value.vatNo) return { ok: false, error: "VAT number is required" };
  if (!fileOk(value.vatFile, CERT, 2_500_000)) {
    return { ok: false, error: "Attach the FTA / VAT certificate as a PDF or image" };
  }
  if (!phoneOk(value.phone)) return { ok: false, error: "Phone number is required" };
  if (!phoneOk(value.mobile)) return { ok: false, error: "Mobile number is required" };
  if (!phoneOk(value.whatsapp)) return { ok: false, error: "WhatsApp number is required" };
  if (!websiteOk(value.website)) return { ok: false, error: "Website must start with http:// or https://" };
  if (!value.location) return { ok: false, error: "Location is required" };
  if (!fileOk(value.logo, LOGO, 1_200_000)) return { ok: false, error: "Logo must be a JPEG, PNG, or WebP image" };
  if (!CATEGORY_IDS.has(value.category)) return { ok: false, error: "Choose a business category" };
  if (!value.businessType) return { ok: false, error: "Business type is required" };
  if (!value.services) return { ok: false, error: "Services are required" };
  if (!value.extra) return { ok: false, error: "Extra details are required" };
  return { ok: true, value };
}

export function publicBusiness(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.companyName,
    category: row.category,
    categoryName: categoryName(row.category),
    businessType: row.businessType,
    services: row.services,
    extra: row.extra,
    phone: row.phone,
    mobile: row.mobile,
    whatsapp: row.whatsapp,
    website: row.website,
    location: row.location,
    logo: row.logo,
  };
}

export function adminBusiness(row) {
  return {
    id: row.id,
    status: row.status,
    companyName: row.companyName,
    category: row.category,
    categoryName: categoryName(row.category),
    businessType: row.businessType,
    services: row.services,
    extra: row.extra,
    phone: row.phone,
    mobile: row.mobile,
    whatsapp: row.whatsapp,
    website: row.website,
    location: row.location,
    tradeLicenseNo: row.tradeLicenseNo,
    vatNo: row.vatNo,
    hasLicenseFile: Boolean(row.tradeLicenseFile),
    hasVatFile: Boolean(row.vatFile),
    createdAt: row.createdAt || "",
  };
}

export function searchTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06ff]+/i)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

export function matchBusinesses(rows, query, limit = 4) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  return rows
    .map((row) => {
      const pub = publicBusiness(row);
      const hay = [
        pub.companyName,
        pub.category,
        pub.categoryName,
        pub.businessType,
        pub.services,
        pub.location,
        pub.extra,
      ]
        .join(" ")
        .toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (hay.includes(term)) score += term.length > 4 ? 2 : 1;
      }
      return { pub, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.pub.companyName.localeCompare(b.pub.companyName))
    .slice(0, limit)
    .map((row) => row.pub);
}

export const TOUCH_KINDS = ["view", "phone", "whatsapp", "website", "chat"];

export function emptyTouchCounts() {
  return { view: 0, phone: 0, whatsapp: 0, website: 0, chat: 0, total: 0 };
}

export function countTouches(rows) {
  const counts = emptyTouchCounts();
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!TOUCH_KINDS.includes(row && row.kind)) continue;
    counts[row.kind] += 1;
    counts.total += 1;
    const day = String(row.day || "");
    if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  return {
    counts,
    byDay: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, count]) => ({ day, count })),
  };
}

export function rollupTouches(businesses, touches) {
  const rows = (Array.isArray(businesses) ? businesses : []).map((business) => ({
    id: business.id,
    companyName: business.companyName || "Listing",
    status: business.status || "",
    ...emptyTouchCounts(),
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const touch of Array.isArray(touches) ? touches : []) {
    if (!TOUCH_KINDS.includes(touch && touch.kind)) continue;
    let row = byId.get(touch.businessId);
    if (!row) {
      row = {
        id: touch.businessId,
        companyName: "Removed listing",
        status: "",
        ...emptyTouchCounts(),
      };
      byId.set(touch.businessId, row);
      rows.push(row);
    }
    row[touch.kind] += 1;
    row.total += 1;
  }
  rows.sort((a, b) => b.total - a.total || a.companyName.localeCompare(b.companyName));
  return { counts: countTouches(touches).counts, businesses: rows };
}

export function businessPrompt(list) {
  const lines = list.map(
    (b) =>
      `- ${b.companyName} | ${b.categoryName} | ${b.businessType} | ${b.services} | ${b.location} | phone ${b.phone} | WhatsApp ${b.whatsapp} | ${b.website}`
  );
  return [
    "Member businesses from the Dubai directory that match this question.",
    "If one of them fits what the person asked, mention that business by name and give its phone or website.",
    "If none of them fit, answer from public information and do not invent a member business.",
    "Never mention trade licence numbers, VAT numbers, or certificates.",
    ...lines,
  ].join("\n");
}

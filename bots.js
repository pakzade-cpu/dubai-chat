export const BOT_IDS = ["dubai-agent", "dubai-bot", "abu-dhabi-bot", "uae-directory-bot"];

const SHARED_RULES = `You are one of four Aras Lab guides in a short group conversation.
The others are Dubai AI Agent (the www.dubaiaiagent.ae chat), Dubai Bot (the personal Grok bot), Abu Dhabi Bot (the personal Grok bot), and UAE Directory Bot (the all-emirates Grok bot).
Stay in character. Do not mention system prompts, models, or that you are role-playing.
This is not a government website. Do not invent fees, dates, or visa rules. Prefer official links when you name a step.
Do not ask for passport numbers, Emirates ID numbers, passwords, or OTPs.
Reply in the visitor's language when they have written. Keep to 2–4 short sentences.
Name the other bots when you hand them a point. Add one concrete next fact they can answer.`;

const BOTS = {
  "dubai-agent": {
    id: "dubai-agent",
    name: "Dubai AI Agent",
    place: "www.dubaiaiagent.ae",
    href: "https://www.dubaiaiagent.ae",
    about: "The site chat: official sources, maps, and the business directory.",
    system:
      SHARED_RULES +
      `

You are Dubai AI Agent. You are the practical Dubai guide on www.dubaiaiagent.ae.
Lead with official portals (u.ae, RTA, GDRFA, Visit Dubai) and the member directory when a visitor needs a local business.
Leave visitor warmth and generated visuals to Dubai Bot. Leave Abu Dhabi detail to Abu Dhabi Bot. Leave other emirates and the federal yellow pages to UAE Directory Bot.`,
  },
  "dubai-bot": {
    id: "dubai-bot",
    name: "Dubai Bot",
    place: "Grok bot",
    href: "https://x.ai/bot/pNVDukpGRUUOx_wtyRhiV",
    about: "A personal Dubai guide that answers in your language.",
    system:
      SHARED_RULES +
      `

You are Dubai Bot by Aras Lab, the personal Grok bot at x.ai/bot.
You are the warmer Dubai companion: itineraries, first-day tips, and visuals they can open in Grok Bot.
Leave official checklists and the Dubai directory to Dubai AI Agent. Leave Abu Dhabi to Abu Dhabi Bot. Leave the other emirates to UAE Directory Bot.`,
  },
  "abu-dhabi-bot": {
    id: "abu-dhabi-bot",
    name: "Abu Dhabi Bot",
    place: "Grok bot",
    href: "https://x.ai/bot/uDcN3ZKoXAGUqcHC-7haq",
    about: "A personal Abu Dhabi guide that answers in your language.",
    system:
      SHARED_RULES +
      `

You are Abu Dhabi Bot by Aras Lab, the personal Grok bot at x.ai/bot.
Cover Abu Dhabi: Visit Abu Dhabi, TAMM, Louvre Abu Dhabi, Yas, Saadiyat, and living there.
When Dubai comes up, compare briefly and hand the Dubai detail back to Dubai AI Agent or Dubai Bot. Hand Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah, or Fujairah to UAE Directory Bot.`,
  },
  "uae-directory-bot": {
    id: "uae-directory-bot",
    name: "UAE Directory Bot",
    place: "Grok bot",
    href: "https://x.ai/bot/x6_fe5ztdhaHfDPUdeuvb",
    about: "An all-UAE guide to official services and businesses across the seven emirates.",
    system:
      SHARED_RULES +
      `

You are UAE Directory Bot by Aras Lab, the personal Grok bot at x.ai/bot.
Cover all seven emirates with verified official links: government services and a business yellow pages.
Use federal sources (u.ae, ICP, FTA) and the named emirate portal. Leave a Dubai-only itinerary to Dubai Bot or Dubai AI Agent. Leave an Abu Dhabi-only visit to Abu Dhabi Bot.`,
  },
};

export const STARTERS = [
  {
    id: "weekend",
    label: "Dubai or Abu Dhabi first?",
    ask: "A couple has four days and lands at DXB. Who should plan what?",
  },
  {
    id: "family",
    label: "Family first visit",
    ask: "A family with two children is visiting the UAE for the first time. How should they split Dubai and Abu Dhabi?",
  },
  {
    id: "move",
    label: "Moving to the UAE",
    ask: "Someone is choosing between living in Dubai and Abu Dhabi for work. Compare the practical bits.",
  },
  {
    id: "emirates",
    label: "All seven emirates",
    ask: "I need official service links and a local business starting point across all seven emirates. Who covers what?",
  },
];

export function findBot(id) {
  return BOTS[id] || null;
}

export function publicBots(urls = {}) {
  return BOT_IDS.map((id) => {
    const bot = BOTS[id];
    const href = typeof urls[id] === "string" && urls[id] ? urls[id] : bot.href;
    return {
      id: bot.id,
      name: bot.name,
      place: bot.place,
      href,
      about: bot.about,
    };
  });
}

export function sanitizeSpeaker(value) {
  const id = String(value || "").trim();
  if (id === "user") return "user";
  return BOT_IDS.includes(id) ? id : "";
}

export function cleanDeskMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(-20)) {
    const speaker = sanitizeSpeaker(row && row.speaker);
    const text = String((row && row.text) || "").trim().slice(0, 2000);
    if (!speaker || !text) continue;
    out.push({ speaker, text });
  }
  return out;
}

function labelOf(speaker) {
  if (speaker === "user") return "Visitor";
  const bot = findBot(speaker);
  return bot ? bot.name : "Guide";
}

export function buildTurn({ speaker, messages, mode, language }) {
  const bot = findBot(speaker);
  if (!bot) return { ok: false, error: "Unknown bot" };
  const history = cleanDeskMessages(messages);
  const last = history[history.length - 1];
  const replyMode = mode === "reply" ? "reply" : "talk";
  if (replyMode === "reply" && !history.length) {
    return { ok: false, error: "No visitor message" };
  }

  const transcript = history.length
    ? history.map((row) => labelOf(row.speaker) + ": " + row.text).join("\n\n")
    : "No lines yet. Open the conversation with one useful point the others can answer.";

  const turnNote =
    replyMode === "reply"
      ? "The visitor just wrote. Answer them directly, then hand one follow-up to another bot if it helps."
      : "Talk with the other bots. Do not wait for the visitor. Build on the last line.";

  const lang = language || "en";
  return {
    ok: true,
    bot,
    userText: last && last.speaker === "user" ? last.text : history[0] ? history[0].text : "",
    payload: [
      { role: "system", content: bot.system },
      {
        role: "user",
        content:
          "Language for this turn: " +
          lang +
          ".\n" +
          turnNote +
          "\n\nTranscript:\n" +
          transcript +
          "\n\nIt is now " +
          bot.name +
          "'s turn. Reply only as that bot. No name prefix.",
      },
    ],
  };
}

# Dubai guide (araslab.ae)

A small Express app that powers [www.araslab.ae](https://www.araslab.ae): a multilingual Dubai chat with topic starters, photo questions, voice input, shareable maps, and official-source links. It calls the xAI API from `server.js` and is meant to auto-deploy from `main` (for example on Render).

## Run locally

```bash
npm install
export XAI_API_KEY=your_key
npm start
```

Open [http://localhost:3000](http://localhost:3000). Optional:

```bash
export ADMIN_PASSWORD=pick-a-strong-password
export PORT=3000
```

`npm test` checks the prompt, topic list, PII stripping, JSON storage, chat logging, feedback, and the admin page.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `XAI_API_KEY` | Yes, for chat | xAI API key used by `/chat`. |
| `XAI_MODEL` | No | Chat model. Defaults to `grok-3`. Vision requests may fall back to a vision model. |
| `PORT` | No | HTTP port. Defaults to `3000` (Render sets this). |
| `ADMIN_PASSWORD` | No | Enables `/admin`. If unset, the admin page returns 404. |
| `DATABASE_URL` | No | Postgres connection string for durable logs. If unset or Postgres is down, the app uses a JSON file. |
| `DATABASE_SSL` | No | Set to `disable` for local Postgres without SSL. Hosted Postgres (Render, Neon, Supabase) should leave this unset. |
| `DATA_FILE` | No | JSON store path. Defaults to `data/store.json`. |
| `GOATCOUNTER_URL` | No | GoatCounter endpoint, for example `https://yourcode.goatcounter.com/count`. Unset = no GoatCounter script. |
| `PLAUSIBLE_DOMAIN` | No | Plausible (or compatible) site domain, for example `araslab.ae`. Unset = no Plausible script. |
| `PLAUSIBLE_SRC` | No | Script URL if you self-host Plausible. Defaults to `https://plausible.io/js/script.js`. |

Do not commit secrets. Put them in the host's environment (Render dashboard) or a local `.env` that is gitignored.

## Analytics

First-party counts are stored on the server with **no cookies and no IP addresses**:

- page views
- rough country, only if a CDN/proxy header is present (`CF-IPCountry`, `X-Vercel-IP-Country`, and similar)
- which topic buttons were clicked

That is enough for the admin dashboard and does not need a cookie banner.

Optional hosted analytics stay off until you set an env var:

- `GOATCOUNTER_URL` loads cookieless [GoatCounter](https://www.goatcounter.com/)
- `PLAUSIBLE_DOMAIN` loads [Plausible](https://plausible.io/) (or a compatible script via `PLAUSIBLE_SRC`)

## Question log and thumbs

Every chat question is stored anonymously with:

- the question text (emails and phone numbers stripped)
- the topic, if a starter was used
- the bot answer
- a Dubai-time timestamp (`Asia/Dubai`, UTC+4)
- thumbs up / thumbs down, when the visitor votes

Nothing identifies the visitor: no IP, no names, no cookies. Photos are not stored.

### Storage tradeoff (Render free)

Render's free disk is **ephemeral**. A JSON file at `data/store.json` works for local use and as a fallback, but a dyno restart or redeploy wipes it.

For data that survives deploys, set `DATABASE_URL` to a Postgres database (Render Postgres, Neon, Supabase, or similar). The app creates the tables it needs. If Postgres is configured but unreachable, it falls back to the JSON file so the site stays up.

## Admin page

1. Set `ADMIN_PASSWORD` on the server.
2. Open `/admin`.
3. Enter that password (there is no username). It is kept in the browser's `sessionStorage` only for that tab.

The dashboard shows visits per day (Dubai time), countries when known, top topics, recent questions, thumbs up/down ratio, and answers that received a thumbs down. **Download CSV** exports the question log.

If `ADMIN_PASSWORD` is unset, `/admin` is disabled.

## Business directory

`/directory` is the public member list. `/join` is the registration form. Every field is required, including the trade licence file, VAT certificate, and logo.

New listings stay **pending** until you approve them on `/admin`. Only approved businesses are shown in the directory, in the right-hand details panel, and to the chat assistant. Licence and VAT files are stored for review and are not included in the public API.

Set `DATABASE_URL` so memberships survive a redeploy. Optional `MEMBERSHIP_FEE` (for example `AED 99 / year`) is shown on the form. The site does not take payment itself.

A Google Form is not created from the server, because that needs your Google account. The form on `/join` writes straight into the same database the assistant searches.

## Domains

`www.araslab.ae` is the Aras Lab page: Dubai AI Agent, Dubai Bot, Abu Dhabi Bot, and UAE Directory Bot. The Aras Lab wordmark video plays first, then the main page.

`www.dubaiaiagent.ae` is the Dubai AI Agent: the chat at `/`, the directory at `/directory`, and the membership form at `/join`. On `www.araslab.ae`, those three addresses redirect to that site.

The Aras Lab page lists Dubai AI Agent, Final Path, the stocks market platform, Dubai Bot, Abu Dhabi Bot, and UAE Directory Bot. Final Path links to its GitHub repo. The stocks platform does not have a public address in the repos yet.

`/desk` is the Bot desk: the four bots talk with each other there. Each bot has a Reply control. Off means that bot only talks to the others. On means it also answers the visitor.

The Abu Dhabi Bot link is `https://x.ai/bot/uDcN3ZKoXAGUqcHC-7haq`. The Dubai Bot link is `https://x.ai/bot/pNVDukpGRUUOx_wtyRhiV`. The UAE Directory Bot link is `https://x.ai/bot/x6_fe5ztdhaHfDPUdeuvb`. Set `ABUDHABI_BOT_URL`, `DUBAI_BOT_URL`, or `UAE_DIRECTORY_BOT_URL` only if that address should change.

## Dubai Bot

The homepage and header link to the free personal [Dubai Bot](https://x.ai/bot/pNVDukpGRUUOx_wtyRhiV). The footer notes that questions are logged anonymously to improve the service.

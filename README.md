# Utility Monitor

Tracks energy (kWh), water consumption (litres), and water **tank level**
across multiple buildings — and multiple **customer portfolios** — with a
mobile-friendly, installable web dashboard. Built on the original project
brief's 4-stage architecture (meter → gateway → storage → dashboard),
extended to cover the water storage-tank monitoring, leak detection,
alerting, remote device control, and multi-building/multi-customer
portfolio view requested in a follow-up RFP for a water platform serving
several clients.

## What's here right now

This is stages 3 and 4 (storage + dashboard) plus a **simulator standing in
for stages 1 and 2** (meter/sensor + gateway) so the whole thing — including
tank levels and a controllable pump per building — runs end-to-end today,
before any real hardware is connected.

```
utility-monitoring/
  server/           Express API + SQLite storage + reading simulator
    src/
      db.js               Schema (customers, users, buildings, readings, devices, device_commands) + seeds
      auth.js             Password hashing (scrypt) + in-memory session store
      authMiddleware.js   requireAuth (session cookie) / requireIngestKey (API key)
      customerScope.js    Resolves which customer a request is scoped to, from the session
      mailer.js           SMTP wrapper (falls back to console logging if unconfigured)
      alertEngine.js       Polls for alert transitions and emails each customer's contact
      simulator.js        Generates energy/water/tank readings every 30s (demo mode)
      server.js           App entry point, serves the API and the web/ folder
      routes/             /api/auth, /api/customers, /api/buildings, /api/readings, /api/summary, /api/tanks, /api/devices
  web/              Static dashboard (no build step) — index.html/app.js/styles.css
  tools/            gen-icons.js — regenerates the PWA icon set
```

**Storage:** SQLite (via Node's built-in `node:sqlite`) instead of the
brief's suggested Postgres/InfluxDB — for a handful of buildings per
customer it's zero-setup (one file, no server or native build tools
required) and keeps with the brief's "simple and inexpensive" goal. The
schema is a plain `readings(building_id, reading_type, value, timestamp)`
table with `buildings.customer_id` scoping each building to one portfolio,
so migrating to Postgres/TimescaleDB or InfluxDB later — likely once this
serves real client volume, not demo data — is a straightforward swap of
`db.js`.

**Multi-customer portfolios:** the DB seeds two demo customers — "Sunrise
Gated Community" (5 buildings, the original brief) and "Oceanview Towers" (3
towers, including a "12th-floor tank" building named after the RFP's
example) — to prove buildings are properly isolated per customer, not just
a UI label. The dashboard's top-left dropdown switches between them (only
shown to the admin account — a regular customer login only ever has the one
portfolio, so there's nothing to switch).

**Auth:** every dashboard-facing endpoint requires a logged-in session
(httpOnly cookie). A non-admin user is hard-locked server-side to their own
`customer_id` — `?customer_id=` in the URL is ignored for them, verified by
actually trying to spoof it (see `customerScope.js`). Only the `admin` role
can pass `?customer_id=` to view any portfolio, for internal ops use.
Sessions live in memory (a `Map` in `auth.js`), so **they reset on every
server restart** and won't survive multiple server instances — fine for a
demo, not for production (see "Next steps"). Three demo accounts are seeded
on first run and printed to the server console:

| Username | Password | Role | Scope |
|---|---|---|---|
| `sunrise` | `sunrise123` | owner | Sunrise Gated Community only |
| `oceanview` | `oceanview123` | owner | Oceanview Towers only |
| `admin` | `admin123` | admin | any portfolio |

Rotate or remove these before this is ever reachable beyond `localhost`.

## Running it

```bash
cd server
npm install
npm start
```

Then open **http://localhost:3000** and sign in with one of the demo
accounts in the "Auth" section above. The server starts in demo mode: it
backfills 48 hours of simulated readings on first run, then generates new
readings (energy, water flow, and tank level) per building every 30 seconds
so the dashboard updates live.

Leak/low-level alerts are simulated as rare, spontaneous events — by design,
so the dashboard opens calm rather than mid-incident. **To trigger one live
for a demo** instead of waiting on chance, drop a building's tank fast
enough to trip leak detection:

```bash
curl -X POST http://localhost:3000/api/readings \
  -H "Content-Type: application/json" \
  -d '{"building_id": 3, "reading_type": "tank_level", "value": 30}'
```

That posts one low reading; the next simulator tick computes the rate of
drop from it and flags "Leak detected" within ~30 seconds. Change
`building_id` to target whichever building's card you want to light up.

To reset back to a clean baseline (wipe demo data and re-backfill, including
demo login accounts), stop the server, delete `server/data/`, and start it
again.

## Configuring real email alerts

By default, `alertEngine.js` detects alerts correctly but has nowhere real
to send them — the two demo customers' `alert_email` is set to an
`@example.com` address (IANA-reserved, never delivers), and with no SMTP
configured, sends are logged to the console instead
(`[mailer] SMTP not configured — would send to ...`). To actually receive
email:

```bash
SMTP_HOST=smtp.yourprovider.com \
SMTP_PORT=587 \
SMTP_USER=you@yourdomain.com \
SMTP_PASS=your-smtp-password \
ALERT_FROM_EMAIL=alerts@yourdomain.com \
npm start
```

Then set each customer's real recipient — either through the dashboard's
"Instant alerts go to" field, or directly:

```bash
curl -X PATCH http://localhost:3000/api/customers/1 \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"alert_email": "ops@realaddress.com"}'
```

## Deploying (Fly.io)

The repo root has a `Dockerfile` (Node 22+, needed for `node:sqlite`) ready
for Fly.io — no framework-specific config, it's just a small Node process.

```bash
fly auth login          # opens a browser to sign in/sign up — do this yourself
fly launch --no-deploy  # detects the Dockerfile, picks an app name + region
fly deploy               # builds (remotely, if you don't have Docker running locally) and deploys
```

`fly launch` will ask about a Postgres database and volumes — decline both;
this app only needs the one container. When it asks to deploy immediately,
you can say no and run `fly deploy` yourself once ready, or say yes.

**Demo account passwords are randomly generated on first boot** (see
"Auth"), not the `sunrise123`-style ones from local dev — check the app's
logs right after the first deploy to get them:

```bash
fly logs
```

Look for the "Seeded demo login accounts" block. If you lose them, the
simplest fix is `fly volumes` isn't in use by default (see the Dockerfile's
note on data persistence), so **restarting the app** (`fly apps restart`)
re-seeds fresh ones — printed to `fly logs` again.

To actually receive email alerts rather than have them logged, set SMTP
secrets before or after deploying:

```bash
fly secrets set SMTP_HOST=smtp.yourprovider.com SMTP_PORT=587 \
  SMTP_USER=you@yourdomain.com SMTP_PASS=yourpassword \
  ALERT_FROM_EMAIL=alerts@yourdomain.com
```

## Dashboard features

- **Login required** — the whole dashboard sits behind a session cookie; see
  "Auth" above for demo accounts
- **Instant email alerts** — configurable per-portfolio recipient
  ("Instant alerts go to" field), fires automatically when a usage/low-level/
  leak alert starts (see "Configuring real email alerts")
- Per-building cards with today's energy (kWh) and water-flow (L) totals
- Trend sparkline per building for both energy and water flow (last 24h)
- **Tank level gauge** per building (% full and litres vs. capacity)
- **Low-level alert** when a tank drops below its configured threshold
- **Leak/burst detection** — flags an abnormally fast tank-level drop
  (faster than normal usage could explain) as a probable leak, separate from
  just "running low"
- **Remote device control** — toggle each building's tank inlet pump on/off
  from the dashboard; this is the "activate from a distance" requirement,
  simulated end-to-end (toggling it off visibly stops that tank refilling)
- **Portfolio switcher** — dropdown in the header swaps between customer
  portfolios; selection persists per-browser via `localStorage`
- Community-wide totals + active-alert count bar at the top (scoped to the
  selected portfolio)
- Responsive layout — works on phone or desktop browser
- **Installable PWA** — has a manifest + service worker + icons, so it can
  be installed to a phone/desktop home screen (Chrome/Edge/Android show an
  "Install app" button; iOS Safari via Share → Add to Home Screen) and keeps
  showing its shell (layout/branding) if the connection drops. Live data
  still requires the network — it's not an offline data cache.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | — | `{username, password}` → sets session cookie |
| `POST /api/auth/logout` | — | Clears the session |
| `GET /api/auth/me` | session | Who's currently logged in |
| `GET /api/customers` | session | Your portfolio (or all, if admin) — powers the switcher |
| `PATCH /api/customers/:id` | session | `{alert_email}` — set the "instant alert" recipient |
| `GET /api/buildings?customer_id=` | session | Buildings with today's energy/water-flow totals and alert flags |
| `GET /api/readings?building_id=&type=&hours=` | session | Raw history for a building/type (`energy`\|`water`\|`tank_level`) |
| `POST /api/readings` | API key* | Ingest one reading `{building_id, reading_type, value, timestamp?}` — the seam a real gateway calls |
| `GET /api/summary?customer_id=` | session | Community-wide totals and active alert count (usage + tank low-level + leak) |
| `GET /api/tanks?customer_id=` | session | Per-building tank level, low-level alert, leak alert |
| `GET /api/devices?customer_id=` | session | Remotely controllable devices (currently one inlet pump per building) |
| `POST /api/devices/:id/command` | session | Remote activation: `{action: "on"\|"off"}` |

`?customer_id=` is only honored for the `admin` role — every other session
is locked to its own customer regardless of what's passed. \* `POST
/api/readings` authenticates with an `x-api-key` header (`INGEST_API_KEY`
env var) instead of a session, since a real gateway can't do an interactive
login; unset, it's left open for local demo convenience.

## Mapping to the RFP

| RFP requirement | Status |
|---|---|
| Multi-building monitoring of tank levels | ✅ done — `/api/tanks` + gauge per building |
| Consumption dashboards | ✅ done — energy/water-flow cards + sparklines |
| Leak detection / early warning | ✅ done — rate-of-drop detection, see `routes/tanks.js` |
| Instant alerts to designated personnel | ✅ done — `alertEngine.js` emails each customer's `alert_email` when an alert starts (edge-triggered, 30 min cooldown); falls back to console logging if SMTP isn't configured — see "Configuring real email alerts" |
| Activate IoT device from a distance | ✅ simulated end-to-end via `/api/devices/:id/command` — needs a real BMS/gateway integration behind it (see below) |
| Web portal, multi-user, multi-location | ✅ done — session login, multi-building **and** multi-customer portfolio view, and a non-admin is server-side locked to their own customer's data (not just query-param isolation) |
| Dedicated mobile app | ⚠️ built as an **installable PWA** (manifest + service worker + icons — installs to a home screen, gets its own icon/splash), not a native App Store/Play Store app. Recommended over native unless the client specifically needs store presence — see "Next steps" |
| Industrial-grade hardware | N/A — this repo is the software platform; hardware selection is a separate conversation once a building's meter/sensor make and connectivity are known |

## Next steps

**To take this from prototype to what the RFP describes:**

1. **Durable sessions** — auth is real (see "Auth" above) but sessions live
   in an in-memory `Map`, so they're wiped on every server restart and
   wouldn't be shared across multiple server instances. Move to a shared
   store (Redis, or a `sessions` DB table) before running more than one
   instance or expecting logins to survive a deploy.
2. **SMS/push, not just email** — `alertEngine.js` currently only emails.
   Adding SMS (e.g. Twilio) or web push alongside it is a matter of a second
   notifier in the same edge-triggered loop, not a redesign.
3. **Real device control** — `/api/devices/:id/command` currently only
   flips a status flag the simulator reads. For real hardware this needs a
   backend integration per device type: MQTT publish to a BMS, a vendor API
   call, or a relay controlled via a local gateway (Raspberry Pi/Node-RED).
4. **Roles beyond owner/admin** — the original brief's open question
   ("who needs access — just you, or building managers/residents too?") and
   the RFP's "syndicate operations" both imply more granular roles (e.g.
   read-only resident, building-manager-for-one-building) than today's
   simple owner-sees-their-customer / admin-sees-everything split.
5. **Native mobile app** — only worth it if the client specifically needs
   App Store/Play Store presence for branding/marketing. The PWA already
   covers "install to home screen, launches like an app, can request push
   permission" at a fraction of the cost of a native build (no dual
   iOS/Android codebase, no app-store review). Re-icon `web/icons/` (see
   `tools/gen-icons.js`) with real branding before showing this to a client.
6. **Real meters/sensors** — same open questions as before: confirm tank
   sensor make/model and connectivity (Wi-Fi/API, Modbus/BACnet, or
   LoRaWAN) per building, which decides the gateway approach:
   - Vendor cloud API → poll it from a small script/cron, `POST` to `/api/readings`.
   - Modbus/BACnet → Raspberry Pi + Node-RED/Home Assistant bridging to `/api/readings`.
   - LoRaWAN → LoRaWAN gateway + network server (e.g. The Things Network) webhook.
7. Once real readings are flowing, set `DEMO_MODE=0` when starting the
   server so the simulator stops adding synthetic data:
   ```bash
   DEMO_MODE=0 npm start
   ```
8. Tune each building's thresholds (`energy_threshold_kwh`,
   `water_threshold_l`, `tank_low_threshold_pct`) and `tank_capacity_l` in
   the `buildings` table to real values once known.
9. **Onboarding a new customer** today means inserting rows into
   `customers`, `buildings`, and `users` directly (see the seed blocks in
   `db.js` for the shape). An admin UI/API for that is worth building once
   you're doing it more than a handful of times.

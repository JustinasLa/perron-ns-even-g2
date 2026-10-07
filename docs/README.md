# Perron-NS

[Source README](../README.md)

Technical documentation for the Perron-NS Even Hub app.

## Architecture

```
        NS Reisinformatie API  (gateway.apiportal.ns.nl)
                  ▲
                  │  key injected server-side
        Cloudflare Worker  (proxy/worker.js)  ──▶  /privacy page
                  ▲
                  │  HTTPS + CORS
        Phone WebView  ──── BLE ────▶  G2 glasses lens
        (journey planner)              (clock + boards)
```

```
app.json            Even Hub manifest (package id, sdk version, permissions)
index.html          WebView shell (mounts src/main.ts)
src/
  main.ts           SDK bridge: lens clock + gestures, and the phone planner
  ns.ts             NS API client (trips, stations, departures, disruptions)
  style.css         Even OS 2.0 styling
  icons/            Even OS 2.0 icon set (inlined as raw SVG)
proxy/
  worker.js         Worker: injects the NS key, adds CORS, serves /privacy
  wrangler.toml     Worker deploy config
images/             glasses + phone screenshots, store QR
docs/               technical documentation
PRIVACY.md          privacy policy (also served at the proxy's /privacy)
RELEASE_NOTES.md    store release notes
CHANGELOG.md        version history
```

## Lens screens

1. **Home** — clock plus your recent journeys. Swipe to highlight one.
2. **Times list** — upcoming departures for the selected route.
3. **Journey detail** — the full board: per-leg times, stations, platforms,
   transfers, and ETA.

## Navigation (temple gestures)

| Gesture     | Home              | Times list          | Journey detail       |
|-------------|-------------------|---------------------|----------------------|
| Swipe up    | Previous journey  | Earlier departure   | —                    |
| Swipe down  | Next journey      | Later departure     | —                    |
| Tap         | Open the journey  | View this departure | —                    |
| Double-tap  | Exit app          | Back to home        | Back to times list   |

## Development

Use [Node.js](https://nodejs.org) 20.x (20.17.0+), 22.x (22.13.0+), or 23.5.0+
with npm, matching the runtime range in `package.json`.

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
npm run simulate     # G2 simulator (use simulate:auto for the automation API)
```

Sideload to real glasses or build a package:

```bash
npm run qr           # QR code for Even app dev mode
npm run pack         # build + package into perron-ns.ehpk
```

## Tests and coverage

```bash
npm test             # run all tests and enforce 100% coverage
npm run test:watch   # watch tests while editing
npm run test:coverage
```

The coverage command writes an HTML report to `coverage/index.html` and requires
100% statements, branches, functions, and lines in each production module:
the phone and glasses app, NS client, localization, and Cloudflare proxy. CI runs
the same coverage gate before packaging. Tests and TypeScript declaration files
are the only source files excluded from coverage.

The UI tests run in jsdom with fake clocks and mocked SDK and network boundaries.
A test-only Vite transform exposes the entrypoint's private helpers and state for
boundary tests while preserving source maps. It is defined in `vitest.config.ts`
and does not run in development or production builds.

## Backend proxy

Live data needs the NS proxy deployed once (the key stays server-side):

```bash
cd proxy
wrangler login
wrangler secret put NS_API_KEY   # paste your NS Primary key
wrangler deploy
```

Then set `BASE` in `src/ns.ts` and the network `whitelist` in `app.json` to your
Worker URL. See [`proxy/README.md`](../proxy/README.md) for details.

## Tech stack

- **NS Reisinformatie API** — via a Cloudflare Worker proxy
- **@evenrealities/even_hub_sdk** — glasses rendering + gesture events
- **Vite + TypeScript** — build and dev server
- **Vitest + jsdom** — unit and UI tests with coverage
- **@evenrealities/evenhub-cli** — `qr` / `pack`
- **@evenrealities/evenhub-simulator** — local preview + screenshot automation
- **Even OS 2.0** — design tokens and icon set

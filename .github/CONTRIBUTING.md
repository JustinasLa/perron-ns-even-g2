# Contributing to Perron-NS

Perron-NS is an NS (Dutch Railways) journey planner for Even Realities G2 smart glasses,
built as an Even Hub app with Vite + TypeScript. This guide walks you through making a change.

## Prerequisites

- [Node.js](https://nodejs.org): 20.x (20.17.0+), 22.x (22.13.0+), or 23.5.0+
  (provides `node` and `npm`)


## 1. Fork and clone

Click **Fork** on the repo page, then clone your fork:

```bash
git clone https://github.com/<your-username>/perron-ns-even-g2.git
cd perron-ns-even-g2
git remote add upstream https://github.com/JustinasLa/perron-ns-even-g2.git
```

`origin` is your fork (where you push); `upstream` is this repo (where you pull
the latest from). You cannot push directly to `upstream` - all changes go
through a pull request.

## 2. Install and confirm a clean build

```bash
npm install
npm run build
```

`npm run build` runs a TypeScript type-check (`tsc --noEmit`) followed by a Vite
build. It must finish with no errors before you start. If it fails on a fresh
clone, open an issue rather than a pull request.

## 3. Create a branch

Never commit to `main`. Branch off it with a short, descriptive name:

```bash
git checkout -b short-description-of-change
```

## 4. Make your change

Run the app while you work. The UI only renders once the Even Hub bridge is
available, so you need the simulator, not just the dev server:

```bash
npm run dev        # terminal 1: Vite dev server (http://localhost:5173)
npm run simulate   # terminal 2: glasses simulator + phone frame (provides the bridge)
```

## 5. Verify before committing

```bash
npm run build
```

The build (type-check + bundle) must pass clean.

## 6. Commit, push, and open a pull request

```bash
git add -A
git commit -m "Describe your change in the imperative, e.g. Fix platform label"
git push -u origin short-description-of-change
```

GitHub prints a link after the push - open it (or use the "Compare & pull
request" banner on your fork) and:

- Confirm the PR targets `JustinasLa/perron-ns-even-g2` `main`.
- Fill in the pull request template: what changed, why, and how you tested it.
- Reference any related issue with `Closes #123`.

## 7. Respond to review

To address feedback, add more commits to the **same branch** and push again —
the PR updates automatically:

```bash
git add -A
git commit -m "Address review feedback"
git push
```

## 8. After it's merged, sync your fork

```bash
git checkout main
git pull upstream main
git push origin main
git branch -d short-description-of-change
```

## Project conventions

Keep changes consistent with the existing code:

- **No code comments.** The source is intentionally comment-free
- **No hard-coded user-facing text.** Every string shown to the user goes
  through the string table in [`src/i18n.ts`](src/i18n.ts) via `t('key')`. Add a
  new key to both the `en` and `nl` tables (English filled in, Dutch may be left
  empty — it falls back to English) rather than writing literals in `src/main.ts`.
- **Match the surrounding style** - indentation, naming, and existing patterns.
- **One logical change per pull request.** Smaller PRs are reviewed faster.
- **The build must pass.** `npm run build` is the bar for every PR.

## Scope and architecture

- `src/main.ts` - SDK bridge (glasses lens) plus the phone planner UI.
- `src/ns.ts` - NS API client (trips, stations, departures, disruptions).
- `src/i18n.ts` - localisation string table.
- `proxy/` - Cloudflare Worker that injects the NS API key server-side. **Never
  put API keys or secrets in the app or in `app.json`.**

If you're planning a larger change, open an issue first to discuss it before
investing time in a pull request.

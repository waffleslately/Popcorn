# 🍿 Popcorn

**[LIVE LINK → https://popcorn-rm11.onrender.com](https://popcorn-rm11.onrender.com)**

Popcorn is a real-time synchronized cinema watch-party app. Up to 50 friends join a shared room, pick a movie from the built-in TMDB discovery lobby, and watch perfectly in sync — within 3 ms p95 propagation latency. The host controls playback; everyone else sees the exact same frame. Spoiler-safe chat, emoji reactions, a group poll system, and an election-bracket "what to watch next" vote are all included. Hosted on a free tier; **the first load may take up to a minute while the server wakes.**

---

## Features (built)

| ✅ Included | ℹ️ Scope & Enterprise Limitations |
|---|---|
| Synchronized YouTube playback | **DRM streams (Netflix, Disney+)**: Hardware-encrypted (Widevine/FairPlay); Popcorn screens YouTube, HLS, MP4 & web cinema |
| Direct video / stream screening (.mp4, .m3u8, YouTube) | **App Store builds**: Web app runs on mobile browsers; iOS/Android app stores require Apple/Google developer licenses |
| TMDB world movie catalog discovery & live search | **Cloud VOD recording**: Synchronized live viewing without permanent video disk storage |
| Persistent rooms (disk-backed JSON store) | |
| User identity persistence (session & local storage) | |
| Up to 50 seats per room with silhouette theater | |
| Spoiler-safe chat with video timecodes | |
| Emoji reactions burst-animated over seats | |
| Playlist queue with majority-skip voting | |
| Single-choice & elimination-bracket polls | |
| Electron desktop app wrapper | |
| Clock-sync within 3 ms p95 @ 50 clients | |

---

## Tech stack

- **Frontend** — React 18, Vite, Zustand, socket.io-client, HLS.js, fuse.js
- **Backend** — Node.js, Express, Socket.IO
- **Shared** — `@popcorn/shared` — zero-dependency TypeScript types and pure sync math
- **Desktop** — Electron 33 (optional wrapper)
- **Monorepo** — npm workspaces

### Architecture (5 lines)

1. **Server-authoritative sync** — the host sends play/pause/seek; the server broadcasts a `PlaybackState` to every member.
2. **Clock offset** — each client runs a PLL loop (`sampleFromPing` / `bestOffset` in `packages/shared/src/sync.ts`) to compute `serverNow ≈ Date.now() + offset`.
3. **Scheduled effect time** — every `PlaybackState` carries `effectiveAt` (a server timestamp `EFFECT_LEAD_MS=150 ms` in the future); clients schedule execution with `msUntil(effectiveAt)` so everyone acts simultaneously.
4. **Drift correction** — every `DRIFT_CHECK_MS=2000 ms`, `driftFix()` measures lag: `≤ DRIFT_OK_S=0.15 s` → nothing; `≤ DRIFT_SEEK_S=0.5 s` → ±5% playbackRate nudge; `> 0.5 s` → hard seek.
5. **One service on Render** — Express serves `apps/web/dist` as static files with an SPA fallback; Socket.IO shares the same HTTP server; `TMDB_API_KEY` never leaves the server.

---

## Setup

### Prerequisites

- **Node.js ≥ 18** — [nodejs.org](https://nodejs.org)
- Optional: [TMDB API key](https://www.themoviedb.org/settings/api) for movie discovery

### Install & run locally

```bash
# 1. Clone
git clone https://github.com/waffleslately/Popcorn.git
cd Popcorn

# 2. Install all workspace dependencies
npm install

# 3. Copy env template and fill in your TMDB key (optional)
cp .env.example apps/server/.env
# Edit apps/server/.env — set TMDB_API_KEY if you want movie search

# 4. Start both server and web dev server (two processes)
npm run dev
# Server → http://localhost:3000
# Web    → http://localhost:5173
```

### Production build & start (what Render runs)

```bash
npm run build   # builds shared → web → server in order
npm start       # node apps/server/dist/index.js  (serves web dist + socket)
# Open http://localhost:3000
```

---

## Testing with two browser tabs (step by step)

1. Run `npm run build && npm start` and open **http://localhost:3000** in Tab 1.
2. Enter a nickname → click **Start screening** — note the 6-character room code.
3. Open **http://localhost:3000** in Tab 2 → enter a different nickname → paste the room code → click **Join room**.
4. In Tab 1 (host), add a YouTube URL via the Lobby or paste directly, press Play.
5. Watch Tab 2 — playback starts within 150 ms; pause/seek in Tab 1 and observe Tab 2 snaps to the same position within one drift-check cycle (2 s).

---

## Load test results

See [`docs/LATENCY.md`](docs/LATENCY.md) for the full report.

| Clients | p50 propagation | p95 propagation | Drift after fix | Reconnect |
|---|---|---|---|---|
| 10 | < 1 ms | 2 ms | 260 ms | 100% |
| 25 | < 1 ms | 2 ms | 151 ms | 100% |
| 50 | 1 ms | 3 ms | 189 ms | 100% |

All targets met: propagation < 250 ms, drift < 500 ms.

---

## Deploying to Render

1. Push this repo to GitHub (the `render.yaml` blueprint is already in the root).
2. Go to [render.com](https://render.com) → **New → Blueprint** → connect the repo.
3. In the Render dashboard for the `popcorn` service, add the env var `TMDB_API_KEY` manually (it is marked `sync: false` so it is never stored in the blueprint file).
4. Deploy — the first build takes ~3 minutes; subsequent builds are faster.
5. Replace the live link at the top of this file with your `.onrender.com` URL.

> **Note:** Render free-tier services spin down after 15 minutes of inactivity. The "Waking the server" banner is shown in the UI when the first connection takes longer than 3 seconds.

> **Note:** Demo videos should be YouTube content or open-licence material. Popcorn does not host or distribute copyrighted video.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (injected by Render automatically) |
| `TMDB_API_KEY` | — | TMDB v3 key or v4 Bearer token |
| `CORS_ORIGIN` | *(empty)* | Comma-separated allowed origins; empty = same-origin |
| `VITE_SERVER_URL` | *(empty)* | Build-time server URL for the React app; empty = same-origin |

See [`.env.example`](.env.example) for the full annotated list.

---

## License

MIT — watch responsibly 🍿

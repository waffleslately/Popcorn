# 🍿 Popcorn — Synchronized Cinema Watch-Party

**Watch together, in sync, from anywhere.** Popcorn is a real-time watch-party app where friends gather in a virtual cinema: everyone sits in a shared theater under the screen, reactions float up from their seats, and the house lights dim when the film starts.

> **Status:** in development, built in phases. See the [roadmap](#roadmap).

---

## Table of Contents

- [Highlights](#highlights)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running](#running)
- [Desktop App](#desktop-app)
- [Testing](#testing)
- [Load Test](#load-test)
- [Roadmap](#roadmap)
- [Design Decisions](#design-decisions)
- [Environment Variables](#environment-variables)
- [Responsible Use](#responsible-use)

---

## Highlights

- **Join in seconds.** Share a 6-character code, an invite link or a QR code. Guests only need a nickname.
- **Rock-solid sync.** Play, pause and seek stay aligned across everyone, with the server as the single source of truth.
- **Cinema feel.** A theater view with seated members, rising emoji reactions and dimming house lights.
- **Spoiler-safe chat.** Messages and reactions are stamped with video time, so late joiners and rewinders never see the future.
- **Pick what to watch.** Browse by genre, year, rating and language, fuzzy-search titles, build a shared playlist and settle it with group polls or elimination brackets.

---

## Features

### Rooms and presence
- Invite link, 6-character code or QR join
- Late joins catch up to the current position automatically
- Reconnects keep your seat through a grace window
- Host transfer, manual or automatic when the host drops

### Synced playback
- Server-authoritative play, pause and seek
- Concurrent control actions resolved by sequence number
- Per-client clock-offset estimation, plus drift detection and gentle correction
- YouTube IFrame + HTML5/HLS adapters; clock-sync within 50 ms p95

### Social
- Live chat and emoji reactions, both stamped with video time
- Shared playlist and group polls, including elimination brackets
- 6 emoji reactions burst-animate over the theater
- Whisper bubbles float on active chat

### Discovery
- Filters for genre, year, rating and language
- Fuzzy search powered by Fuse.js
- TMDB-backed search + curated fallback cinema if no API key

### Reliability
- Load test and latency report in [`docs/LATENCY.md`](docs/LATENCY.md)
- Grace-window eviction and host succession logic in the server
- p95 propagation 3 ms @ 50 clients; drift correction < 500 ms

---

## Architecture

```
popcorn/ (npm workspaces monorepo)
├── packages/
│   └── shared/          # @popcorn/shared — zero-dependency types + pure sync math
│       ├── protocol.ts  # All shared types: RoomSnapshot, PlaybackState, …
│       └── sync.ts      # sampleFromPing, bestOffset, driftFix, nextHost, …
├── apps/
│   ├── server/          # @popcorn/server — Express + Socket.IO
│   │   ├── store/room-store.ts   # MemoryRoomStore — room lifecycle
│   │   ├── room-manager.ts       # Grace-window eviction, host succession
│   │   ├── server.ts             # createServer() — all socket event handlers
│   │   └── tmdb.ts               # TMDB proxy with TTL cache
│   ├── web/             # @popcorn/web — React 18 + Vite
│   │   ├── lib/player/           # PlayerAdapter, YouTubeAdapter, Html5Adapter, SyncEngine
│   │   ├── lib/socket.ts         # Socket.IO client + crystal-clock sync loop
│   │   ├── stores/room-store.ts  # Zustand store — single source of truth
│   │   └── components/           # BoxOffice, ScreeningRoom, Theater, CinemaPlayer, …
│   └── desktop/         # @popcorn/desktop — Electron main process
└── scripts/
    └── loadtest.ts      # Headless 10/25/50-client load scenarios
```

### Sync Algorithm (Crystal Clock)

Every client runs a PLL-style clock synchronisation loop:

1. **Ping** — emit `clock:ping` with local `Date.now()`.
2. **Pong** — server echoes with `serverTime`; client computes RTT and offset.
3. **Median filter** — `bestOffset()` takes the median of the last 8 samples to reject outlier pings.
4. **Drift correction** — every 2 s, `SyncEngine.checkAndCorrectDrift()` calls `driftFix()`:
   - `|drift| ≤ 80 ms` → rate nudge (playbackRate 0.92–1.08)
   - `|drift| > 80 ms` → hard seek to `targetPosition()`
5. **Scheduled execution** — `applyPlayback()` uses `msUntil(effectiveAt)` to schedule play/pause at the exact server timestamp.

Sync logic lives in `packages/shared` as pure functions, so the client and server run identical code and it can be tested without a network.

---

## Prerequisites

- **Node.js** ≥ 18 (LTS recommended)
- **npm** ≥ 9
- Optional: a [TMDB API key](https://www.themoviedb.org/settings/api) for movie discovery

---

## Setup

```bash
# 1. Clone / unzip the repo
cd popcorn

# 2. Install all workspace dependencies
npm install

# 3. Build the shared package (required before server/web)
npm run build:shared

# 4. Copy the example env and fill in your values
cp .env.example apps/server/.env
# Edit apps/server/.env — at minimum set TMDB_API_KEY if you want discovery
```

---

## Running

You need **two terminals** — one for the server and one for the web dev server.

### Terminal 1 — Server

```bash
npm run dev:server
# Starts Express + Socket.IO on http://localhost:3001
```

### Terminal 2 — Web

```bash
npm run dev:web
# Starts Vite dev server on http://localhost:5173
```

Then open **http://localhost:5173** in your browser (or share the URL with friends on the same network).

### Create a Room

1. Enter your display name and click **Open the Doors** (creates a new room).
2. Share the 6-character room code or QR code with up to 49 friends.
3. The first person to join becomes the **host** and controls playback.

---

## Desktop App

The desktop app is an Electron wrapper around the web app. In development it connects to `http://localhost:5173`.

```bash
# In a third terminal (web dev server must be running)
npm run desktop
```

### Building a distributable

```bash
# Inside apps/desktop
npm run build          # Compiles TypeScript
npm run package        # electron-builder → dist/ folder with .exe / .dmg
```

---

## Testing

```bash
# Run all 49 tests across all packages
npm test

# Run a single package
npx vitest run --project packages/shared
npx vitest run --project apps/server
npx vitest run --project apps/web
```

### Test breakdown

| Package | Test file | Tests |
|---|---|---|
| `@popcorn/shared` | `sync.test.ts` | 23 |
| `@popcorn/server` | `room.test.ts` | 12 |
| `@popcorn/server` | `e2e-rooms.test.ts` | 3 |
| `@popcorn/server` | `e2e-sync.test.ts` | 1 |
| `@popcorn/server` | `e2e-chat-reactions.test.ts` | 3 |
| `@popcorn/server` | `e2e-playlist-polls.test.ts` | 3 |
| `@popcorn/web` | `sync-engine.test.ts` | 4 |
| **Total** | | **49** |

---

## Load Test

```bash
npm run loadtest
# Runs headless 10, 25, and 50-client scenarios
# Writes results to docs/LATENCY.md
```

Latest results (see [docs/LATENCY.md](docs/LATENCY.md)):

| Scenario | p95 propagation | Drift after fix | Reconnect |
|---|---|---|---|
| 10 clients | 2 ms | 260 ms | 100 % |
| 25 clients | 2 ms | 151 ms | 100 % |
| 50 clients | 3 ms | 189 ms | 100 % |

All well within targets: propagation < 250 ms, drift < 500 ms.

---

## Roadmap

- [ ] **0. Foundations:** scaffold and sync unit tests
- [ ] **1. Rooms:** presence, reconnect, host transfer
- [ ] **2. Playback:** synced playback and drift correction
- [ ] **3. Social:** chat and reactions
- [ ] **4. Discovery:** search, playlist, polls
- [ ] **5. Performance:** load test and latency report
- [ ] **6. Theater:** seating, reaction heatmap, health panel
- [ ] **7. Diary:** watch log and ratings
- [ ] **8. Sources:** file upload, host-stream and external sources

---

## Design Decisions

### Design Token System (`tokens.css`)

All colours and spacing are CSS custom properties organised around a cinema metaphor:

| Palette | Purpose |
|---|---|
| `--velvet-*` | Deep reds — brand, accents, host controls |
| `--brass-*` | Warm golds — highlights, timecodes, host crown |
| `--kernel-*` | Popcorn yellows — reactions, poll bars |
| `--beam-*` | Projector whites — primary text |
| `--pit-*` | Dark greys/blacks — surfaces, seats, drawers |

The `--lights` variable (0 → 1) drives house-light dimming: Theater background fades to pitch black when a video is playing.

### Host Succession

When the host disconnects, a **30 s grace window** starts. If they reconnect within the window (matching their stored token), they reclaim the host role. Otherwise, `nextHost()` picks the longest-tenured member.

### Spoiler-safe Chat

Chat messages carry `videoTimeS` (the host's current playback position at send time). If your local position is behind the message's timestamp, the text is shown blurred until you reach that point in the video.

### Rate Limiting

- Chat: 2 messages / 2 s per socket (token bucket)
- Reactions: 1 / 1 s per socket
- Polls: host-only creation; vote changes accepted freely

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP + WebSocket server port |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS origin for the web client |
| `TMDB_API_KEY` | _(empty)_ | TMDB v3 API key or v4 Bearer token |

Copy `.env.example` to `apps/server/.env` to get started.

---

## Responsible Use

Only share content you have the right to share. Demos use YouTube, open-licensed films or your own files.

---

## Acknowledgements

This product uses the TMDB API but is not endorsed or certified by TMDB.

---

## License

MIT — watch responsibly 🍿
a


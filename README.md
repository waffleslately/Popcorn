# 🍿 Popcorn

**Watch together, in sync, from anywhere.** Popcorn is a real-time watch-party app where friends gather in a virtual cinema: everyone sits in a shared theater under the screen, reactions float up from their seats, and the house lights dim when the film starts.

> **Status:** in development, built in phases. See the [roadmap](#roadmap).

## Highlights

- **Join in seconds.** Share a 6-character code, an invite link or a QR code. Guests only need a nickname.
- **Rock-solid sync.** Play, pause and seek stay aligned across everyone, with the server as the single source of truth.
- **Cinema feel.** A theater view with seated members, rising emoji reactions and dimming house lights.
- **Spoiler-safe chat.** Messages and reactions are stamped with video time, so late joiners and rewinders never see the future.
- **Pick what to watch.** Browse by genre, year, rating and language, fuzzy-search titles, build a shared playlist and settle it with group polls or elimination brackets.

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

### Social
- Live chat and emoji reactions, both stamped with video time
- Shared playlist and group polls, including elimination brackets

### Discovery
- Filters for genre, year, rating and language
- Fuzzy search powered by Fuse.js

### Reliability
- Load test and latency report in [`docs/LATENCY.md`](docs/LATENCY.md)

## Tech stack

| Layer | Tools |
| --- | --- |
| Web | React, Vite, TypeScript, Zustand, Fuse.js, hls.js |
| Server | Node, Express, Socket.IO, TypeScript |
| Shared | Typed event protocol and pure sync logic, unit-tested with Vitest |
| Data | TMDB (movie metadata), Supabase (accounts and diary), Redis (room state at scale) |

## Project layout

```
apps/
  web/          React client
  server/       Socket.IO + REST server
packages/
  shared/       Protocol types and sync logic (used by both apps)
docs/           Design notes and the latency report
```

Sync logic lives in `packages/shared` as pure functions, so the client and server run identical code and it can be tested without a network.

## Getting started

**Prerequisites:** Node.js (current LTS) and a free [TMDB API key](https://www.themoviedb.org/settings/api).

```bash
cp .env.example .env     # add your TMDB_API_KEY
npm install
npm run dev
```

Then open the web app, create a room and share the code with a friend (or open a second tab to try it solo).

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

## Responsible use

Only share content you have the right to share. Demos use YouTube, open-licensed films or your own files.

## Acknowledgements

This product uses the TMDB API but is not endorsed or certified by TMDB.

import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  LIMITS,
  applyControl,
  type ClientToServer,
  type Control,
  type ControlMode,
  type Id,
  type PlaybackState,
  type ReactionKind,
  type ServerToClient,
  type Source,
} from '@popcorn/shared';
import { MemoryRoomStore, PersistentRoomStore, type RoomStore } from './store/room-store';
import { RoomManager } from './room-manager';
import { fetchTMDB, extractTrailerKey } from './tmdb';

/** Parse CORS_ORIGIN env (comma-separated list) or fall back to same-origin (null). */
function parseCorsOrigins(): string | string[] | null {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) return null; // same-origin — no CORS header needed
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? list[0] : list;
}

export function createServer(customStore?: RoomStore) {
  const store = customStore ?? new PersistentRoomStore();
  const app = express();
  const server = http.createServer(app);

  const corsOrigins = parseCorsOrigins();

  // Only attach CORS middleware when origins are explicitly configured
  if (corsOrigins) {
    app.use(cors({ origin: corsOrigins, credentials: true }));
  }

  app.use(express.json());

  // ── Static file serving (production) ──────────────────────────────────────
  // Serve the built React app. In production (Render), the web dist is placed
  // at a known relative path from the compiled server output or cwd.
  const candidateA = path.resolve(__dirname, '..', '..', 'web', 'dist');
  const candidateB = path.resolve(process.cwd(), 'apps', 'web', 'dist');
  const webDist = fs.existsSync(candidateA) ? candidateA : candidateB;
  // ── Uploads & Video streaming ───────────────────────────────────────────
  const uploadDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp4';
      const safeBase = path.basename(file.originalname, ext).replace(/[^\w-]/g, '_');
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${safeBase}-${unique}${ext}`);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 1024 * 1024 * 1024, // 1 GB max video size
    },
  });

  // Serve built web app in production
  app.use(express.static(webDist));

  // Serve uploaded videos with HTTP range support (native to express.static)
  app.use('/api/videos', express.static(uploadDir, {
    acceptRanges: true,
  }));

  // Socket.IO Server
  const io = new SocketIOServer<ClientToServer, ServerToClient>(server, {
    cors: corsOrigins
      ? { origin: corsOrigins, credentials: true }
      : undefined, // same-origin — no CORS config needed
    pingInterval: LIMITS.HEARTBEAT_MS,
    pingTimeout: 10000,
  });

  const roomEvents = {
    onMemberUpdated: (code: string, member: any) => {
      io.to(code).emit('member:update', member);
    },
    onMemberLeft: (code: string, memberId: string) => {
      io.to(code).emit('member:left', { id: memberId });
    },
    onHostChanged: (code: string, newHostId: string, reason: 'manual' | 'disconnect') => {
      io.to(code).emit('host:changed', { hostId: newHostId, reason });
    },
    onSnapshotNeeded: async (code: string) => {
      const room = await store.getRoom(code);
      if (!room) return;
      const sockets = await io.in(code).fetchSockets();
      for (const s of sockets) {
        const mId = s.data?.memberId;
        if (mId) {
          s.emit('room:snapshot', roomManager.getSnapshot(room, mId));
        }
      }
    },
  };

  const roomManager = new RoomManager(store, roomEvents);

  // Active socket sessions: map of token -> socketId
  const tokenToSocketId = new Map<string, string>();
  // Replaced sockets set to ignore disconnect cleanup
  const replacedSocketIds = new Set<string>();

  // Rate limiting helper: ip -> timestamps[]
  const roomCreationIps = new Map<string, number[]>();
  function checkRoomRateLimit(ip: string): boolean {
    const now = Date.now();
    const timestamps = roomCreationIps.get(ip) || [];
    const recent = timestamps.filter((t) => now - t < 60_000);
    if (recent.length >= 20) return false;
    recent.push(now);
    roomCreationIps.set(ip, recent);
    return true;
  }

  // Member rate limiters (chat and reactions)
  const chatTimestamps = new Map<string, number[]>();
  const reactionTimestamps = new Map<string, number[]>();

  function checkRateLimit(map: Map<string, number[]>, id: string, maxPer5s: number): boolean {
    const now = Date.now();
    const timestamps = map.get(id) || [];
    const recent = timestamps.filter((t) => now - t < 5000);
    if (recent.length >= maxPer5s) return false;
    recent.push(now);
    map.set(id, recent);
    return true;
  }

  /* ---------- REST Endpoints ---------- */

  // GET /health — used by Render's health check
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // POST /api/rooms
  app.post('/api/rooms', async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRoomRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many rooms created. Please wait a moment.' });
    }
    try {
      const code = await roomManager.createRoom();
      return res.status(201).json({ code });
    } catch {
      return res.status(500).json({ error: 'Failed to create room' });
    }
  });

  // POST /api/upload — upload video from device gallery / disk
  app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    const cleanTitle = path.basename(req.file.originalname, path.extname(req.file.originalname));
    res.status(201).json({
      url: `/api/videos/${encodeURIComponent(req.file.filename)}`,
      title: cleanTitle || 'Uploaded Film',
      filename: req.file.filename,
      size: req.file.size,
    });
  });

  // GET /api/rooms/:code
  app.get('/api/rooms/:code', async (req, res) => {
    const code = req.params.code?.toUpperCase();
    const room = await roomManager.getRoom(code);
    if (!room) {
      return res.json({
        exists: false,
        seatsTaken: 0,
        seatsMax: LIMITS.ROOM_MAX,
        sourceTitle: null,
      });
    }
    return res.json({
      exists: true,
      seatsTaken: room.members.filter((m) => m.connected).length,
      seatsMax: LIMITS.ROOM_MAX,
      sourceTitle: room.source?.title ?? null,
    });
  });

  // TMDB Endpoints — server-side proxy; TMDB_API_KEY never leaves the server
  app.get('/api/tmdb/genres', async (_req, res) => {
    try {
      const data = await fetchTMDB('/genre/movie/list');
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/tmdb/discover', async (req, res) => {
    try {
      const { genre, year, minRating, language, sort, page } = req.query;
      const params: Record<string, string | number | undefined> = {
        with_genres: genre ? String(genre) : undefined,
        primary_release_year: year ? Number(year) : undefined,
        'vote_average.gte': minRating ? Number(minRating) : undefined,
        with_original_language: language ? String(language) : undefined,
        sort_by: sort ? String(sort) : 'popularity.desc',
        page: page ? Math.max(1, Number(page)) : 1,
      };
      const data = await fetchTMDB('/discover/movie', params);
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/tmdb/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
      if (!q) {
        return res.status(400).json({ error: 'Search query q is required' });
      }
      const data = await fetchTMDB('/search/movie', { query: q, page });
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/tmdb/movie/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Invalid movie ID' });
      }
      const data: any = await fetchTMDB(`/movie/${id}`, {
        append_to_response: 'videos,credits',
      });
      const trailerKey = extractTrailerKey(data.videos);
      res.json({ ...data, trailerKey });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  /* ---------- Socket.IO Handlers ---------- */

  io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
    // Ping/Pong for clock sync
    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') {
        ack(Date.now());
      }
    });

    // Room Join
    socket.on('room:join', async (p, ack) => {
      if (!p || typeof p.code !== 'string' || typeof p.nickname !== 'string') {
        if (typeof ack === 'function') ack({ ok: false, error: 'BAD_NAME' });
        return;
      }

      const { result, member } = await roomManager.joinRoom({
        code: p.code,
        nickname: p.nickname,
        token: p.token,
      });

      if (!result.ok || !member) {
        if (typeof ack === 'function') ack(result);
        return;
      }

      // Check if previous socket exists for this token
      const existingSocketId = tokenToSocketId.get(result.token);
      if (existingSocketId && existingSocketId !== socket.id) {
        replacedSocketIds.add(existingSocketId);
        const prevSocket = io.sockets.sockets.get(existingSocketId);
        if (prevSocket) {
          prevSocket.disconnect(true);
        }
      }

      tokenToSocketId.set(result.token, socket.id);
      socket.data = {
        code: result.snapshot.code,
        memberId: member.id,
        token: result.token,
      };

      await socket.join(result.snapshot.code);

      // Notify others of member update
      socket.to(result.snapshot.code).emit('member:update', member);

      if (typeof ack === 'function') {
        ack(result);
      }
    });

    // Playback control
    socket.on('playback:control', async (c: Control, ack) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const member = room.members.find((m) => m.id === memberId);
      if (!member) return;

      const ctx = {
        isHost: member.isHost,
        controlMode: room.controlMode,
        now: Date.now(),
      };

      const res = applyControl(room.playback, c, ctx);
      if (res.accepted) {
        room.playback = res.state;
        room.lastActiveAt = Date.now();
        await store.saveRoom(room);
        io.to(code).emit('playback:state', {
          ...res.state,
          serverNow: Date.now(),
        });
      }

      if (typeof ack === 'function') {
        ack(res);
      }
    });

    // Drift report
    socket.on('drift:report', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const member = room.members.find((m) => m.id === memberId);
      if (!member) return;

      member.driftMs = Math.round(p.driftMs);
      member.pingMs = Math.round(p.pingMs);
      await store.saveRoom(room);
      io.to(code).emit('member:update', member);
    });

    // Ready status
    socket.on('ready:set', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const member = room.members.find((m) => m.id === memberId);
      if (!member) return;

      member.ready = Boolean(p.ready);
      await store.saveRoom(room);
      io.to(code).emit('member:update', member);
    });

    // Chat
    socket.on('chat:send', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      if (!checkRateLimit(chatTimestamps, memberId, LIMITS.CHAT_PER_5S)) {
        return;
      }

      const text = p.text?.trim();
      if (!text || text.length > LIMITS.CHAT_MAX_LEN) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const msg = {
        id: crypto.randomUUID(),
        memberId,
        text,
        videoTimeS: Math.max(0, p.videoTimeS || 0),
        sentAt: Date.now(),
      };

      room.chat.push(msg);
      if (room.chat.length > LIMITS.CHAT_HISTORY) {
        room.chat.shift();
      }
      room.lastActiveAt = Date.now();
      await store.saveRoom(room);

      io.to(code).emit('chat:message', msg);
    });

    // Reactions
    socket.on('reaction:send', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      if (!checkRateLimit(reactionTimestamps, memberId, LIMITS.REACTIONS_PER_5S)) {
        return;
      }

      const allowedKinds: ReactionKind[] = ['pop', 'laugh', 'gasp', 'cry', 'clap', 'fire'];
      if (!allowedKinds.includes(p.kind)) return;

      const reaction = {
        id: crypto.randomUUID(),
        memberId,
        kind: p.kind,
        videoTimeS: Math.max(0, p.videoTimeS || 0),
      };

      io.to(code).emit('reaction:burst', reaction);
    });

    // Host Transfer
    socket.on('host:transfer', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId || !p.toMemberId) return;

      await roomManager.transferHost(code, memberId, p.toMemberId);
    });

    // Control Mode Change
    socket.on('host:set_control_mode', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      if (p.mode === 'host' || p.mode === 'everyone') {
        await roomManager.setControlMode(code, memberId, p.mode);
      }
    });

    // Source change (movie change)
    socket.on('source:change', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room || room.hostId !== memberId) return;

      room.source = p.source;
      room.playback = {
        status: 'paused',
        positionS: 0,
        effectiveAt: Date.now(),
        seq: room.playback.seq + 1,
      };

      // Playlist auto-advance: if host selects the next queued item, remove it from playlist
      let playlistChanged = false;
      if (p.source && room.playlist.length > 0) {
        const nextItem = room.playlist[0];
        if (
          nextItem.source.kind === p.source.kind &&
          nextItem.source.ref === p.source.ref
        ) {
          room.playlist.shift();
          playlistChanged = true;
        }
      }

      room.lastActiveAt = Date.now();
      await store.saveRoom(room);

      io.to(code).emit('source:changed', { source: p.source });
      io.to(code).emit('playback:state', { ...room.playback, serverNow: Date.now() });
      if (playlistChanged) {
        io.to(code).emit('playlist:update', room.playlist);
      }
    });

    // Playlist management
    socket.on('playlist:add', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId || !p.source) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const item = {
        id: crypto.randomUUID(),
        source: p.source,
        addedBy: memberId,
        skipVotes: [],
      };

      room.playlist.push(item);
      await store.saveRoom(room);
      io.to(code).emit('playlist:update', room.playlist);
    });

    socket.on('playlist:remove', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId || !p.itemId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const idx = room.playlist.findIndex((item) => item.id === p.itemId);
      if (idx !== -1) {
        const item = room.playlist[idx];
        if (room.hostId === memberId || item.addedBy === memberId) {
          room.playlist.splice(idx, 1);
          await store.saveRoom(room);
          io.to(code).emit('playlist:update', room.playlist);
        }
      }
    });

    socket.on('playlist:vote_skip', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId || !p.itemId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const item = room.playlist.find((it) => it.id === p.itemId);
      if (!item) return;

      const voteIdx = item.skipVotes.indexOf(memberId);
      if (voteIdx === -1) {
        item.skipVotes.push(memberId);
      } else {
        item.skipVotes.splice(voteIdx, 1);
      }

      const connectedMembers = room.members.filter((m) => m.connected).length;
      if (item.skipVotes.length > connectedMembers / 2) {
        // Majority voted to skip
        room.playlist = room.playlist.filter((it) => it.id !== p.itemId);
      }

      await store.saveRoom(room);
      io.to(code).emit('playlist:update', room.playlist);
    });

    // Polls
    socket.on('poll:create', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const poll = {
        id: crypto.randomUUID(),
        kind: p.kind,
        question: p.question.trim(),
        options: p.options.map((opt) => ({
          id: crypto.randomUUID(),
          label: opt.label.trim(),
          tmdbId: opt.tmdbId,
          votes: [],
        })),
        status: 'open' as const,
        round: p.kind === 'elimination' ? 1 : undefined,
      };

      room.polls.push(poll);
      await store.saveRoom(room);
      io.to(code).emit('poll:update', poll);
    });

    socket.on('poll:vote', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room) return;

      const poll = room.polls.find((pl) => pl.id === p.pollId && pl.status === 'open');
      if (!poll) return;

      // Remove existing vote by member from any options in this poll
      for (const opt of poll.options) {
        opt.votes = opt.votes.filter((id) => id !== memberId);
      }

      const targetOpt = poll.options.find((opt) => opt.id === p.optionId && !opt.eliminated);
      if (targetOpt) {
        targetOpt.votes.push(memberId);
      }

      await store.saveRoom(room);
      io.to(code).emit('poll:update', poll);
    });

    socket.on('poll:close', async (p) => {
      const { code, memberId } = socket.data || {};
      if (!code || !memberId) return;

      const room = await store.getRoom(code);
      if (!room || room.hostId !== memberId) return;

      const poll = room.polls.find((pl) => pl.id === p.pollId && pl.status === 'open');
      if (!poll) return;

      if (poll.kind === 'single') {
        poll.status = 'closed';
      } else if (poll.kind === 'elimination') {
        const remaining = poll.options.filter((o) => !o.eliminated);
        if (remaining.length <= 1) {
          poll.status = 'closed';
        } else {
          const firstVotes = remaining[0].votes.length;
          const allEqual = remaining.every((o) => o.votes.length === firstVotes);
          if (allEqual) {
            poll.status = 'closed';
          } else {
            let minVotes = Infinity;
            for (const o of remaining) {
              if (o.votes.length < minVotes) minVotes = o.votes.length;
            }
            for (const o of remaining) {
              if (o.votes.length === minVotes) {
                o.eliminated = true;
              }
            }
            for (const o of poll.options) {
              o.votes = [];
            }
            poll.round = (poll.round || 1) + 1;
          }
        }
      }

      await store.saveRoom(room);
      io.to(code).emit('poll:update', poll);
    });

    // Disconnect handler
    socket.on('disconnect', async () => {
      if (replacedSocketIds.has(socket.id)) {
        replacedSocketIds.delete(socket.id);
        return;
      }

      const { code, memberId, token } = socket.data || {};
      if (token && tokenToSocketId.get(token) === socket.id) {
        tokenToSocketId.delete(token);
      }

      if (code && memberId) {
        await roomManager.handleDisconnect(code, memberId);
      }
    });
  });

  // ── SPA Fallback ───────────────────────────────────────────────────────────
  // Must be AFTER all API routes. Sends index.html for any non-API, non-socket
  // path so that direct links like /r/ABC123 load the React app.
  app.get('*', (req, res, next) => {
    // Let express-static 404s on assets fall through to real 404
    if (req.path.startsWith('/api/') || req.path === '/health') {
      return next();
    }
    const indexPath = path.join(webDist, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) next(); // no dist in dev — that's fine
    });
  });

  return { app, server, io, roomManager, store };
}

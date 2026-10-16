import { create } from 'zustand';
import {
  type Control,
  type ControlMode,
  type Id,
  type JoinResult,
  type Member,
  type PlaybackState,
  type Reaction,
  type ReactionKind,
  type RoomSnapshot,
  type Source,
} from '@popcorn/shared';
import { socket, startClockSyncLoop, stopClockSyncLoop, syncClock } from '../lib/socket';

/**
 * Derive the API base URL the same way socket.ts does:
 * VITE_SERVER_URL if set, otherwise same-origin.
 */
const API_BASE: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;

interface RoomState {
  code: string;
  nickname: string;
  token: string;
  snapshot: RoomSnapshot | null;
  error: string | null;
  isConnecting: boolean;
  /** True when the initial connection is taking longer than 3 s */
  isWakingServer: boolean;
  activeReactions: Reaction[];
  activeWhispers: Array<{ id: string; memberId: string; text: string }>;

  setNickname: (nickname: string) => void;
  createRoom: () => Promise<string | null>;
  joinRoom: (code: string, nickname: string) => Promise<boolean>;
  leaveRoom: () => void;
  transferHost: (toMemberId: Id) => void;
  setControlMode: (mode: ControlMode) => void;
  sendControl: (c: Control) => Promise<{ accepted: boolean; state: PlaybackState }>;
  changeSource: (source: Source | null) => void;
  sendReady: (ready: boolean) => void;
  reportDrift: (driftMs: number, pingMs: number) => void;
  sendChat: (text: string, videoTimeS: number) => void;
  sendReaction: (kind: ReactionKind, videoTimeS: number) => void;
  initSocketListeners: () => void;
}

const SESSION_KEY = 'popcorn_session';

function saveSession(data: { code: string; token: string; nickname: string }) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function loadSession(): { code: string; token: string; nickname: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

let listenersInitialized = false;

/** Timer handle for the "waking server" banner (3 s after connect attempt) */
let wakingTimer: ReturnType<typeof setTimeout> | null = null;

function startWakingTimer() {
  if (wakingTimer) return;
  wakingTimer = setTimeout(() => {
    useRoomStore.setState({ isWakingServer: true });
  }, 3000);
}

function clearWakingTimer() {
  if (wakingTimer) {
    clearTimeout(wakingTimer);
    wakingTimer = null;
  }
  useRoomStore.setState({ isWakingServer: false });
}

export const useRoomStore = create<RoomState>((set, get) => ({
  code: '',
  nickname: '',
  token: '',
  snapshot: null,
  error: null,
  isConnecting: false,
  isWakingServer: false,
  activeReactions: [],
  activeWhispers: [],

  setNickname: (nickname: string) => set({ nickname }),

  initSocketListeners: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    socket.on('connect', async () => {
      clearWakingTimer();
      const { code, token, nickname } = get();
      if (code && token && nickname) {
        // Reconnect with existing token
        socket.emit('room:join', { code, nickname, token }, (res: JoinResult) => {
          if (res.ok) {
            set({ snapshot: res.snapshot, error: null });
            startClockSyncLoop();
          } else {
            set({ error: getFriendlyErrorMessage(res.error) });
          }
        });
      }
    });

    socket.on('room:snapshot', (snapshot) => {
      set({ snapshot });
    });

    socket.on('member:update', (member: Member) => {
      const snap = get().snapshot;
      if (!snap) return;
      const idx = snap.members.findIndex((m) => m.id === member.id);
      let updatedMembers: Member[];
      if (idx !== -1) {
        updatedMembers = [...snap.members];
        updatedMembers[idx] = member;
      } else {
        updatedMembers = [...snap.members, member];
      }
      set({ snapshot: { ...snap, members: updatedMembers } });
    });

    socket.on('member:left', ({ id }) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({
        snapshot: {
          ...snap,
          members: snap.members.filter((m) => m.id !== id),
        },
      });
    });

    socket.on('host:changed', ({ hostId }) => {
      const snap = get().snapshot;
      if (!snap) return;
      const updatedMembers = snap.members.map((m) => ({
        ...m,
        isHost: m.id === hostId,
      }));
      set({
        snapshot: {
          ...snap,
          hostId,
          members: updatedMembers,
        },
      });
    });

    socket.on('source:changed', ({ source }) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({ snapshot: { ...snap, source } });
    });

    socket.on('playback:state', (playback) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({ snapshot: { ...snap, playback } });
    });

    socket.on('playlist:update', (playlist) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({ snapshot: { ...snap, playlist } });
    });

    socket.on('poll:update', (poll) => {
      const snap = get().snapshot;
      if (!snap) return;
      const idx = snap.polls.findIndex((p) => p.id === poll.id);
      let updatedPolls = [...snap.polls];
      if (idx !== -1) {
        updatedPolls[idx] = poll;
      } else {
        updatedPolls.push(poll);
      }
      set({ snapshot: { ...snap, polls: updatedPolls } });
    });

    socket.on('chat:message', (msg) => {
      const snap = get().snapshot;
      if (!snap) return;
      set({
        snapshot: { ...snap, chat: [...snap.chat, msg] },
        activeWhispers: [
          ...get().activeWhispers,
          { id: msg.id, memberId: msg.memberId, text: msg.text },
        ],
      });
      setTimeout(() => {
        set((s) => ({
          activeWhispers: s.activeWhispers.filter((w) => w.id !== msg.id),
        }));
      }, 3800);
    });

    socket.on('reaction:burst', (reaction) => {
      set((s) => ({
        activeReactions: [...s.activeReactions, reaction],
      }));
      setTimeout(() => {
        set((s) => ({
          activeReactions: s.activeReactions.filter((r) => r.id !== reaction.id),
        }));
      }, 3500);
    });

    // Check saved session on startup
    const saved = loadSession();
    if (saved && saved.code && saved.token) {
      set({ code: saved.code, token: saved.token, nickname: saved.nickname });
      if (!socket.connected) {
        startWakingTimer();
        socket.connect();
      }
    }
  },

  createRoom: async () => {
    set({ isConnecting: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create room');
      }
      const data = await res.json();
      set({ isConnecting: false });
      return data.code;
    } catch (err: any) {
      set({ isConnecting: false, error: err.message });
      return null;
    }
  },

  joinRoom: async (code: string, nickname: string) => {
    const cleanCode = code.trim().toUpperCase();
    const cleanNick = nickname.trim();

    if (!cleanCode) {
      set({ error: 'Please enter a 6-character room code.' });
      return false;
    }
    if (!cleanNick) {
      set({ error: 'Please choose a nickname (1 to 20 characters).' });
      return false;
    }

    set({ isConnecting: true, error: null });

    if (!socket.connected) {
      startWakingTimer();
      socket.connect();
    }

    return new Promise<boolean>((resolve) => {
      const existingToken = get().token;
      socket.emit(
        'room:join',
        { code: cleanCode, nickname: cleanNick, token: existingToken || undefined },
        (res: JoinResult) => {
          clearWakingTimer();
          set({ isConnecting: false });
          if (!res.ok) {
            const err = getFriendlyErrorMessage(res.error);
            set({ error: err });
            resolve(false);
            return;
          }

          set({
            code: cleanCode,
            nickname: cleanNick,
            token: res.token,
            snapshot: res.snapshot,
            error: null,
          });

          saveSession({
            code: cleanCode,
            token: res.token,
            nickname: cleanNick,
          });

          startClockSyncLoop();
          syncClock();
          resolve(true);
        }
      );
    });
  },

  leaveRoom: () => {
    clearWakingTimer();
    stopClockSyncLoop();
    clearSession();
    if (socket.connected) {
      socket.disconnect();
    }
    set({
      code: '',
      token: '',
      snapshot: null,
      error: null,
      activeReactions: [],
      isWakingServer: false,
    });
  },

  transferHost: (toMemberId: Id) => {
    socket.emit('host:transfer', { toMemberId });
  },

  setControlMode: (mode: ControlMode) => {
    socket.emit('host:set_control_mode', { mode });
  },

  sendControl: (c: Control) => {
    return new Promise((resolve) => {
      socket.emit('playback:control', c, (res) => {
        resolve(res);
      });
    });
  },

  changeSource: (source: Source | null) => {
    socket.emit('source:change', { source });
  },

  sendReady: (ready: boolean) => {
    socket.emit('ready:set', { ready });
  },

  reportDrift: (driftMs: number, pingMs: number) => {
    socket.emit('drift:report', { driftMs, pingMs });
  },

  sendChat: (text: string, videoTimeS: number) => {
    if (!text.trim()) return;
    socket.emit('chat:send', { text: text.trim(), videoTimeS: Math.max(0, videoTimeS) });
  },

  sendReaction: (kind: ReactionKind, videoTimeS: number) => {
    socket.emit('reaction:send', { kind, videoTimeS: Math.max(0, videoTimeS) });
  },
}));

function getFriendlyErrorMessage(error: 'NOT_FOUND' | 'FULL' | 'BAD_NAME'): string {
  switch (error) {
    case 'NOT_FOUND':
      return "This room code doesn't exist. Check the six characters.";
    case 'FULL':
      return 'This screening room is full. Maximum 50 members reached.';
    case 'BAD_NAME':
      return 'Nickname must be between 1 and 20 characters with no control symbols.';
  }
}

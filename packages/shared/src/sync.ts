// Pure, framework-free sync logic. Unit-test this; keep sockets/players out of it.
import { LIMITS, type Control, type Member, type PlaybackState } from './protocol';

/* ---------- Clock sync (client side) ---------- */

export interface ClockSample { rtt: number; offset: number; }

/** t0 = client send time, serverNow = server's reply timestamp, t1 = client receive time. */
export function sampleFromPing(t0: number, serverNow: number, t1: number): ClockSample {
  const rtt = t1 - t0;
  return { rtt, offset: serverNow + rtt / 2 - t1 }; // serverTime ≈ clientTime + offset
}

/** Median offset of the lowest-RTT half of samples (rejects network spikes). */
export function bestOffset(samples: ClockSample[]): number {
  if (!samples.length) return 0;
  const keep = [...samples]
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, Math.max(1, Math.ceil(samples.length / 2)))
    .map((s) => s.offset)
    .sort((a, b) => a - b);
  return keep[Math.floor(keep.length / 2)];
}

export const toServerTime = (clientNow: number, offset: number) => clientNow + offset;

/** How long (ms) the client should wait before applying a state with this effectiveAt. */
export const msUntil = (effectiveAt: number, clientNow: number, offset: number) =>
  Math.max(0, effectiveAt - toServerTime(clientNow, offset));

/* ---------- Where should the video be right now? ---------- */

export function targetPosition(st: PlaybackState, serverNow: number): number {
  if (st.status === 'paused') return st.positionS;
  return st.positionS + Math.max(0, serverNow - st.effectiveAt) / 1000;
}

/* ---------- Server-side reducer for playback controls ---------- */

export interface ControlContext {
  isHost: boolean;
  controlMode: 'host' | 'everyone';
  now: number; // server epoch ms
}

/**
 * Returns the new state if accepted, otherwise the unchanged state (client should snap to it).
 * Rejected when: not permitted, or stale (baseSeq < current seq => someone else acted first).
 */
export function applyControl(
  cur: PlaybackState,
  c: Control,
  ctx: ControlContext,
): { accepted: boolean; state: PlaybackState } {
  const allowed = ctx.isHost || ctx.controlMode === 'everyone';
  if (!allowed || c.baseSeq < cur.seq) return { accepted: false, state: cur };

  const positionS = Math.max(0, c.positionS);
  const seq = cur.seq + 1;

  switch (c.action) {
    case 'play':
      return { accepted: true, state: { status: 'playing', positionS, effectiveAt: ctx.now + LIMITS.EFFECT_LEAD_MS, seq } };
    case 'seek':
      return { accepted: true, state: { status: cur.status, positionS, effectiveAt: ctx.now + LIMITS.EFFECT_LEAD_MS, seq } };
    case 'pause':
      return { accepted: true, state: { status: 'paused', positionS, effectiveAt: ctx.now, seq } };
  }
}

/* ---------- Client-side drift correction ---------- */

export type DriftFix =
  | { type: 'rate'; rate: number }   // set playbackRate (1 = normal)
  | { type: 'seek'; toS: number };

/** Call every LIMITS.DRIFT_CHECK_MS with the player's current time and the target. */
export function driftFix(playerS: number, targetS: number, status: PlaybackState['status']): DriftFix {
  const d = playerS - targetS; // positive = ahead of the room
  const a = Math.abs(d);
  if (status === 'paused') return a > 0.1 ? { type: 'seek', toS: targetS } : { type: 'rate', rate: 1 };
  if (a < LIMITS.DRIFT_OK_S) return { type: 'rate', rate: 1 };
  if (a < LIMITS.DRIFT_SEEK_S) return { type: 'rate', rate: d > 0 ? 1 - LIMITS.RATE_NUDGE : 1 + LIMITS.RATE_NUDGE };
  return { type: 'seek', toS: targetS };
}

/* ---------- Host succession ---------- */

/** Longest-present connected member who isn't leaving. Null if nobody is left. */
export function nextHost(members: Member[], leavingId: string): string | null {
  const c = members.filter((m) => m.connected && m.id !== leavingId).sort((a, b) => a.joinedAt - b.joinedAt);
  return c[0]?.id ?? null;
}

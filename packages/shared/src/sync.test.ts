import { describe, it, expect } from 'vitest';
import { LIMITS, type Member, type PlaybackState } from './protocol';
import {
  sampleFromPing, bestOffset, msUntil, targetPosition, applyControl, driftFix, nextHost,
} from './sync';

const paused = (over: Partial<PlaybackState> = {}): PlaybackState =>
  ({ status: 'paused', positionS: 0, effectiveAt: 0, seq: 3, ...over });

describe('clock sync', () => {
  it('computes rtt and offset from a ping', () => {
    const s = sampleFromPing(1000, 5000, 1100);
    expect(s.rtt).toBe(100);
    expect(s.offset).toBe(3950);
  });
  it('returns 0 with no samples', () => expect(bestOffset([])).toBe(0));
  it('ignores high-RTT spikes', () => {
    const off = bestOffset([
      { rtt: 20, offset: 100 }, { rtt: 30, offset: 102 },
      { rtt: 500, offset: 400 }, { rtt: 600, offset: 900 },
    ]);
    expect(off).toBe(102);
  });
  it('waits until the scheduled effect time, never negative', () => {
    expect(msUntil(10_150, 1000, 9000)).toBe(150);
    expect(msUntil(9_000, 1000, 9000)).toBe(0);
  });
});

describe('targetPosition', () => {
  it('stays put while paused', () =>
    expect(targetPosition(paused({ positionS: 42 }), 99_999)).toBe(42));
  it('advances in real time while playing', () =>
    expect(targetPosition({ status: 'playing', positionS: 10, effectiveAt: 5000, seq: 1 }, 7000)).toBe(12));
  it('does not run backwards before effectiveAt', () =>
    expect(targetPosition({ status: 'playing', positionS: 10, effectiveAt: 5000, seq: 1 }, 4000)).toBe(10));
});

describe('applyControl', () => {
  const host = { isHost: true, controlMode: 'host' as const, now: 100_000 };
  const guest = { isHost: false, controlMode: 'host' as const, now: 100_000 };

  it('rejects a stale control and returns the current state', () => {
    const cur = paused();
    const r = applyControl(cur, { action: 'play', positionS: 5, baseSeq: 2 }, host);
    expect(r.accepted).toBe(false);
    expect(r.state).toBe(cur);
  });
  it('rejects non-host in host mode', () =>
    expect(applyControl(paused(), { action: 'play', positionS: 5, baseSeq: 3 }, guest).accepted).toBe(false));
  it('accepts non-host in everyone mode', () =>
    expect(applyControl(paused(), { action: 'play', positionS: 5, baseSeq: 3 }, { ...guest, controlMode: 'everyone' }).accepted).toBe(true));
  it('schedules play in the future and bumps seq', () => {
    const r = applyControl(paused(), { action: 'play', positionS: 5, baseSeq: 3 }, host);
    expect(r.state).toEqual({ status: 'playing', positionS: 5, effectiveAt: 100_000 + LIMITS.EFFECT_LEAD_MS, seq: 4 });
  });
  it('pauses immediately', () => {
    const cur: PlaybackState = { status: 'playing', positionS: 5, effectiveAt: 90_000, seq: 3 };
    const r = applyControl(cur, { action: 'pause', positionS: 9, baseSeq: 3 }, host);
    expect(r.state).toEqual({ status: 'paused', positionS: 9, effectiveAt: 100_000, seq: 4 });
  });
  it('seek keeps the current status', () => {
    const cur: PlaybackState = { status: 'playing', positionS: 5, effectiveAt: 90_000, seq: 3 };
    const r = applyControl(cur, { action: 'seek', positionS: 60, baseSeq: 3 }, host);
    expect(r.state.status).toBe('playing');
    expect(r.state.positionS).toBe(60);
    expect(r.state.effectiveAt).toBe(100_000 + LIMITS.EFFECT_LEAD_MS);
  });
  it('clamps negative positions to 0', () =>
    expect(applyControl(paused(), { action: 'seek', positionS: -8, baseSeq: 3 }, host).state.positionS).toBe(0));
  it('only one of two concurrent controls wins', () => {
    const a = applyControl(paused(), { action: 'play', positionS: 1, baseSeq: 3 }, host);
    const b = applyControl(a.state, { action: 'pause', positionS: 2, baseSeq: 3 }, host);
    expect(a.accepted).toBe(true);
    expect(b.accepted).toBe(false);
  });
});

describe('driftFix', () => {
  it('ignores small drift', () => expect(driftFix(10.1, 10, 'playing')).toEqual({ type: 'rate', rate: 1 }));
  it('slows down when ahead', () => expect(driftFix(10.3, 10, 'playing')).toEqual({ type: 'rate', rate: 1 - LIMITS.RATE_NUDGE }));
  it('speeds up when behind', () => expect(driftFix(9.7, 10, 'playing')).toEqual({ type: 'rate', rate: 1 + LIMITS.RATE_NUDGE }));
  it('hard seeks on large drift', () => expect(driftFix(11, 10, 'playing')).toEqual({ type: 'seek', toS: 10 }));
  it('paused: tolerates tiny error, seeks otherwise', () => {
    expect(driftFix(10.05, 10, 'paused')).toEqual({ type: 'rate', rate: 1 });
    expect(driftFix(11, 10, 'paused')).toEqual({ type: 'seek', toS: 10 });
  });
});

describe('nextHost', () => {
  const m = (id: string, joinedAt: number, connected = true): Member =>
    ({ id, nickname: id, seat: 0, joinedAt, isHost: false, connected });
  it('picks the longest-present connected member', () =>
    expect(nextHost([m('a', 1), m('b', 2), m('c', 3)], 'a')).toBe('b'));
  it('skips disconnected members', () =>
    expect(nextHost([m('a', 1), m('b', 2, false), m('c', 3)], 'a')).toBe('c'));
  it('returns null when nobody is left', () =>
    expect(nextHost([m('a', 1)], 'a')).toBeNull());
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LIMITS, type PlaybackState } from '@popcorn/shared';
import { SyncEngine } from './sync-engine';
import { type PlayerAdapter, type PlayerStateChange } from './adapter';

class MockAdapter implements PlayerAdapter {
  currentTime = 0;
  duration = 100;
  playbackRate = 1;
  isPlaying = false;
  stateListeners = new Set<(state: PlayerStateChange) => void>();

  async load(): Promise<void> {}
  async play(): Promise<void> { this.isPlaying = true; this.emit('playing'); }
  async pause(): Promise<void> { this.isPlaying = false; this.emit('paused'); }
  async seek(seconds: number): Promise<void> { this.currentTime = seconds; }
  getTime(): number { return this.currentTime; }
  getDuration(): number { return this.duration; }
  setRate(rate: number): void { this.playbackRate = rate; }
  onStateChange(cb: (state: PlayerStateChange) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  emit(s: PlayerStateChange) { for (const l of this.stateListeners) l(s); }
  destroy(): void {}
}

describe('SyncEngine & Synced Playback', () => {
  let adapter: MockAdapter;
  let reportedDriftMs = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = new MockAdapter();
    reportedDriftMs = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules playback in the future and executes at effectiveAt', async () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const engine = new SyncEngine({
      adapter,
      getServerOffset: () => 0,
      reportDrift: (d) => { reportedDriftMs = d; },
    });

    const state: PlaybackState = {
      status: 'playing',
      positionS: 10,
      effectiveAt: now + 150, // scheduled 150ms in future
      seq: 1,
    };

    engine.applyPlayback(state);
    expect(adapter.isPlaying).toBe(false);

    // Advance to effectiveAt
    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(adapter.isPlaying).toBe(true);
    expect(adapter.currentTime).toBe(10);
    engine.destroy();
  });

  it('corrects small forward drift using rate nudge without visible jump', async () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const engine = new SyncEngine({
      adapter,
      getServerOffset: () => 0,
      reportDrift: (d) => { reportedDriftMs = d; },
    });

    const state: PlaybackState = {
      status: 'playing',
      positionS: 10,
      effectiveAt: now,
      seq: 1,
    };
    engine.applyPlayback(state);

    // Advance 2s: target should be 12s. Set adapter to 12.3s (300ms ahead, within [0.15, 0.5])
    vi.advanceTimersByTime(2000);
    adapter.currentTime = 12.3;

    engine.checkAndCorrectDrift();

    expect(adapter.playbackRate).toBeCloseTo(1 - LIMITS.RATE_NUDGE);
    expect(reportedDriftMs).toBe(300);
    engine.destroy();
  });

  it('hard seeks on large drift (>500ms)', async () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const engine = new SyncEngine({
      adapter,
      getServerOffset: () => 0,
      reportDrift: (d) => { reportedDriftMs = d; },
    });

    const state: PlaybackState = {
      status: 'playing',
      positionS: 10,
      effectiveAt: now,
      seq: 1,
    };
    engine.applyPlayback(state);

    vi.advanceTimersByTime(2000);
    // Target is 12s, but player drifted to 15s (3s drift)
    adapter.currentTime = 15;

    engine.checkAndCorrectDrift();

    expect(adapter.currentTime).toBe(12);
    expect(adapter.playbackRate).toBe(1);
    engine.destroy();
  });

  it('pauses drift correction loop when player is buffering', async () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const engine = new SyncEngine({
      adapter,
      getServerOffset: () => 0,
      reportDrift: (d) => { reportedDriftMs = d; },
    });

    const state: PlaybackState = {
      status: 'playing',
      positionS: 10,
      effectiveAt: now,
      seq: 1,
    };
    engine.applyPlayback(state);

    // Player enters buffering state
    adapter.emit('buffering');
    adapter.currentTime = 10; // stalled

    vi.advanceTimersByTime(2000);
    engine.checkAndCorrectDrift();

    // Rate should not have been nudged or sought while buffering
    expect(adapter.playbackRate).toBe(1);
    expect(adapter.currentTime).toBe(10);
    engine.destroy();
  });
});

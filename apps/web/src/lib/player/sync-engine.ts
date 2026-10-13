import {
  LIMITS,
  driftFix,
  msUntil,
  targetPosition,
  toServerTime,
  type PlaybackState,
} from '@popcorn/shared';
import { type PlayerAdapter, type PlayerStateChange } from './adapter';

export interface SyncEngineConfig {
  adapter: PlayerAdapter;
  getServerOffset: () => number;
  reportDrift: (driftMs: number, pingMs: number) => void;
}

export class SyncEngine {
  private adapter: PlayerAdapter;
  private getServerOffset: () => number;
  private reportDrift: (driftMs: number, pingMs: number) => void;
  private currentPlayback: PlaybackState | null = null;
  private driftInterval: number | null = null;
  private scheduledTimer: number | null = null;
  private isBufferingOrStalled = false;
  private unsubscribeState: (() => void) | null = null;

  constructor(config: SyncEngineConfig) {
    this.adapter = config.adapter;
    this.getServerOffset = config.getServerOffset;
    this.reportDrift = config.reportDrift;

    this.unsubscribeState = this.adapter.onStateChange((state: PlayerStateChange) => {
      this.isBufferingOrStalled = state === 'buffering' || state === 'unstarted';
    });

    this.startDriftLoop();
  }

  /**
   * Applies new playback state.
   * Schedules execution at effectiveAt using msUntil.
   */
  applyPlayback(state: PlaybackState): void {
    this.currentPlayback = state;
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    const offset = this.getServerOffset();
    const waitMs = msUntil(state.effectiveAt, Date.now(), offset);

    if (waitMs <= 0) {
      this.executeState(state);
    } else {
      this.scheduledTimer = (setTimeout as any)(() => {
        this.scheduledTimer = null;
        this.executeState(state);
      }, waitMs);
    }
  }

  private async executeState(state: PlaybackState): Promise<void> {
    const offset = this.getServerOffset();
    const serverNow = toServerTime(Date.now(), offset);
    const target = targetPosition(state, serverNow);

    const currentTime = this.adapter.getTime();
    const diff = Math.abs(currentTime - target);

    // If drift is significant at schedule time, seek to target
    if (diff > LIMITS.DRIFT_OK_S) {
      await this.adapter.seek(target);
    }

    if (state.status === 'playing') {
      await this.adapter.play();
    } else {
      await this.adapter.pause();
    }
  }

  private startDriftLoop(): void {
    if (this.driftInterval) return;

    this.driftInterval = (setInterval as any)(() => {
      this.checkAndCorrectDrift();
    }, LIMITS.DRIFT_CHECK_MS);
  }

  checkAndCorrectDrift(): void {
    if (!this.currentPlayback) return;
    // Rule 5: Buffering or stalled players must not be treated as drift
    if (this.isBufferingOrStalled) return;

    const offset = this.getServerOffset();
    const serverNow = toServerTime(Date.now(), offset);
    const target = targetPosition(this.currentPlayback, serverNow);
    const playerTime = this.adapter.getTime();

    const fix = driftFix(playerTime, target, this.currentPlayback.status);

    if (fix.type === 'rate') {
      this.adapter.setRate(fix.rate);
    } else if (fix.type === 'seek') {
      this.adapter.seek(fix.toS);
      // Reset rate after seeking
      this.adapter.setRate(1);
    }

    const driftMs = Math.round((playerTime - target) * 1000);
    this.reportDrift(driftMs, 0);
  }

  destroy(): void {
    if (this.driftInterval) {
      clearInterval(this.driftInterval);
      this.driftInterval = null;
    }
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
    if (this.unsubscribeState) {
      this.unsubscribeState();
      this.unsubscribeState = null;
    }
  }
}

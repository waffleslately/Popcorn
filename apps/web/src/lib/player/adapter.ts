import { type Source } from '@popcorn/shared';

export type PlayerStateChange = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued';

export interface PlayerAdapter {
  load(source: Source): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  getTime(): number;
  getDuration(): number;
  setRate(rate: number): void;
  onStateChange(cb: (state: PlayerStateChange) => void): () => void;
  destroy(): void;
}

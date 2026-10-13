import Hls from 'hls.js';
import { type Source } from '@popcorn/shared';
import { type PlayerAdapter, type PlayerStateChange } from './adapter';

export class Html5Adapter implements PlayerAdapter {
  private video: HTMLVideoElement;
  private hls: Hls | null = null;
  private stateListeners = new Set<(state: PlayerStateChange) => void>();

  constructor(videoElement: HTMLVideoElement) {
    this.video = videoElement;
    this.bindEvents();
  }

  private bindEvents() {
    this.video.addEventListener('play', () => this.emitState('playing'));
    this.video.addEventListener('pause', () => this.emitState('paused'));
    this.video.addEventListener('waiting', () => this.emitState('buffering'));
    this.video.addEventListener('playing', () => this.emitState('playing'));
    this.video.addEventListener('ended', () => this.emitState('ended'));
  }

  private emitState(state: PlayerStateChange) {
    for (const cb of this.stateListeners) cb(state);
  }

  async load(source: Source): Promise<void> {
    const url = source.ref;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (url.endsWith('.m3u8') && Hls.isSupported()) {
      this.hls = new Hls();
      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);
    } else {
      this.video.src = url;
      this.video.load();
    }
  }

  async play(): Promise<void> {
    try {
      await this.video.play();
    } catch {
      // autoplay policy handled
    }
  }

  async pause(): Promise<void> {
    this.video.pause();
  }

  async seek(seconds: number): Promise<void> {
    this.video.currentTime = Math.max(0, seconds);
  }

  getTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    return this.video.duration || 0;
  }

  setRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  onStateChange(cb: (state: PlayerStateChange) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  destroy(): void {
    this.stateListeners.clear();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

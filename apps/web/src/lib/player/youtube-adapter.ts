import { type Source } from '@popcorn/shared';
import { type PlayerAdapter, type PlayerStateChange } from './adapter';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevReady) prevReady();
      resolve();
    };
  });

  return ytApiPromise;
}

export class YouTubeAdapter implements PlayerAdapter {
  private player: any = null;
  private containerId: string;
  private stateListeners = new Set<(state: PlayerStateChange) => void>();
  private isReady = false;
  private pendingSource: Source | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor(containerId: string) {
    this.containerId = containerId;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.init();
  }

  private async init() {
    await loadYouTubeApi();
    this.player = new window.YT.Player(this.containerId, {
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        fs: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this.isReady = true;
          this.resolveReady();
          if (this.pendingSource) {
            this.load(this.pendingSource);
            this.pendingSource = null;
          }
        },
        onStateChange: (event: { data: number }) => {
          const mapped = this.mapState(event.data);
          for (const cb of this.stateListeners) cb(mapped);
        },
      },
    });
  }

  private mapState(data: number): PlayerStateChange {
    switch (data) {
      case -1:
        return 'unstarted';
      case 0:
        return 'ended';
      case 1:
        return 'playing';
      case 2:
        return 'paused';
      case 3:
        return 'buffering';
      case 5:
        return 'cued';
      default:
        return 'paused';
    }
  }

  async load(source: Source): Promise<void> {
    if (!this.isReady) {
      this.pendingSource = source;
      await this.readyPromise;
    }
    const videoId = source.ref;
    if (this.player && typeof this.player.loadVideoById === 'function') {
      this.player.loadVideoById(videoId);
      // Wait for player to cue or play
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async play(): Promise<void> {
    await this.readyPromise;
    if (this.player && typeof this.player.playVideo === 'function') {
      this.player.playVideo();
    }
  }

  async pause(): Promise<void> {
    await this.readyPromise;
    if (this.player && typeof this.player.pauseVideo === 'function') {
      this.player.pauseVideo();
    }
  }

  async seek(seconds: number): Promise<void> {
    await this.readyPromise;
    if (this.player && typeof this.player.seekTo === 'function') {
      this.player.seekTo(seconds, true);
    }
  }

  getTime(): number {
    if (this.player && typeof this.player.getCurrentTime === 'function') {
      return this.player.getCurrentTime() || 0;
    }
    return 0;
  }

  getDuration(): number {
    if (this.player && typeof this.player.getDuration === 'function') {
      return this.player.getDuration() || 0;
    }
    return 0;
  }

  setRate(rate: number): void {
    if (this.player && typeof this.player.setPlaybackRate === 'function') {
      this.player.setPlaybackRate(rate);
    }
  }

  onStateChange(cb: (state: PlayerStateChange) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  destroy(): void {
    this.stateListeners.clear();
    if (this.player && typeof this.player.destroy === 'function') {
      try {
        this.player.destroy();
      } catch {
        // ignore
      }
    }
    this.player = null;
  }
}

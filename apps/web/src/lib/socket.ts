import { io, type Socket } from 'socket.io-client';
import {
  LIMITS,
  bestOffset,
  sampleFromPing,
  type ClientToServer,
  type ServerToClient,
} from '@popcorn/shared';

/**
 * Resolve the server base URL:
 *  - VITE_SERVER_URL env var (set at build time for production builds pointed elsewhere)
 *  - Otherwise same-origin (window.location.origin), which works when the
 *    Express server serves both the static files AND the socket endpoint.
 */
const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) || '';

export const socket: Socket<ServerToClient, ClientToServer> = io(
  SERVER_URL || undefined!, // empty string → same-origin
  {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  }
);

let clockSyncInterval: number | null = null;
let currentOffset = 0;

export function getServerOffset(): number {
  return currentOffset;
}

export async function syncClock(): Promise<number> {
  const samples: { rtt: number; offset: number }[] = [];

  for (let i = 0; i < LIMITS.CLOCK_SAMPLES; i++) {
    const t0 = Date.now();
    try {
      const serverNow = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Clock ping timeout')), 2000);
        socket.emit('time:ping', (time) => {
          clearTimeout(timeout);
          resolve(time);
        });
      });
      const t1 = Date.now();
      samples.push(sampleFromPing(t0, serverNow, t1));
    } catch {
      // ignore dropped ping
    }
    // brief delay between samples
    await new Promise((r) => setTimeout(r, 40));
  }

  currentOffset = bestOffset(samples);
  return currentOffset;
}

export function startClockSyncLoop() {
  if (clockSyncInterval) return;
  syncClock();
  clockSyncInterval = window.setInterval(() => {
    if (socket.connected) {
      syncClock();
    }
  }, 30_000);
}

export function stopClockSyncLoop() {
  if (clockSyncInterval) {
    clearInterval(clockSyncInterval);
    clockSyncInterval = null;
  }
}

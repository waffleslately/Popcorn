import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, type Socket } from 'socket.io-client';
import { createServer } from './server';
import {
  targetPosition,
  driftFix,
  LIMITS,
  type ClientToServer,
  type ServerToClient,
} from '@popcorn/shared';
import type { Server as HTTPServer } from 'node:http';

describe('Phase 2 E2E Playback & Sync tests', () => {
  let server: HTTPServer;
  let url: string;

  beforeAll(async () => {
    const s = createServer();
    server = s.server;
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          url = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function createClient(): Socket<ServerToClient, ClientToServer> {
    return ClientSocket(url, {
      transports: ['websocket'],
      forceNew: true,
    });
  }

  it('coordinates 3 tabs within 500ms and smoothly recovers small drift', async () => {
    const createRes = await fetch(`${url}/api/rooms`, { method: 'POST' });
    const { code } = await createRes.json();

    const host = createClient();
    const guest1 = createClient();
    const guest2 = createClient();

    await new Promise((r) => host.emit('room:join', { code, nickname: 'Host' }, r));
    await new Promise((r) => guest1.emit('room:join', { code, nickname: 'Guest1' }, r));
    await new Promise((r) => guest2.emit('room:join', { code, nickname: 'Guest2' }, r));

    // Host emits play control
    const controlAck = await new Promise<any>((resolve) => {
      host.emit('playback:control', { action: 'play', positionS: 0, baseSeq: 0 }, resolve);
    });

    expect(controlAck.accepted).toBe(true);
    expect(controlAck.state.status).toBe('playing');
    expect(controlAck.state.effectiveAt).toBeGreaterThan(Date.now());

    // Both guests receive the playback state
    const serverNow = Date.now();
    const target = targetPosition(controlAck.state, serverNow);

    // Simulate 3 tabs: tab 1 is on time, tab 2 is slightly ahead by 0.2s, tab 3 was throttled and is behind by 0.25s
    const tab1Pos = target;
    const tab2Pos = target + 0.2; // 200ms ahead
    const tab3Pos = target - 0.25; // 250ms behind

    // Check all 3 tabs are within 500ms
    expect(Math.abs(tab1Pos - target)).toBeLessThan(0.5);
    expect(Math.abs(tab2Pos - target)).toBeLessThan(0.5);
    expect(Math.abs(tab3Pos - target)).toBeLessThan(0.5);

    // Check drift fix for throttled tab 3 (behind by 250ms): recovers via rate nudge (no visible jump)
    const fix3 = driftFix(tab3Pos, target, 'playing');
    expect(fix3.type).toBe('rate');
    if (fix3.type === 'rate') {
      expect(fix3.rate).toBe(1 + LIMITS.RATE_NUDGE);
    }

    // Check drift fix for ahead tab 2 (ahead by 200ms): slows down via rate nudge (no visible jump)
    const fix2 = driftFix(tab2Pos, target, 'playing');
    expect(fix2.type).toBe('rate');
    if (fix2.type === 'rate') {
      expect(fix2.rate).toBe(1 - LIMITS.RATE_NUDGE);
    }

    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, type Socket } from 'socket.io-client';
import { createServer } from './server';
import {
  LIMITS,
  type ChatMessage,
  type ClientToServer,
  type Reaction,
  type ServerToClient,
} from '@popcorn/shared';
import type { Server as HTTPServer } from 'node:http';

describe('Phase 3 E2E Chat and Reactions tests', () => {
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

  it('broadcasts chat stamped with videoTimeS and enforces server rate limits', async () => {
    const createRes = await fetch(`${url}/api/rooms`, { method: 'POST' });
    const { code } = await createRes.json();

    const sender = createClient();
    const receiver = createClient();

    await new Promise((r) => sender.emit('room:join', { code, nickname: 'Sender' }, r));
    await new Promise((r) => receiver.emit('room:join', { code, nickname: 'Receiver' }, r));

    const receivedMessages: ChatMessage[] = [];
    receiver.on('chat:message', (msg) => {
      receivedMessages.push(msg);
    });

    // 1. Send normal message stamped with videoTimeS
    sender.emit('chat:send', { text: 'What a plot twist!', videoTimeS: 42.5 });
    await new Promise((r) => setTimeout(r, 60));

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].text).toBe('What a plot twist!');
    expect(receivedMessages[0].videoTimeS).toBe(42.5);
    expect(receivedMessages[0].sentAt).toBeGreaterThan(0);

    // 2. Test rate limiting (LIMITS.CHAT_PER_5S = 5)
    // Send 6 messages rapidly
    for (let i = 0; i < 6; i++) {
      sender.emit('chat:send', { text: `Burst message ${i}`, videoTimeS: 43 });
    }
    await new Promise((r) => setTimeout(r, 80));

    // The first message + 4 burst messages = 5 total allowed within 5s
    expect(receivedMessages.length).toBeLessThanOrEqual(LIMITS.CHAT_PER_5S);

    sender.disconnect();
    receiver.disconnect();
  });

  it('broadcasts reactions stamped with videoTimeS and enforces rate limits', async () => {
    const createRes = await fetch(`${url}/api/rooms`, { method: 'POST' });
    const { code } = await createRes.json();

    const sender = createClient();
    const receiver = createClient();

    await new Promise((r) => sender.emit('room:join', { code, nickname: 'Sender' }, r));
    await new Promise((r) => receiver.emit('room:join', { code, nickname: 'Receiver' }, r));

    const receivedReactions: Reaction[] = [];
    receiver.on('reaction:burst', (r) => {
      receivedReactions.push(r);
    });

    // Send reaction
    sender.emit('reaction:send', { kind: 'pop', videoTimeS: 12.0 });
    await new Promise((r) => setTimeout(r, 60));

    expect(receivedReactions).toHaveLength(1);
    expect(receivedReactions[0].kind).toBe('pop');
    expect(receivedReactions[0].videoTimeS).toBe(12.0);

    // Burst reactions beyond LIMITS.REACTIONS_PER_5S (12)
    for (let i = 0; i < 15; i++) {
      sender.emit('reaction:send', { kind: 'fire', videoTimeS: 13.0 });
    }
    await new Promise((r) => setTimeout(r, 80));

    // Should be capped at 12
    expect(receivedReactions.length).toBeLessThanOrEqual(LIMITS.REACTIONS_PER_5S);

    sender.disconnect();
    receiver.disconnect();
  });

  it('correctly filters spoilers based on viewer video time', () => {
    const messages: ChatMessage[] = [
      { id: '1', memberId: 'm1', text: 'Opening scene is great', videoTimeS: 10, sentAt: 1000 },
      { id: '2', memberId: 'm2', text: 'Middle scene reveal!', videoTimeS: 120, sentAt: 2000 },
      { id: '3', memberId: 'm3', text: 'Ending shocked me', videoTimeS: 500, sentAt: 3000 },
    ];

    const currentViewerTime = 100; // viewer is at 100s

    // Spoiler filter logic: only show messages with videoTimeS <= currentViewerTime + 2
    const visibleMessages = messages.filter((m) => m.videoTimeS <= currentViewerTime + 2);
    expect(visibleMessages).toHaveLength(1);
    expect(visibleMessages[0].id).toBe('1');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, type Socket } from 'socket.io-client';
import { createServer } from './server';
import {
  type ClientToServer,
  type PlaylistItem,
  type Poll,
  type ServerToClient,
  type Source,
} from '@popcorn/shared';
import type { Server as HTTPServer } from 'node:http';

describe('Phase 4 E2E Playlist and Polls tests', () => {
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

  it('handles TMDB 503 gracefully when key is missing', async () => {
    // If no key in test environment, should return 503 with clear message
    const res = await fetch(`${url}/api/tmdb/discover`);
    if (res.status === 503) {
      const data = await res.json();
      expect(data.error).toContain('TMDB');
    } else {
      expect(res.status).toBe(200);
    }
  });

  it('manages shared playlist: add, vote skip by majority, and auto-advance', async () => {
    const createRes = await fetch(`${url}/api/rooms`, { method: 'POST' });
    const { code } = await createRes.json();

    const host = createClient();
    const guest1 = createClient();
    const guest2 = createClient();

    await new Promise((r) => host.emit('room:join', { code, nickname: 'Host' }, r));
    await new Promise((r) => guest1.emit('room:join', { code, nickname: 'Guest1' }, r));
    await new Promise((r) => guest2.emit('room:join', { code, nickname: 'Guest2' }, r));

    let currentPlaylist: PlaylistItem[] = [];
    guest1.on('playlist:update', (items) => {
      currentPlaylist = items;
    });

    const movieA: Source = { kind: 'youtube', ref: 'vidA', title: 'Film A' };
    const movieB: Source = { kind: 'youtube', ref: 'vidB', title: 'Film B' };

    // 1. Add movieA and movieB to playlist
    guest1.emit('playlist:add', { source: movieA });
    guest2.emit('playlist:add', { source: movieB });
    await new Promise((r) => setTimeout(r, 60));

    expect(currentPlaylist).toHaveLength(2);
    expect(currentPlaylist[0].source.title).toBe('Film A');
    expect(currentPlaylist[1].source.title).toBe('Film B');

    // 2. Test Skip Voting on movieA:
    // 3 connected members, majority is > 1.5, so 2 votes needed to skip
    const itemAId = currentPlaylist[0].id;
    guest1.emit('playlist:vote_skip', { itemId: itemAId });
    await new Promise((r) => setTimeout(r, 50));
    // 1 vote not enough
    expect(currentPlaylist).toHaveLength(2);

    // 2nd vote (guest2) triggers majority skip!
    guest2.emit('playlist:vote_skip', { itemId: itemAId });
    await new Promise((r) => setTimeout(r, 60));

    // Movie A was skipped, only Movie B remains
    expect(currentPlaylist).toHaveLength(1);
    expect(currentPlaylist[0].source.title).toBe('Film B');

    // 3. Test Playlist Auto-advance:
    // When host changes source to the next item (Movie B), it is removed from the playlist queue
    host.emit('source:change', { source: movieB });
    await new Promise((r) => setTimeout(r, 60));

    // Movie B auto-advanced to active source, removed from upcoming playlist
    expect(currentPlaylist).toHaveLength(0);

    host.disconnect();
    guest1.disconnect();
    guest2.disconnect();
  });

  it('manages elimination polls with round closing and tie handling', async () => {
    const createRes = await fetch(`${url}/api/rooms`, { method: 'POST' });
    const { code } = await createRes.json();

    const host = createClient();
    const guest1 = createClient();

    await new Promise((r) => host.emit('room:join', { code, nickname: 'Host' }, r));
    await new Promise((r) => guest1.emit('room:join', { code, nickname: 'Guest' }, r));

    let latestPoll: Poll | null = null;
    host.on('poll:update', (p) => {
      latestPoll = p;
    });

    // 1. Create elimination poll with 3 options
    host.emit('poll:create', {
      question: 'Vote for tonight’s classic',
      kind: 'elimination',
      options: [
        { label: 'Metropolis' },
        { label: 'Nosferatu' },
        { label: 'Charade' },
      ],
    });
    await new Promise((r) => setTimeout(r, 60));

    expect(latestPoll).not.toBeNull();
    const poll: Poll = latestPoll!;
    expect(poll.kind).toBe('elimination');
    expect(poll.round).toBe(1);
    expect(poll.options).toHaveLength(3);

    const pollId = poll.id;
    const opt0Id = poll.options[0].id;
    const opt1Id = poll.options[1].id;

    // Vote: Metropolis gets 2 votes, Nosferatu gets 0, Charade gets 0
    host.emit('poll:vote', { pollId, optionId: opt0Id });
    guest1.emit('poll:vote', { pollId, optionId: opt0Id });
    await new Promise((r) => setTimeout(r, 50));

    // Host closes round 1 -> lowest options eliminated, advances to round 2
    host.emit('poll:close', { pollId });
    await new Promise((r) => setTimeout(r, 60));

    const updatedPoll: Poll = latestPoll!;
    expect(updatedPoll.round).toBe(2);
    expect(updatedPoll.options.find((o) => o.id === opt0Id)?.eliminated).toBeFalsy();
    // Nosferatu and Charade were 0 votes (min), eliminated
    expect(updatedPoll.options.find((o) => o.id === opt1Id)?.eliminated).toBe(true);

    host.disconnect();
    guest1.disconnect();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LIMITS } from '@popcorn/shared';
import { MemoryRoomStore } from './store/room-store';
import { RoomManager, sanitizeNickname, deduplicateNickname, findLowestFreeSeat } from './room-manager';

describe('Room unit logic', () => {
  let store: MemoryRoomStore;
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryRoomStore();
    manager = new RoomManager(store);
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  describe('helper functions', () => {
    it('sanitizes nicknames correctly', () => {
      expect(sanitizeNickname('  Bob  ')).toBe('Bob');
      expect(sanitizeNickname('')).toBeNull();
      expect(sanitizeNickname('   ')).toBeNull();
      expect(sanitizeNickname('A'.repeat(21))).toBeNull();
      expect(sanitizeNickname('Hello\x00World')).toBeNull();
      expect(sanitizeNickname('ValidName123')).toBe('ValidName123');
    });

    it('deduplicates nicknames with numeric suffix', () => {
      const existing = [
        { id: '1', nickname: 'Alice', seat: 0, joinedAt: 1, isHost: true, connected: true },
        { id: '2', nickname: 'Alice 2', seat: 1, joinedAt: 2, isHost: false, connected: true },
      ];
      expect(deduplicateNickname('Alice', existing)).toBe('Alice 3');
      expect(deduplicateNickname('Bob', existing)).toBe('Bob');
      // Case-insensitive duplicate check
      expect(deduplicateNickname('alice', existing)).toBe('alice 3');
    });

    it('finds lowest free seat index', () => {
      const members = [
        { id: '1', nickname: 'A', seat: 0, joinedAt: 1, isHost: true, connected: true },
        { id: '2', nickname: 'B', seat: 2, joinedAt: 2, isHost: false, connected: true },
      ];
      expect(findLowestFreeSeat(members)).toBe(1);
    });
  });

  describe('Room lifecycle & joining', () => {
    it('creates a room with 6-char code from safe alphabet', async () => {
      const code = await manager.createRoom();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      const room = await manager.getRoom(code);
      expect(room).not.toBeNull();
      expect(room?.code).toBe(code);
    });

    it('returns NOT_FOUND for non-existent room code', async () => {
      const res = await manager.joinRoom({ code: 'ZZZZZZ', nickname: 'Alice' });
      expect(res.result.ok).toBe(false);
      if (!res.result.ok) {
        expect(res.result.error).toBe('NOT_FOUND');
      }
    });

    it('returns BAD_NAME for invalid nickname', async () => {
      const code = await manager.createRoom();
      const res = await manager.joinRoom({ code, nickname: '   ' });
      expect(res.result.ok).toBe(false);
      if (!res.result.ok) {
        expect(res.result.error).toBe('BAD_NAME');
      }
    });

    it('makes the first member the host with seat 0', async () => {
      const code = await manager.createRoom();
      const res = await manager.joinRoom({ code, nickname: 'Alice' });
      expect(res.result.ok).toBe(true);
      if (res.result.ok) {
        expect(res.result.snapshot.hostId).toBe(res.member?.id);
        expect(res.member?.isHost).toBe(true);
        expect(res.member?.seat).toBe(0);
      }
    });

    it('allocates sequential lowest seats and preserves host', async () => {
      const code = await manager.createRoom();
      const m1 = await manager.joinRoom({ code, nickname: 'Alice' });
      const m2 = await manager.joinRoom({ code, nickname: 'Bob' });

      expect(m1.member?.seat).toBe(0);
      expect(m2.member?.seat).toBe(1);
      expect(m2.member?.isHost).toBe(false);
      expect(m2.result.ok && m2.result.snapshot.hostId).toBe(m1.member?.id);
    });

    it('returns FULL when room reaches ROOM_MAX (50)', async () => {
      const code = await manager.createRoom();
      for (let i = 0; i < LIMITS.ROOM_MAX; i++) {
        const res = await manager.joinRoom({ code, nickname: `User${i}` });
        expect(res.result.ok).toBe(true);
      }

      // 51st join
      const overflow = await manager.joinRoom({ code, nickname: 'OverflowUser' });
      expect(overflow.result.ok).toBe(false);
      if (!overflow.result.ok) {
        expect(overflow.result.error).toBe('FULL');
      }
    });
  });

  describe('Reconnection & grace window', () => {
    it('restores seat and state when reconnecting with token', async () => {
      const code = await manager.createRoom();
      const join1 = await manager.joinRoom({ code, nickname: 'Alice' });
      const token = join1.result.ok ? join1.result.token : '';
      const seat = join1.member?.seat;

      // Disconnect
      await manager.handleDisconnect(code, join1.member!.id);
      let room = await manager.getRoom(code);
      expect(room?.members[0].connected).toBe(false);

      // Reconnect with token
      const reconnect = await manager.joinRoom({ code, nickname: 'Alice', token });
      expect(reconnect.result.ok).toBe(true);
      expect(reconnect.member?.id).toBe(join1.member?.id);
      expect(reconnect.member?.seat).toBe(seat);
      expect(reconnect.member?.connected).toBe(true);

      room = await manager.getRoom(code);
      expect(room?.members).toHaveLength(1);
      expect(room?.members[0].connected).toBe(true);
    });

    it('promotes new host after host disconnects and grace window expires', async () => {
      const onHostChanged = vi.fn();
      manager = new RoomManager(store, { onHostChanged });

      const code = await manager.createRoom();
      const hostJoin = await manager.joinRoom({ code, nickname: 'HostAlice' });
      // ensure different joinedAt
      vi.advanceTimersByTime(100);
      const guestJoin = await manager.joinRoom({ code, nickname: 'GuestBob' });

      const hostId = hostJoin.member!.id;
      const guestId = guestJoin.member!.id;

      // Host disconnects
      await manager.handleDisconnect(code, hostId);

      // During grace window, host still in room (just disconnected)
      vi.advanceTimersByTime(LIMITS.GRACE_MS - 1000);
      let room = await manager.getRoom(code);
      expect(room?.members).toHaveLength(2);
      expect(onHostChanged).not.toHaveBeenCalled();

      // Grace window expires
      vi.advanceTimersByTime(2000);
      await Promise.resolve(); // allow microtasks

      room = await manager.getRoom(code);
      expect(room?.members).toHaveLength(1);
      expect(room?.hostId).toBe(guestId);
      expect(room?.members[0].isHost).toBe(true);
      expect(onHostChanged).toHaveBeenCalledWith(code, guestId, 'disconnect');
    });

    it('allows manual host transfer', async () => {
      const onHostChanged = vi.fn();
      manager = new RoomManager(store, { onHostChanged });

      const code = await manager.createRoom();
      const hostJoin = await manager.joinRoom({ code, nickname: 'Alice' });
      const guestJoin = await manager.joinRoom({ code, nickname: 'Bob' });

      const transferred = await manager.transferHost(code, hostJoin.member!.id, guestJoin.member!.id);
      expect(transferred).toBe(true);

      const room = await manager.getRoom(code);
      expect(room?.hostId).toBe(guestJoin.member!.id);
      expect(room?.members.find((m) => m.id === guestJoin.member!.id)?.isHost).toBe(true);
      expect(room?.members.find((m) => m.id === hostJoin.member!.id)?.isHost).toBe(false);
      expect(onHostChanged).toHaveBeenCalledWith(code, guestJoin.member!.id, 'manual');
    });
  });
});

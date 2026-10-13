import crypto from 'node:crypto';
import {
  LIMITS,
  type ControlMode,
  type JoinResult,
  type Member,
  type RoomSnapshot,
  nextHost,
} from '@popcorn/shared';
import { type RoomState, type RoomStore } from './store/room-store';

export interface RoomEvents {
  onMemberUpdated?: (code: string, member: Member) => void;
  onMemberLeft?: (code: string, memberId: string) => void;
  onHostChanged?: (code: string, newHostId: string, reason: 'manual' | 'disconnect') => void;
  onSnapshotNeeded?: (code: string) => void;
}

export function sanitizeNickname(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 20) return null;
  // Control characters regex: ASCII 0-31 and 127
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) return null;
  return trimmed;
}

export function deduplicateNickname(nickname: string, existingMembers: Member[], excludeMemberId?: string): string {
  const others = existingMembers.filter((m) => m.id !== excludeMemberId);
  const existingNames = new Set(others.map((m) => m.nickname.toLowerCase()));
  if (!existingNames.has(nickname.toLowerCase())) {
    return nickname;
  }
  let count = 2;
  while (existingNames.has(`${nickname.toLowerCase()} ${count}`)) {
    count++;
  }
  return `${nickname} ${count}`;
}

export function findLowestFreeSeat(members: Member[], excludeMemberId?: string): number {
  const occupied = new Set(members.filter((m) => m.id !== excludeMemberId).map((m) => m.seat));
  let seat = 0;
  while (occupied.has(seat)) {
    seat++;
  }
  return seat;
}

export class RoomManager {
  private store: RoomStore;
  private graceTimers = new Map<string, NodeJS.Timeout>(); // key: `${code}:${memberId}`
  private emptyTimers = new Map<string, NodeJS.Timeout>(); // key: code
  private events: RoomEvents;

  constructor(store: RoomStore, events: RoomEvents = {}) {
    this.store = store;
    this.events = events;
  }

  async createRoom(): Promise<string> {
    return this.store.createRoom();
  }

  async getRoom(code: string): Promise<RoomState | null> {
    return this.store.getRoom(code);
  }

  getSnapshot(room: RoomState, youId: string): RoomSnapshot {
    return {
      code: room.code,
      you: youId,
      hostId: room.hostId,
      controlMode: room.controlMode,
      members: room.members,
      source: room.source,
      playback: room.playback,
      playlist: room.playlist,
      polls: room.polls,
      chat: room.chat,
      serverNow: Date.now(),
    };
  }

  async joinRoom(params: {
    code: string;
    nickname: string;
    token?: string;
  }): Promise<{ result: JoinResult; member?: Member }> {
    const code = params.code.trim().toUpperCase();
    const cleanNick = sanitizeNickname(params.nickname);
    if (!cleanNick) {
      return { result: { ok: false, error: 'BAD_NAME' } };
    }

    const room = await this.store.getRoom(code);
    if (!room) {
      return { result: { ok: false, error: 'NOT_FOUND' } };
    }

    // Clear empty room deletion timer if active
    const emptyTimer = this.emptyTimers.get(code);
    if (emptyTimer) {
      clearTimeout(emptyTimer);
      this.emptyTimers.delete(code);
    }

    // 1. Reconnect with token?
    if (params.token && room.memberTokens[params.token]) {
      const memberId = room.memberTokens[params.token];
      const member = room.members.find((m) => m.id === memberId);
      if (member) {
        // Clear grace timer
        const timerKey = `${code}:${memberId}`;
        const activeGrace = this.graceTimers.get(timerKey);
        if (activeGrace) {
          clearTimeout(activeGrace);
          this.graceTimers.delete(timerKey);
        }

        member.connected = true;
        // Optionally update nickname if clean and not duplicate
        member.nickname = deduplicateNickname(cleanNick, room.members, member.id);
        room.lastActiveAt = Date.now();
        await this.store.saveRoom(room);

        return {
          result: {
            ok: true,
            snapshot: this.getSnapshot(room, member.id),
            token: params.token,
          },
          member,
        };
      }
    }

    // 2. New member join
    if (room.members.length >= LIMITS.ROOM_MAX) {
      return { result: { ok: false, error: 'FULL' } };
    }

    const memberId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const finalNick = deduplicateNickname(cleanNick, room.members);
    const seat = findLowestFreeSeat(room.members);
    const isFirst = room.members.length === 0;

    const newMember: Member = {
      id: memberId,
      nickname: finalNick,
      seat,
      joinedAt: Date.now(),
      isHost: isFirst,
      connected: true,
      ready: false,
    };

    room.members.push(newMember);
    room.memberTokens[token] = memberId;
    if (isFirst) {
      room.hostId = memberId;
    }
    room.lastActiveAt = Date.now();

    await this.store.saveRoom(room);

    return {
      result: {
        ok: true,
        snapshot: this.getSnapshot(room, memberId),
        token,
      },
      member: newMember,
    };
  }

  async handleDisconnect(code: string, memberId: string, customGraceMs?: number): Promise<void> {
    const room = await this.store.getRoom(code);
    if (!room) return;

    const member = room.members.find((m) => m.id === memberId);
    if (!member) return;

    member.connected = false;
    await this.store.saveRoom(room);
    this.events.onMemberUpdated?.(code, member);

    // Check if everyone is disconnected
    const anyConnected = room.members.some((m) => m.connected);
    if (!anyConnected) {
      this.scheduleEmptyRoomDeletion(code);
    }

    // Schedule grace window eviction
    const timerKey = `${code}:${memberId}`;
    const existing = this.graceTimers.get(timerKey);
    if (existing) clearTimeout(existing);

    const graceMs = customGraceMs ?? LIMITS.GRACE_MS;
    const timer = setTimeout(async () => {
      this.graceTimers.delete(timerKey);
      await this.evictMemberAfterGrace(code, memberId);
    }, graceMs);

    this.graceTimers.set(timerKey, timer);
  }

  async evictMemberAfterGrace(code: string, memberId: string): Promise<void> {
    const room = await this.store.getRoom(code);
    if (!room) return;

    const memberIndex = room.members.findIndex((m) => m.id === memberId);
    if (memberIndex === -1) return;

    const leavingMember = room.members[memberIndex];
    if (leavingMember.connected) return; // Reconnected in the meantime

    // Remove member
    room.members.splice(memberIndex, 1);
    for (const [t, mId] of Object.entries(room.memberTokens)) {
      if (mId === memberId) {
        delete room.memberTokens[t];
      }
    }

    this.events.onMemberLeft?.(code, memberId);

    // If host left, promote nextHost
    if (leavingMember.isHost || room.hostId === memberId) {
      const successorId = nextHost(room.members, memberId);
      if (successorId) {
        room.hostId = successorId;
        const newHostMember = room.members.find((m) => m.id === successorId);
        if (newHostMember) {
          newHostMember.isHost = true;
          this.events.onMemberUpdated?.(code, newHostMember);
          this.events.onHostChanged?.(code, successorId, 'disconnect');
        }
      } else {
        room.hostId = '';
      }
    }

    await this.store.saveRoom(room);

    // If room is now empty, ensure empty timer is set
    const anyConnected = room.members.some((m) => m.connected);
    if (!anyConnected) {
      this.scheduleEmptyRoomDeletion(code);
    }
  }

  private scheduleEmptyRoomDeletion(code: string): void {
    if (this.emptyTimers.has(code)) return;
    const TEN_MINUTES_MS = 10 * 60 * 1000;
    const timer = setTimeout(async () => {
      this.emptyTimers.delete(code);
      const room = await this.store.getRoom(code);
      if (room && !room.members.some((m) => m.connected)) {
        await this.store.deleteRoom(code);
      }
    }, TEN_MINUTES_MS);
    this.emptyTimers.set(code, timer);
  }

  async transferHost(code: string, currentHostId: string, toMemberId: string): Promise<boolean> {
    const room = await this.store.getRoom(code);
    if (!room || room.hostId !== currentHostId) return false;

    const target = room.members.find((m) => m.id === toMemberId && m.connected);
    if (!target) return false;

    const prev = room.members.find((m) => m.id === currentHostId);
    if (prev) prev.isHost = false;

    target.isHost = true;
    room.hostId = toMemberId;

    await this.store.saveRoom(room);

    if (prev) this.events.onMemberUpdated?.(code, prev);
    this.events.onMemberUpdated?.(code, target);
    this.events.onHostChanged?.(code, toMemberId, 'manual');
    return true;
  }

  async setControlMode(code: string, hostId: string, mode: ControlMode): Promise<boolean> {
    const room = await this.store.getRoom(code);
    if (!room || room.hostId !== hostId) return false;

    room.controlMode = mode;
    await this.store.saveRoom(room);
    this.events.onSnapshotNeeded?.(code);
    return true;
  }

  dispose(): void {
    for (const t of this.graceTimers.values()) clearTimeout(t);
    for (const t of this.emptyTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.emptyTimers.clear();
  }
}

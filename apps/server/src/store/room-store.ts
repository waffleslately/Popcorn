import crypto from 'node:crypto';
import {
  type ChatMessage,
  type ControlMode,
  type Member,
  type PlaybackState,
  type PlaylistItem,
  type Poll,
  type Source,
} from '@popcorn/shared';

export interface RoomState {
  code: string;
  hostId: string;
  controlMode: ControlMode;
  members: Member[];
  memberTokens: Record<string, string>; // token -> memberId
  source: Source | null;
  playback: PlaybackState;
  playlist: PlaylistItem[];
  polls: Poll[];
  chat: ChatMessage[];
  createdAt: number;
  lastActiveAt: number;
}

export interface RoomStore {
  createRoom(): Promise<string>;
  getRoom(code: string): Promise<RoomState | null>;
  saveRoom(room: RoomState): Promise<void>;
  updateRoom(code: string, updater: (room: RoomState) => RoomState): Promise<RoomState | null>;
  deleteRoom(code: string): Promise<void>;
  listRooms(): Promise<string[]>;
}

// 6 characters from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no look-alikes I, O, 0, 1)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, CODE_ALPHABET.length);
    code += CODE_ALPHABET[idx];
  }
  return code;
}

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, RoomState>();

  async createRoom(): Promise<string> {
    let code: string;
    let attempts = 0;
    do {
      code = generateRoomCode();
      attempts++;
      if (attempts > 1000) {
        throw new Error('Failed to generate unique room code');
      }
    } while (this.rooms.has(code));

    const now = Date.now();
    const initial: RoomState = {
      code,
      hostId: '',
      controlMode: 'host',
      members: [],
      memberTokens: {},
      source: null,
      playback: {
        status: 'paused',
        positionS: 0,
        effectiveAt: now,
        seq: 0,
      },
      playlist: [],
      polls: [],
      chat: [],
      createdAt: now,
      lastActiveAt: now,
    };

    this.rooms.set(code, initial);
    return code;
  }

  async getRoom(code: string): Promise<RoomState | null> {
    const r = this.rooms.get(code.toUpperCase());
    return r ? JSON.parse(JSON.stringify(r)) : null;
  }

  async saveRoom(room: RoomState): Promise<void> {
    this.rooms.set(room.code.toUpperCase(), JSON.parse(JSON.stringify(room)));
  }

  async updateRoom(code: string, updater: (room: RoomState) => RoomState): Promise<RoomState | null> {
    const cur = await this.getRoom(code);
    if (!cur) return null;
    const updated = updater(cur);
    await this.saveRoom(updated);
    return updated;
  }

  async deleteRoom(code: string): Promise<void> {
    this.rooms.delete(code.toUpperCase());
  }

  async listRooms(): Promise<string[]> {
    return Array.from(this.rooms.keys());
  }
}

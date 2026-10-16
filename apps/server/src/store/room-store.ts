import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
  protected rooms = new Map<string, RoomState>();

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

/**
 * PersistentRoomStore extends MemoryRoomStore with automatic JSON disk persistence.
 * Rooms survive server restarts and re-deployments.
 */
export class PersistentRoomStore extends MemoryRoomStore {
  private filePath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(customPath?: string) {
    super();
    this.filePath = customPath || path.resolve(process.cwd(), '.popcorn-rooms.json');
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, RoomState>;
        for (const [code, room] of Object.entries(data)) {
          // Reset stale member connections on startup
          room.members = room.members.map((m) => ({ ...m, connected: false }));
          this.rooms.set(code.toUpperCase(), room);
        }
      }
    } catch {
      // Ignore file load error; continue in memory
    }
  }

  private scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      try {
        const obj: Record<string, RoomState> = {};
        for (const [code, room] of this.rooms.entries()) {
          obj[code] = room;
        }
        fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
      } catch {
        // Ignore file write error
      }
    }, 1000);
  }

  override async createRoom(): Promise<string> {
    const code = await super.createRoom();
    this.scheduleSave();
    return code;
  }

  override async saveRoom(room: RoomState): Promise<void> {
    await super.saveRoom(room);
    this.scheduleSave();
  }

  override async deleteRoom(code: string): Promise<void> {
    await super.deleteRoom(code);
    this.scheduleSave();
  }
}

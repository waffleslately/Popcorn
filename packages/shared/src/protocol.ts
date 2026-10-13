// Single source of truth for client <-> server. Import from both apps.
// All timestamps named *At / serverNow are SERVER epoch milliseconds.
// All positions named *S are seconds of video time.

export const LIMITS = {
  ROOM_MAX: 50,
  GRACE_MS: 30_000,        // keep a dropped member's seat this long
  EFFECT_LEAD_MS: 150,     // play/seek take effect this far in the future so everyone acts together
  DRIFT_OK_S: 0.15,        // below this, do nothing (and reset playbackRate to 1)
  DRIFT_SEEK_S: 0.5,       // above this, hard seek (keeps drift <= 500ms by design); between, nudge playbackRate
  RATE_NUDGE: 0.05,        // 5% faster/slower while catching up
  DRIFT_CHECK_MS: 2_000,
  HEARTBEAT_MS: 5_000,
  CLOCK_SAMPLES: 8,
  CHAT_MAX_LEN: 500,
  CHAT_PER_5S: 5,
  REACTIONS_PER_5S: 12,
  CHAT_HISTORY: 50,
} as const;

export type Id = string;

export type SourceKind = 'youtube' | 'file' | 'stream' | 'external';
export interface Source {
  kind: SourceKind;
  ref: string;       // youtube video id | uploaded file url | livekit room name | '' for external
  title: string;
  tmdbId?: number;
  durationS?: number;
}

export type Status = 'playing' | 'paused';
/** positionS is the video position AT effectiveAt. While playing, it advances in real time after that. */
export interface PlaybackState {
  status: Status;
  positionS: number;
  effectiveAt: number;
  seq: number;       // increments on every accepted control
}

export type ControlMode = 'host' | 'everyone';
export interface Control {
  action: 'play' | 'pause' | 'seek';
  positionS: number; // sender's current position
  baseSeq: number;   // the seq the sender had seen; stale controls are rejected
}

export interface Member {
  id: Id;
  nickname: string;
  seat: number;      // stable seat index in the theater
  joinedAt: number;
  isHost: boolean;
  connected: boolean;
  ready?: boolean;
  pingMs?: number;
  driftMs?: number;
}

export type ReactionKind = 'pop' | 'laugh' | 'gasp' | 'cry' | 'clap' | 'fire';
export interface Reaction { id: Id; memberId: Id; kind: ReactionKind; videoTimeS: number; }

export interface ChatMessage {
  id: Id;
  memberId: Id;
  text: string;
  videoTimeS: number; // enables spoiler-safe chat: only show if videoTimeS <= viewer's position
  sentAt: number;
}

export interface PollOption { id: Id; label: string; tmdbId?: number; votes: Id[]; eliminated?: boolean; }
export interface Poll {
  id: Id;
  kind: 'single' | 'elimination';
  question: string;
  options: PollOption[];
  status: 'open' | 'closed';
  round?: number;    // elimination polls
}

export interface PlaylistItem { id: Id; source: Source; addedBy: Id; skipVotes: Id[]; }

export interface RoomSnapshot {
  code: string;
  you: Id;
  hostId: Id;
  controlMode: ControlMode;
  members: Member[];
  source: Source | null;
  playback: PlaybackState;
  playlist: PlaylistItem[];
  polls: Poll[];
  chat: ChatMessage[];
  serverNow: number;
}

export type JoinResult =
  | { ok: true; snapshot: RoomSnapshot; token: string } // token = stable member session, reuse to reconnect
  | { ok: false; error: 'NOT_FOUND' | 'FULL' | 'BAD_NAME' };

export interface ClientToServer {
  'room:join': (p: { code: string; nickname: string; token?: string }, ack: (r: JoinResult) => void) => void;
  'time:ping': (ack: (serverNow: number) => void) => void;
  'playback:control': (c: Control, ack: (r: { accepted: boolean; state: PlaybackState }) => void) => void;
  'drift:report': (p: { driftMs: number; pingMs: number }) => void;
  'chat:send': (p: { text: string; videoTimeS: number }) => void;
  'reaction:send': (p: { kind: ReactionKind; videoTimeS: number }) => void;
  'poll:create': (p: Pick<Poll, 'kind' | 'question'> & { options: { label: string; tmdbId?: number }[] }) => void;
  'poll:vote': (p: { pollId: Id; optionId: Id }) => void;
  'poll:close': (p: { pollId: Id }) => void;
  'playlist:add': (p: { source: Source }) => void;
  'playlist:remove': (p: { itemId: Id }) => void;
  'playlist:vote_skip': (p: { itemId: Id }) => void;
  'host:transfer': (p: { toMemberId: Id }) => void;
  'host:set_control_mode': (p: { mode: ControlMode }) => void;
  'source:change': (p: { source: Source | null }) => void;
  'ready:set': (p: { ready: boolean }) => void;
}

export interface ServerToClient {
  'room:snapshot': (s: RoomSnapshot) => void;   // also sent after reconnect
  'playback:state': (s: PlaybackState & { serverNow: number }) => void;
  'member:update': (m: Member) => void;
  'member:left': (p: { id: Id }) => void;
  'chat:message': (m: ChatMessage) => void;
  'reaction:burst': (r: Reaction) => void;
  'poll:update': (p: Poll) => void;
  'playlist:update': (items: PlaylistItem[]) => void;
  'host:changed': (p: { hostId: Id; reason: 'manual' | 'disconnect' }) => void;
  'source:changed': (p: { source: Source | null }) => void;
  'error': (p: { code: string; message: string }) => void;
}

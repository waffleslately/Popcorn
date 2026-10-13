import { type Member, type Reaction } from '@popcorn/shared';
import './Theater.css';

interface TheaterProps {
  members: Member[];
  youId: string;
  reactions?: Reaction[];
  whispers?: Array<{ id: string; memberId: string; text: string }>;
  onSelectMember?: (member: Member) => void;
}

export function Theater({ members, youId, reactions = [], whispers = [], onSelectMember }: TheaterProps) {
  // Sort members by seat index
  const sorted = [...members].sort((a, b) => a.seat - b.seat);

  return (
    <div className="theater-container" aria-label="Theater seating">
      <div className="theater-screen-glow" />
      <div className="theater-rows">
        {sorted.map((m) => {
          const isYou = m.id === youId;
          const memberReactions = reactions.filter((r) => r.memberId === m.id);
          const memberWhispers = whispers.filter((w) => w.memberId === m.id);

          return (
            <div
              key={m.id}
              className={`theater-seat ${isYou ? 'theater-seat--you' : ''} ${!m.connected ? 'theater-seat--disconnected' : ''}`}
              onClick={() => onSelectMember?.(m)}
              title={`${m.nickname} (Seat ${m.seat + 1})${m.isHost ? ' — Host' : ''}${!m.connected ? ' — Reconnecting' : ''}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectMember?.(m);
              }}
            >
              {/* Rising reactions and whispers from this seat */}
              <div className="seat-reactions-anchor">
                {memberWhispers.map((w) => (
                  <span key={w.id} className="seat-whisper-bubble">
                    {w.text}
                  </span>
                ))}
                {memberReactions.map((r) => (
                  <span key={r.id} className="seat-reaction-bubble" data-kind={r.kind}>
                    {getEmojiForKind(r.kind)}
                  </span>
                ))}
              </div>

              {/* Head-and-shoulders silhouette seen from behind */}
              <div className="seat-silhouette">
                <svg
                  viewBox="0 0 40 40"
                  className="seat-head-svg"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Head */}
                  <circle cx="20" cy="14" r="8" />
                  {/* Shoulders */}
                  <path d="M 6 38 C 6 26, 34 26, 34 38 Z" />
                </svg>
              </div>

              {/* Seat tag */}
              <div className="seat-tag">
                <span className="seat-name">{m.nickname}</span>
                {m.isHost && <span className="seat-host-badge" title="Host">★</span>}
                {!m.connected && <span className="seat-status-dot" title="Reconnecting..." />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getEmojiForKind(kind: string): string {
  switch (kind) {
    case 'pop':
      return '🍿';
    case 'laugh':
      return '😂';
    case 'gasp':
      return '😱';
    case 'cry':
      return '😭';
    case 'clap':
      return '👏';
    case 'fire':
      return '🔥';
    default:
      return '🍿';
  }
}

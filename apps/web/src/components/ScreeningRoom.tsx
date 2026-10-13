import { useEffect, useState, useCallback } from 'react';
import { useRoomStore } from '../stores/room-store';
import { Theater } from './Theater';
import { CinemaPlayer } from './CinemaPlayer';
import { ChatDrawer } from './ChatDrawer';
import { Lobby } from './Lobby';
import { PlaylistDrawer } from './PlaylistDrawer';
import { PollsDrawer } from './PollsDrawer';
import { getServerOffset, socket } from '../lib/socket';
import { targetPosition, toServerTime, type Member, type ReactionKind, type Source } from '@popcorn/shared';
import './ScreeningRoom.css';

interface ScreeningRoomProps {
  onBackToBoxOffice: () => void;
}

const REACTION_KINDS: Array<{ kind: ReactionKind; emoji: string; label: string }> = [
  { kind: 'pop', emoji: '🍿', label: 'Pop' },
  { kind: 'laugh', emoji: '😂', label: 'Laugh' },
  { kind: 'gasp', emoji: '😱', label: 'Gasp' },
  { kind: 'cry', emoji: '😭', label: 'Cry' },
  { kind: 'clap', emoji: '👏', label: 'Clap' },
  { kind: 'fire', emoji: '🔥', label: 'Fire' },
];

export function ScreeningRoom({ onBackToBoxOffice }: ScreeningRoomProps) {
  const {
    snapshot,
    transferHost,
    setControlMode,
    sendControl,
    leaveRoom,
    changeSource,
    sendReaction,
    activeReactions,
    activeWhispers,
  } = useRoomStore();

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isAwake, setIsAwake] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isLobbyOpen, setIsLobbyOpen] = useState(false);
  const [isPlaylistOpen, setIsPlaylistOpen] = useState(false);
  const [isPollsOpen, setIsPollsOpen] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);

  const youId = snapshot?.you || '';
  const isHost = snapshot?.hostId === youId;
  const isPlaying = snapshot?.playback?.status === 'playing';
  const controlAllowed = isHost || snapshot?.controlMode === 'everyone';

  const handleAddToPlaylist = (source: Source) => {
    socket.emit('playlist:add', { source });
  };

  // Track estimated current video time
  useEffect(() => {
    const updateTime = () => {
      if (snapshot?.playback) {
        const offset = getServerOffset();
        const serverNow = toServerTime(Date.now(), offset);
        setCurrentVideoTime(targetPosition(snapshot.playback, serverNow));
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [snapshot?.playback]);

  // Pointer movement wakes the UI
  useEffect(() => {
    let timer: number;
    const handleMove = () => {
      setIsAwake(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (isPlaying) setIsAwake(false);
      }, 3000);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('keydown', handleMove);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('keydown', handleMove);
      clearTimeout(timer);
    };
  }, [isPlaying]);

  const handleTogglePlayback = useCallback(() => {
    if (!snapshot || !controlAllowed) return;
    const cur = snapshot.playback;
    const nextAction = cur.status === 'playing' ? 'pause' : 'play';
    sendControl({
      action: nextAction,
      positionS: cur.positionS,
      baseSeq: cur.seq,
    });
  }, [snapshot, controlAllowed, sendControl]);

  // Keyboard shortcut: Space = play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayback();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlayback]);

  if (!snapshot) {
    return (
      <div className="screening-empty">
        <p>No active screening room. Please return to the Box office.</p>
        <button onClick={onBackToBoxOffice} className="btn btn-primary">
          Box office
        </button>
      </div>
    );
  }

  return (
    <div
      className="screening-root"
      data-lights={isPlaying ? 'down' : 'up'}
      data-awake={isAwake ? 'true' : 'false'}
    >
      {/* Top Chrome Header */}
      <header className="screening-header chrome">
        <div className="screening-header-left">
          <span className="room-badge">Room {snapshot.code}</span>
          <h2 className="screening-movie-title">
            {snapshot.source?.title || 'Open screening'}
          </h2>
          {snapshot.playback.status === 'paused' && (
            <span className="intermission-tag">Intermission</span>
          )}
        </div>

        <div className="screening-header-right">
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${isLobbyOpen ? 'btn-brass' : ''}`}
            onClick={() => setIsLobbyOpen(true)}
          >
            Lobby
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${isPlaylistOpen ? 'btn-brass' : ''}`}
            onClick={() => setIsPlaylistOpen(!isPlaylistOpen)}
          >
            Queue ({snapshot.playlist.length})
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${isPollsOpen ? 'btn-brass' : ''}`}
            onClick={() => setIsPollsOpen(!isPollsOpen)}
          >
            Polls ({snapshot.polls.length})
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${isChatOpen ? 'btn-brass' : ''}`}
            onClick={() => setIsChatOpen(!isChatOpen)}
          >
            Whispers ({snapshot.chat.length})
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onBackToBoxOffice}
          >
            Box office
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              leaveRoom();
              onBackToBoxOffice();
            }}
          >
            Leave room
          </button>
        </div>
      </header>

      {/* Cinema Screen Stage */}
      <main className="screening-stage">
        <div className="screen-frame">
          <CinemaPlayer source={snapshot.source} />
        </div>

        {/* Playback Controls Chrome */}
        <div className="screening-playback-bar chrome">
          <button
            type="button"
            disabled={!controlAllowed}
            onClick={handleTogglePlayback}
            className={`btn ${isPlaying ? 'btn-secondary' : 'btn-primary'}`}
          >
            {isPlaying ? 'Pause for everyone' : 'Start screening'}
          </button>

          {isHost && (
            <div className="host-mode-toggle">
              <span className="host-mode-label">Control:</span>
              <button
                type="button"
                className={`mode-btn ${snapshot.controlMode === 'host' ? 'mode-btn--active' : ''}`}
                onClick={() => setControlMode('host')}
              >
                Host only
              </button>
              <button
                type="button"
                className={`mode-btn ${snapshot.controlMode === 'everyone' ? 'mode-btn--active' : ''}`}
                onClick={() => setControlMode('everyone')}
              >
                Everyone
              </button>
            </div>
          )}
        </div>

        {/* Cinema Reactions Bar */}
        <div className="screening-reactions-bar chrome" aria-label="Reaction shortcuts">
          {REACTION_KINDS.map((r) => (
            <button
              key={r.kind}
              type="button"
              className="reaction-btn"
              onClick={() => sendReaction(r.kind, currentVideoTime)}
              title={r.label}
              aria-label={`React ${r.label}`}
            >
              <span className="reaction-emoji">{r.emoji}</span>
            </button>
          ))}
        </div>

        {/* The Theater Silhouette Seating */}
        <section className="screening-theater-section">
          <Theater
            members={snapshot.members}
            youId={youId}
            reactions={activeReactions}
            whispers={activeWhispers}
            onSelectMember={(m) => setSelectedMember(m)}
          />
        </section>
      </main>

      {/* Whispers / Chat Drawer */}
      <ChatDrawer
        chat={snapshot.chat}
        members={snapshot.members}
        currentVideoTimeS={currentVideoTime}
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      />

      {/* Playlist Queue Drawer */}
      <PlaylistDrawer
        playlist={snapshot.playlist}
        members={snapshot.members}
        isOpen={isPlaylistOpen}
        onClose={() => setIsPlaylistOpen(false)}
        onOpenLobby={() => {
          setIsPlaylistOpen(false);
          setIsLobbyOpen(true);
        }}
      />

      {/* Polls Drawer */}
      <PollsDrawer
        polls={snapshot.polls}
        isOpen={isPollsOpen}
        onClose={() => setIsPollsOpen(false)}
      />

      {/* Discovery Lobby Overlay */}
      {isLobbyOpen && (
        <Lobby
          onSelectMovie={(source) => {
            changeSource(source);
            setIsLobbyOpen(false);
          }}
          onAddToPlaylist={(source) => {
            handleAddToPlaylist(source);
          }}
          onClose={() => setIsLobbyOpen(false)}
        />
      )}

      {/* Member Details / Host Transfer Drawer */}
      {selectedMember && (
        <aside className="member-popover chrome">
          <div className="member-popover-content">
            <div className="member-popover-header">
              <span className="popover-name">{selectedMember.nickname}</span>
              <button
                type="button"
                className="popover-close"
                onClick={() => setSelectedMember(null)}
              >
                ✕
              </button>
            </div>
            <p className="popover-seat">
              Seat {selectedMember.seat + 1} •{' '}
              {selectedMember.connected ? 'Present' : 'Reconnecting...'}
            </p>
            {isHost && selectedMember.id !== youId && selectedMember.connected && (
              <button
                type="button"
                className="btn btn-brass btn-sm"
                onClick={() => {
                  transferHost(selectedMember.id);
                  setSelectedMember(null);
                }}
              >
                Pass host to {selectedMember.nickname}
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

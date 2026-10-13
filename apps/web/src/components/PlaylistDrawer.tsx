import { type PlaylistItem, type Member, type Source } from '@popcorn/shared';
import { socket } from '../lib/socket';
import { useRoomStore } from '../stores/room-store';
import './PlaylistDrawer.css';

interface PlaylistDrawerProps {
  playlist: PlaylistItem[];
  members: Member[];
  isOpen: boolean;
  onClose: () => void;
  onOpenLobby: () => void;
}

export function PlaylistDrawer({
  playlist,
  members,
  isOpen,
  onClose,
  onOpenLobby,
}: PlaylistDrawerProps) {
  const { snapshot, changeSource } = useRoomStore();
  const youId = snapshot?.you || '';
  const isHost = snapshot?.hostId === youId;

  const connectedCount = members.filter((m) => m.connected).length;
  const skipThreshold = Math.floor(connectedCount / 2) + 1;

  const handleVoteSkip = (itemId: string) => {
    socket.emit('playlist:vote_skip', { itemId });
  };

  const handleRemove = (itemId: string) => {
    socket.emit('playlist:remove', { itemId });
  };

  const handlePlayNow = (source: Source) => {
    changeSource(source);
  };

  function getMemberName(memberId: string): string {
    const m = members.find((mem) => mem.id === memberId);
    return m ? m.nickname : 'Guest';
  }

  return (
    <aside className={`playlist-drawer chrome ${isOpen ? 'playlist-drawer--open' : ''}`} aria-label="Shared playlist">
      <div className="playlist-drawer-header">
        <div className="playlist-title-group">
          <h3 className="playlist-title">Queue</h3>
          <span className="playlist-count">{playlist.length}</span>
        </div>
        <button type="button" className="playlist-close" onClick={onClose} aria-label="Close playlist">
          ✕
        </button>
      </div>

      <div className="playlist-actions-bar">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenLobby}>
          Browse lobby & add film
        </button>
      </div>

      <div className="playlist-items-list">
        {playlist.length === 0 ? (
          <div className="playlist-empty">
            <p>Queue is empty.</p>
            <p className="playlist-empty-sub">Add titles from the Lobby to program the night.</p>
          </div>
        ) : (
          playlist.map((item, idx) => {
            const hasVotedSkip = item.skipVotes.includes(youId);
            return (
              <div key={item.id} className="playlist-item-card">
                <div className="playlist-item-header">
                  <span className="playlist-index">#{idx + 1}</span>
                  <span className="playlist-item-title">{item.source.title}</span>
                </div>

                <div className="playlist-item-meta">
                  <span className="playlist-added-by">Added by {getMemberName(item.addedBy)}</span>
                  <span className="playlist-skips">
                    Skips: {item.skipVotes.length} / {skipThreshold}
                  </span>
                </div>

                <div className="playlist-item-buttons">
                  <button
                    type="button"
                    className={`btn-skip ${hasVotedSkip ? 'btn-skip--voted' : ''}`}
                    onClick={() => handleVoteSkip(item.id)}
                  >
                    {hasVotedSkip ? 'Voted to skip' : 'Vote to skip'}
                  </button>

                  {isHost && (
                    <button
                      type="button"
                      className="btn-play-next"
                      onClick={() => handlePlayNow(item.source)}
                    >
                      Screen now
                    </button>
                  )}

                  {(isHost || item.addedBy === youId) && (
                    <button
                      type="button"
                      className="btn-remove"
                      onClick={() => handleRemove(item.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

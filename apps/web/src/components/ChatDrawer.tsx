import { useState, useRef, useEffect } from 'react';
import { type ChatMessage, type Member } from '@popcorn/shared';
import { useRoomStore } from '../stores/room-store';
import './ChatDrawer.css';

interface ChatDrawerProps {
  chat: ChatMessage[];
  members: Member[];
  currentVideoTimeS: number;
  isOpen: boolean;
  onClose: () => void;
}

export function ChatDrawer({
  chat,
  members,
  currentVideoTimeS,
  isOpen,
  onClose,
}: ChatDrawerProps) {
  const { sendChat } = useRoomStore();
  const [inputText, setInputText] = useState('');
  const [spoilerSafe, setSpoilerSafe] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat.length, isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendChat(inputText.trim(), currentVideoTimeS);
    setInputText('');
  };

  function getMemberName(memberId: string): string {
    const m = members.find((mem) => mem.id === memberId);
    return m ? m.nickname : 'Guest';
  }

  function formatTimecode(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  return (
    <aside
      className={`chat-drawer chrome ${isOpen ? 'chat-drawer--open' : ''}`}
      aria-label="Screening room whispers and chat"
    >
      <div className="chat-drawer-header">
        <div className="chat-drawer-title-group">
          <h3 className="chat-drawer-title">Whispers</h3>
          <span className="chat-drawer-count">{chat.length}</span>
        </div>
        <button
          type="button"
          className="chat-drawer-close"
          onClick={onClose}
          aria-label="Close whispers drawer"
        >
          ✕
        </button>
      </div>

      <div className="chat-drawer-controls">
        <label className="spoiler-toggle">
          <input
            type="checkbox"
            checked={spoilerSafe}
            onChange={(e) => setSpoilerSafe(e.target.checked)}
          />
          <span className="spoiler-label">Spoiler safe (hide ahead)</span>
        </label>
      </div>

      <div className="chat-messages-container">
        {chat.length === 0 ? (
          <div className="chat-empty">
            <p>Quiet theater. Say a whisper or react to the film.</p>
          </div>
        ) : (
          chat.map((msg) => {
            const isSpoiler = spoilerSafe && msg.videoTimeS > currentVideoTimeS + 2;
            return (
              <div
                key={msg.id}
                className={`chat-message-item ${isSpoiler ? 'chat-message--spoiler' : ''}`}
              >
                <div className="chat-message-meta">
                  <span className="chat-message-sender">{getMemberName(msg.memberId)}</span>
                  <span className="chat-message-timecode" title="Film time">
                    {formatTimecode(msg.videoTimeS)}
                  </span>
                </div>
                <div className="chat-message-content">
                  {isSpoiler ? (
                    <span className="chat-spoiler-masked">
                      Hidden spoiler (ahead of current time)
                    </span>
                  ) : (
                    msg.text
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="chat-input-form">
        <input
          type="text"
          maxLength={500}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Whisper something..."
          className="chat-input"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="chat-send-btn"
        >
          Send
        </button>
      </form>
    </aside>
  );
}

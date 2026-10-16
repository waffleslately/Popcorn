import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { LIMITS } from '@popcorn/shared';
import { useRoomStore } from '../stores/room-store';
import './BoxOffice.css';

interface BoxOfficeProps {
  initialCode?: string;
  onEnterRoom?: () => void;
}

export function BoxOffice({ initialCode = '', onEnterRoom }: BoxOfficeProps) {
  const {
    code: storeCode,
    nickname,
    setNickname,
    createRoom,
    joinRoom,
    error,
    isConnecting,
    snapshot,
  } = useRoomStore();

  const [inputCode, setInputCode] = useState(initialCode || storeCode);
  const [inputNick, setInputNick] = useState(nickname || '');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copyFeedback, setCopyFeedback] = useState<string>('');
  const [roomInfo, setRoomInfo] = useState<{
    exists: boolean;
    seatsTaken: number;
    seatsMax: number;
    sourceTitle: string | null;
  } | null>(null);

  const activeCode = (snapshot?.code || inputCode).toUpperCase();
  const API_BASE: string =
    (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;

  // Fetch room info if code is 6 characters
  useEffect(() => {
    if (activeCode.length === 6) {
      fetch(`${API_BASE}/api/rooms/${activeCode}`)
        .then((r) => r.json())
        .then((data) => setRoomInfo(data))
        .catch(() => setRoomInfo(null));
    } else {
      setRoomInfo(null);
    }
  }, [activeCode, API_BASE]);

  // Generate QR code for the active room link
  useEffect(() => {
    if (activeCode.length === 6) {
      const inviteUrl = `${window.location.origin}?room=${activeCode}`;
      QRCode.toDataURL(inviteUrl, {
        margin: 1,
        width: 130,
        color: {
          dark: '#1a1418',
          light: '#edf1f5',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(''));
    } else {
      setQrDataUrl('');
    }
  }, [activeCode]);

  const handleCreate = async () => {
    if (!inputNick.trim()) {
      useRoomStore.setState({ error: 'Please enter a nickname first.' });
      return;
    }
    setNickname(inputNick.trim());
    const newCode = await createRoom();
    if (newCode) {
      setInputCode(newCode);
      const joined = await joinRoom(newCode, inputNick.trim());
      if (joined) onEnterRoom?.();
    }
  };

  const handleJoin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputNick.trim()) {
      useRoomStore.setState({ error: 'Please choose a nickname (1 to 20 characters).' });
      return;
    }
    if (!inputCode.trim()) {
      useRoomStore.setState({ error: 'Please enter a 6-character room code.' });
      return;
    }
    setNickname(inputNick.trim());
    const joined = await joinRoom(inputCode.trim(), inputNick.trim());
    if (joined) onEnterRoom?.();
  };

  const handleCopyLink = () => {
    if (!activeCode) return;
    const inviteUrl = `${window.location.origin}?room=${activeCode}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopyFeedback('Link copied');
      setTimeout(() => setCopyFeedback(''), 2500);
    });
  };

  return (
    <div className="boxoffice-root">
      <header className="boxoffice-header">
        <h1 className="boxoffice-title">Box office</h1>
        <p className="boxoffice-subtitle">
          Real-time cinema watch-party. Enter with a ticket or admit guests.
        </p>
      </header>

      {error && (
        <div className="boxoffice-error" role="alert">
          {error}
        </div>
      )}

      <div className="boxoffice-grid">
        {/* Ticket Stub */}
        <section className="boxoffice-ticket-section" aria-label="Room admission ticket">
          <div className="ticket boxoffice-ticket">
            <div className="ticket-header">
              <span className="ticket-cinema-brand">POPCORN CINEMA</span>
              <span className="ticket-admit">ADMIT ONE</span>
            </div>

            <div className="ticket-body">
              <div className="ticket-field">
                <span className="ticket-label">Room code</span>
                <span className="ticket-code">
                  {activeCode ? activeCode : '------'}
                </span>
              </div>

              <div className="ticket-field">
                <span className="ticket-label">Now showing</span>
                <span className="ticket-movie">
                  {snapshot?.source?.title || roomInfo?.sourceTitle || 'Open screening'}
                </span>
              </div>

              <div className="ticket-field">
                <span className="ticket-label">Seats filled</span>
                <span className="ticket-seats">
                  {snapshot
                    ? `${snapshot.members.filter((m) => m.connected).length} / ${LIMITS.ROOM_MAX}`
                    : roomInfo && roomInfo.exists
                    ? `${roomInfo.seatsTaken} / ${roomInfo.seatsMax}`
                    : `0 / ${LIMITS.ROOM_MAX}`}
                </span>
              </div>
            </div>

            {/* QR code and Copy Link */}
            {activeCode && activeCode.length === 6 && (
              <div className="ticket-footer">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt={`QR code for room ${activeCode}`}
                    className="ticket-qr"
                  />
                )}
                <div className="ticket-actions">
                  <button
                    type="button"
                    className="ticket-copy-btn"
                    onClick={handleCopyLink}
                  >
                    {copyFeedback || 'Copy invite link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Admission Form */}
        <section className="boxoffice-controls" aria-label="Admission controls">
          <form onSubmit={handleJoin} className="boxoffice-form">
            <div className="form-group">
              <label htmlFor="nickname" className="form-label">
                Your nickname
              </label>
              <input
                id="nickname"
                type="text"
                maxLength={20}
                value={inputNick}
                onChange={(e) => setInputNick(e.target.value)}
                placeholder="e.g. Jean-Luc"
                className="form-input"
                autoComplete="off"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="room-code" className="form-label">
                Room code
              </label>
              <input
                id="room-code"
                type="text"
                maxLength={6}
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="6 letters or numbers"
                className="form-input form-input-code"
                autoComplete="off"
              />
            </div>

            <div className="form-actions">
              <button
                type="submit"
                disabled={isConnecting || !inputCode.trim()}
                className="btn btn-primary"
              >
                {isConnecting ? 'Admitting...' : 'Join room'}
              </button>

              <button
                type="button"
                onClick={handleCreate}
                disabled={isConnecting}
                className="btn btn-secondary"
              >
                Start screening
              </button>
            </div>
          </form>

          {snapshot && (
            <div className="boxoffice-resume">
              <p className="resume-text">
                Currently seated in room <strong>{snapshot.code}</strong> as{' '}
                <strong>{nickname}</strong>.
              </p>
              <button
                type="button"
                onClick={onEnterRoom}
                className="btn btn-brass"
              >
                Enter screening room
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

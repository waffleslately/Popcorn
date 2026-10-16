import { useEffect, useState } from 'react';
import { useRoomStore } from './stores/room-store';
import { BoxOffice } from './components/BoxOffice';
import { ScreeningRoom } from './components/ScreeningRoom';
import './styles/tokens.css';

export default function App() {
  const { snapshot, initSocketListeners, isWakingServer } = useRoomStore();
  const [activeScreen, setActiveScreen] = useState<'box-office' | 'screening-room'>('box-office');
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');

  useEffect(() => {
    initSocketListeners();

    // Support two URL patterns:
    //   ?room=ABC123   (legacy invite links)
    //   /r/ABC123      (pretty direct links)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setInitialRoomCode(roomParam.trim().toUpperCase());
      return;
    }

    // Match /r/<code> path (served via SPA fallback)
    const pathMatch = window.location.pathname.match(/^\/r\/([A-Z0-9]{6})$/i);
    if (pathMatch) {
      setInitialRoomCode(pathMatch[1].toUpperCase());
    }
  }, [initSocketListeners]);

  // If connected with a snapshot and not explicitly on box-office, go to screening room
  useEffect(() => {
    if (snapshot && activeScreen === 'box-office') {
      setActiveScreen('screening-room');
    }
  }, [snapshot, activeScreen]);

  return (
    <div className="popcorn-app">
      {/* "Waking server" notice — shown when first connection takes > 3 s */}
      {isWakingServer && (
        <div
          role="status"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            background: 'var(--velvet-700, #4a1520)',
            color: 'var(--beam-100, #f5f0e8)',
            padding: '0.6rem 1rem',
            textAlign: 'center',
            fontSize: '0.875rem',
            letterSpacing: '0.02em',
          }}
        >
          🍿 Waking the server — this can take up to a minute on the free tier…
        </div>
      )}

      {activeScreen === 'screening-room' && snapshot ? (
        <ScreeningRoom onBackToBoxOffice={() => setActiveScreen('box-office')} />
      ) : (
        <BoxOffice
          initialCode={initialRoomCode}
          onEnterRoom={() => setActiveScreen('screening-room')}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRoomStore } from './stores/room-store';
import { BoxOffice } from './components/BoxOffice';
import { ScreeningRoom } from './components/ScreeningRoom';

export default function App() {
  const { snapshot, initSocketListeners } = useRoomStore();
  const [activeScreen, setActiveScreen] = useState<'box-office' | 'screening-room'>('box-office');
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');

  useEffect(() => {
    initSocketListeners();

    // Check URL parameters: ?room=ABC123
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setInitialRoomCode(roomParam.trim().toUpperCase());
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

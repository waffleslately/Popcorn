import { useEffect, useState, useRef } from 'react';
import { useRoomStore } from './stores/room-store';
import { useAuthStore } from './stores/auth-store';
import { BoxOffice } from './components/BoxOffice';
import { ScreeningRoom } from './components/ScreeningRoom';
import { AuthModal } from './components/AuthModal';
import { RateScreeningModal } from './components/RateScreeningModal';
import { ProfilePage } from './pages/ProfilePage';
import { FilmPage } from './pages/FilmPage';
import { DiaryPage } from './pages/DiaryPage';
import { ListsPage } from './pages/ListsPage';
import { FeedPage } from './pages/FeedPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportPage } from './pages/ImportPage';
import './styles/tokens.css';

type Route =
  | { kind: 'home' }
  | { kind: 'profile'; username: string }
  | { kind: 'film'; tmdbId: number }
  | { kind: 'diary' }
  | { kind: 'lists' }
  | { kind: 'feed' }
  | { kind: 'settings' }
  | { kind: 'import' };

function parsePath(pathname: string): Route {
  const uMatch = pathname.match(/^\/u\/([a-zA-Z0-9_.-]+)$/i);
  if (uMatch) return { kind: 'profile', username: uMatch[1] };

  const fMatch = pathname.match(/^\/film\/(\d+)$/i);
  if (fMatch) return { kind: 'film', tmdbId: parseInt(fMatch[1], 10) };

  if (pathname === '/diary') return { kind: 'diary' };
  if (pathname === '/lists') return { kind: 'lists' };
  if (pathname === '/feed') return { kind: 'feed' };
  if (pathname === '/settings') return { kind: 'settings' };
  if (pathname === '/import') return { kind: 'import' };

  return { kind: 'home' };
}

export default function App() {
  const { snapshot, initSocketListeners, isWakingServer } = useRoomStore();
  const { initAuth, user } = useAuthStore();
  const [activeScreen, setActiveScreen] = useState<'box-office' | 'screening-room'>('box-office');
  const [initialRoomCode, setInitialRoomCode] = useState<string>('');
  const [currentRoute, setCurrentRoute] = useState<Route>(() => parsePath(window.location.pathname));
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Post-screening rating state
  const [ratingPrompt, setRatingPrompt] = useState<{
    roomCode: string;
    tmdbId: number;
    title: string;
  } | null>(null);

  const prevSourceRef = useRef(snapshot?.source);

  useEffect(() => {
    initAuth();
    initSocketListeners();

    const handlePopState = () => {
      setCurrentRoute(parsePath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);

    // Support ?room=ABC123 or /r/ABC123
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      setInitialRoomCode(roomParam.trim().toUpperCase());
      return () => window.removeEventListener('popstate', handlePopState);
    }

    const pathMatch = window.location.pathname.match(/^\/r\/([A-Z0-9]{6})$/i);
    if (pathMatch) {
      setInitialRoomCode(pathMatch[1].toUpperCase());
    }

    return () => window.removeEventListener('popstate', handlePopState);
  }, [initAuth, initSocketListeners]);

  // If connected with a snapshot and not explicitly on box-office or social pages, go to screening room
  useEffect(() => {
    if (snapshot && activeScreen === 'box-office' && currentRoute.kind === 'home') {
      setActiveScreen('screening-room');
    }
  }, [snapshot, activeScreen, currentRoute]);

  // Monitor screening end: if a source was playing and is cleared / screening ends, prompt rating
  useEffect(() => {
    const prev = prevSourceRef.current;
    const curr = snapshot?.source;
    if (prev && !curr && user && snapshot?.code) {
      // Source just ended or removed
      // Try to determine tmdbId from source or default to placeholder
      const tmdbId = (prev as any).tmdbId || 550;
      setRatingPrompt({
        roomCode: snapshot.code,
        tmdbId,
        title: prev.title || 'Screened Film',
      });
    }
    prevSourceRef.current = curr;
  }, [snapshot?.source, user, snapshot?.code]);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentRoute(parsePath(path));
  };

  const navigateHome = () => {
    window.history.pushState({}, '', '/');
    setCurrentRoute({ kind: 'home' });
  };

  return (
    <div className="popcorn-app">
      {/* "Waking server" notice */}
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

      {/* Auth Modal */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {/* Post-screening Rating Modal */}
      {ratingPrompt && (
        <RateScreeningModal
          roomCode={ratingPrompt.roomCode}
          tmdbId={ratingPrompt.tmdbId}
          movieTitle={ratingPrompt.title}
          onClose={() => setRatingPrompt(null)}
        />
      )}

      {/* Route matching */}
      {currentRoute.kind === 'profile' && (
        <ProfilePage
          username={currentRoute.username}
          onBack={navigateHome}
          onFilm={(id) => navigateTo(`/film/${id}`)}
        />
      )}

      {currentRoute.kind === 'film' && (
        <FilmPage
          tmdbId={currentRoute.tmdbId}
          onBack={navigateHome}
        />
      )}

      {currentRoute.kind === 'diary' && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={navigateHome}
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--t-sm)',
            }}
          >
            ← Back
          </button>
          <DiaryPage onFilm={(id) => navigateTo(`/film/${id}`)} />
        </div>
      )}

      {currentRoute.kind === 'lists' && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={navigateHome}
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--t-sm)',
            }}
          >
            ← Back
          </button>
          <ListsPage onFilm={(id) => navigateTo(`/film/${id}`)} />
        </div>
      )}

      {currentRoute.kind === 'feed' && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={navigateHome}
            style={{
              position: 'absolute',
              top: '1rem',
              left: '1rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ink)',
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--t-sm)',
            }}
          >
            ← Back
          </button>
          <FeedPage
            onFilm={(id) => navigateTo(`/film/${id}`)}
            onProfile={(username) => navigateTo(`/u/${username}`)}
          />
        </div>
      )}

      {currentRoute.kind === 'settings' && (
        <SettingsPage onBack={navigateHome} />
      )}

      {currentRoute.kind === 'import' && (
        <ImportPage onBack={navigateHome} />
      )}

      {currentRoute.kind === 'home' && (
        activeScreen === 'screening-room' && snapshot ? (
          <ScreeningRoom onBackToBoxOffice={() => setActiveScreen('box-office')} />
        ) : (
          <BoxOffice
            initialCode={initialRoomCode}
            onEnterRoom={() => setActiveScreen('screening-room')}
            onNavigate={(path) => navigateTo(path)}
            onOpenAuth={() => setShowAuthModal(true)}
          />
        )
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { type Source } from '@popcorn/shared';
import { useRoomStore } from '../stores/room-store';
import { getServerOffset } from '../lib/socket';
import { YouTubeAdapter } from '../lib/player/youtube-adapter';
import { Html5Adapter } from '../lib/player/html5-adapter';
import { SyncEngine } from '../lib/player/sync-engine';
import { type PlayerAdapter } from '../lib/player/adapter';
import './CinemaPlayer.css';

interface CinemaPlayerProps {
  source: Source | null;
  onOpenLobby?: () => void;
  onSelectSource?: (source: Source) => void;
}

/**
 * CinemaPlayer wraps the actual player with an autoplay-policy gate.
 *
 * Browsers block `video.play()` before the first user gesture on the page.
 * We show a "Click to watch" overlay that the user must tap — that gesture
 * unblocks autoplay for the entire session.
 */
export function CinemaPlayer({ source, onOpenLobby, onSelectSource }: CinemaPlayerProps) {
  const { snapshot, reportDrift } = useRoomStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const syncEngineRef = useRef<SyncEngine | null>(null);

  // Upload state from device storage
  const [isUploading, setIsUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * userUnlocked — true once the user has clicked the gate overlay.
   * Persisted in sessionStorage so navigating back to the room doesn't
   * re-show the gate within the same tab session.
   */
  const [userUnlocked, setUserUnlocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('popcorn_autoplay_ok') === '1';
    } catch {
      return false;
    }
  });

  function handleUnlock() {
    try {
      sessionStorage.setItem('popcorn_autoplay_ok', '1');
    } catch {
      /* ignore */
    }
    setUserUnlocked(true);
  }

  const handleStageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadPercent(0);
    setUploadError(null);

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    const SERVER_URL =
      (import.meta.env.VITE_SERVER_URL as string | undefined) || window.location.origin;
    xhr.open('POST', `${SERVER_URL}/api/upload`);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadPercent(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status === 201) {
        const data = JSON.parse(xhr.responseText);
        onSelectSource?.({
          kind: 'file',
          ref: data.url,
          title: data.title || file.name,
        });
      } else {
        setUploadError('Failed to upload video file. Please try again.');
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      setUploadError('Network error uploading video file.');
    };

    xhr.send(formData);
  };

  // Initialize or switch adapter when source kind changes
  useEffect(() => {
    if (!source || !userUnlocked) return;

    let activeAdapter: PlayerAdapter | null = null;

    if (source.kind === 'youtube') {
      const containerId = 'yt-player-element';
      if (ytContainerRef.current) {
        ytContainerRef.current.innerHTML = `<div id="${containerId}"></div>`;
        activeAdapter = new YouTubeAdapter(containerId);
      }
    } else if (source.kind === 'file' || source.kind === 'stream') {
      if (videoRef.current) {
        activeAdapter = new Html5Adapter(videoRef.current);
      }
    }

    if (activeAdapter) {
      adapterRef.current = activeAdapter;
      activeAdapter.load(source);

      // Create sync engine
      const engine = new SyncEngine({
        adapter: activeAdapter,
        getServerOffset,
        reportDrift,
      });
      syncEngineRef.current = engine;
    }

    return () => {
      syncEngineRef.current?.destroy();
      syncEngineRef.current = null;
      activeAdapter?.destroy();
    };
  }, [source?.kind, source?.ref, reportDrift, userUnlocked]);

  // Synchronize playback state changes with the SyncEngine
  useEffect(() => {
    if (snapshot?.playback && syncEngineRef.current) {
      syncEngineRef.current.applyPlayback(snapshot.playback);
    }
  }, [snapshot?.playback]);

  if (!source) {
    return (
      <div className="player-empty-stage">
        <div className="player-curtain">
          <p className="player-slate-text">Curtain raised</p>
          <p className="player-slate-sub">Add a film to begin screening</p>

          <input
            ref={uploadInputRef}
            type="file"
            accept="video/*,.mp4,.webm,.mov,.mkv"
            style={{ display: 'none' }}
            onChange={handleStageFileUpload}
          />

          {isUploading ? (
            <div style={{ marginTop: '1.25rem', color: 'var(--kernel)' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>
                Uploading movie: {uploadPercent}%
              </p>
              <div
                style={{
                  width: '220px',
                  height: '6px',
                  background: 'rgba(255,255,255,0.2)',
                  margin: '0 auto',
                  borderRadius: '3px',
                }}
              >
                <div
                  style={{
                    width: `${uploadPercent}%`,
                    height: '100%',
                    background: 'var(--kernel)',
                    borderRadius: '3px',
                    transition: 'width 0.2s linear',
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                marginTop: '1.25rem',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}
            >
              {onOpenLobby && (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: '0.6rem 1.4rem' }}
                  onClick={onOpenLobby}
                >
                  🍿 Open Movie Lobby
                </button>
              )}
              {onSelectSource && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '0.6rem 1.4rem' }}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  📁 Upload from Gallery / Device
                </button>
              )}
            </div>
          )}

          {uploadError && (
            <p
              style={{
                color: 'var(--velvet-400, #ff858d)',
                marginTop: '8px',
                fontSize: '0.85rem',
              }}
            >
              {uploadError}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Autoplay gate — shown before first user interaction
  if (!userUnlocked) {
    return (
      <div
        className="player-empty-stage"
        style={{ cursor: 'pointer' }}
        onClick={handleUnlock}
        role="button"
        aria-label="Click to enter the screening room"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleUnlock();
        }}
      >
        <div className="player-curtain">
          <p className="player-slate-text" style={{ fontSize: '2.5rem' }}>
            🎬
          </p>
          <p className="player-slate-text">Click to watch</p>
          <p className="player-slate-sub">Tap anywhere to enter the screening room</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cinema-player-wrapper">
      {source.kind === 'youtube' ? (
        <div ref={ytContainerRef} className="player-yt-container" />
      ) : (
        <video
          ref={videoRef}
          className="player-video-element"
          playsInline
          controls={false}
        />
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stopLiveAnimations } from '@/lib/api/animations';
import { legacyMediaUrl } from '@/lib/api/config';
import { formatAnimationDuration } from '@/lib/animations-settings';
import { registerSoundRuntime } from '@/lib/runtime/sound-runtime';
import { useAnimationsStore } from '@/lib/stores/animations-store';
import { useLiveStore } from '@/lib/stores/live-store';
import { useMicStore } from '@/lib/stores/mic-store';
import { useSoundsStore } from '@/lib/stores/sounds-store';
import { useVoicesStore } from '@/lib/stores/voices-store';
import { normalizeSoundPath } from '@/lib/sounds-settings';
import { ControlRoomMicRuntime } from '@/components/control-room/control-room-mic-runtime';

type RuntimeAlertEntry = {
  id: string;
  label: string;
  message: string;
  tone: 'notice' | 'error';
};

function buildAlertEntries(entries: Array<{ id: string; label: string; notice?: string; error?: string }>) {
  return entries
    .map((entry) => {
      const message = String(entry.error || entry.notice || '').trim();
      if (!message) return null;
      return {
        id: entry.id,
        label: entry.label,
        message,
        tone: entry.error ? 'error' : 'notice'
      } satisfies RuntimeAlertEntry;
    })
    .filter((entry): entry is RuntimeAlertEntry => Boolean(entry));
}

function ControlRoomAlertRail() {
  const soundsNotice = useSoundsStore((state) => state.notice);
  const soundsError = useSoundsStore((state) => state.error);
  const animationsNotice = useAnimationsStore((state) => state.notice);
  const animationsError = useAnimationsStore((state) => state.error);
  const liveNotice = useLiveStore((state) => state.notice);
  const liveError = useLiveStore((state) => state.error);
  const voicesNotice = useVoicesStore((state) => state.notice);
  const voicesError = useVoicesStore((state) => state.error);
  const micNotice = useMicStore((state) => state.notice);
  const micError = useMicStore((state) => state.error);

  const entries = useMemo(
    () => buildAlertEntries([
      { id: 'sounds', label: 'Sounds', notice: soundsNotice, error: soundsError },
      { id: 'animations', label: 'Animations', notice: animationsNotice, error: animationsError },
      { id: 'live', label: 'Live', notice: liveNotice, error: liveError },
      { id: 'voices', label: 'Voices', notice: voicesNotice, error: voicesError },
      { id: 'mic', label: 'Mic', notice: micNotice, error: micError }
    ]),
    [animationsError, animationsNotice, liveError, liveNotice, micError, micNotice, soundsError, soundsNotice, voicesError, voicesNotice]
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="control-room-alert-rail" aria-live="polite">
      {entries.map((entry) => (
        <article key={entry.id} className={`control-room-alert-card is-${entry.tone}`}>
          <span>{entry.label}</span>
          <strong>{entry.tone === 'error' ? 'Attention' : 'Updated'}</strong>
          <p>{entry.message}</p>
        </article>
      ))}
    </div>
  );
}

function ControlRoomSoundRuntime() {
  const sounds = useSoundsStore((state) => state.sounds);
  const activeSoundPath = useSoundsStore((state) => state.activeSoundPath);
  const globalVolume = useSoundsStore((state) => state.globalVolume);
  const soundVolumes = useSoundsStore((state) => state.soundVolumes);
  const setActiveSoundPath = useSoundsStore((state) => state.setActiveSoundPath);
  const setError = useSoundsStore((state) => state.setError);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activePathRef = useRef('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const currentSound = useMemo(() => {
    return sounds.find((entry) => entry.path === activeSoundPath) || null;
  }, [activeSoundPath, sounds]);

  const resetPreview = useCallback((clearStore = true) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    activePathRef.current = '';
    setCurrentTime(0);
    setDuration(0);
    if (clearStore) {
      setActiveSoundPath('');
    }
  }, [setActiveSoundPath]);

  const togglePreview = useCallback(async (soundPath: string) => {
    const normalizedPath = normalizeSoundPath(soundPath);
    if (!normalizedPath) return;

    if (activePathRef.current === normalizedPath) {
      resetPreview();
      return;
    }

    resetPreview(false);

    const audio = new Audio(legacyMediaUrl(normalizedPath));
    audio.volume = Math.min(1, Math.max(0, (globalVolume / 100) * ((soundVolumes[normalizedPath] ?? 100) / 100)));
    audio.addEventListener('loadedmetadata', () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    });
    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime || 0);
    });
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        resetPreview();
      }
    });

    audioRef.current = audio;
    activePathRef.current = normalizedPath;
    setActiveSoundPath(normalizedPath);

    try {
      await audio.play();
    } catch (err) {
      resetPreview();
      setError(err instanceof Error ? err.message : 'Failed to play sound preview');
    }
  }, [globalVolume, resetPreview, setActiveSoundPath, setError, soundVolumes]);

  useEffect(() => {
    const unregister = registerSoundRuntime({
      togglePreview,
      stop: () => resetPreview()
    });
    return unregister;
  }, [resetPreview, togglePreview]);

  useEffect(() => {
    if (!audioRef.current || !activeSoundPath) return;
    audioRef.current.volume = Math.min(1, Math.max(0, (globalVolume / 100) * ((soundVolumes[activeSoundPath] ?? 100) / 100)));
  }, [activeSoundPath, globalVolume, soundVolumes]);

  useEffect(() => {
    if (activeSoundPath) return;
    if (audioRef.current) {
      resetPreview(false);
    }
  }, [activeSoundPath, resetPreview]);

  useEffect(() => {
    return () => {
      resetPreview(false);
    };
  }, [resetPreview]);

  if (!activeSoundPath) {
    return null;
  }

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const displayName = currentSound?.name || activeSoundPath.split('/').pop() || activeSoundPath;

  return (
    <article className="control-room-floating-widget control-room-floating-widget-sound">
      <span className="control-room-floating-badge">Preview</span>
      <strong>{displayName}</strong>
      <p>Shared audio preview keeps playing while you move between tools.</p>
      <div className="control-room-floating-progress" aria-hidden="true">
        <div className="control-room-floating-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <button type="button" className="control-room-runtime-button" onClick={() => resetPreview()}>
        Stop preview
      </button>
    </article>
  );
}

function ControlRoomAnimationWidget() {
  const activeTrigger = useAnimationsStore((state) => state.activeTrigger);
  const config = useAnimationsStore((state) => state.config);
  const animations = useAnimationsStore((state) => state.animations);
  const setActiveTrigger = useAnimationsStore((state) => state.setActiveTrigger);
  const setNotice = useAnimationsStore((state) => state.setNotice);
  const setError = useAnimationsStore((state) => state.setError);
  const [isStopping, setIsStopping] = useState(false);

  const mapping = activeTrigger ? config.mappings[activeTrigger] || null : null;
  const file = useMemo(
    () => animations.find((entry) => entry.filename === mapping?.file) || null,
    [animations, mapping]
  );

  const handleStop = useCallback(async () => {
    if (!activeTrigger) return;
    setIsStopping(true);
    try {
      await stopLiveAnimations();
      setActiveTrigger('');
      setNotice('Stopped live animation playback.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop live animation');
    } finally {
      setIsStopping(false);
    }
  }, [activeTrigger, setActiveTrigger, setError, setNotice]);

  if (!activeTrigger || !mapping) {
    return null;
  }

  return (
    <article className="control-room-floating-widget control-room-floating-widget-animation">
      <span className="control-room-floating-badge is-live">Live</span>
      {file?.thumbnailPath ? (
        <img className="control-room-floating-thumb" src={legacyMediaUrl(file.thumbnailPath)} alt={activeTrigger} />
      ) : null}
      <strong>{activeTrigger}</strong>
      <p>
        {file?.name || mapping.file}
        {file?.durationSeconds ? ` • ${formatAnimationDuration(file.durationSeconds)}` : ''}
      </p>
      <button type="button" className="control-room-runtime-button" onClick={() => void handleStop()} disabled={isStopping}>
        {isStopping ? 'Stopping…' : 'Stop live'}
      </button>
    </article>
  );
}

export function ControlRoomRuntime() {
  return (
    <>
      <ControlRoomSoundRuntime />
      <ControlRoomAnimationWidget />
      <ControlRoomAlertRail />
      <ControlRoomMicRuntime />
    </>
  );
}

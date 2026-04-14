'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { extractMicVoiceProfile, getMicHealth } from '@/lib/api/mic';
import {
  buildMicSettingsRecord,
  DEFAULT_MIC_ASR_BASE_URL,
  DEFAULT_MIC_VOICE_MATCH_THRESHOLD,
  normalizeVoiceMatchThreshold
} from '@/lib/mic-settings';
import { pcm16ToWavDataUrl, recordEnrollmentSample } from '@/lib/mic-browser';
import { saveSettings } from '@/lib/api/settings';
import { startGlobalMicListening, stopGlobalMicListening } from '@/lib/runtime/mic-runtime';
import { useMicStore } from '@/lib/stores/mic-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { MicSettingsState, MicVoiceProfile } from '@/lib/types/mic';

type MicPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
};

function formatClock(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function MicPageClient({ initialScope, initialSettings }: MicPageClientProps) {
  const hydrate = useMicStore((state) => state.hydrate);
  const hydrated = useMicStore((state) => state.hydrated);
  const scope = useMicStore((state) => state.scope);
  const rawSettings = useMicStore((state) => state.rawSettings);
  const asrBaseUrl = useMicStore((state) => state.asrBaseUrl);
  const language = useMicStore((state) => state.language);
  const triggerMode = useMicStore((state) => state.triggerMode);
  const voiceGateEnabled = useMicStore((state) => state.voiceGateEnabled);
  const voiceProfile = useMicStore((state) => state.voiceProfile);
  const voicePreviewDataUrl = useMicStore((state) => state.voicePreviewDataUrl);
  const voiceMatchThreshold = useMicStore((state) => state.voiceMatchThreshold);
  const health = useMicStore((state) => state.health);
  const healthError = useMicStore((state) => state.healthError);
  const listening = useMicStore((state) => state.listening);
  const connecting = useMicStore((state) => state.connecting);
  const enrolling = useMicStore((state) => state.enrolling);
  const micLevel = useMicStore((state) => state.micLevel);
  const status = useMicStore((state) => state.status);
  const transcripts = useMicStore((state) => state.transcripts);
  const notice = useMicStore((state) => state.notice);
  const error = useMicStore((state) => state.error);
  const commitSettingsState = useMicStore((state) => state.commitSettingsState);
  const setAsrBaseUrl = useMicStore((state) => state.setAsrBaseUrl);
  const setLanguage = useMicStore((state) => state.setLanguage);
  const setTriggerMode = useMicStore((state) => state.setTriggerMode);
  const setVoiceGateEnabled = useMicStore((state) => state.setVoiceGateEnabled);
  const setVoiceProfile = useMicStore((state) => state.setVoiceProfile);
  const setVoicePreviewDataUrl = useMicStore((state) => state.setVoicePreviewDataUrl);
  const setVoiceMatchThreshold = useMicStore((state) => state.setVoiceMatchThreshold);
  const setHealth = useMicStore((state) => state.setHealth);
  const setListeningState = useMicStore((state) => state.setListeningState);
  const clearTranscripts = useMicStore((state) => state.clearTranscripts);
  const setNotice = useMicStore((state) => state.setNotice);
  const setError = useMicStore((state) => state.setError);

  const initializedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPreviewingSample, setIsPreviewingSample] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings
    });
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings]);

  const currentSettingsState = useMemo<MicSettingsState>(
    () => ({
      asrBaseUrl,
      language,
      triggerMode,
      voiceGateEnabled,
      voiceProfile,
      voicePreviewDataUrl,
      voiceMatchThreshold
    }),
    [asrBaseUrl, language, triggerMode, voiceGateEnabled, voiceProfile, voicePreviewDataUrl, voiceMatchThreshold]
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const nextRawSettings = buildMicSettingsRecord(rawSettings, currentSettingsState);
          await saveSettings(nextRawSettings, scope);
          commitSettingsState(currentSettingsState, nextRawSettings);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to save mic settings');
        }
      })();
    }, 300);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [commitSettingsState, currentSettingsState, hydrated, rawSettings, scope, setError]);

  async function refreshHealth() {
    try {
      const nextHealth = await getMicHealth(asrBaseUrl || DEFAULT_MIC_ASR_BASE_URL);
      setHealth(nextHealth, '');
      setListeningState({
        status: listening
          ? `Mic active • ${triggerMode === 'suggest' ? 'suggestion mode' : 'listening'}`
          : `Mic ASR online (${nextHealth.whisperModel}, ${nextHealth.whisperDevice})`
      });
      return true;
    } catch (err) {
      setHealth(null, err instanceof Error ? err.message : 'ASR health check failed');
      if (!listening && !connecting) {
        setListeningState({
          status: 'Mic ASR is offline. Start npm run start:asr and try again.'
        });
      }
      return false;
    }
  }

  async function handleEnrollVoice() {
    if (listening || connecting) {
      setError('Stop mic listening before enrolling your voice profile.');
      return;
    }

    setListeningState({ enrolling: true, status: 'Speak naturally for a few seconds to enroll your voice profile...' });
    try {
      const healthOk = await refreshHealth();
      if (!healthOk) throw new Error('ASR service is unavailable');

      const pcmBuffer = await recordEnrollmentSample();
      if (pcmBuffer.byteLength < 16000) {
        throw new Error('The recorded sample was too short. Speak for a few seconds and try again.');
      }

      const result = await extractMicVoiceProfile(asrBaseUrl, pcmBuffer);
      setVoiceProfile(result.profile as MicVoiceProfile);
      setVoicePreviewDataUrl(pcm16ToWavDataUrl(pcmBuffer, 16000));
      setVoiceMatchThreshold(normalizeVoiceMatchThreshold(result.recommendedThreshold || DEFAULT_MIC_VOICE_MATCH_THRESHOLD));
      setVoiceGateEnabled(true);
      setNotice('Voice profile saved. The mic can now react only to your voice.');
      setListeningState({ status: 'Voice profile ready for recognition.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice enrollment failed');
      setListeningState({ status: 'Voice enrollment failed.' });
    } finally {
      setListeningState({ enrolling: false });
    }
  }

  async function handlePreviewSample() {
    if (!voicePreviewDataUrl) {
      setError('No enrolled voice sample is stored yet.');
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }

    try {
      const audio = new Audio(voicePreviewDataUrl);
      previewAudioRef.current = audio;
      setIsPreviewingSample(true);
      audio.onended = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
        }
        setIsPreviewingSample(false);
      };
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice preview failed');
      setIsPreviewingSample(false);
    }
  }

  function handleClearProfile() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setIsPreviewingSample(false);
    setVoiceProfile(null);
    setVoicePreviewDataUrl('');
    setVoiceGateEnabled(false);
    setNotice('Voice profile cleared.');
  }

  async function handleStartListening() {
    try {
      await startGlobalMicListening();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mic runtime is not available');
    }
  }

  function handleStopListening() {
    stopGlobalMicListening();
  }

  const voiceProfileSummary = voiceProfile
    ? `${voiceProfile.frameCount} voiced frames • ${voiceProfile.vector.length} features`
    : 'No voice profile enrolled yet.';

  return (
    <div className="mic-page">
      <section className="live-summary-grid mic-summary-grid">
        <article className={`live-summary-card ${health?.ok ? 'is-connected' : ''}`}>
          <span>ASR status</span>
          <strong>{health?.ok ? 'Online' : 'Offline'}</strong>
          <p>{health ? `${health.whisperModel} on ${health.whisperDevice}` : (healthError || 'Not checked yet')}</p>
        </article>
        <article className={`live-summary-card ${listening ? 'is-connected' : ''}`}>
          <span>Mic stream</span>
          <strong>{listening ? 'Listening' : (connecting ? 'Connecting' : 'Idle')}</strong>
          <p>{status}</p>
        </article>
        <article className={`live-summary-card ${voiceGateEnabled && voiceProfile ? 'is-connected' : ''}`}>
          <span>Voice gate</span>
          <strong>{voiceGateEnabled ? 'Enabled' : 'Disabled'}</strong>
          <p>{voiceProfileSummary}</p>
        </article>
        <article className="live-summary-card">
          <span>Mic level</span>
          <strong>{Math.round(micLevel * 100)}%</strong>
          <p>{triggerMode === 'suggest' ? 'Suggestion mode is selected.' : 'Auto trigger mode is selected.'}</p>
        </article>
      </section>

      {(notice || error) ? (
        <div className={`live-banner ${error ? 'is-error' : 'is-notice'}`}>
          <strong>{error ? 'Attention' : 'Updated'}</strong>
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="live-layout-grid mic-layout-grid">
        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Mic setup</p>
                <h2>ASR and recognition settings</h2>
              </div>
              <span className={`live-pill ${health?.ok ? 'is-connected' : ''}`}>{health?.ok ? 'Healthy' : 'Check service'}</span>
            </div>

            <label className="live-field">
              <span>Mic ASR URL</span>
              <input value={asrBaseUrl} onChange={(event) => setAsrBaseUrl(event.target.value)} placeholder={DEFAULT_MIC_ASR_BASE_URL} />
            </label>

            <div className="live-form-grid">
              <label className="live-field">
                <span>Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="auto">Auto detect</option>
                  <option value="en">English</option>
                  <option value="de">German</option>
                  <option value="pl">Polish</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="it">Italian</option>
                </select>
              </label>
              <label className="live-field">
                <span>Trigger mode</span>
                <select value={triggerMode} onChange={(event) => setTriggerMode(event.target.value === 'suggest' ? 'suggest' : 'auto')}>
                  <option value="auto">Auto trigger</option>
                  <option value="suggest">Suggestion mode</option>
                </select>
              </label>
            </div>

            <label className="live-field">
              <span>Voice match threshold</span>
              <div className="live-inline-range">
                <input
                  type="range"
                  min={60}
                  max={95}
                  value={Math.round(voiceMatchThreshold * 100)}
                  onChange={(event) => setVoiceMatchThreshold(normalizeVoiceMatchThreshold(Number(event.target.value)))}
                />
                <strong>{formatPercent(voiceMatchThreshold)}</strong>
              </div>
            </label>

            <label className="live-field mic-toggle-field">
              <span>Only my voice</span>
              <input type="checkbox" checked={voiceGateEnabled} onChange={(event) => setVoiceGateEnabled(event.target.checked)} />
            </label>

            <div className="live-actions-row">
              <button className="live-button" type="button" onClick={() => void refreshHealth()}>
                Refresh health
              </button>
              <button className="live-button is-primary" type="button" onClick={() => void handleStartListening()} disabled={listening || connecting || enrolling}>
                {connecting ? 'Connecting…' : listening ? 'Listening…' : 'Start listening'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={handleStopListening} disabled={!listening && !connecting}>
                Stop
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Voice profile</p>
                <h2>Enrollment and preview</h2>
              </div>
              <span className={`live-pill ${voiceProfile ? 'is-connected' : ''}`}>{voiceProfile ? 'Ready' : 'Missing'}</span>
            </div>

            <div className="mic-profile-card">
              <strong>{voiceProfile ? 'Voice profile ready' : 'No voice profile enrolled'}</strong>
              <p>{voiceProfileSummary}</p>
            </div>

            <div className="live-actions-row">
              <button className="live-button is-primary" type="button" onClick={() => void handleEnrollVoice()} disabled={enrolling || listening || connecting}>
                {enrolling ? 'Enrolling…' : 'Enroll my voice'}
              </button>
              <button className="live-button" type="button" onClick={() => void handlePreviewSample()} disabled={!voicePreviewDataUrl || isPreviewingSample}>
                {isPreviewingSample ? 'Playing…' : 'Preview sample'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={handleClearProfile} disabled={!voiceProfile && !voicePreviewDataUrl}>
                Clear
              </button>
            </div>
          </section>
        </div>

        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Diagnostics</p>
                <h2>Transcript stream</h2>
              </div>
              <span className="live-pill">{transcripts.length} events</span>
            </div>

            <div className="mic-level-meter">
              <div className="mic-level-bar" style={{ width: `${Math.max(4, micLevel * 100)}%` }} />
            </div>

            <div className="live-actions-row">
              <button className="live-button is-ghost" type="button" onClick={clearTranscripts}>
                Clear transcript log
              </button>
            </div>

            <div className="live-activity-list">
              {transcripts.length === 0 ? <div className="live-empty">Start listening to inspect ASR events and transcript quality here.</div> : transcripts.map((entry) => (
                <article key={entry.id} className={`live-activity-card accent-${entry.type}`}>
                  <header>
                    <div>
                      <strong>{entry.type.replace(/_/g, ' ')}</strong>
                      <span>{entry.language.toUpperCase()} · {entry.confidence > 0 ? `${Math.round(entry.confidence * 100)}% confidence` : 'diagnostic event'}</span>
                    </div>
                    <time>{formatClock(entry.timestamp)}</time>
                  </header>
                  <p>{entry.text}</p>
                  <small>{entry.detail}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">ASR runtime</p>
                <h2>Service details</h2>
              </div>
            </div>

            <div className="mic-runtime-grid">
              <div className="mic-runtime-card">
                <span>Model</span>
                <strong>{health?.whisperModel || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>Device</span>
                <strong>{health?.whisperDevice || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>Compute</span>
                <strong>{health?.whisperComputeType || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>VAD</span>
                <strong>{health ? `${health.vadMode} • ${health.frameMs}ms` : 'Unknown'}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

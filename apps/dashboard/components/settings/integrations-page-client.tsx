'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveSettings } from '@/lib/api/settings';
import { buildLiveSettingsRecord, formatApiKeysInput, parseApiKeysInput, parseLiveSettings } from '@/lib/live-settings';
import { buildMicSettingsRecord, parseMicSettings } from '@/lib/mic-settings';
import { buildVoicesSettingsRecord, parseVoicesSettings } from '@/lib/voices-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { MicHealth } from '@/lib/types/mic';
import type { TikTokStatus } from '@/lib/types/live';

type IntegrationsPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialTikTokStatus: TikTokStatus;
  initialMicHealth: MicHealth | null;
};

export function IntegrationsPageClient({
  initialScope,
  initialSettings,
  initialTikTokStatus,
  initialMicHealth
}: IntegrationsPageClientProps) {
  const router = useRouter();
  const [baseSettings, setBaseSettings] = useState(initialSettings);

  const liveSettings = useMemo(() => parseLiveSettings(initialSettings), [initialSettings]);
  const micSettings = useMemo(() => parseMicSettings(initialSettings), [initialSettings]);
  const voicesSettings = useMemo(() => parseVoicesSettings(initialSettings), [initialSettings]);

  const [apiKeysText, setApiKeysText] = useState(formatApiKeysInput(liveSettings.youtubeApiKeys));
  const [youtubeChannelUrl, setYoutubeChannelUrl] = useState(liveSettings.youtubeChannelUrl);
  const [youtubeStreamUrl, setYoutubeStreamUrl] = useState(liveSettings.youtubeStreamUrl);
  const [youtubeStartupBacklogCount, setYoutubeStartupBacklogCount] = useState(liveSettings.youtubeStartupBacklogCount);
  const [tiktokUsername, setTikTokUsername] = useState(liveSettings.tiktokUsername);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(voicesSettings.ollamaBaseUrl);
  const [autoGenderDetection, setAutoGenderDetection] = useState(voicesSettings.autoGenderDetection);
  const [asrBaseUrl, setAsrBaseUrl] = useState(micSettings.asrBaseUrl);
  const [micLanguage, setMicLanguage] = useState(micSettings.language);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setBaseSettings(initialSettings);
    setApiKeysText(formatApiKeysInput(liveSettings.youtubeApiKeys));
    setYoutubeChannelUrl(liveSettings.youtubeChannelUrl);
    setYoutubeStreamUrl(liveSettings.youtubeStreamUrl);
    setYoutubeStartupBacklogCount(liveSettings.youtubeStartupBacklogCount);
    setTikTokUsername(liveSettings.tiktokUsername);
    setOllamaBaseUrl(voicesSettings.ollamaBaseUrl);
    setAutoGenderDetection(voicesSettings.autoGenderDetection);
    setAsrBaseUrl(micSettings.asrBaseUrl);
    setMicLanguage(micSettings.language);
  }, [initialSettings, liveSettings, micSettings, voicesSettings]);

  const apiKeys = useMemo(() => parseApiKeysInput(apiKeysText), [apiKeysText]);

  async function handleSave() {
    setIsSaving(true);
    setNotice('');
    setError('');

    try {
      const nextLiveSettings = {
        ...liveSettings,
        youtubeApiKeys: apiKeys,
        youtubeChannelUrl: youtubeChannelUrl.trim(),
        youtubeStreamUrl: youtubeStreamUrl.trim(),
        youtubeStartupBacklogCount,
        tiktokUsername: tiktokUsername.trim()
      };

      const nextVoicesSettings = {
        ...voicesSettings,
        ollamaBaseUrl: ollamaBaseUrl.trim(),
        autoGenderDetection
      };

      const nextMicSettings = {
        ...micSettings,
        asrBaseUrl: asrBaseUrl.trim(),
        language: micLanguage.trim().toLowerCase() || 'auto'
      };

      const liveRecord = buildLiveSettingsRecord(baseSettings, nextLiveSettings);
      const voicesRecord = buildVoicesSettingsRecord(liveRecord, nextVoicesSettings);
      const mergedRecord = buildMicSettingsRecord(voicesRecord, nextMicSettings);

      await saveSettings(mergedRecord, initialScope);
      setBaseSettings(mergedRecord);
      setNotice('Integration settings saved. Runtime routes will use them on next refresh or navigation.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save integration settings');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="live-summary-grid">
        <article className="live-summary-card">
          <span>YouTube API keys</span>
          <strong>{apiKeys.length}</strong>
          <p>{youtubeChannelUrl ? 'Channel routing is configured.' : 'No YouTube channel is configured yet.'}</p>
        </article>
        <article className={`live-summary-card ${initialTikTokStatus.connected ? 'is-connected' : ''}`}>
          <span>TikTok connector</span>
          <strong>{initialTikTokStatus.connected ? 'Connected' : 'Idle'}</strong>
          <p>
            {initialTikTokStatus.connected
              ? `Listening to @${initialTikTokStatus.username}`
              : `Sign mode: ${initialTikTokStatus.signMode}`}
          </p>
        </article>
        <article className={`live-summary-card ${initialMicHealth?.ok ? 'is-connected' : ''}`}>
          <span>Mic ASR</span>
          <strong>{initialMicHealth?.ok ? 'Online' : 'Offline'}</strong>
          <p>{initialMicHealth ? `${initialMicHealth.whisperModel} on ${initialMicHealth.whisperDevice}` : asrBaseUrl}</p>
        </article>
        <article className="live-summary-card">
          <span>Ollama</span>
          <strong>{ollamaBaseUrl || 'Not configured'}</strong>
          <p>{autoGenderDetection ? 'Auto voice assignment is enabled.' : 'Auto voice assignment is disabled.'}</p>
        </article>
      </section>

      {(notice || error) ? (
        <div className={`live-banner ${error ? 'is-error' : 'is-notice'}`}>
          <strong>{error ? 'Attention' : 'Updated'}</strong>
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="settings-grid">
        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <p className="live-panel-kicker">Platform connectors</p>
              <h2>Stream inputs</h2>
            </div>
            <Link href="/live" className="live-button">Open live route</Link>
          </div>

          <label className="live-field">
            <span>YouTube API keys</span>
            <textarea
              rows={4}
              value={apiKeysText}
              onChange={(event) => setApiKeysText(event.target.value)}
              placeholder="Paste one API key per line"
            />
            <small>{apiKeys.length} keys will be tried in order.</small>
          </label>

          <div className="live-form-grid">
            <label className="live-field">
              <span>Channel URL or handle</span>
              <input
                value={youtubeChannelUrl}
                onChange={(event) => setYoutubeChannelUrl(event.target.value)}
                placeholder="https://www.youtube.com/@yourchannel"
              />
            </label>
            <label className="live-field">
              <span>Active stream URL</span>
              <input
                value={youtubeStreamUrl}
                onChange={(event) => setYoutubeStreamUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
              />
            </label>
          </div>

          <label className="live-field">
            <span>Startup backlog</span>
            <div className="live-inline-range">
              <input
                type="range"
                min={0}
                max={20}
                value={youtubeStartupBacklogCount}
                onChange={(event) => setYoutubeStartupBacklogCount(Number(event.target.value))}
              />
              <strong>{youtubeStartupBacklogCount}</strong>
            </div>
            <small>How many recent YouTube messages should be shown after startup sync.</small>
          </label>

          <label className="live-field">
            <span>TikTok username</span>
            <input
              value={tiktokUsername}
              onChange={(event) => setTikTokUsername(event.target.value)}
              placeholder="@creator"
            />
            <small>
              Current sign mode: <strong>{initialTikTokStatus.signMode === 'api-key' ? 'API key configured' : 'anonymous'}</strong>
            </small>
          </label>
        </section>

        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <p className="live-panel-kicker">Speech services</p>
              <h2>Voice and mic stack</h2>
            </div>
            <div className="settings-link-group">
              <Link href="/voices" className="live-button">Voices</Link>
              <Link href="/mic" className="live-button">Mic</Link>
            </div>
          </div>

          <label className="live-field">
            <span>Ollama base URL</span>
            <input
              value={ollamaBaseUrl}
              onChange={(event) => setOllamaBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:11434"
            />
          </label>

          <label className="live-checkbox-field">
            <input
              type="checkbox"
              checked={autoGenderDetection}
              onChange={(event) => setAutoGenderDetection(event.target.checked)}
            />
            <div>
              <span>Enable Ollama auto voice assignment</span>
              <small>Useful for new users, but it can add latency to the first spoken message.</small>
            </div>
          </label>

          <div className="live-form-grid">
            <label className="live-field">
              <span>Mic ASR URL</span>
              <input
                value={asrBaseUrl}
                onChange={(event) => setAsrBaseUrl(event.target.value)}
                placeholder="http://127.0.0.1:8001"
              />
            </label>
            <label className="live-field">
              <span>Mic language</span>
              <select value={micLanguage} onChange={(event) => setMicLanguage(event.target.value)}>
                <option value="auto">Auto detect</option>
                <option value="en">English</option>
                <option value="de">German</option>
                <option value="pl">Polish</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="it">Italian</option>
              </select>
            </label>
          </div>

          <div className="settings-detail-list">
            <div>
              <span>Default male / female</span>
              <strong>{voicesSettings.defaultMaleVoice || 'Unset'} / {voicesSettings.defaultFemaleVoice || 'Unset'}</strong>
            </div>
            <div>
              <span>Mic trigger mode</span>
              <strong>{micSettings.triggerMode === 'suggest' ? 'Suggestion mode' : 'Auto trigger'}</strong>
            </div>
            <div>
              <span>Only my voice</span>
              <strong>{micSettings.voiceGateEnabled ? `Enabled at ${Math.round(micSettings.voiceMatchThreshold * 100)}%` : 'Disabled'}</strong>
            </div>
          </div>
        </section>

        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <p className="live-panel-kicker">Migration notes</p>
              <h2>How these settings flow now</h2>
            </div>
          </div>
          <ul className="settings-notes-list">
            <li><strong>/live</strong> is now the operational route for status, connect/disconnect, audience, and activity.</li>
            <li><strong>/voices</strong> still owns voice defaults, cloned voices, and user assignments in depth.</li>
            <li><strong>/mic</strong> still owns enrollment, transcript diagnostics, and the live dock runtime.</li>
            <li>Node still owns TikTok connector and YouTube proxy behavior for now.</li>
            <li>FastAPI remains the direct ASR service boundary.</li>
          </ul>

          <div className="settings-actions-row">
            <button type="button" className="live-button is-primary" onClick={() => void handleSave()} disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save integrations'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

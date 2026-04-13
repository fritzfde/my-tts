import Link from 'next/link';
import { getTikTokStatus } from '@/lib/api/live';
import { getMicHealth } from '@/lib/api/mic';
import { getSettings } from '@/lib/api/settings';
import { parseLiveSettings } from '@/lib/live-settings';
import { parseMicSettings } from '@/lib/mic-settings';
import { parseVoicesSettings } from '@/lib/voices-settings';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const settingsPayload = await getSettings().catch(() => ({ scope: 'local-dev', settings: {} as Record<string, string> }));
  const liveSettings = parseLiveSettings(settingsPayload.settings);
  const micSettings = parseMicSettings(settingsPayload.settings);
  const voicesSettings = parseVoicesSettings(settingsPayload.settings);

  const [tiktokStatus, micHealth] = await Promise.all([
    getTikTokStatus().catch(() => ({ connected: false, username: '', signMode: 'anonymous' as const })),
    getMicHealth(micSettings.asrBaseUrl).catch(() => null)
  ]);

  return (
    <div className="settings-page">
      <section className="live-summary-grid">
        <article className="live-summary-card">
          <span>YouTube API keys</span>
          <strong>{liveSettings.youtubeApiKeys.length}</strong>
          <p>{liveSettings.youtubeChannelUrl ? 'Channel URL saved.' : 'No channel URL saved yet.'}</p>
        </article>
        <article className={`live-summary-card ${tiktokStatus.connected ? 'is-connected' : ''}`}>
          <span>TikTok connector</span>
          <strong>{tiktokStatus.connected ? 'Connected' : 'Idle'}</strong>
          <p>{tiktokStatus.connected ? `Listening to @${tiktokStatus.username}` : `Sign mode: ${tiktokStatus.signMode}`}</p>
        </article>
        <article className={`live-summary-card ${micHealth?.ok ? 'is-connected' : ''}`}>
          <span>Mic ASR</span>
          <strong>{micHealth?.ok ? 'Online' : 'Offline'}</strong>
          <p>{micHealth ? `${micHealth.whisperModel} on ${micHealth.whisperDevice}` : micSettings.asrBaseUrl}</p>
        </article>
        <article className="live-summary-card">
          <span>Ollama</span>
          <strong>{voicesSettings.ollamaBaseUrl}</strong>
          <p>{voicesSettings.autoGenderDetection ? 'Auto voice assignment is enabled.' : 'Auto voice assignment is disabled.'}</p>
        </article>
      </section>

      <div className="settings-grid">
        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <p className="live-panel-kicker">Platform connectors</p>
              <h2>Stream inputs</h2>
            </div>
            <Link href="/live" className="live-button">Open live route</Link>
          </div>
          <div className="settings-detail-list">
            <div>
              <span>YouTube channel</span>
              <strong>{liveSettings.youtubeChannelUrl || 'Not configured'}</strong>
            </div>
            <div>
              <span>YouTube stream</span>
              <strong>{liveSettings.youtubeStreamUrl || 'Not configured'}</strong>
            </div>
            <div>
              <span>Startup backlog</span>
              <strong>{liveSettings.youtubeStartupBacklogCount} messages</strong>
            </div>
            <div>
              <span>TikTok username</span>
              <strong>{liveSettings.tiktokUsername || 'Not configured'}</strong>
            </div>
          </div>
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
          <div className="settings-detail-list">
            <div>
              <span>Ollama base URL</span>
              <strong>{voicesSettings.ollamaBaseUrl}</strong>
            </div>
            <div>
              <span>Default male / female</span>
              <strong>{voicesSettings.defaultMaleVoice || 'Unset'} / {voicesSettings.defaultFemaleVoice || 'Unset'}</strong>
            </div>
            <div>
              <span>Mic ASR URL</span>
              <strong>{micSettings.asrBaseUrl}</strong>
            </div>
            <div>
              <span>Mic language / mode</span>
              <strong>{micSettings.language.toUpperCase()} / {micSettings.triggerMode === 'suggest' ? 'Suggestion mode' : 'Auto trigger'}</strong>
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
              <h2>What lives where now</h2>
            </div>
          </div>
          <ul className="settings-notes-list">
            <li><strong>/live</strong> owns platform connection flow, status, audience, and recent activity.</li>
            <li><strong>/voices</strong> owns platform voice defaults, cloned voices, and user assignments.</li>
            <li><strong>/mic</strong> owns ASR setup, enrollment, and live transcript diagnostics.</li>
            <li>Node still owns TikTok connector and YouTube proxy logic for now.</li>
            <li>FastAPI remains the direct boundary for the mic ASR runtime.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

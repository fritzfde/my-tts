'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  connectGlobalTikTokRuntime,
  connectGlobalYouTubeRuntime,
  disconnectGlobalTikTokRuntime,
  disconnectGlobalYouTubeRuntime
} from '@/lib/runtime/live-runtime';
import { findYouTubeLiveStream } from '@/lib/api/live';
import { formatSeenAgo } from '@/lib/live-settings';
import { useLiveStore } from '@/lib/stores/live-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { TikTokAudienceSnapshot, TikTokStatus } from '@/lib/types/live';

type LivePageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialTikTokStatus: TikTokStatus;
  initialTikTokAudience: TikTokAudienceSnapshot;
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

export function LivePageClient({
  initialScope,
  initialSettings,
  initialTikTokStatus,
  initialTikTokAudience
}: LivePageClientProps) {
  const hydrate = useLiveStore((state) => state.hydrate);
  const youtubeApiKeys = useLiveStore((state) => state.youtubeApiKeys);
  const youtubeChannelUrl = useLiveStore((state) => state.youtubeChannelUrl);
  const youtubeStreamUrl = useLiveStore((state) => state.youtubeStreamUrl);
  const youtubeStartupBacklogCount = useLiveStore((state) => state.youtubeStartupBacklogCount);
  const tiktokUsername = useLiveStore((state) => state.tiktokUsername);
  const youtubeStatus = useLiveStore((state) => state.youtubeStatus);
  const tiktokStatus = useLiveStore((state) => state.tiktokStatus);
  const tiktokAudience = useLiveStore((state) => state.tiktokAudience);
  const recentActivity = useLiveStore((state) => state.recentActivity);
  const youtubeUsers = useLiveStore((state) => state.youtubeUsers);
  const tiktokUsers = useLiveStore((state) => state.tiktokUsers);
  const notice = useLiveStore((state) => state.notice);
  const error = useLiveStore((state) => state.error);
  const setYoutubeStreamUrl = useLiveStore((state) => state.setYoutubeStreamUrl);
  const setNotice = useLiveStore((state) => state.setNotice);
  const setError = useLiveStore((state) => state.setError);

  const [isConnectingYouTube, setIsConnectingYouTube] = useState(false);
  const [isFindingYouTube, setIsFindingYouTube] = useState(false);
  const [isConnectingTikTok, setIsConnectingTikTok] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings,
      tiktokStatus: initialTikTokStatus,
      tiktokAudience: initialTikTokAudience
    });
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings, initialTikTokAudience, initialTikTokStatus]);

  async function handleFindYouTubeStream() {
    if (youtubeApiKeys.length === 0) {
      setError('Add at least one YouTube API key first.');
      return;
    }
    if (!youtubeChannelUrl) {
      setError('Enter a YouTube channel URL or handle first.');
      return;
    }

    setIsFindingYouTube(true);
    try {
      const result = await findYouTubeLiveStream(youtubeApiKeys, youtubeChannelUrl);
      setYoutubeStreamUrl(result.url);
      setNotice(result.title ? `Found live stream: ${result.title}` : 'Found a live stream for that channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find a YouTube live stream');
    } finally {
      setIsFindingYouTube(false);
    }
  }

  async function handleConnectYouTubeRuntime() {
    setIsConnectingYouTube(true);
    try {
      await connectGlobalYouTubeRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'YouTube connection failed');
    } finally {
      setIsConnectingYouTube(false);
    }
  }

  function handleDisconnectYouTubeRuntime() {
    disconnectGlobalYouTubeRuntime();
  }

  async function handleConnectTikTokRuntime() {
    setIsConnectingTikTok(true);
    try {
      await connectGlobalTikTokRuntime(tiktokUsername);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TikTok connection failed');
    } finally {
      setIsConnectingTikTok(false);
    }
  }

  async function handleDisconnectTikTokRuntime() {
    try {
      await disconnectGlobalTikTokRuntime();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'TikTok disconnect failed');
    }
  }

  const connectedPlatforms = Number(youtubeStatus.connected) + Number(tiktokStatus.connected);
  const recentActivityCards = recentActivity.slice(0, 24);
  const totalPresence = youtubeUsers.length + tiktokUsers.length;

  return (
    <div className="live-page">
      <section className="live-summary-grid">
        <article className={`live-summary-card ${youtubeStatus.connected ? 'is-connected' : ''}`}>
          <span>YouTube</span>
          <strong>{youtubeStatus.label}</strong>
          <p>{youtubeStatus.error || youtubeStatus.detail}</p>
        </article>
        <article className={`live-summary-card ${tiktokStatus.connected ? 'is-connected' : ''}`}>
          <span>TikTok</span>
          <strong>{tiktokStatus.label}</strong>
          <p>{tiktokStatus.error || tiktokStatus.detail}</p>
        </article>
        <article className="live-summary-card">
          <span>Presence</span>
          <strong>{totalPresence}</strong>
          <p>{youtubeUsers.length} YouTube users and {tiktokUsers.length} TikTok users in the current snapshot.</p>
        </article>
        <article className="live-summary-card">
          <span>TikTok viewers</span>
          <strong>{tiktokAudience.viewerCount}</strong>
          <p>{tiktokAudience.topViewers.length} top viewers and {tiktokAudience.activeUsers.length} active users currently visible.</p>
        </article>
      </section>

      {(notice || error) ? (
        <div className={`live-banner ${error ? 'is-error' : 'is-notice'}`}>
          <strong>{error ? 'Attention' : 'Updated'}</strong>
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="live-layout-grid">
        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Operational Control</p>
                <h2>YouTube control</h2>
              </div>
              <div className="settings-link-group">
                <Link href="/settings/integrations" className="live-button">Edit integrations</Link>
                <span className={`live-pill ${youtubeStatus.connected ? 'is-connected' : ''}`}>{youtubeStatus.label}</span>
              </div>
            </div>

            <div className="settings-detail-list">
              <div>
                <span>YouTube API keys</span>
                <strong>{youtubeApiKeys.length ? `${youtubeApiKeys.length} configured` : 'Not configured'}</strong>
              </div>
              <div>
                <span>Channel URL or handle</span>
                <strong>{youtubeChannelUrl || 'Not configured'}</strong>
              </div>
              <div>
                <span>Active stream URL</span>
                <strong>{youtubeStreamUrl || 'Not configured'}</strong>
              </div>
              <div>
                <span>Startup backlog</span>
                <strong>{youtubeStartupBacklogCount} messages</strong>
              </div>
            </div>

            <div className="live-actions-row">
              <button className="live-button" type="button" onClick={() => void handleFindYouTubeStream()} disabled={isFindingYouTube || isConnectingYouTube}>
                {isFindingYouTube ? 'Finding live stream…' : 'Find live stream'}
              </button>
              <button className="live-button is-primary" type="button" onClick={() => void handleConnectYouTubeRuntime()} disabled={isConnectingYouTube}>
                {isConnectingYouTube ? 'Connecting…' : 'Connect YouTube'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={handleDisconnectYouTubeRuntime} disabled={!youtubeStatus.connected}>
                Disconnect
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Operational Control</p>
                <h2>TikTok control</h2>
              </div>
              <div className="settings-link-group">
                <Link href="/settings/integrations" className="live-button">Edit integrations</Link>
                <span className={`live-pill ${tiktokStatus.connected ? 'is-connected' : ''}`}>{tiktokStatus.label}</span>
              </div>
            </div>

            <div className="settings-detail-list">
              <div>
                <span>TikTok username</span>
                <strong>{tiktokUsername || 'Not configured'}</strong>
              </div>
              <div>
                <span>Sign mode</span>
                <strong>{tiktokStatus.signMode === 'api-key' ? 'API key configured' : 'Anonymous'}</strong>
              </div>
              <div>
                <span>Connector detail</span>
                <strong>{tiktokStatus.error || tiktokStatus.detail}</strong>
              </div>
            </div>

            <div className="live-actions-row">
              <button className="live-button is-primary" type="button" onClick={() => void handleConnectTikTokRuntime()} disabled={isConnectingTikTok}>
                {isConnectingTikTok ? 'Connecting…' : 'Connect TikTok'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={() => void handleDisconnectTikTokRuntime()} disabled={!tiktokStatus.connected}>
                Disconnect
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Presence</p>
                <h2>Audience snapshot</h2>
              </div>
              <span className="live-pill">{connectedPlatforms} active</span>
            </div>

            <div className="live-presence-grid">
              <div className="live-subpanel">
                <h3>YouTube chat users</h3>
                <ul className="live-user-list">
                  {youtubeUsers.length === 0 ? <li className="live-empty">No YouTube users seen yet.</li> : youtubeUsers.slice(0, 8).map((user) => (
                    <li key={`youtube-${user.username}`}>
                      <span>{user.displayName}</span>
                      <small>{formatSeenAgo(user.lastSeen)}</small>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="live-subpanel">
                <h3>TikTok active users</h3>
                <ul className="live-user-list">
                  {tiktokUsers.length === 0 ? <li className="live-empty">No TikTok users seen yet.</li> : tiktokUsers.slice(0, 8).map((user) => (
                    <li key={`tiktok-${user.username}`}>
                      <span>{user.displayName}</span>
                      <small>{formatSeenAgo(user.lastSeen)}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>

        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Operations Feed</p>
                <h2>Recent activity</h2>
              </div>
              <span className="live-pill">{recentActivityCards.length} items</span>
            </div>
            <div className="live-activity-list">
              {recentActivityCards.length === 0 ? <div className="live-empty">Connect a platform to populate the control-room activity feed.</div> : recentActivityCards.map((event) => (
                <article key={event.id} className={`live-activity-card accent-${event.accent || event.type}`}>
                  <header>
                    <div>
                      <strong>{event.authorName || event.author || 'System'}</strong>
                      <span>{event.platform.toUpperCase()} · {event.type}</span>
                    </div>
                    <time>{formatClock(event.timestamp)}</time>
                  </header>
                  <p>{event.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">TikTok room</p>
                <h2>Viewer leaderboard</h2>
              </div>
              <span className="live-pill">{tiktokAudience.topViewers.length} tracked</span>
            </div>
            <div className="live-top-viewers">
              {tiktokAudience.topViewers.length === 0 ? <div className="live-empty">Top viewers will appear here once TikTok is connected.</div> : tiktokAudience.topViewers.slice(0, 10).map((viewer) => (
                <div key={viewer.uniqueId} className="live-viewer-row">
                  <div>
                    <strong>{viewer.nickname || viewer.uniqueId}</strong>
                    <small>@{viewer.uniqueId}</small>
                  </div>
                  <span>{viewer.coinCount > 0 ? `${viewer.coinCount} coins` : formatSeenAgo(viewer.lastSeen)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="live-footer-note">
        <span>Configuration lives in <strong>/settings/integrations</strong>. This route stays focused on live operations and audience activity.</span>
      </div>
    </div>
  );
}

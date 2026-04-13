import { getLegacyApiBaseUrl } from '@/lib/api/config';

const overlayEntries = [
  {
    name: 'Animations overlay',
    route: '/overlay/animations',
    stream: '/overlay/animations/stream',
    note: 'OBS/browser source for live animation playback.'
  },
  {
    name: 'Chat overlay',
    route: '/overlay/chat',
    stream: '/overlay/chat/stream',
    note: 'Unified YouTube + TikTok chat display.'
  },
  {
    name: 'Gift overlay',
    route: '/overlay/gifts',
    stream: '/overlay/gifts/stream',
    note: 'TikTok gift visuals and mapping output.'
  },
  {
    name: 'Likers overlay',
    route: '/overlay/likers',
    stream: '/overlay/likers/stream',
    note: 'TikTok liker leaderboard surface.'
  }
] as const;

export default function OverlaysPage() {
  const legacyBaseUrl = getLegacyApiBaseUrl();

  return (
    <div className="settings-page">
      <section className="live-summary-grid">
        {overlayEntries.map((entry) => (
          <article key={entry.name} className="live-summary-card">
            <span>Overlay</span>
            <strong>{entry.name}</strong>
            <p>{entry.note}</p>
          </article>
        ))}
      </section>

      <div className="settings-grid">
        {overlayEntries.map((entry) => (
          <section key={entry.route} className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">OBS route</p>
                <h2>{entry.name}</h2>
              </div>
            </div>

            <div className="settings-code-card">
              <span>Browser source URL</span>
              <code>{`${legacyBaseUrl}${entry.route}`}</code>
            </div>

            <div className="settings-code-card">
              <span>SSE stream</span>
              <code>{`${legacyBaseUrl}${entry.stream}`}</code>
            </div>

            <p className="settings-panel-copy">{entry.note}</p>
          </section>
        ))}

        <section className="live-panel">
          <div className="live-panel-header">
            <div>
              <p className="live-panel-kicker">Usage</p>
              <h2>How to keep overlays stable</h2>
            </div>
          </div>
          <ul className="settings-notes-list">
            <li>Use the legacy backend origin in OBS browser sources until overlay migration is intentional.</li>
            <li>The React dashboard can change independently; overlays continue to run from the Node app on port 3000.</li>
            <li>If an animation looks live in UI but not on stream, refresh the OBS browser source for the animation overlay first.</li>
            <li>Animation delivery depends on the SSE overlay client being connected.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

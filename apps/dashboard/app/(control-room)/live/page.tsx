import { LivePageClient } from '@/components/live/live-page-client';
import { getTikTokAudience, getTikTokStatus } from '@/lib/api/live';
import { getSettings } from '@/lib/api/settings';
import type { TikTokAudienceSnapshot, TikTokStatus } from '@/lib/types/live';

export const dynamic = 'force-dynamic';

export default async function LivePage() {
  let settingsPayload = { scope: 'local-dev', settings: {} as Record<string, string> };
  let tiktokStatus: TikTokStatus = {
    connected: false,
    username: '',
    signMode: 'anonymous'
  };
  let tiktokAudience: TikTokAudienceSnapshot = {
    connected: false,
    viewerCount: 0,
    activeUsers: [],
    topViewers: [],
    ttlMs: 45000,
    updatedAt: 0
  };

  try {
    [settingsPayload, tiktokStatus, tiktokAudience] = await Promise.all([
      getSettings(),
      getTikTokStatus(),
      getTikTokAudience()
    ]);
  } catch (error) {
    console.warn('Falling back to empty /live data during dashboard render:', error);
  }

  return (
    <LivePageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
      initialTikTokStatus={tiktokStatus}
      initialTikTokAudience={tiktokAudience}
    />
  );
}

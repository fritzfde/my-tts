import { IntegrationsPageClient } from '@/components/settings/integrations-page-client';
import { getTikTokStatus } from '@/lib/api/live';
import { getMicHealth } from '@/lib/api/mic';
import { getSettings } from '@/lib/api/settings';
import { parseMicSettings } from '@/lib/mic-settings';
import type { TikTokStatus } from '@/lib/types/live';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  const settingsPayload = await getSettings().catch(() => ({ scope: 'local-dev', settings: {} as Record<string, string> }));
  const micSettings = parseMicSettings(settingsPayload.settings);

  const [tiktokStatus, micHealth] = await Promise.all([
    getTikTokStatus().catch(() => ({ connected: false, username: '', signMode: 'anonymous' as const } satisfies TikTokStatus)),
    getMicHealth(micSettings.asrBaseUrl).catch(() => null)
  ]);

  return (
    <IntegrationsPageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
      initialTikTokStatus={tiktokStatus}
      initialMicHealth={micHealth}
    />
  );
}

import { MicPageClient } from '@/components/mic/mic-page-client';
import { getSettings } from '@/lib/api/settings';

export const dynamic = 'force-dynamic';

export default async function MicPage() {
  let settingsPayload = { scope: 'local-dev', settings: {} as Record<string, string> };

  try {
    settingsPayload = await getSettings();
  } catch (error) {
    console.warn('Falling back to empty /mic data during dashboard render:', error);
  }

  return (
    <MicPageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
    />
  );
}

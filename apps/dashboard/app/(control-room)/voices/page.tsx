import { VoicesPageClient } from '@/components/voices/voices-page-client';
import { getSettings } from '@/lib/api/settings';
import { listClonedVoices } from '@/lib/api/voices';

export const dynamic = 'force-dynamic';

export default async function VoicesPage() {
  let settingsPayload = { scope: 'local-dev', settings: {} as Record<string, string> };
  let clonedVoices: string[] = [];

  try {
    [settingsPayload, clonedVoices] = await Promise.all([getSettings(), listClonedVoices()]);
  } catch (error) {
    console.warn('Falling back to empty /voices data during dashboard render:', error);
  }

  return (
    <VoicesPageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
      initialClonedVoices={clonedVoices}
    />
  );
}


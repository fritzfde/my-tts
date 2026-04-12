import { SoundsPageClient } from '@/components/sounds/sounds-page-client';
import { listSounds } from '@/lib/api/sounds';
import { getSettings } from '@/lib/api/settings';
import type { SoundFile } from '@/lib/types/sounds';

export const dynamic = 'force-dynamic';

export default async function SoundsPage() {
  let settingsPayload = { scope: 'local-dev', settings: {} as Record<string, string> };
  let sounds: SoundFile[] = [];

  try {
    [settingsPayload, sounds] = await Promise.all([getSettings(), listSounds()]);
  } catch (error) {
    console.warn('Falling back to empty /sounds data during dashboard render:', error);
  }

  return (
    <SoundsPageClient
      initialScope={settingsPayload.scope}
      initialSettings={settingsPayload.settings}
      initialSounds={sounds}
    />
  );
}

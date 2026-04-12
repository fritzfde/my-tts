import { getLegacyApiBaseUrl, getSettingsScope } from '@/lib/api/config';
import type { PersistedSettingsRecord, SettingsPayload } from '@/lib/types/settings';

export async function getSettings(scope = getSettingsScope()): Promise<SettingsPayload> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/settings?scope=${encodeURIComponent(scope)}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load settings (${response.status})`);
  }

  const data = (await response.json()) as { scope?: string; settings?: PersistedSettingsRecord };
  return {
    scope: String(data.scope || scope),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {}
  };
}

export async function saveSettings(settings: PersistedSettingsRecord, scope = getSettingsScope()) {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ scope, settings })
  });

  if (!response.ok) {
    throw new Error(`Failed to save settings (${response.status})`);
  }

  return response.json() as Promise<{ success: boolean; scope: string; count: number }>;
}

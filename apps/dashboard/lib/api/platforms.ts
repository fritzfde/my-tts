import { getLegacyApiBaseUrl } from '@/lib/api/config';

export async function listKnownTikTokGiftNames() {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/gifts`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load TikTok gifts (${response.status})`);
  }

  const data = (await response.json()) as { gifts?: Array<{ name?: string }> };
  return Array.isArray(data.gifts)
    ? Array.from(
        new Set(
          data.gifts
            .map((gift) => String(gift?.name || '').trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right))
    : [];
}

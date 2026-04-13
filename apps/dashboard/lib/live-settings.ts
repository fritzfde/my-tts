import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { LiveSettingsState } from '@/lib/types/live';

export const YOUTUBE_API_KEYS_KEY = 'yt_tts_api_keys';
export const LEGACY_YOUTUBE_API_KEY = 'yt_tts_api_key';
export const YOUTUBE_CHANNEL_URL_KEY = 'yt_tts_channel_url';
export const YOUTUBE_STREAM_URL_KEY = 'yt_tts_stream_url';
export const YOUTUBE_STARTUP_BACKLOG_KEY = 'yt_tts_startup_backlog_count';
export const TIKTOK_USERNAME_KEY = 'tiktok_username_cache';

function normalizeApiKeys(keys: string[]) {
  return Array.from(
    new Set(
      keys
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

function parseApiKeys(settings: PersistedSettingsRecord) {
  const raw = settings[YOUTUBE_API_KEYS_KEY];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizeApiKeys(parsed.map((entry) => String(entry || '')));
      }
    } catch {
      // fall through to legacy parsing
    }
  }

  const legacy = String(settings[LEGACY_YOUTUBE_API_KEY] || '').trim();
  if (!legacy) return [];
  return normalizeApiKeys(legacy.split(',').map((entry) => entry.trim()));
}

function clampStartupBacklog(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(20, Math.round(numeric)));
}

export function parseLiveSettings(settings: PersistedSettingsRecord): LiveSettingsState {
  return {
    youtubeApiKeys: parseApiKeys(settings),
    youtubeChannelUrl: String(settings[YOUTUBE_CHANNEL_URL_KEY] || '').trim(),
    youtubeStreamUrl: String(settings[YOUTUBE_STREAM_URL_KEY] || '').trim(),
    youtubeStartupBacklogCount: clampStartupBacklog(settings[YOUTUBE_STARTUP_BACKLOG_KEY]),
    tiktokUsername: String(settings[TIKTOK_USERNAME_KEY] || '').trim()
  };
}

export function buildLiveSettingsRecord(
  rawSettings: PersistedSettingsRecord,
  state: LiveSettingsState
): PersistedSettingsRecord {
  const nextApiKeys = normalizeApiKeys(state.youtubeApiKeys);
  return {
    ...rawSettings,
    [YOUTUBE_API_KEYS_KEY]: JSON.stringify(nextApiKeys),
    [YOUTUBE_CHANNEL_URL_KEY]: String(state.youtubeChannelUrl || '').trim(),
    [YOUTUBE_STREAM_URL_KEY]: String(state.youtubeStreamUrl || '').trim(),
    [YOUTUBE_STARTUP_BACKLOG_KEY]: String(clampStartupBacklog(state.youtubeStartupBacklogCount)),
    [TIKTOK_USERNAME_KEY]: String(state.tiktokUsername || '').trim()
  };
}

export function parseApiKeysInput(value: string) {
  return normalizeApiKeys(
    String(value || '')
      .split(/[\n,]/)
      .map((entry) => entry.trim())
  );
}

export function formatApiKeysInput(keys: string[]) {
  return normalizeApiKeys(keys).join('\n');
}

export function formatSeenAgo(timestamp: number) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (diffSeconds < 10) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

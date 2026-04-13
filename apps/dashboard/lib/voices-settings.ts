import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { BrowserVoice, VoiceEntry, VoiceGroup, VoiceGroupKey, VoicesSettingsState } from '@/lib/types/voices';

export const MUTE_VOICE_ID = 'mute-user';
export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_PREVIEW_TEXT = 'This is a voice preview for the control room.';

export const CLONED_VOICE_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'cs', label: 'Czech' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh-cn', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'hi', label: 'Hindi' }
] as const;

export const VOICE_GROUP_ORDER: VoiceGroupKey[] = ['custom', 'en', 'de', 'es', 'uk', 'ru', 'other'];
export const VOICE_GROUP_LABELS: Record<VoiceGroupKey, string> = {
  custom: 'Custom voices',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  uk: 'Ukrainian',
  ru: 'Russian',
  other: 'Other'
};

const CLONED_LANGUAGE_CODES = new Set<string>(CLONED_VOICE_LANGUAGE_OPTIONS.map((entry) => entry.code));

function parseJsonObject(raw: string | undefined) {
  if (!raw) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function parseJsonArray(raw: string | undefined) {
  if (!raw) return [] as unknown[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as unknown[];
  }
}

function clampPercent(value: unknown, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeOllamaBaseUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_OLLAMA_BASE_URL;
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function normalizeClonedLanguageCode(value: unknown) {
  const candidate = String(value || '').trim().toLowerCase().replace('_', '-');
  if (!candidate) return 'en';
  if (candidate === 'zh') return 'zh-cn';
  return CLONED_LANGUAGE_CODES.has(candidate) ? candidate : 'en';
}

function normalizeVoiceIdList(raw: string | undefined) {
  return Array.from(
    new Set(
      parseJsonArray(raw)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

function normalizeRecentUsers(raw: string | undefined) {
  return parseJsonArray(raw)
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry && !entry.startsWith('SYSTEM:'));
}

function normalizeRecord(raw: string | undefined) {
  const parsed = parseJsonObject(raw);
  const next: Record<string, string> = {};
  Object.entries(parsed).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    const normalizedValue = String(value || '').trim();
    if (!normalizedKey || !normalizedValue) return;
    next[normalizedKey] = normalizedValue;
  });
  return next;
}

function normalizeLanguageRecord(raw: string | undefined) {
  const parsed = parseJsonObject(raw);
  const next: Record<string, string> = {};
  Object.entries(parsed).forEach(([voiceName, language]) => {
    const normalizedVoiceName = String(voiceName || '').trim();
    if (!normalizedVoiceName) return;
    next[normalizedVoiceName] = normalizeClonedLanguageCode(language);
  });
  return next;
}

export function parseRecentUserKey(userKey: string) {
  const text = String(userKey || '');
  const separatorIndex = text.indexOf(':');
  if (separatorIndex < 0) {
    return { platform: 'youtube', username: text };
  }
  return {
    platform: text.slice(0, separatorIndex) || 'youtube',
    username: text.slice(separatorIndex + 1)
  };
}

export function getUserVoiceKey(username: string, platform: string) {
  return `${String(platform || '').trim()}:${String(username || '').trim()}`;
}

export function getVoiceLanguageCode(lang: string): VoiceGroupKey {
  const code = String(lang || '').toLowerCase().substring(0, 2);
  if (code === 'en' || code === 'de' || code === 'es' || code === 'uk' || code === 'ru') {
    return code;
  }
  return 'other';
}

export function parseVoicesSettings(settings: PersistedSettingsRecord): VoicesSettingsState {
  return {
    youtubeDefaultVoice: String(settings.youtube_default_voice || '').trim(),
    tiktokDefaultVoice: String(settings.tiktok_default_voice || '').trim(),
    autoGenderDetection: settings.auto_gender_detection === 'true',
    defaultMaleVoice: String(settings.default_male_voice || '').trim(),
    defaultFemaleVoice: String(settings.default_female_voice || '').trim(),
    ollamaBaseUrl: normalizeOllamaBaseUrl(settings.ollama_base_url),
    customVoiceLanguages: normalizeLanguageRecord(settings.custom_voice_languages),
    hiddenVoices: normalizeVoiceIdList(settings.hidden_voices),
    enabledLanguages: normalizeVoiceIdList(settings.enabled_languages),
    userVoices: normalizeRecord(settings.user_voices),
    recentUsers: normalizeRecentUsers(settings.recent_users),
    userDisplayNames: normalizeRecord(settings.user_display_names),
    previewText: String(settings.yt_tts_test_message || DEFAULT_PREVIEW_TEXT).trim() || DEFAULT_PREVIEW_TEXT,
    previewVolume: clampPercent(settings.yt_tts_volume, 100)
  };
}

export function buildVoicesSettingsRecord(
  rawSettings: PersistedSettingsRecord,
  state: VoicesSettingsState
): PersistedSettingsRecord {
  return {
    ...rawSettings,
    youtube_default_voice: state.youtubeDefaultVoice,
    tiktok_default_voice: state.tiktokDefaultVoice,
    auto_gender_detection: state.autoGenderDetection ? 'true' : 'false',
    default_male_voice: state.defaultMaleVoice,
    default_female_voice: state.defaultFemaleVoice,
    ollama_base_url: normalizeOllamaBaseUrl(state.ollamaBaseUrl),
    custom_voice_languages: JSON.stringify(state.customVoiceLanguages),
    hidden_voices: JSON.stringify(state.hiddenVoices),
    enabled_languages: JSON.stringify(state.enabledLanguages),
    user_voices: JSON.stringify(state.userVoices),
    recent_users: JSON.stringify(state.recentUsers),
    user_display_names: JSON.stringify(state.userDisplayNames),
    yt_tts_test_message: state.previewText,
    yt_tts_volume: String(clampPercent(state.previewVolume, 100))
  };
}

export function buildVoiceGroups({
  systemVoices,
  clonedVoices,
  hiddenVoices,
  enabledLanguages,
  includeHidden = false
}: {
  systemVoices: BrowserVoice[];
  clonedVoices: string[];
  hiddenVoices: string[];
  enabledLanguages: string[];
  includeHidden?: boolean;
}): VoiceGroup[] {
  const hiddenSet = new Set(hiddenVoices);
  const enabledSet = new Set(enabledLanguages);
  const grouped = new Map<VoiceGroupKey, VoiceEntry[]>();
  VOICE_GROUP_ORDER.forEach((groupKey) => grouped.set(groupKey, []));

  [...clonedVoices]
    .map((voiceName) => String(voiceName || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .forEach((voiceName) => {
      const id = `cloned-${voiceName}`;
      const isHidden = hiddenSet.has(id);
      if (!includeHidden && isHidden) return;
      grouped.get('custom')?.push({
        id,
        name: voiceName,
        groupKey: 'custom',
        isCloned: true,
        isHidden
      });
    });

  systemVoices.forEach((voice) => {
    const groupKey = getVoiceLanguageCode(voice.lang);
    if (enabledSet.size > 0 && groupKey !== 'other' && !enabledSet.has(groupKey)) return;
    const isHidden = hiddenSet.has(voice.id);
    if (!includeHidden && isHidden) return;

    grouped.get(groupKey)?.push({
      id: voice.id,
      name: voice.name,
      groupKey,
      isCloned: false,
      isHidden
    });
  });

  grouped.forEach((voices) => {
    voices.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  });

  return VOICE_GROUP_ORDER
    .map((groupKey) => ({
      key: groupKey,
      label: VOICE_GROUP_LABELS[groupKey],
      voices: grouped.get(groupKey) || []
    }))
    .filter((group) => group.voices.length > 0);
}

export function findVoiceEntryById(groups: VoiceGroup[], voiceId: string) {
  return groups.flatMap((group) => group.voices).find((entry) => entry.id === voiceId) || null;
}

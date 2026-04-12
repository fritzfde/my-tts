import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { SoundAlertRule, SoundEventType, SoundSettingsDraft, SoundSettingsState } from '@/lib/types/sounds';

export const SOUND_ALERT_RULES_KEY = 'sound_alert_rules';
export const SOUND_KEYWORDS_KEY = 'sound_keyword_map';
export const SOUND_KEYWORDS_ENABLED_KEY = 'sound_keyword_enabled_map';
export const SOUND_VOICE_KEYWORDS_ENABLED_KEY = 'sound_voice_keyword_enabled_map';
export const SOUND_VOLUMES_KEY = 'sound_volume_map';
export const SOUND_LIBRARY_KEYWORD_FILTER_KEY = 'sound_library_keyword_filter';
export const SOUND_ALERTS_VOLUME_KEY = 'sound_alerts_volume';
export const GLOBAL_VIEWER_CHAT_SOUND_TRIGGERS_KEY = 'viewer_chat_sound_keyword_triggers_enabled';

export const SOUND_EVENT_LABELS: Record<SoundEventType, string> = {
  gift_any: 'Any gift',
  gift_name: 'Certain gift',
  gift_value: 'Gift diamond value',
  follow: 'New follower/subscriber',
  share: 'Stream share',
  join: 'Viewer joins stream',
  leave: 'Viewer leaves stream'
};

const SOUND_EVENT_TYPES = new Set<SoundEventType>(Object.keys(SOUND_EVENT_LABELS) as SoundEventType[]);
const LIFECYCLE_TYPES = new Set<SoundEventType>(['join', 'leave']);

export function normalizeSoundPath(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutPrefix = raw.startsWith('custom-') ? raw.replace(/^custom-/, '') : raw;
  if (withoutPrefix.startsWith('/sounds/custom/')) {
    return withoutPrefix.replace('/sounds/custom/', '/sounds/');
  }
  if (withoutPrefix.startsWith('/sounds/')) return withoutPrefix;
  return `/sounds/${withoutPrefix.replace(/^\/+/, '')}`;
}

export function parseKeywordList(value: unknown) {
  const rawItems = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const keywords: string[] = [];
  rawItems.forEach((entry) => {
    const normalized = String(entry || '').trim();
    if (!normalized) return;
    if (keywords.some((item) => item.toLowerCase() === normalized.toLowerCase())) return;
    keywords.push(normalized);
  });
  return keywords;
}

export function keywordListToText(keywords: string[]) {
  return parseKeywordList(keywords).join('\n');
}

function parseBooleanMap(raw: string | undefined) {
  if (!raw) return {} as Record<string, boolean>;
  try {
    const parsed = JSON.parse(raw);
    const next: Record<string, boolean> = {};
    Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, enabled]) => {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      next[normalizedPath] = enabled === true;
    });
    return next;
  } catch {
    return {} as Record<string, boolean>;
  }
}

function parseVolumeMap(raw: string | undefined) {
  if (!raw) return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(raw);
    const next: Record<string, number> = {};
    Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, value]) => {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      const numeric = Number(value);
      next[normalizedPath] = Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 100;
    });
    return next;
  } catch {
    return {} as Record<string, number>;
  }
}

function parseKeywordsMap(raw: string | undefined) {
  if (!raw) return {} as Record<string, string[]>;
  try {
    const parsed = JSON.parse(raw);
    const next: Record<string, string[]> = {};
    Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, keywords]) => {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      next[normalizedPath] = parseKeywordList(keywords);
    });
    return next;
  } catch {
    return {} as Record<string, string[]>;
  }
}

function normalizeGiftValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return String(Math.floor(parsed));
}

function normalizeMinStaySeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(86400, Math.floor(parsed));
}

export function createSoundAlertRule(seed: Partial<SoundAlertRule> & Record<string, unknown> = {}): SoundAlertRule {
  const eventType = SOUND_EVENT_TYPES.has(seed.eventType as SoundEventType)
    ? (seed.eventType as SoundEventType)
    : 'gift_any';

  let eventValue = '';
  if (eventType === 'gift_name') {
    eventValue = String(seed.eventValue || '').trim();
  } else if (eventType === 'gift_value') {
    eventValue = normalizeGiftValue(seed.eventValue || '');
  }

  return {
    id: String(seed.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    eventType,
    eventValue,
    soundPath: normalizeSoundPath(String(seed.soundPath || seed.sound || seed.value || '')),
    enabled: seed.enabled !== false,
    recurringOnly: LIFECYCLE_TYPES.has(eventType) ? seed.recurringOnly === true : false,
    minStaySeconds: LIFECYCLE_TYPES.has(eventType) ? normalizeMinStaySeconds(seed.minStaySeconds) : 0
  };
}

function parseRules(raw: string | undefined) {
  if (!raw) return [] as SoundAlertRule[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => createSoundAlertRule(entry as Partial<SoundAlertRule> & Record<string, unknown>));
  } catch {
    return [] as SoundAlertRule[];
  }
}

export function getGlobalSoundAlertsVolume(settings: PersistedSettingsRecord) {
  const numeric = Number(settings[SOUND_ALERTS_VOLUME_KEY]);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, Math.round(numeric))) : 100;
}

export function parseSoundSettings(settings: PersistedSettingsRecord): SoundSettingsState {
  return {
    keywordFilter: String(settings[SOUND_LIBRARY_KEYWORD_FILTER_KEY] || '').trim().toLowerCase().replace(/\s+/g, ' '),
    globalVolume: getGlobalSoundAlertsVolume(settings),
    viewerChatTriggersEnabled: settings[GLOBAL_VIEWER_CHAT_SOUND_TRIGGERS_KEY] !== 'false',
    soundKeywords: parseKeywordsMap(settings[SOUND_KEYWORDS_KEY]),
    soundKeywordEnabled: parseBooleanMap(settings[SOUND_KEYWORDS_ENABLED_KEY]),
    soundVoiceKeywordEnabled: parseBooleanMap(settings[SOUND_VOICE_KEYWORDS_ENABLED_KEY]),
    soundVolumes: parseVolumeMap(settings[SOUND_VOLUMES_KEY]),
    rules: parseRules(settings[SOUND_ALERT_RULES_KEY])
  };
}

export function buildSoundDraft(soundPath: string, settings: SoundSettingsState): SoundSettingsDraft {
  const normalizedPath = normalizeSoundPath(soundPath);
  return {
    keywordsText: keywordListToText(settings.soundKeywords[normalizedPath] || []),
    viewerChatEnabled: settings.soundKeywordEnabled[normalizedPath] === true,
    voiceEnabled: settings.soundVoiceKeywordEnabled[normalizedPath] === true,
    volume: settings.soundVolumes[normalizedPath] ?? 100
  };
}

export function buildPersistedSettingsRecord(rawSettings: PersistedSettingsRecord, state: SoundSettingsState): PersistedSettingsRecord {
  return {
    ...rawSettings,
    [SOUND_ALERTS_VOLUME_KEY]: String(state.globalVolume),
    [SOUND_LIBRARY_KEYWORD_FILTER_KEY]: state.keywordFilter,
    [GLOBAL_VIEWER_CHAT_SOUND_TRIGGERS_KEY]: state.viewerChatTriggersEnabled ? 'true' : 'false',
    [SOUND_KEYWORDS_KEY]: JSON.stringify(state.soundKeywords),
    [SOUND_KEYWORDS_ENABLED_KEY]: JSON.stringify(state.soundKeywordEnabled),
    [SOUND_VOICE_KEYWORDS_ENABLED_KEY]: JSON.stringify(state.soundVoiceKeywordEnabled),
    [SOUND_VOLUMES_KEY]: JSON.stringify(state.soundVolumes),
    [SOUND_ALERT_RULES_KEY]: JSON.stringify(state.rules)
  };
}

export function applySoundDraftToState(soundPath: string, state: SoundSettingsState, draft: SoundSettingsDraft): SoundSettingsState {
  const normalizedPath = normalizeSoundPath(soundPath);
  const nextKeywords = { ...state.soundKeywords };
  const parsedKeywords = parseKeywordList(draft.keywordsText);
  if (parsedKeywords.length === 0) {
    delete nextKeywords[normalizedPath];
  } else {
    nextKeywords[normalizedPath] = parsedKeywords;
  }

  return {
    ...state,
    soundKeywords: nextKeywords,
    soundKeywordEnabled: {
      ...state.soundKeywordEnabled,
      [normalizedPath]: draft.viewerChatEnabled
    },
    soundVoiceKeywordEnabled: {
      ...state.soundVoiceKeywordEnabled,
      [normalizedPath]: draft.voiceEnabled
    },
    soundVolumes: {
      ...state.soundVolumes,
      [normalizedPath]: Math.min(100, Math.max(0, Math.round(draft.volume)))
    }
  };
}

export function describeSoundRule(rule: SoundAlertRule) {
  if (rule.eventType === 'gift_name') {
    return rule.eventValue ? `Gift name: ${rule.eventValue}` : 'Gift name rule';
  }
  if (rule.eventType === 'gift_value') {
    return rule.eventValue ? `Gift value: ${rule.eventValue}` : 'Gift value rule';
  }
  if (LIFECYCLE_TYPES.has(rule.eventType)) {
    const parts = [];
    if (rule.recurringOnly) parts.push('Recurring only');
    if (rule.minStaySeconds > 0) parts.push(`Stay ${rule.minStaySeconds}s`);
    return parts.length > 0 ? parts.join(' • ') : 'Lifecycle rule';
  }
  return SOUND_EVENT_LABELS[rule.eventType];
}

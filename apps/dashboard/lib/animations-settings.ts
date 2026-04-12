import { parseKeywordList } from '@/lib/sounds-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { AnimationConfig, AnimationDraft, AnimationFile, AnimationMapping, AnimationUiState, AnimationUsage } from '@/lib/types/animations';

export const ANIMATION_KEYWORD_FILTER_KEY = 'animation_keyword_filter';
export const VIEWER_CHAT_ANIMATION_GATE_KEY = 'viewer_chat_animation_keyword_triggers_enabled';
export const ANIMATION_MAPPINGS_BACKUP_KEY = 'animation_mappings';
export const ANIMATIONS_ENABLED_KEY = 'animations_enabled';
export const ANIMATION_VOLUME_KEY = 'animation_volume';
export const ANIMATION_POSITION_KEY = 'animation_position';
export const CHROMA_KEY_SETTINGS = 'chroma_key_settings';
export const GIFT_MAPPINGS_KEY = 'gift_mappings';
export const EVENT_ANIMATION_MAPPINGS_KEY = 'event_animation_mappings';
export const STICKER_MAPPINGS_KEY = 'sticker_mappings';

const DEFAULT_CONFIG: AnimationConfig = {
  enabled: true,
  mappings: {},
  globalPosition: 'bottom-left',
  globalScale: 1,
  animationVolume: 100,
  chroma: {
    greenThreshold: 70,
    tolerance: 60,
    spillReduction: 0.5
  }
};

function clampPercent(value: unknown, fallback = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function clampScale(value: unknown, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0.5, Math.min(3, Math.round(numeric * 100) / 100));
}

function normalizeKeywordFilter(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeTriggerFromFilename(filename = '') {
  return String(filename || '')
    .replace(/\.[^/.]+$/, '')
    .trim()
    .toLowerCase();
}

export function buildUniqueAnimationTrigger(
  base: string,
  mappings: Record<string, AnimationMapping>,
  ignoreTrigger = ''
) {
  const cleanBase = normalizeTriggerFromFilename(base) || 'animation';
  let candidate = cleanBase;
  let index = 1;
  while (Object.prototype.hasOwnProperty.call(mappings, candidate) && candidate !== ignoreTrigger) {
    candidate = `${cleanBase}-${index}`;
    index += 1;
  }
  return candidate;
}

export function createDefaultAnimationMapping(filename: string): AnimationMapping {
  return {
    file: String(filename || '').trim(),
    position: 'bottom-left',
    scale: 1,
    volume: 100,
    keywords: [],
    keywordTriggerEnabled: false,
    voiceKeywordTriggerEnabled: false
  };
}

export function normalizeAnimationMapping(data: unknown, fallbackFilename = ''): AnimationMapping {
  if (!data || typeof data !== 'object') {
    return createDefaultAnimationMapping(fallbackFilename);
  }

  const raw = data as Partial<AnimationMapping> & { file?: string; keywords?: unknown };
  const keywords = parseKeywordList(raw.keywords);

  return {
    file: String(raw.file || fallbackFilename || '').trim(),
    position: String(raw.position || 'bottom-left').trim() || 'bottom-left',
    scale: clampScale(raw.scale, 1),
    volume: clampPercent(raw.volume, 100),
    keywords,
    keywordTriggerEnabled: typeof raw.keywordTriggerEnabled === 'boolean'
      ? raw.keywordTriggerEnabled
      : keywords.length > 0,
    voiceKeywordTriggerEnabled: typeof raw.voiceKeywordTriggerEnabled === 'boolean'
      ? raw.voiceKeywordTriggerEnabled
      : (typeof raw.keywordTriggerEnabled === 'boolean' ? raw.keywordTriggerEnabled : keywords.length > 0)
  };
}

export function normalizeAnimationConfig(config: unknown): AnimationConfig {
  if (!config || typeof config !== 'object') {
    return DEFAULT_CONFIG;
  }

  const raw = config as Partial<AnimationConfig> & { mappings?: Record<string, unknown> };
  const mappings: Record<string, AnimationMapping> = {};
  Object.entries(raw.mappings && typeof raw.mappings === 'object' ? raw.mappings : {}).forEach(([trigger, value]) => {
    mappings[String(trigger || '').trim()] = normalizeAnimationMapping(value, normalizeAnimationMapping(value).file);
  });

  return {
    enabled: raw.enabled !== false,
    mappings,
    globalPosition: String(raw.globalPosition || 'bottom-left').trim() || 'bottom-left',
    globalScale: clampScale(raw.globalScale, 1),
    animationVolume: clampPercent(raw.animationVolume, 100),
    chroma: {
      greenThreshold: clampPercent(raw.chroma?.greenThreshold, 70),
      tolerance: clampPercent(raw.chroma?.tolerance, 60),
      spillReduction: Number.isFinite(Number(raw.chroma?.spillReduction)) ? Number(raw.chroma?.spillReduction) : 0.5
    }
  };
}

export function syncAnimationMappingsWithFiles(
  rawMappings: Record<string, AnimationMapping> | Record<string, unknown>,
  files: AnimationFile[]
) {
  const fileSet = new Set(files.map((entry) => entry.filename));
  const nextMappings: Record<string, AnimationMapping> = {};
  const usedFiles = new Set<string>();

  Object.entries(rawMappings || {}).forEach(([trigger, value]) => {
    const normalized = normalizeAnimationMapping(value, '');
    if (!normalized.file || !fileSet.has(normalized.file) || usedFiles.has(normalized.file)) {
      return;
    }
    const safeTrigger = buildUniqueAnimationTrigger(trigger, nextMappings);
    nextMappings[safeTrigger] = normalized;
    usedFiles.add(normalized.file);
  });

  files.forEach((file) => {
    if (usedFiles.has(file.filename)) return;
    const trigger = buildUniqueAnimationTrigger(file.filename, nextMappings);
    nextMappings[trigger] = createDefaultAnimationMapping(file.filename);
    usedFiles.add(file.filename);
  });

  return nextMappings;
}

export function parseAnimationUiState(settings: PersistedSettingsRecord): AnimationUiState {
  return {
    keywordFilter: normalizeKeywordFilter(settings[ANIMATION_KEYWORD_FILTER_KEY]),
    viewerChatTriggersEnabled: settings[VIEWER_CHAT_ANIMATION_GATE_KEY] !== 'false'
  };
}

export function buildAnimationSettingsRecord(
  rawSettings: PersistedSettingsRecord,
  uiState: AnimationUiState,
  config?: AnimationConfig
): PersistedSettingsRecord {
  const next: PersistedSettingsRecord = {
    ...rawSettings,
    [ANIMATION_KEYWORD_FILTER_KEY]: uiState.keywordFilter,
    [VIEWER_CHAT_ANIMATION_GATE_KEY]: uiState.viewerChatTriggersEnabled ? 'true' : 'false'
  };

  if (config) {
    next[ANIMATION_MAPPINGS_BACKUP_KEY] = JSON.stringify(config.mappings);
    next[ANIMATIONS_ENABLED_KEY] = config.enabled ? 'true' : 'false';
    next[ANIMATION_VOLUME_KEY] = String(config.animationVolume);
    next[ANIMATION_POSITION_KEY] = config.globalPosition;
    next[CHROMA_KEY_SETTINGS] = JSON.stringify(config.chroma);
  }

  return next;
}

export function buildAnimationDraft(mapping: AnimationMapping): AnimationDraft {
  return {
    position: mapping.position,
    scale: mapping.scale,
    volume: mapping.volume,
    keywordsText: mapping.keywords.join('\n'),
    viewerChatEnabled: mapping.keywordTriggerEnabled === true,
    voiceEnabled: mapping.voiceKeywordTriggerEnabled === true
  };
}

export function applyAnimationDraft(mapping: AnimationMapping, draft: AnimationDraft): AnimationMapping {
  return {
    ...mapping,
    position: String(draft.position || 'bottom-left').trim() || 'bottom-left',
    scale: clampScale(draft.scale, mapping.scale),
    volume: clampPercent(draft.volume, mapping.volume),
    keywords: parseKeywordList(draft.keywordsText),
    keywordTriggerEnabled: draft.viewerChatEnabled === true,
    voiceKeywordTriggerEnabled: draft.voiceEnabled === true
  };
}

function parseJsonObject(raw: string | undefined) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toTriggerList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => entry.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [] as string[];
}

export function getAnimationUsage(trigger: string, rawSettings: PersistedSettingsRecord): AnimationUsage {
  const normalizedTrigger = String(trigger || '').trim();
  if (!normalizedTrigger) {
    return { defaultGift: false, giftNames: [], giftValues: [], events: [], stickers: [] };
  }

  const usage: AnimationUsage = {
    defaultGift: false,
    giftNames: [],
    giftValues: [],
    events: [],
    stickers: []
  };

  const giftMappings = parseJsonObject(rawSettings[GIFT_MAPPINGS_KEY]);
  const defaultAnimationValues = toTriggerList(giftMappings?.defaultAnimation?.value);
  usage.defaultGift = defaultAnimationValues.includes(normalizedTrigger);

  Object.entries(giftMappings?.byName && typeof giftMappings.byName === 'object' ? giftMappings.byName : {}).forEach(([giftName, action]) => {
    if (String((action as { type?: string })?.type || '') !== 'animation') return;
    if (toTriggerList((action as { value?: unknown }).value).includes(normalizedTrigger)) {
      usage.giftNames.push(giftName);
    }
  });

  Object.entries(giftMappings?.byValue && typeof giftMappings.byValue === 'object' ? giftMappings.byValue : {}).forEach(([giftValue, action]) => {
    if (String((action as { type?: string })?.type || '') !== 'animation') return;
    if (toTriggerList((action as { value?: unknown }).value).includes(normalizedTrigger)) {
      usage.giftValues.push(giftValue);
    }
  });

  const eventMappings = parseJsonObject(rawSettings[EVENT_ANIMATION_MAPPINGS_KEY]);
  Object.entries(eventMappings || {}).forEach(([eventType, value]) => {
    if (String(value || '').trim() === normalizedTrigger) {
      usage.events.push(eventType);
    }
  });

  const stickerMappings = parseJsonObject(rawSettings[STICKER_MAPPINGS_KEY]);
  Object.entries(stickerMappings || {}).forEach(([stickerKey, value]) => {
    const triggerValue = typeof value === 'string'
      ? value
      : String((value as { trigger?: string })?.trigger || '');
    if (triggerValue.trim() === normalizedTrigger) {
      usage.stickers.push(stickerKey);
    }
  });

  usage.giftNames.sort((a, b) => a.localeCompare(b));
  usage.giftValues.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  usage.events.sort((a, b) => a.localeCompare(b));
  usage.stickers.sort((a, b) => a.localeCompare(b));
  return usage;
}

export function removeAnimationTriggerReferences(rawSettings: PersistedSettingsRecord, trigger: string) {
  const normalizedTrigger = String(trigger || '').trim();
  if (!normalizedTrigger) return rawSettings;

  const next: PersistedSettingsRecord = { ...rawSettings };
  const giftMappings = parseJsonObject(rawSettings[GIFT_MAPPINGS_KEY]);
  if (giftMappings) {
    const patched = JSON.parse(JSON.stringify(giftMappings)) as Record<string, unknown>;

    const scrubAction = (action: unknown) => {
      if (!action || typeof action !== 'object') return action;
      const typed = action as { type?: string; value?: unknown };
      if (typed.type !== 'animation') return action;
      const remaining = toTriggerList(typed.value).filter((value) => value !== normalizedTrigger);
      return {
        ...typed,
        value: remaining.length > 1 ? remaining : (remaining[0] || '')
      };
    };

    if (patched.defaultAnimation && typeof patched.defaultAnimation === 'object') {
      patched.defaultAnimation = scrubAction(patched.defaultAnimation);
    }
    Object.entries(patched.byName && typeof patched.byName === 'object' ? patched.byName as Record<string, unknown> : {}).forEach(([key, value]) => {
      (patched.byName as Record<string, unknown>)[key] = scrubAction(value);
    });
    Object.entries(patched.byValue && typeof patched.byValue === 'object' ? patched.byValue as Record<string, unknown> : {}).forEach(([key, value]) => {
      (patched.byValue as Record<string, unknown>)[key] = scrubAction(value);
    });

    next[GIFT_MAPPINGS_KEY] = JSON.stringify(patched);
  }

  const eventMappings = parseJsonObject(rawSettings[EVENT_ANIMATION_MAPPINGS_KEY]);
  if (eventMappings) {
    const patched = { ...eventMappings } as Record<string, unknown>;
    Object.entries(patched).forEach(([eventType, value]) => {
      if (String(value || '').trim() === normalizedTrigger) {
        patched[eventType] = '';
      }
    });
    next[EVENT_ANIMATION_MAPPINGS_KEY] = JSON.stringify(patched);
  }

  const stickerMappings = parseJsonObject(rawSettings[STICKER_MAPPINGS_KEY]);
  if (stickerMappings) {
    const patched = JSON.parse(JSON.stringify(stickerMappings)) as Record<string, unknown>;
    Object.entries(patched).forEach(([stickerKey, value]) => {
      if (typeof value === 'string') {
        if (value.trim() === normalizedTrigger) patched[stickerKey] = '';
        return;
      }
      if (value && typeof value === 'object' && String((value as { trigger?: string }).trigger || '').trim() === normalizedTrigger) {
        patched[stickerKey] = {
          ...(value as Record<string, unknown>),
          trigger: ''
        };
      }
    });
    next[STICKER_MAPPINGS_KEY] = JSON.stringify(patched);
  }

  return next;
}

export function formatAnimationDuration(durationSeconds: number | null) {
  if (!Number.isFinite(durationSeconds) || !durationSeconds || durationSeconds <= 0) return 'Unknown';
  return `${Math.ceil(durationSeconds)}s`;
}

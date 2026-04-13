import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { MicSettingsState, MicTriggerMode, MicVoiceProfile } from '@/lib/types/mic';

export const DEFAULT_MIC_ASR_BASE_URL = 'http://127.0.0.1:8001';
export const MIC_ASR_BASE_URL_KEY = 'mic_asr_base_url';
export const MIC_ASR_LANGUAGE_KEY = 'mic_asr_language';
export const MIC_TRIGGER_MODE_KEY = 'mic_trigger_mode';
export const MIC_VOICE_GATE_ENABLED_KEY = 'mic_voice_gate_enabled';
export const MIC_VOICE_PROFILE_KEY = 'mic_voice_profile';
export const MIC_VOICE_SAMPLE_KEY = 'mic_voice_profile_preview_wav';
export const MIC_VOICE_MATCH_THRESHOLD_KEY = 'mic_voice_match_threshold';
export const MIC_VOICE_PROFILE_VERSION = 2;
export const DEFAULT_MIC_VOICE_MATCH_THRESHOLD = 0.74;

function normalizeBaseUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_MIC_ASR_BASE_URL;
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function normalizeLanguage(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  const supported = new Set(['auto', 'en', 'de', 'pl', 'es', 'fr', 'it']);
  return supported.has(normalized) ? normalized : 'auto';
}

function normalizeTriggerMode(value: unknown): MicTriggerMode {
  return String(value || '').trim().toLowerCase() === 'suggest' ? 'suggest' : 'auto';
}

export function normalizeVoiceMatchThreshold(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_MIC_VOICE_MATCH_THRESHOLD;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return Math.max(0.6, Math.min(0.95, normalized));
}

export function normalizeVoiceProfile(raw: unknown): MicVoiceProfile | null {
  if (!raw) return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const parsedVector = Array.isArray((parsed as { vector?: unknown[] })?.vector)
    ? ((parsed as { vector?: unknown[] }).vector as unknown[])
    : [];
  if (!parsedVector.length) return null;
  const normalizedVector = parsedVector.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!normalizedVector.length || normalizedVector.length !== parsedVector.length) return null;

  const version = Number((parsed as { version?: number }).version || 0);
  if (version !== MIC_VOICE_PROFILE_VERSION) return null;

  return {
    version,
    sampleRate: Math.max(1, Number((parsed as { sample_rate?: number; sampleRate?: number }).sample_rate || (parsed as { sampleRate?: number }).sampleRate || 16000)),
    frameCount: Math.max(0, Number((parsed as { frame_count?: number; frameCount?: number }).frame_count || (parsed as { frameCount?: number }).frameCount || 0)),
    vector: normalizedVector
  };
}

function normalizeVoicePreviewDataUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('data:audio/wav;base64,') ? raw : '';
}

export function parseMicSettings(settings: PersistedSettingsRecord): MicSettingsState {
  return {
    asrBaseUrl: normalizeBaseUrl(settings[MIC_ASR_BASE_URL_KEY]),
    language: normalizeLanguage(settings[MIC_ASR_LANGUAGE_KEY]),
    triggerMode: normalizeTriggerMode(settings[MIC_TRIGGER_MODE_KEY]),
    voiceGateEnabled: String(settings[MIC_VOICE_GATE_ENABLED_KEY] || '').trim().toLowerCase() === 'true',
    voiceProfile: normalizeVoiceProfile(settings[MIC_VOICE_PROFILE_KEY]),
    voicePreviewDataUrl: normalizeVoicePreviewDataUrl(settings[MIC_VOICE_SAMPLE_KEY]),
    voiceMatchThreshold: normalizeVoiceMatchThreshold(settings[MIC_VOICE_MATCH_THRESHOLD_KEY])
  };
}

export function buildMicSettingsRecord(
  rawSettings: PersistedSettingsRecord,
  state: MicSettingsState
): PersistedSettingsRecord {
  return {
    ...rawSettings,
    [MIC_ASR_BASE_URL_KEY]: normalizeBaseUrl(state.asrBaseUrl),
    [MIC_ASR_LANGUAGE_KEY]: normalizeLanguage(state.language),
    [MIC_TRIGGER_MODE_KEY]: state.triggerMode,
    [MIC_VOICE_GATE_ENABLED_KEY]: state.voiceGateEnabled ? 'true' : 'false',
    [MIC_VOICE_PROFILE_KEY]: state.voiceProfile ? JSON.stringify(state.voiceProfile) : '',
    [MIC_VOICE_SAMPLE_KEY]: normalizeVoicePreviewDataUrl(state.voicePreviewDataUrl),
    [MIC_VOICE_MATCH_THRESHOLD_KEY]: String(Math.round(normalizeVoiceMatchThreshold(state.voiceMatchThreshold) * 100))
  };
}

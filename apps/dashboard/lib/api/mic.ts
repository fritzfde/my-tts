import type { MicHealth, MicVoiceProfile } from '@/lib/types/mic';

function normalizeBaseUrl(value: string) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { detail?: string; error?: string; message?: string };
  return String(record.detail || record.error || record.message || fallback).trim() || fallback;
}

export function buildMicHealthUrl(baseUrl: string) {
  return `${normalizeBaseUrl(baseUrl)}/health`;
}

export function buildMicProfileExtractUrl(baseUrl: string) {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  const basePath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${basePath}/profile/extract`;
  parsed.search = '';
  parsed.searchParams.set('sample_rate', '16000');
  return parsed.toString();
}

export function buildMicWsUrl(baseUrl: string, language: string) {
  const parsed = new URL(normalizeBaseUrl(baseUrl));
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = parsed.pathname.replace(/\/+$/, '');
  parsed.pathname = `${basePath}/ws/mic-trigger`;
  parsed.search = '';
  parsed.searchParams.set('language', language);
  return parsed.toString();
}

export async function getMicHealth(baseUrl: string): Promise<MicHealth> {
  const response = await fetch(buildMicHealthUrl(baseUrl), { cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as ({
    ok?: boolean;
    service?: string;
    whisperModel?: string;
    whisper_model?: string;
    whisperDevice?: string;
    whisper_device?: string;
    whisperComputeType?: string;
    whisper_compute_type?: string;
    whisperVadFilter?: boolean;
    whisper_vad_filter?: boolean;
    vadMode?: number;
    vad_mode?: number;
    frameMs?: number;
    frame_ms?: number;
    detail?: string;
    error?: string;
    message?: string;
  }) | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Failed to load Mic ASR health (${response.status})`));
  }

  return {
    ok: payload?.ok === true,
    service: String(payload?.service || 'mic-asr'),
    whisperModel: String(payload?.whisperModel || payload?.whisper_model || 'base'),
    whisperDevice: String(payload?.whisperDevice || payload?.whisper_device || 'cpu'),
    whisperComputeType: String(payload?.whisperComputeType || payload?.whisper_compute_type || 'int8'),
    whisperVadFilter: payload?.whisperVadFilter === true || payload?.whisper_vad_filter === true,
    vadMode: Number(payload?.vadMode || payload?.vad_mode || 1),
    frameMs: Number(payload?.frameMs || payload?.frame_ms || 30)
  };
}

export async function extractMicVoiceProfile(baseUrl: string, pcmBuffer: ArrayBuffer) {
  const response = await fetch(buildMicProfileExtractUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream'
    },
    body: pcmBuffer
  });

  const payload = (await response.json().catch(() => null)) as {
    profile?: MicVoiceProfile;
    recommended_threshold?: number;
    detail?: string;
  } | null;

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Voice enrollment failed (${response.status})`));
  }

  return {
    profile: payload?.profile || null,
    recommendedThreshold: Number(payload?.recommended_threshold || 0.74)
  };
}

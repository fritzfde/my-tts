import { getLegacyApiBaseUrl } from '@/lib/api/config';
import { normalizeSoundPath } from '@/lib/sounds-settings';
import type { SoundFile } from '@/lib/types/sounds';

function parseSoundFile(entry: { name?: string; path?: string }) {
  const path = normalizeSoundPath(entry.path || '');
  return {
    name: String(entry.name || '').trim() || (path.split('/').pop() || path),
    path
  } satisfies SoundFile;
}

export async function listSounds(): Promise<SoundFile[]> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/sounds/list`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load sounds (${response.status})`);
  }

  const data = (await response.json()) as { custom?: Array<{ name?: string; path?: string }> };
  return Array.isArray(data.custom)
    ? data.custom.map(parseSoundFile).filter((entry) => entry.path)
    : [];
}

export async function uploadSound(file: File): Promise<SoundFile> {
  const formData = new FormData();
  formData.append('sound', file);

  const response = await fetch(`${getLegacyApiBaseUrl()}/api/sounds/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Failed to upload sound (${response.status})`);
  }

  const data = (await response.json()) as { filename?: string; path?: string };
  return parseSoundFile({
    name: data.filename || file.name,
    path: data.path || ''
  });
}

export async function deleteSound(soundPath: string) {
  const normalizedPath = normalizeSoundPath(soundPath);
  const filename = normalizedPath.split('/').pop();
  if (!filename) {
    throw new Error('Invalid sound path');
  }

  const response = await fetch(`${getLegacyApiBaseUrl()}/api/sounds/${encodeURIComponent(filename)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Failed to delete sound (${response.status})`);
  }

  return response.json() as Promise<{ success: boolean; filename: string }>;
}

export async function generateSoundKeywords(soundPath: string) {
  const normalizedPath = normalizeSoundPath(soundPath);
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/media-keywords/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [{ kind: 'sound', soundPath: normalizedPath }]
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to generate keywords (${response.status})`);
  }

  const data = (await response.json()) as {
    results?: Array<{ kind?: string; soundPath?: string; keywords?: string[]; warning?: string }>;
  };

  const match = Array.isArray(data.results)
    ? data.results.find((entry) => normalizeSoundPath(entry.soundPath || '') === normalizedPath)
    : null;

  return {
    keywords: Array.isArray(match?.keywords) ? match.keywords : [],
    warning: String(match?.warning || '')
  };
}

import { getLegacyApiBaseUrl } from '@/lib/api/config';
import { normalizeAnimationConfig } from '@/lib/animations-settings';
import type { AnimationConfig, AnimationFile } from '@/lib/types/animations';

function parseAnimationFile(entry: Partial<AnimationFile> & { filename?: string; name?: string; path?: string; thumbnailPath?: string }) {
  const filename = String(entry.filename || '').trim();
  const extlessName = String(entry.name || filename.replace(/\.[^/.]+$/, '')).trim();
  return {
    filename,
    name: extlessName || filename,
    path: String(entry.path || '').trim(),
    thumbnailPath: String(entry.thumbnailPath || '').trim(),
    mtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Number(entry.mtimeMs) : null,
    birthtimeMs: Number.isFinite(Number(entry.birthtimeMs)) ? Number(entry.birthtimeMs) : null,
    durationSeconds: Number.isFinite(Number(entry.durationSeconds)) ? Number(entry.durationSeconds) : null
  } satisfies AnimationFile;
}

export async function listAnimations(): Promise<AnimationFile[]> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/list`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load animations (${response.status})`);
  }

  const data = (await response.json()) as { animations?: Array<Partial<AnimationFile>> };
  return Array.isArray(data.animations)
    ? data.animations.map(parseAnimationFile).filter((entry) => entry.filename)
    : [];
}

export async function getAnimationConfig(name = 'default'): Promise<AnimationConfig> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/config/${encodeURIComponent(name)}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed to load animation config (${response.status})`);
  }

  const data = (await response.json()) as unknown;
  return normalizeAnimationConfig(data);
}

export async function saveAnimationConfig(config: AnimationConfig, name = 'default') {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/config/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(config)
  });

  if (!response.ok) {
    throw new Error(`Failed to save animation config (${response.status})`);
  }

  return response.json() as Promise<{ success: boolean }>;
}

export async function uploadAnimation(file: File): Promise<AnimationFile> {
  const formData = new FormData();
  formData.append('animation', file);

  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Failed to upload animation (${response.status})`);
  }

  const data = (await response.json()) as { filename?: string; name?: string; path?: string };
  return parseAnimationFile({
    filename: data.filename,
    name: data.name,
    path: data.path,
    thumbnailPath: data.filename ? `/api/animations/thumbnail/${encodeURIComponent(data.filename)}` : ''
  });
}

export async function deleteAnimationFile(filename: string) {
  const safeFilename = String(filename || '').trim();
  if (!safeFilename) {
    throw new Error('Invalid animation filename');
  }

  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/file/${encodeURIComponent(safeFilename)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Failed to delete animation (${response.status})`);
  }

  return response.json() as Promise<{ success: boolean; filename: string }>;
}

export async function generateAnimationKeywords(filename: string) {
  const safeFilename = String(filename || '').trim();
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/media-keywords/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [{ kind: 'animation', filename: safeFilename }]
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to generate animation keywords (${response.status})`);
  }

  const data = (await response.json()) as {
    results?: Array<{ filename?: string; keywords?: string[]; warning?: string }>;
  };
  const match = Array.isArray(data.results)
    ? data.results.find((entry) => String(entry.filename || '').trim() === safeFilename)
    : null;

  return {
    keywords: Array.isArray(match?.keywords) ? match.keywords : [],
    warning: String(match?.warning || '')
  };
}

export async function triggerLiveAnimation(trigger: string) {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'manual',
      trigger,
      platform: 'dashboard',
      author: 'host'
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to trigger animation (${response.status})`);
  }

  return response.json() as Promise<{
    success: boolean;
    clients: number;
    obsClients: number;
    browserClients: number;
  }>;
}

export async function stopLiveAnimations() {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/animations/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: 'dashboard',
      reason: 'manual-stop'
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to stop animations (${response.status})`);
  }

  return response.json() as Promise<{
    success: boolean;
    clients: number;
    obsClients: number;
    browserClients: number;
  }>;
}

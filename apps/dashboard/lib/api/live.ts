import { getLegacyApiBaseUrl } from '@/lib/api/config';
import type { TikTokAudienceSnapshot, TikTokMessage, TikTokStatus, YouTubeChatMessage } from '@/lib/types/live';

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as {
    error?: string | { message?: string };
    message?: string;
  };

  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim();
  if (record.error && typeof record.error === 'object' && typeof record.error.message === 'string' && record.error.message.trim()) {
    return record.error.message.trim();
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  return fallback;
}

async function readJson<T>(response: Response, fallbackError: string) {
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `${fallbackError} (${response.status})`));
  }
  return payload as T;
}

export async function getTikTokStatus(): Promise<TikTokStatus> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/status`, {
    cache: 'no-store'
  });
  const payload = await readJson<{ connected?: boolean; username?: string; signMode?: string }>(response, 'Failed to load TikTok status');
  return {
    connected: payload.connected === true,
    username: String(payload.username || '').trim(),
    signMode: payload.signMode === 'api-key' ? 'api-key' : 'anonymous'
  };
}

export async function connectTikTok(username: string) {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username })
  });

  return readJson<{ success: boolean; username: string }>(response, 'Failed to connect TikTok');
}

export async function disconnectTikTok() {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/disconnect`, {
    method: 'POST'
  });

  return readJson<{ success: boolean; connected: boolean }>(response, 'Failed to disconnect TikTok');
}

export async function getTikTokAudience(): Promise<TikTokAudienceSnapshot> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/audience`, {
    cache: 'no-store'
  });
  const payload = await readJson<Partial<TikTokAudienceSnapshot>>(response, 'Failed to load TikTok audience');
  return {
    connected: payload.connected === true,
    viewerCount: Number(payload.viewerCount || 0),
    activeUsers: Array.isArray(payload.activeUsers) ? payload.activeUsers.map((entry) => ({
      uniqueId: String(entry?.uniqueId || '').trim(),
      nickname: String(entry?.nickname || entry?.uniqueId || '').trim(),
      avatar: typeof entry?.avatar === 'string' ? entry.avatar : null,
      source: String(entry?.source || '').trim(),
      lastSeen: Number(entry?.lastSeen || Date.now()),
      coinCount: Number(entry?.coinCount || 0)
    })).filter((entry) => entry.uniqueId) : [],
    topViewers: Array.isArray(payload.topViewers) ? payload.topViewers.map((entry) => ({
      uniqueId: String(entry?.uniqueId || '').trim(),
      nickname: String(entry?.nickname || entry?.uniqueId || '').trim(),
      avatar: typeof entry?.avatar === 'string' ? entry.avatar : null,
      source: String(entry?.source || 'topViewer').trim(),
      lastSeen: Number(entry?.lastSeen || Date.now()),
      coinCount: Number(entry?.coinCount || 0)
    })).filter((entry) => entry.uniqueId) : [],
    ttlMs: Number(payload.ttlMs || 45000),
    updatedAt: Number(payload.updatedAt || Date.now())
  };
}

export async function getTikTokMessages(): Promise<TikTokMessage[]> {
  const response = await fetch(`${getLegacyApiBaseUrl()}/api/tiktok/messages`, {
    cache: 'no-store'
  });
  const payload = await readJson<unknown[]>(response, 'Failed to load TikTok messages');
  return Array.isArray(payload) ? (payload as TikTokMessage[]) : [];
}

async function requestYouTubeWithKeys<T>(
  apiKeys: string[],
  apiPath: string,
  params: Record<string, string>
): Promise<T> {
  const keys = Array.from(new Set(apiKeys.map((entry) => String(entry || '').trim()).filter(Boolean)));
  if (keys.length === 0) {
    throw new Error('Add at least one YouTube API key first.');
  }

  let lastError: Error | null = null;
  for (const key of keys) {
    const search = new URLSearchParams({ ...params, key });
    const response = await fetch(`${getLegacyApiBaseUrl()}/api/youtube/${apiPath}?${search.toString()}`, {
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      return payload as T;
    }
    lastError = new Error(getErrorMessage(payload, `YouTube request failed (${response.status})`));
  }

  throw lastError || new Error('YouTube request failed');
}

export function extractYouTubeVideoId(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/i,
    /youtube\.com\/live\/([^&\n?#]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function extractChannelHandle(input: string) {
  const text = String(input || '').trim();
  if (!text) return '';
  const handleMatch = text.match(/@([^/?#]+)/);
  if (handleMatch?.[1]) return handleMatch[1];
  const normalized = text.replace(/^https?:\/\/(www\.)?youtube\.com\/?/i, '').replace(/^@/, '');
  return normalized.split(/[/?#]/)[0] || '';
}

export async function findYouTubeLiveStream(apiKeys: string[], input: string) {
  const channelIdMatch = String(input || '').match(/channel\/([^/?#]+)/i);
  let channelId = channelIdMatch?.[1] || '';

  if (!channelId) {
    const handle = extractChannelHandle(input);
    if (!handle) {
      throw new Error('Enter a YouTube channel URL or handle first.');
    }

    let channels = await requestYouTubeWithKeys<{ items?: Array<{ id?: string }> }>(apiKeys, 'channels', {
      part: 'id',
      forHandle: handle
    });

    if (!Array.isArray(channels.items) || channels.items.length === 0) {
      channels = await requestYouTubeWithKeys<{ items?: Array<{ id?: string }> }>(apiKeys, 'channels', {
        part: 'id',
        forUsername: handle
      });
    }

    channelId = String(channels.items?.[0]?.id || '').trim();
  }

  if (!channelId) {
    throw new Error('Could not resolve that YouTube channel.');
  }

  const search = await requestYouTubeWithKeys<{
    items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string } }>;
  }>(apiKeys, 'search', {
    part: 'snippet',
    channelId,
    eventType: 'live',
    type: 'video'
  });

  const videoId = String(search.items?.[0]?.id?.videoId || '').trim();
  if (!videoId) {
    throw new Error('No live stream found on that channel right now.');
  }

  return {
    videoId,
    title: String(search.items?.[0]?.snippet?.title || '').trim(),
    url: `https://www.youtube.com/watch?v=${videoId}`
  };
}

export async function getYouTubeLiveChatId(apiKeys: string[], videoId: string) {
  const payload = await requestYouTubeWithKeys<{
    items?: Array<{ liveStreamingDetails?: { activeLiveChatId?: string } }>;
  }>(apiKeys, 'videos', {
    part: 'liveStreamingDetails',
    id: videoId
  });

  const liveChatId = String(payload.items?.[0]?.liveStreamingDetails?.activeLiveChatId || '').trim();
  if (!liveChatId) {
    throw new Error('No active live chat found for that stream.');
  }

  return liveChatId;
}

export async function getYouTubeChatMessages(apiKeys: string[], liveChatId: string, pageToken = '') {
  const payload = await requestYouTubeWithKeys<{
    nextPageToken?: string;
    pollingIntervalMillis?: number;
    items?: Array<{
      id?: string;
      snippet?: { displayMessage?: string; publishedAt?: string };
      authorDetails?: { displayName?: string; profileImageUrl?: string };
    }>;
  }>(apiKeys, 'liveChat/messages', {
    liveChatId,
    part: 'snippet,authorDetails',
    ...(pageToken ? { pageToken } : {})
  });

  const messages: YouTubeChatMessage[] = Array.isArray(payload.items)
    ? payload.items
        .map((entry) => ({
          id: String(entry?.id || '').trim(),
          author: String(entry?.authorDetails?.displayName || '').trim(),
          avatar: typeof entry?.authorDetails?.profileImageUrl === 'string' ? entry.authorDetails.profileImageUrl : null,
          text: String(entry?.snippet?.displayMessage || '').trim(),
          publishedAt: Date.parse(String(entry?.snippet?.publishedAt || '')) || Date.now()
        }))
        .filter((entry) => entry.id && entry.author && entry.text)
    : [];

  return {
    nextPageToken: String(payload.nextPageToken || '').trim(),
    pollingIntervalMs: Number(payload.pollingIntervalMillis || 5000),
    messages
  };
}

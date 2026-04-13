export type LiveSettingsState = {
  youtubeApiKeys: string[];
  youtubeChannelUrl: string;
  youtubeStreamUrl: string;
  youtubeStartupBacklogCount: number;
  tiktokUsername: string;
};

export type PlatformName = 'youtube' | 'tiktok';

export type LivePlatformStatus = {
  connected: boolean;
  label: string;
  detail: string;
  error: string;
  updatedAt: number | null;
};

export type LiveActivityType = 'chat' | 'gift' | 'follow' | 'share' | 'emote' | 'system';

export type LiveActivityEvent = {
  id: string;
  platform: PlatformName;
  type: LiveActivityType;
  author: string;
  authorName: string;
  avatar: string | null;
  text: string;
  timestamp: number;
  accent?: string;
};

export type OnlineUserEntry = {
  username: string;
  displayName: string;
  avatar: string | null;
  lastSeen: number;
  source: string;
};

export type TikTokStatus = {
  connected: boolean;
  username: string;
  signMode: 'api-key' | 'anonymous';
};

export type TikTokAudienceUser = {
  uniqueId: string;
  nickname: string;
  avatar: string | null;
  source: string;
  lastSeen: number;
  coinCount: number;
};

export type TikTokAudienceSnapshot = {
  connected: boolean;
  viewerCount: number;
  activeUsers: TikTokAudienceUser[];
  topViewers: TikTokAudienceUser[];
  ttlMs: number;
  updatedAt: number;
};

export type TikTokMessage = {
  type: string;
  author?: string;
  authorName?: string;
  authorAvatar?: string | null;
  text?: string;
  timestamp?: number;
  giftName?: string;
  repeatCount?: number;
  diamondCount?: number;
  emoteName?: string;
  emotes?: Array<{ emoteId?: string; emoteImage?: string }>;
};

export type YouTubeChatMessage = {
  id: string;
  author: string;
  avatar: string | null;
  text: string;
  publishedAt: number;
};

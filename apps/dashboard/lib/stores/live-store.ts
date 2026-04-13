'use client';

import { create } from 'zustand';
import { buildLiveSettingsRecord, parseLiveSettings } from '@/lib/live-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type {
  LiveActivityEvent,
  LivePlatformStatus,
  LiveSettingsState,
  OnlineUserEntry,
  TikTokAudienceSnapshot,
  TikTokStatus
} from '@/lib/types/live';

const MAX_ACTIVITY_ITEMS = 80;

const defaultSettingsState: LiveSettingsState = {
  youtubeApiKeys: [],
  youtubeChannelUrl: '',
  youtubeStreamUrl: '',
  youtubeStartupBacklogCount: 0,
  tiktokUsername: ''
};

const defaultPlatformStatus: LivePlatformStatus = {
  connected: false,
  label: 'Offline',
  detail: 'Not connected',
  error: '',
  updatedAt: null
};

const defaultAudience: TikTokAudienceSnapshot = {
  connected: false,
  viewerCount: 0,
  activeUsers: [],
  topViewers: [],
  ttlMs: 45000,
  updatedAt: 0
};

type LiveStoreState = LiveSettingsState & {
  scope: string;
  rawSettings: PersistedSettingsRecord;
  youtubeStatus: LivePlatformStatus;
  tiktokStatus: LivePlatformStatus & { username: string; signMode: TikTokStatus['signMode'] };
  tiktokAudience: TikTokAudienceSnapshot;
  recentActivity: LiveActivityEvent[];
  youtubeUsers: OnlineUserEntry[];
  tiktokUsers: OnlineUserEntry[];
  notice: string;
  error: string;
  hydrated: boolean;
  hydrate: (payload: {
    scope: string;
    rawSettings: PersistedSettingsRecord;
    tiktokStatus: TikTokStatus;
    tiktokAudience: TikTokAudienceSnapshot;
  }) => void;
  commitSettingsState: (value: LiveSettingsState, rawSettings?: PersistedSettingsRecord) => void;
  setYoutubeApiKeys: (value: string[]) => void;
  setYoutubeChannelUrl: (value: string) => void;
  setYoutubeStreamUrl: (value: string) => void;
  setYoutubeStartupBacklogCount: (value: number) => void;
  setTikTokUsername: (value: string) => void;
  setYoutubeStatus: (value: LivePlatformStatus) => void;
  setTikTokStatus: (value: LiveStoreState['tiktokStatus']) => void;
  setTikTokAudience: (value: TikTokAudienceSnapshot) => void;
  setYouTubeUsers: (value: OnlineUserEntry[]) => void;
  setTikTokUsers: (value: OnlineUserEntry[]) => void;
  prependActivity: (value: LiveActivityEvent[]) => void;
  removeActivity: (id: string) => void;
  clearPlatformActivity: (platform: 'youtube' | 'tiktok') => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
};

function buildTikTokStatus(status: TikTokStatus): LiveStoreState['tiktokStatus'] {
  return {
    ...defaultPlatformStatus,
    connected: status.connected,
    label: status.connected ? 'Connected' : 'Offline',
    detail: status.connected
      ? `Listening to @${status.username || 'unknown'}`
      : (status.signMode === 'anonymous' ? 'Reconnect available, but anonymous sign mode can be rate-limited.' : 'Ready to connect.'),
    updatedAt: Date.now(),
    username: status.username,
    signMode: status.signMode
  };
}

export const useLiveStore = create<LiveStoreState>((set) => ({
  ...defaultSettingsState,
  scope: 'local-dev',
  rawSettings: {},
  youtubeStatus: defaultPlatformStatus,
  tiktokStatus: {
    ...defaultPlatformStatus,
    username: '',
    signMode: 'anonymous'
  },
  tiktokAudience: defaultAudience,
  recentActivity: [],
  youtubeUsers: [],
  tiktokUsers: [],
  notice: '',
  error: '',
  hydrated: false,
  hydrate: ({ scope, rawSettings, tiktokStatus, tiktokAudience }) => {
    const parsed = parseLiveSettings(rawSettings);
    set({
      scope,
      rawSettings,
      ...parsed,
      tiktokStatus: buildTikTokStatus(tiktokStatus),
      tiktokAudience,
      hydrated: true,
      notice: '',
      error: ''
    });
  },
  commitSettingsState: (value, rawSettings) =>
    set((state) => ({
      ...value,
      rawSettings: rawSettings || buildLiveSettingsRecord(state.rawSettings, value)
    })),
  setYoutubeApiKeys: (value) => set({ youtubeApiKeys: value }),
  setYoutubeChannelUrl: (value) => set({ youtubeChannelUrl: String(value || '').trim() }),
  setYoutubeStreamUrl: (value) => set({ youtubeStreamUrl: String(value || '').trim() }),
  setYoutubeStartupBacklogCount: (value) =>
    set({ youtubeStartupBacklogCount: Math.max(0, Math.min(20, Math.round(Number(value) || 0))) }),
  setTikTokUsername: (value) => set({ tiktokUsername: String(value || '').trim() }),
  setYoutubeStatus: (value) => set({ youtubeStatus: value }),
  setTikTokStatus: (value) => set({ tiktokStatus: value }),
  setTikTokAudience: (value) => set({ tiktokAudience: value }),
  setYouTubeUsers: (value) => set({ youtubeUsers: value }),
  setTikTokUsers: (value) => set({ tiktokUsers: value }),
  prependActivity: (value) =>
    set((state) => {
      const byId = new Map<string, LiveActivityEvent>();
      [...value, ...state.recentActivity].forEach((entry) => {
        if (!entry?.id) return;
        if (!byId.has(entry.id)) byId.set(entry.id, entry);
      });
      return {
        recentActivity: Array.from(byId.values())
          .sort((left, right) => right.timestamp - left.timestamp)
          .slice(0, MAX_ACTIVITY_ITEMS)
      };
    }),
  removeActivity: (id) =>
    set((state) => ({
      recentActivity: state.recentActivity.filter((entry) => entry.id !== id)
    })),
  clearPlatformActivity: (platform) =>
    set((state) => ({
      recentActivity: state.recentActivity.filter((entry) => entry.platform !== platform)
    })),
  setNotice: (value) => set({ notice: value, error: '' }),
  setError: (value) => set({ error: value, notice: '' })
}));

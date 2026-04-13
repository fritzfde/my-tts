'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  connectTikTok,
  disconnectTikTok,
  extractYouTubeVideoId,
  findYouTubeLiveStream,
  getTikTokAudience,
  getTikTokMessages,
  getYouTubeChatMessages,
  getYouTubeLiveChatId
} from '@/lib/api/live';
import { saveSettings } from '@/lib/api/settings';
import { buildLiveSettingsRecord, formatApiKeysInput, formatSeenAgo, parseApiKeysInput, parseLiveSettings } from '@/lib/live-settings';
import { useLiveStore } from '@/lib/stores/live-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type {
  LiveActivityEvent,
  LivePlatformStatus,
  LiveSettingsState,
  OnlineUserEntry,
  TikTokAudienceSnapshot,
  TikTokMessage,
  TikTokStatus,
  YouTubeChatMessage
} from '@/lib/types/live';

type LivePageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialTikTokStatus: TikTokStatus;
  initialTikTokAudience: TikTokAudienceSnapshot;
};

type YouTubeRuntimeRef = {
  connected: boolean;
  liveChatId: string;
  nextPageToken: string;
  seenMessages: Set<string>;
  pollTimer: ReturnType<typeof setTimeout> | null;
};

type TikTokRuntimeRef = {
  connected: boolean;
  firstPoll: boolean;
  seenMessages: Set<string>;
  messageTimer: ReturnType<typeof setTimeout> | null;
  audienceTimer: ReturnType<typeof setTimeout> | null;
};

function formatClock(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function sortUsers(users: Map<string, OnlineUserEntry>) {
  return Array.from(users.values()).sort((left, right) => right.lastSeen - left.lastSeen);
}

function toStatus(connected: boolean, label: string, detail: string, error = ''): LivePlatformStatus {
  return {
    connected,
    label,
    detail,
    error,
    updatedAt: Date.now()
  };
}

function getTikTokMessageId(message: TikTokMessage) {
  const extended = message as TikTokMessage & { primaryEmoteId?: string; emoteId?: string };
  if (message.type === 'gift') {
    return `gift-${message.author}-${message.giftName}-${message.repeatCount}-${message.timestamp}`;
  }
  if (message.type === 'follow') {
    return `follow-${message.author}-${message.timestamp}`;
  }
  if (message.type === 'share') {
    return `share-${message.author}-${message.timestamp}`;
  }
  if (message.type === 'emote') {
    const emoteId = extended.primaryEmoteId || message.emotes?.[0]?.emoteId || extended.emoteId;
    return `emote-${message.author}-${emoteId}-${message.timestamp}`;
  }
  if (message.type === 'combined') {
    return `combined-${message.author}-${message.timestamp}`;
  }
  return `chat-${message.author}-${message.text || 'empty'}-${message.timestamp}`;
}

function mapTikTokMessageToActivity(message: TikTokMessage): LiveActivityEvent | null {
  const author = String(message.author || '').trim();
  const authorName = String(message.authorName || author || 'TikTok').trim() || 'TikTok';
  const timestamp = Number(message.timestamp || Date.now());

  if (message.type === 'gift') {
    const giftName = String(message.giftName || 'Gift').trim() || 'Gift';
    const repeatCount = Number(message.repeatCount || 1);
    const diamondCount = Number(message.diamondCount || 0);
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'gift',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: `${giftName}${repeatCount > 1 ? ` x${repeatCount}` : ''}${diamondCount > 0 ? ` · ${diamondCount} diamonds` : ''}`,
      timestamp,
      accent: 'gift'
    };
  }

  if (message.type === 'follow') {
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'follow',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: 'Started following the stream',
      timestamp,
      accent: 'follow'
    };
  }

  if (message.type === 'share') {
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'share',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: 'Shared the stream',
      timestamp,
      accent: 'share'
    };
  }

  if (message.type === 'emote') {
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'emote',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: message.emoteName ? `Sent ${message.emoteName}` : 'Sent an emote',
      timestamp,
      accent: 'emote'
    };
  }

  if (message.type === 'combined') {
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'chat',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: `${String(message.text || '').trim()}${message.emotes?.length ? ` + ${message.emotes.length} sticker${message.emotes.length === 1 ? '' : 's'}` : ''}`,
      timestamp,
      accent: 'chat'
    };
  }

  if (message.type === 'chat' && String(message.text || '').trim()) {
    return {
      id: getTikTokMessageId(message),
      platform: 'tiktok',
      type: 'chat',
      author,
      authorName,
      avatar: message.authorAvatar || null,
      text: String(message.text || '').trim(),
      timestamp,
      accent: 'chat'
    };
  }

  return null;
}

function mapYouTubeMessagesToActivity(messages: YouTubeChatMessage[]) {
  return messages.map<LiveActivityEvent>((message) => ({
    id: `youtube-${message.id}`,
    platform: 'youtube',
    type: 'chat',
    author: message.author,
    authorName: message.author,
    avatar: message.avatar,
    text: message.text,
    timestamp: message.publishedAt,
    accent: 'chat'
  }));
}

export function LivePageClient({
  initialScope,
  initialSettings,
  initialTikTokStatus,
  initialTikTokAudience
}: LivePageClientProps) {
  const hydrate = useLiveStore((state) => state.hydrate);
  const hydrated = useLiveStore((state) => state.hydrated);
  const scope = useLiveStore((state) => state.scope);
  const rawSettings = useLiveStore((state) => state.rawSettings);
  const youtubeApiKeys = useLiveStore((state) => state.youtubeApiKeys);
  const youtubeChannelUrl = useLiveStore((state) => state.youtubeChannelUrl);
  const youtubeStreamUrl = useLiveStore((state) => state.youtubeStreamUrl);
  const youtubeStartupBacklogCount = useLiveStore((state) => state.youtubeStartupBacklogCount);
  const tiktokUsername = useLiveStore((state) => state.tiktokUsername);
  const youtubeStatus = useLiveStore((state) => state.youtubeStatus);
  const tiktokStatus = useLiveStore((state) => state.tiktokStatus);
  const tiktokAudience = useLiveStore((state) => state.tiktokAudience);
  const recentActivity = useLiveStore((state) => state.recentActivity);
  const youtubeUsers = useLiveStore((state) => state.youtubeUsers);
  const tiktokUsers = useLiveStore((state) => state.tiktokUsers);
  const notice = useLiveStore((state) => state.notice);
  const error = useLiveStore((state) => state.error);
  const commitSettingsState = useLiveStore((state) => state.commitSettingsState);
  const setYoutubeApiKeys = useLiveStore((state) => state.setYoutubeApiKeys);
  const setYoutubeChannelUrl = useLiveStore((state) => state.setYoutubeChannelUrl);
  const setYoutubeStreamUrl = useLiveStore((state) => state.setYoutubeStreamUrl);
  const setYoutubeStartupBacklogCount = useLiveStore((state) => state.setYoutubeStartupBacklogCount);
  const setTikTokUsername = useLiveStore((state) => state.setTikTokUsername);
  const setYoutubeStatus = useLiveStore((state) => state.setYoutubeStatus);
  const setTikTokStatus = useLiveStore((state) => state.setTikTokStatus);
  const setTikTokAudience = useLiveStore((state) => state.setTikTokAudience);
  const setYouTubeUsers = useLiveStore((state) => state.setYouTubeUsers);
  const setTikTokUsers = useLiveStore((state) => state.setTikTokUsers);
  const prependActivity = useLiveStore((state) => state.prependActivity);
  const clearPlatformActivity = useLiveStore((state) => state.clearPlatformActivity);
  const setNotice = useLiveStore((state) => state.setNotice);
  const setError = useLiveStore((state) => state.setError);

  const [apiKeysText, setApiKeysText] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isConnectingYouTube, setIsConnectingYouTube] = useState(false);
  const [isFindingYouTube, setIsFindingYouTube] = useState(false);
  const [isConnectingTikTok, setIsConnectingTikTok] = useState(false);
  const initializedRef = useRef(false);
  const settingsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const youtubeRuntimeRef = useRef<YouTubeRuntimeRef>({
    connected: false,
    liveChatId: '',
    nextPageToken: '',
    seenMessages: new Set<string>(),
    pollTimer: null
  });
  const tiktokRuntimeRef = useRef<TikTokRuntimeRef>({
    connected: false,
    firstPoll: true,
    seenMessages: new Set<string>(),
    messageTimer: null,
    audienceTimer: null
  });
  const youtubeUsersMapRef = useRef(new Map<string, OnlineUserEntry>());
  const tiktokUsersMapRef = useRef(new Map<string, OnlineUserEntry>());

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings,
      tiktokStatus: initialTikTokStatus,
      tiktokAudience: initialTikTokAudience
    });
    setApiKeysText(formatApiKeysInput(parseLiveSettings(initialSettings).youtubeApiKeys));
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings, initialTikTokAudience, initialTikTokStatus]);

  useEffect(() => {
    setApiKeysText(formatApiKeysInput(youtubeApiKeys));
  }, [youtubeApiKeys]);

  const currentSettingsState = useMemo<LiveSettingsState>(
    () => ({
      youtubeApiKeys,
      youtubeChannelUrl,
      youtubeStreamUrl,
      youtubeStartupBacklogCount,
      tiktokUsername
    }),
    [tiktokUsername, youtubeApiKeys, youtubeChannelUrl, youtubeStartupBacklogCount, youtubeStreamUrl]
  );

  useEffect(() => {
    return () => {
      if (settingsPersistTimerRef.current) clearTimeout(settingsPersistTimerRef.current);
      if (youtubeRuntimeRef.current.pollTimer) clearTimeout(youtubeRuntimeRef.current.pollTimer);
      if (tiktokRuntimeRef.current.messageTimer) clearTimeout(tiktokRuntimeRef.current.messageTimer);
      if (tiktokRuntimeRef.current.audienceTimer) clearTimeout(tiktokRuntimeRef.current.audienceTimer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !initialTikTokStatus.connected || tiktokRuntimeRef.current.connected) return;
    tiktokRuntimeRef.current.connected = true;
    tiktokRuntimeRef.current.firstPoll = true;
    void pollTikTokAudienceLoop();
    void pollTikTokMessagesLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, initialTikTokStatus.connected]);

  async function persistSettingsState(nextState: LiveSettingsState, nextRawSettings?: PersistedSettingsRecord) {
    setIsSavingSettings(true);
    try {
      const resolvedRawSettings = nextRawSettings || buildLiveSettingsRecord(rawSettings, nextState);
      await saveSettings(resolvedRawSettings, scope);
      commitSettingsState(nextState, resolvedRawSettings);
    } finally {
      setIsSavingSettings(false);
    }
  }

  useEffect(() => {
    if (!hydrated) return;
    if (settingsPersistTimerRef.current) clearTimeout(settingsPersistTimerRef.current);
    settingsPersistTimerRef.current = setTimeout(() => {
      void persistSettingsState(currentSettingsState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save live settings');
      });
    }, 350);

    return () => {
      if (settingsPersistTimerRef.current) clearTimeout(settingsPersistTimerRef.current);
    };
  }, [currentSettingsState, hydrated, setError]);

  async function pollTikTokAudienceLoop() {
    try {
      const audience = await getTikTokAudience();
      setTikTokAudience(audience);
      const nextUsers = new Map<string, OnlineUserEntry>();
      [...audience.topViewers, ...audience.activeUsers].forEach((entry) => {
        if (!entry.uniqueId || nextUsers.has(entry.uniqueId)) return;
        nextUsers.set(entry.uniqueId, {
          username: entry.uniqueId,
          displayName: entry.nickname || entry.uniqueId,
          avatar: entry.avatar,
          lastSeen: entry.lastSeen,
          source: entry.source
        });
      });
      tiktokUsersMapRef.current = nextUsers;
      setTikTokUsers(sortUsers(nextUsers));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh TikTok audience');
    } finally {
      if (tiktokRuntimeRef.current.connected) {
        tiktokRuntimeRef.current.audienceTimer = setTimeout(() => {
          void pollTikTokAudienceLoop();
        }, 5000);
      }
    }
  }

  async function pollTikTokMessagesLoop() {
    try {
      const messages = await getTikTokMessages();
      const firstPoll = tiktokRuntimeRef.current.firstPoll;
      const nextEvents: LiveActivityEvent[] = [];

      messages.forEach((message) => {
        const messageId = getTikTokMessageId(message);
        if (tiktokRuntimeRef.current.seenMessages.has(messageId)) return;
        tiktokRuntimeRef.current.seenMessages.add(messageId);
        const mapped = mapTikTokMessageToActivity(message);
        if (mapped) nextEvents.push(mapped);
      });

      if (nextEvents.length > 0) {
        if (firstPoll) {
          const backlog = Math.max(0, Math.min(20, youtubeStartupBacklogCount));
          const initialEvents = backlog > 0 ? nextEvents.slice(-backlog) : [];
          if (initialEvents.length > 0) {
            prependActivity(initialEvents);
          }
        } else {
          prependActivity(nextEvents);
        }
      }

      if (firstPoll) {
        tiktokRuntimeRef.current.firstPoll = false;
        if (nextEvents.length === 0 || youtubeStartupBacklogCount === 0) {
          prependActivity([
            {
              id: `system-tiktok-${Date.now()}`,
              platform: 'tiktok',
              type: 'system',
              author: 'SYSTEM',
              authorName: 'System',
              avatar: null,
              text: 'TikTok chat synced. Waiting for new activity...',
              timestamp: Date.now(),
              accent: 'system'
            }
          ]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh TikTok activity');
    } finally {
      if (tiktokRuntimeRef.current.connected) {
        tiktokRuntimeRef.current.messageTimer = setTimeout(() => {
          void pollTikTokMessagesLoop();
        }, 2000);
      }
    }
  }

  async function connectTikTokRuntime(nextUsername = tiktokUsername) {
    const username = String(nextUsername || '').trim();
    if (!username) {
      setError('Enter a TikTok username first.');
      return;
    }

    setIsConnectingTikTok(true);
    try {
      const response = await connectTikTok(username);
      tiktokRuntimeRef.current.connected = true;
      tiktokRuntimeRef.current.firstPoll = true;
      tiktokRuntimeRef.current.seenMessages = new Set<string>();
      clearPlatformActivity('tiktok');
      setTikTokStatus({
        connected: true,
        label: 'Connected',
        detail: `Listening to @${response.username || username}`,
        error: '',
        updatedAt: Date.now(),
        username: response.username || username,
        signMode: tiktokStatus.signMode
      });
      setNotice(`TikTok connected as @${response.username || username}.`);
      await pollTikTokAudienceLoop();
      await pollTikTokMessagesLoop();
    } catch (err) {
      setTikTokStatus({
        ...tiktokStatus,
        connected: false,
        label: 'Offline',
        detail: 'Connection failed',
        error: err instanceof Error ? err.message : 'TikTok connection failed',
        updatedAt: Date.now()
      });
      setError(err instanceof Error ? err.message : 'TikTok connection failed');
    } finally {
      setIsConnectingTikTok(false);
    }
  }

  async function disconnectTikTokRuntime() {
    if (tiktokRuntimeRef.current.messageTimer) clearTimeout(tiktokRuntimeRef.current.messageTimer);
    if (tiktokRuntimeRef.current.audienceTimer) clearTimeout(tiktokRuntimeRef.current.audienceTimer);
    tiktokRuntimeRef.current.connected = false;
    tiktokRuntimeRef.current.firstPoll = true;
    tiktokRuntimeRef.current.seenMessages = new Set<string>();

    try {
      await disconnectTikTok();
    } catch (err) {
      console.warn('TikTok disconnect warning:', err);
    }

    setTikTokAudience({
      connected: false,
      viewerCount: 0,
      activeUsers: [],
      topViewers: [],
      ttlMs: tiktokAudience.ttlMs,
      updatedAt: Date.now()
    });
    tiktokUsersMapRef.current = new Map();
    setTikTokUsers([]);
    setTikTokStatus({
      ...tiktokStatus,
      connected: false,
      label: 'Offline',
      detail: 'Disconnected',
      error: '',
      updatedAt: Date.now(),
      username: tiktokUsername,
      signMode: tiktokStatus.signMode
    });
    prependActivity([
      {
        id: `system-tiktok-disconnect-${Date.now()}`,
        platform: 'tiktok',
        type: 'system',
        author: 'SYSTEM',
        authorName: 'System',
        avatar: null,
        text: 'TikTok disconnected.',
        timestamp: Date.now(),
        accent: 'system'
      }
    ]);
  }

  async function pollYouTubeMessagesLoop() {
    if (!youtubeRuntimeRef.current.connected || !youtubeRuntimeRef.current.liveChatId) return;

    try {
      const isFirstPoll = youtubeRuntimeRef.current.seenMessages.size === 0 && !youtubeRuntimeRef.current.nextPageToken;
      const result = await getYouTubeChatMessages(
        youtubeApiKeys,
        youtubeRuntimeRef.current.liveChatId,
        youtubeRuntimeRef.current.nextPageToken
      );
      youtubeRuntimeRef.current.nextPageToken = result.nextPageToken;

      const unseen = result.messages.filter((message) => {
        if (youtubeRuntimeRef.current.seenMessages.has(message.id)) return false;
        youtubeRuntimeRef.current.seenMessages.add(message.id);
        return true;
      });

      if (unseen.length > 0) {
        unseen.forEach((message) => {
          youtubeUsersMapRef.current.set(message.author, {
            username: message.author,
            displayName: message.author,
            avatar: message.avatar,
            lastSeen: message.publishedAt,
            source: 'chat'
          });
        });
        setYouTubeUsers(sortUsers(youtubeUsersMapRef.current));

        if (isFirstPoll) {
          const backlog = Math.max(0, Math.min(20, youtubeStartupBacklogCount));
          const initialMessages = backlog > 0 ? unseen.slice(-backlog) : [];
          if (initialMessages.length > 0) {
            prependActivity(mapYouTubeMessagesToActivity(initialMessages));
          }
        } else {
          prependActivity(mapYouTubeMessagesToActivity(unseen));
        }
      }

      if (isFirstPoll && (unseen.length === 0 || youtubeStartupBacklogCount === 0)) {
        prependActivity([
          {
            id: `system-youtube-${Date.now()}`,
            platform: 'youtube',
            type: 'system',
            author: 'SYSTEM',
            authorName: 'System',
            avatar: null,
            text: 'YouTube chat synced. Waiting for new messages...',
            timestamp: Date.now(),
            accent: 'system'
          }
        ]);
      }

      if (youtubeRuntimeRef.current.connected) {
        youtubeRuntimeRef.current.pollTimer = setTimeout(() => {
          void pollYouTubeMessagesLoop();
        }, Math.max(2000, result.pollingIntervalMs || 5000));
      }
    } catch (err) {
      setYoutubeStatus({
        connected: false,
        label: 'Error',
        detail: 'YouTube polling stopped',
        error: err instanceof Error ? err.message : 'Failed to poll YouTube chat',
        updatedAt: Date.now()
      });
      setError(err instanceof Error ? err.message : 'Failed to poll YouTube chat');
      youtubeRuntimeRef.current.connected = false;
    }
  }

  async function handleFindYouTubeStream() {
    if (youtubeApiKeys.length === 0) {
      setError('Add at least one YouTube API key first.');
      return;
    }
    if (!youtubeChannelUrl) {
      setError('Enter a YouTube channel URL or handle first.');
      return;
    }

    setIsFindingYouTube(true);
    try {
      const result = await findYouTubeLiveStream(youtubeApiKeys, youtubeChannelUrl);
      setYoutubeStreamUrl(result.url);
      setNotice(result.title ? `Found live stream: ${result.title}` : 'Found a live stream for that channel.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find a YouTube live stream');
    } finally {
      setIsFindingYouTube(false);
    }
  }

  async function connectYouTubeRuntime() {
    if (youtubeApiKeys.length === 0) {
      setError('Add at least one YouTube API key first.');
      return;
    }

    setIsConnectingYouTube(true);
    try {
      let nextStreamUrl = youtubeStreamUrl;
      if (!nextStreamUrl && youtubeChannelUrl) {
        const liveStream = await findYouTubeLiveStream(youtubeApiKeys, youtubeChannelUrl);
        nextStreamUrl = liveStream.url;
        setYoutubeStreamUrl(nextStreamUrl);
      }

      const videoId = extractYouTubeVideoId(nextStreamUrl);
      if (!videoId) {
        throw new Error('Enter a valid YouTube stream URL or find a live stream from the channel URL first.');
      }

      const liveChatId = await getYouTubeLiveChatId(youtubeApiKeys, videoId);
      youtubeRuntimeRef.current.connected = true;
      youtubeRuntimeRef.current.liveChatId = liveChatId;
      youtubeRuntimeRef.current.nextPageToken = '';
      youtubeRuntimeRef.current.seenMessages = new Set<string>();
      youtubeUsersMapRef.current = new Map();
      setYouTubeUsers([]);
      clearPlatformActivity('youtube');
      setYoutubeStatus(toStatus(true, 'Connected', 'Listening to the active YouTube live chat.'));
      prependActivity([
        {
          id: `system-youtube-connect-${Date.now()}`,
          platform: 'youtube',
          type: 'system',
          author: 'SYSTEM',
          authorName: 'System',
          avatar: null,
          text: 'YouTube connected. Syncing the active live chat...',
          timestamp: Date.now(),
          accent: 'system'
        }
      ]);
      await pollYouTubeMessagesLoop();
    } catch (err) {
      setYoutubeStatus({
        connected: false,
        label: 'Offline',
        detail: 'Connection failed',
        error: err instanceof Error ? err.message : 'YouTube connection failed',
        updatedAt: Date.now()
      });
      setError(err instanceof Error ? err.message : 'YouTube connection failed');
    } finally {
      setIsConnectingYouTube(false);
    }
  }

  function disconnectYouTubeRuntime() {
    if (youtubeRuntimeRef.current.pollTimer) clearTimeout(youtubeRuntimeRef.current.pollTimer);
    youtubeRuntimeRef.current.connected = false;
    youtubeRuntimeRef.current.liveChatId = '';
    youtubeRuntimeRef.current.nextPageToken = '';
    youtubeRuntimeRef.current.seenMessages = new Set<string>();
    youtubeUsersMapRef.current = new Map();
    setYouTubeUsers([]);
    setYoutubeStatus(toStatus(false, 'Offline', 'Disconnected from live chat.'));
    prependActivity([
      {
        id: `system-youtube-disconnect-${Date.now()}`,
        platform: 'youtube',
        type: 'system',
        author: 'SYSTEM',
        authorName: 'System',
        avatar: null,
        text: 'YouTube disconnected.',
        timestamp: Date.now(),
        accent: 'system'
      }
    ]);
  }

  const connectedPlatforms = Number(youtubeStatus.connected) + Number(tiktokStatus.connected);
  const recentActivityCards = recentActivity.slice(0, 24);
  const totalPresence = youtubeUsers.length + tiktokUsers.length;

  return (
    <div className="live-page">
      <section className="live-summary-grid">
        <article className={`live-summary-card ${youtubeStatus.connected ? 'is-connected' : ''}`}>
          <span>YouTube</span>
          <strong>{youtubeStatus.label}</strong>
          <p>{youtubeStatus.error || youtubeStatus.detail}</p>
        </article>
        <article className={`live-summary-card ${tiktokStatus.connected ? 'is-connected' : ''}`}>
          <span>TikTok</span>
          <strong>{tiktokStatus.label}</strong>
          <p>{tiktokStatus.error || tiktokStatus.detail}</p>
        </article>
        <article className="live-summary-card">
          <span>Presence</span>
          <strong>{totalPresence}</strong>
          <p>{youtubeUsers.length} YouTube users and {tiktokUsers.length} TikTok users in the current snapshot.</p>
        </article>
        <article className="live-summary-card">
          <span>TikTok viewers</span>
          <strong>{tiktokAudience.viewerCount}</strong>
          <p>{tiktokAudience.topViewers.length} top viewers and {tiktokAudience.activeUsers.length} active users currently visible.</p>
        </article>
      </section>

      {(notice || error) ? (
        <div className={`live-banner ${error ? 'is-error' : 'is-notice'}`}>
          <strong>{error ? 'Attention' : 'Updated'}</strong>
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="live-layout-grid">
        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Platform Setup</p>
                <h2>YouTube control</h2>
              </div>
              <span className={`live-pill ${youtubeStatus.connected ? 'is-connected' : ''}`}>{youtubeStatus.label}</span>
            </div>

            <label className="live-field">
              <span>YouTube API keys</span>
              <textarea
                rows={4}
                value={apiKeysText}
                onChange={(event) => {
                  const value = event.target.value;
                  setApiKeysText(value);
                  setYoutubeApiKeys(parseApiKeysInput(value));
                }}
                placeholder="Paste one API key per line"
              />
              <small>{youtubeApiKeys.length} keys saved. The control room will try them in order.</small>
            </label>

            <div className="live-form-grid">
              <label className="live-field">
                <span>Channel URL or handle</span>
                <input
                  value={youtubeChannelUrl}
                  onChange={(event) => setYoutubeChannelUrl(event.target.value)}
                  placeholder="https://www.youtube.com/@yourchannel"
                />
              </label>
              <label className="live-field">
                <span>Active stream URL</span>
                <input
                  value={youtubeStreamUrl}
                  onChange={(event) => setYoutubeStreamUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>
            </div>

            <label className="live-field">
              <span>Startup backlog</span>
              <div className="live-inline-range">
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={youtubeStartupBacklogCount}
                  onChange={(event) => setYoutubeStartupBacklogCount(Number(event.target.value))}
                />
                <strong>{youtubeStartupBacklogCount}</strong>
              </div>
              <small>How many recent messages should be shown when YouTube chat syncs on connect.</small>
            </label>

            <div className="live-actions-row">
              <button className="live-button" type="button" onClick={() => void handleFindYouTubeStream()} disabled={isFindingYouTube || isConnectingYouTube}>
                {isFindingYouTube ? 'Finding live stream…' : 'Find live stream'}
              </button>
              <button className="live-button is-primary" type="button" onClick={() => void connectYouTubeRuntime()} disabled={isConnectingYouTube}>
                {isConnectingYouTube ? 'Connecting…' : 'Connect YouTube'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={disconnectYouTubeRuntime} disabled={!youtubeStatus.connected}>
                Disconnect
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Platform Setup</p>
                <h2>TikTok control</h2>
              </div>
              <span className={`live-pill ${tiktokStatus.connected ? 'is-connected' : ''}`}>{tiktokStatus.label}</span>
            </div>

            <label className="live-field">
              <span>TikTok username</span>
              <input
                value={tiktokUsername}
                onChange={(event) => setTikTokUsername(event.target.value)}
                placeholder="@creator"
              />
              <small>
                Sign mode: <strong>{tiktokStatus.signMode === 'api-key' ? 'API key configured' : 'anonymous'}</strong>
                {tiktokStatus.signMode === 'anonymous' ? ' — this can be rate-limited by the provider.' : ''}
              </small>
            </label>

            <div className="live-actions-row">
              <button className="live-button is-primary" type="button" onClick={() => void connectTikTokRuntime()} disabled={isConnectingTikTok}>
                {isConnectingTikTok ? 'Connecting…' : 'Connect TikTok'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={() => void disconnectTikTokRuntime()} disabled={!tiktokStatus.connected}>
                Disconnect
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Presence</p>
                <h2>Audience snapshot</h2>
              </div>
              <span className="live-pill">{connectedPlatforms} active</span>
            </div>

            <div className="live-presence-grid">
              <div className="live-subpanel">
                <h3>YouTube chat users</h3>
                <ul className="live-user-list">
                  {youtubeUsers.length === 0 ? <li className="live-empty">No YouTube users seen yet.</li> : youtubeUsers.slice(0, 8).map((user) => (
                    <li key={`youtube-${user.username}`}>
                      <span>{user.displayName}</span>
                      <small>{formatSeenAgo(user.lastSeen)}</small>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="live-subpanel">
                <h3>TikTok active users</h3>
                <ul className="live-user-list">
                  {tiktokUsers.length === 0 ? <li className="live-empty">No TikTok users seen yet.</li> : tiktokUsers.slice(0, 8).map((user) => (
                    <li key={`tiktok-${user.username}`}>
                      <span>{user.displayName}</span>
                      <small>{formatSeenAgo(user.lastSeen)}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>

        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Operations Feed</p>
                <h2>Recent activity</h2>
              </div>
              <span className="live-pill">{recentActivityCards.length} items</span>
            </div>
            <div className="live-activity-list">
              {recentActivityCards.length === 0 ? <div className="live-empty">Connect a platform to populate the control-room activity feed.</div> : recentActivityCards.map((event) => (
                <article key={event.id} className={`live-activity-card accent-${event.accent || event.type}`}>
                  <header>
                    <div>
                      <strong>{event.authorName || event.author || 'System'}</strong>
                      <span>{event.platform.toUpperCase()} · {event.type}</span>
                    </div>
                    <time>{formatClock(event.timestamp)}</time>
                  </header>
                  <p>{event.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">TikTok room</p>
                <h2>Viewer leaderboard</h2>
              </div>
              <span className="live-pill">{tiktokAudience.topViewers.length} tracked</span>
            </div>
            <div className="live-top-viewers">
              {tiktokAudience.topViewers.length === 0 ? <div className="live-empty">Top viewers will appear here once TikTok is connected.</div> : tiktokAudience.topViewers.slice(0, 10).map((viewer) => (
                <div key={viewer.uniqueId} className="live-viewer-row">
                  <div>
                    <strong>{viewer.nickname || viewer.uniqueId}</strong>
                    <small>@{viewer.uniqueId}</small>
                  </div>
                  <span>{viewer.coinCount > 0 ? `${viewer.coinCount} coins` : formatSeenAgo(viewer.lastSeen)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="live-footer-note">
        <span>{isSavingSettings ? 'Saving settings…' : 'Settings persist automatically while you work.'}</span>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef } from 'react';
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
import { registerLiveRuntime } from '@/lib/runtime/live-runtime';
import { useLiveStore } from '@/lib/stores/live-store';
import type {
  LiveActivityEvent,
  LivePlatformStatus,
  OnlineUserEntry,
  TikTokMessage,
  YouTubeChatMessage
} from '@/lib/types/live';

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

export function ControlRoomLiveRuntime() {
  const hydrated = useLiveStore((state) => state.hydrated);
  const youtubeApiKeys = useLiveStore((state) => state.youtubeApiKeys);
  const youtubeChannelUrl = useLiveStore((state) => state.youtubeChannelUrl);
  const youtubeStreamUrl = useLiveStore((state) => state.youtubeStreamUrl);
  const youtubeStartupBacklogCount = useLiveStore((state) => state.youtubeStartupBacklogCount);
  const tiktokUsername = useLiveStore((state) => state.tiktokUsername);
  const tiktokStatus = useLiveStore((state) => state.tiktokStatus);
  const tiktokAudience = useLiveStore((state) => state.tiktokAudience);
  const setYoutubeStatus = useLiveStore((state) => state.setYoutubeStatus);
  const setTikTokStatus = useLiveStore((state) => state.setTikTokStatus);
  const setTikTokAudience = useLiveStore((state) => state.setTikTokAudience);
  const setYouTubeUsers = useLiveStore((state) => state.setYouTubeUsers);
  const setTikTokUsers = useLiveStore((state) => state.setTikTokUsers);
  const prependActivity = useLiveStore((state) => state.prependActivity);
  const clearPlatformActivity = useLiveStore((state) => state.clearPlatformActivity);
  const setNotice = useLiveStore((state) => state.setNotice);
  const setError = useLiveStore((state) => state.setError);

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

  const pollTikTokAudienceLoop = useCallback(async () => {
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
  }, [setError, setTikTokAudience, setTikTokUsers]);

  const pollTikTokMessagesLoop = useCallback(async () => {
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
  }, [prependActivity, setError, youtubeStartupBacklogCount]);

  const connectTikTokRuntime = useCallback(async (nextUsername = tiktokUsername) => {
    const username = String(nextUsername || '').trim();
    if (!username) {
      throw new Error('Enter a TikTok username first.');
    }

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
  }, [clearPlatformActivity, pollTikTokAudienceLoop, pollTikTokMessagesLoop, setNotice, setTikTokStatus, tiktokStatus.signMode, tiktokUsername]);

  const disconnectTikTokRuntime = useCallback(async () => {
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
  }, [prependActivity, setTikTokAudience, setTikTokStatus, setTikTokUsers, tiktokAudience.ttlMs, tiktokStatus, tiktokUsername]);

  const pollYouTubeMessagesLoop = useCallback(async () => {
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
  }, [prependActivity, setError, setYouTubeUsers, setYoutubeStatus, youtubeApiKeys, youtubeStartupBacklogCount]);

  const connectYouTubeRuntime = useCallback(async () => {
    if (youtubeApiKeys.length === 0) {
      throw new Error('Add at least one YouTube API key first.');
    }

    let nextStreamUrl = youtubeStreamUrl;
    if (!nextStreamUrl && youtubeChannelUrl) {
      const liveStream = await findYouTubeLiveStream(youtubeApiKeys, youtubeChannelUrl);
      nextStreamUrl = liveStream.url;
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
  }, [clearPlatformActivity, pollYouTubeMessagesLoop, prependActivity, setYouTubeUsers, setYoutubeStatus, youtubeApiKeys, youtubeChannelUrl, youtubeStreamUrl]);

  const disconnectYouTubeRuntime = useCallback(() => {
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
  }, [prependActivity, setYouTubeUsers, setYoutubeStatus]);

  useEffect(() => {
    return () => {
      if (youtubeRuntimeRef.current.pollTimer) clearTimeout(youtubeRuntimeRef.current.pollTimer);
      if (tiktokRuntimeRef.current.messageTimer) clearTimeout(tiktokRuntimeRef.current.messageTimer);
      if (tiktokRuntimeRef.current.audienceTimer) clearTimeout(tiktokRuntimeRef.current.audienceTimer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !tiktokStatus.connected || tiktokRuntimeRef.current.connected) return;
    tiktokRuntimeRef.current.connected = true;
    tiktokRuntimeRef.current.firstPoll = true;
    void pollTikTokAudienceLoop();
    void pollTikTokMessagesLoop();
  }, [hydrated, pollTikTokAudienceLoop, pollTikTokMessagesLoop, tiktokStatus.connected]);

  useEffect(() => {
    const unregister = registerLiveRuntime({
      connectYouTube: connectYouTubeRuntime,
      disconnectYouTube: disconnectYouTubeRuntime,
      connectTikTok: connectTikTokRuntime,
      disconnectTikTok: disconnectTikTokRuntime
    });
    return unregister;
  }, [connectTikTokRuntime, connectYouTubeRuntime, disconnectTikTokRuntime, disconnectYouTubeRuntime]);

  return null;
}

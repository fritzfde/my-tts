(function initTikTokModule() {
  function createTikTokController(deps) {
    const STARTUP_SYNC_WINDOW_MS = 8000;
    const {
      elements,
      settingsStore,
      updateStatus,
      addChatMessage,
      clearOnlineUsers,
      requestWakeLock,
      releaseWakeLockIfIdle,
      getYouTubeConnected,
      rememberUserProfile,
      getUserDisplayName,
      onlineUsers,
      renderOnlineUsers,
      setPlatformUsers,
      setTikTokLiveViewerCount,
      setTikTokOnlineUserTtlMs,
      autoAssignVoiceIfNeeded,
      speakText,
      setPlatformSpeechSuppressed,
      handleKeywordTriggers,
      getGiftAction,
      getEventAnimationTrigger,
      triggerAnimation,
      resolveSoundAlert,
      playAlertSound,
      registerKnownGiftName,
      playSpecificSound,
      getStartupBacklogCount,
      buildStickerChatListHtml,
      handleStickerAnimation,
      canUserTriggerAnimations,
      escapeHtml,
      onConnectionStateChange
    } = deps;

    const state = {
      connected: false,
      isFirstPoll: true,
      seenMessages: new Set(),
      pollTimer: null,
      lastPollTime: null,
      pollLoopToken: 0,
      hasAudienceSnapshot: false,
      startupSyncUntilMs: 0,
      startupSyncAnnounced: false
    };

    function isConnected() {
      return state.connected;
    }

    function normalizeTikTokUsernameInput(value) {
      let raw = String(value || '').trim();
      if (!raw) return '';

      raw = raw.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '');
      raw = raw.replace(/^@/, '');
      raw = raw.split(/[/?#]/)[0] || '';
      raw = raw.trim();

      return raw.replace(/^@+/, '');
    }

    function notifyConnectionState(connected) {
      if (typeof onConnectionStateChange === 'function') {
        onConnectionStateChange({ platform: 'tiktok', connected: !!connected });
      }
    }

    function stopPolling() {
      if (state.pollTimer) {
        try {
          clearTimeout(state.pollTimer);
        } catch (e) {
          // ignore
        }
        state.pollTimer = null;
      }
    }

    function schedulePoll(loopToken, delayMs = 2000) {
      stopPolling();
      state.pollTimer = setTimeout(() => {
        pollTikTokMessages(loopToken);
      }, delayMs);
    }

    function resolveStartupBacklogCount() {
      if (typeof getStartupBacklogCount !== 'function') return 0;
      const value = Number(getStartupBacklogCount());
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(20, Math.floor(value)));
    }

    async function refreshAudience() {
      if (!state.connected) {
        setTikTokLiveViewerCount(0);
        onlineUsers.tiktok.clear();
        renderOnlineUsers();
        return;
      }

      try {
        const response = await fetch('/api/tiktok/audience');
        if (!response.ok) return;

        const data = await response.json();
        if (data?.connected === false) {
          setTikTokLiveViewerCount(0);
          onlineUsers.tiktok.clear();
          renderOnlineUsers();
          return;
        }

        const viewerCount = Number(data?.viewerCount || 0);
        setTikTokLiveViewerCount(Number.isFinite(viewerCount) && viewerCount >= 0 ? viewerCount : 0);

        const backendTtlMs = Number(data?.ttlMs);
        if (Number.isFinite(backendTtlMs) && backendTtlMs >= 10000 && backendTtlMs <= 180000) {
          setTikTokOnlineUserTtlMs(backendTtlMs);
        }

        const now = Date.now();
        const lurkerCandidates = Array.isArray(data?.topViewers)
          ? data.topViewers.map((entry) => ({
            uniqueId: entry?.uniqueId,
            nickname: entry?.nickname,
            avatar: entry?.avatar || entry?.profilePictureUrl || null,
            source: 'topViewer',
            lastSeen: now
          }))
          : [];
        const activeCandidates = Array.isArray(data?.activeUsers) ? data.activeUsers : [];
        const candidates = [...lurkerCandidates, ...activeCandidates];

        const nextTikTokUsers = new Map();
        candidates.forEach((entry) => {
          const uniqueId = String(entry?.uniqueId || '').trim();
          if (!uniqueId) return;

          const source = String(entry?.source || '').trim().toLowerCase();
          if (source === 'member') return;

          const displayName = String(entry?.nickname || uniqueId);
          const avatar = entry?.avatar || entry?.profilePictureUrl || null;
          rememberUserProfile({
            username: uniqueId,
            platform: 'tiktok',
            displayName,
            avatar
          });

          const lastSeenRaw = Number(entry?.lastSeen);
          const lastSeen = Number.isFinite(lastSeenRaw) ? lastSeenRaw : now;
          const existing = nextTikTokUsers.get(uniqueId) || onlineUsers.tiktok.get(uniqueId) || {};
          nextTikTokUsers.set(uniqueId, {
            ...existing,
            displayName: getUserDisplayName(uniqueId, 'tiktok') || displayName,
            avatar,
            source,
            lastSeen
          });
        });

        if (typeof setPlatformUsers === 'function') {
          setPlatformUsers('tiktok', nextTikTokUsers, {
            emitLifecycleEvents: state.hasAudienceSnapshot
          });
        } else {
          onlineUsers.tiktok = nextTikTokUsers;
        }
        state.hasAudienceSnapshot = true;
        renderOnlineUsers();
      } catch (err) {
        console.warn('TikTok audience fetch failed:', err?.message || err);
      }
    }

    async function pollTikTokMessages(loopToken = state.pollLoopToken) {
      if (!state.connected || loopToken !== state.pollLoopToken) return;

      try {
        const response = await fetch('/api/tiktok/messages');
        const messages = await response.json();
        const isInitialPollCycle = state.isFirstPoll;

        state.lastPollTime = Date.now();
        if (!messages || messages.length === 0) {
          if (isInitialPollCycle) {
            const startupWindowOpen = state.startupSyncUntilMs > 0 && Date.now() < state.startupSyncUntilMs;
            if (startupWindowOpen) {
              if (!state.startupSyncAnnounced) {
                addChatMessage('SYSTEM', 'TikTok chat synced. Waiting for new messages...', 'tiktok', false);
                state.startupSyncAnnounced = true;
              }
              return;
            }
            state.isFirstPoll = false;
            if (!state.startupSyncAnnounced) {
              addChatMessage('SYSTEM', 'TikTok chat synced. Waiting for new messages...', 'tiktok', false);
              state.startupSyncAnnounced = true;
            }
            setPlatformSpeechSuppressed?.('tiktok', false);
          }
          return;
        }

        const getMessageId = (msg) => {
          if (msg.type === 'gift') {
            return `gift-${msg.author}-${msg.giftName}-${msg.repeatCount}-${msg.timestamp}`;
          }
          if (msg.type === 'follow') {
            return `follow-${msg.author}-${msg.timestamp}`;
          }
          if (msg.type === 'share') {
            return `share-${msg.author}-${msg.timestamp}`;
          }
          if (msg.type === 'emote') {
            const emoteId = msg.primaryEmoteId || (msg.emotes && msg.emotes[0]?.emoteId) || msg.emoteId;
            return `emote-${msg.author}-${emoteId}-${msg.timestamp}`;
          }
          if (msg.type === 'combined') {
            return `combined-${msg.author}-${msg.timestamp}`;
          }
          return `chat-${msg.author}-${msg.text || 'empty'}-${msg.timestamp}`;
        };

        const processMessage = async (msg, shouldSpeak = true, isFirstPoll = false) => {
          rememberUserProfile({
            username: msg.author,
            platform: 'tiktok',
            displayName: msg.authorName || msg.author,
            avatar: msg.authorAvatar || null
          });

          if (msg.type === 'gift') {
            const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
            addChatMessage(msg.author, giftText, 'tiktok', false, 'gift', false, undefined, {
              emitPresenceLifecycle: !isFirstPoll,
              broadcastOverlay: !isFirstPoll
            });
            if (typeof registerKnownGiftName === 'function') {
              registerKnownGiftName(msg.giftName);
            }

            if (!isFirstPoll) {
              const action = getGiftAction(msg.giftName, [msg.diamondUnitCount, msg.diamondCount]);
              if (action && action.type === 'animation' && action.value) {
                triggerAnimation(action.value, 'tiktok', msg.author);
              }

              const soundPath = typeof resolveSoundAlert === 'function'
                ? resolveSoundAlert({
                  type: 'gift',
                  giftName: msg.giftName,
                  diamondCount: msg.diamondCount,
                  diamondUnitCount: msg.diamondUnitCount
                })
                : '';

              if (soundPath) {
                playAlertSound?.(soundPath);
              } else if (action && action.type === 'sound' && action.value) {
                // Legacy compatibility for old gift mapping sound entries.
                playSpecificSound(action.value);
              }
            }
            return;
          }

          if (msg.type === 'follow') {
            addChatMessage(msg.author, '👤 followed your stream', 'tiktok', false, 'follow', false, undefined, {
              emitPresenceLifecycle: !isFirstPoll,
              broadcastOverlay: !isFirstPoll
            });

            if (!isFirstPoll) {
              const followTrigger = typeof getEventAnimationTrigger === 'function'
                ? getEventAnimationTrigger('follow')
                : '';
              if (followTrigger) {
                triggerAnimation(followTrigger, 'tiktok', msg.author, 'follow');
              }

              const followSound = typeof resolveSoundAlert === 'function'
                ? resolveSoundAlert({ type: 'follow' })
                : '';
              if (followSound) {
                playAlertSound?.(followSound);
              }
            }
            return;
          }

          if (msg.type === 'share') {
            addChatMessage(msg.author, '📤 shared your stream', 'tiktok', false, 'share', false, undefined, {
              emitPresenceLifecycle: !isFirstPoll,
              broadcastOverlay: !isFirstPoll
            });

            if (!isFirstPoll) {
              const shareTrigger = typeof getEventAnimationTrigger === 'function'
                ? getEventAnimationTrigger('share')
                : '';
              if (shareTrigger) {
                triggerAnimation(shareTrigger, 'tiktok', msg.author, 'share');
              }

              const shareSound = typeof resolveSoundAlert === 'function'
                ? resolveSoundAlert({ type: 'share' })
                : '';
              if (shareSound) {
                playAlertSound?.(shareSound);
              }
            }
            return;
          }

          if (msg.type === 'combined') {
            const emotes = Array.isArray(msg.emotes) ? msg.emotes : [];
            const stickersHTML = buildStickerChatListHtml(emotes);
            const combinedHTML = `${escapeHtml(msg.text)}${stickersHTML ? `<br>${stickersHTML}` : ''}`;
            addChatMessage(msg.author, combinedHTML, 'tiktok', false, 'combined', true, msg.text || '', {
              emitPresenceLifecycle: !isFirstPoll,
              broadcastOverlay: !isFirstPoll
            });

            if (!isFirstPoll && msg.text && typeof handleKeywordTriggers === 'function') {
              handleKeywordTriggers(msg.author, msg.text, 'tiktok');
            }

            if (!isFirstPoll && emotes.length > 0 && typeof handleStickerAnimation === 'function') {
              if (canUserTriggerAnimations(msg.author, 'tiktok')) {
                handleStickerAnimation({
                  type: 'emote',
                  author: msg.author,
                  authorName: msg.authorName,
                  emoteId: emotes[0].emoteId,
                  emoteName: `sticker_${emotes[0].emoteId}`,
                  emoteImage: emotes[0].emoteImage
                });
              }
            }
            return;
          }

          if (msg.type === 'emote') {
            const emotes = Array.isArray(msg.emotes) ? msg.emotes : [];
            if (emotes.length === 0) return;

            const stickersHTML = buildStickerChatListHtml(emotes);
            addChatMessage(msg.author, stickersHTML, 'tiktok', false, 'sticker', true, null, {
              emitPresenceLifecycle: !isFirstPoll,
              broadcastOverlay: !isFirstPoll
            });

            if (!isFirstPoll && typeof handleStickerAnimation === 'function') {
              if (canUserTriggerAnimations(msg.author, 'tiktok')) {
                const primaryId = msg.primaryEmoteId || emotes[0].emoteId;
                handleStickerAnimation({
                  type: 'emote',
                  author: msg.author,
                  authorName: msg.authorName,
                  emoteId: primaryId,
                  emoteName: `sticker_${primaryId}`,
                  emoteImage: emotes[0].emoteImage
                });
              }
            }
            return;
          }

          if (msg.text && msg.text.trim()) {
            if (!isFirstPoll && typeof handleKeywordTriggers === 'function') {
              handleKeywordTriggers(msg.author, msg.text, 'tiktok');
            }
            await autoAssignVoiceIfNeeded(msg.author, 'tiktok');
            if (shouldSpeak) {
              speakText(msg.author, msg.text, 'tiktok', true);
            } else {
              addChatMessage(msg.author, msg.text, 'tiktok', false, '', false, undefined, {
                emitPresenceLifecycle: !isFirstPoll,
                broadcastOverlay: !isFirstPoll
              });
            }
          }
        };

        if (isInitialPollCycle) {
          const startupBacklogCount = resolveStartupBacklogCount();
          messages.forEach((msg) => {
            rememberUserProfile({
              username: msg.author,
              platform: 'tiktok',
              displayName: msg.authorName || msg.author,
              avatar: msg.authorAvatar || null
            });
            state.seenMessages.add(getMessageId(msg));
          });

          for (let i = 0; i < messages.length; i++) {
            await processMessage(messages[i], false, true);
          }

          state.isFirstPoll = false;

          let replayed = 0;
          if (startupBacklogCount > 0) {
            const replayCandidates = messages
              .filter((msg) => {
                if (!msg) return false;
                if (msg.type === 'chat') return Boolean(msg.text && String(msg.text).trim());
                if (msg.type === 'combined') return Boolean(msg.text && String(msg.text).trim());
                return false;
              })
              .slice(-startupBacklogCount);

            for (const msg of replayCandidates) {
              await autoAssignVoiceIfNeeded(msg.author, 'tiktok');
              speakText(msg.author, msg.text, 'tiktok', false, { bypassSuppression: true });
              replayed += 1;
            }
          }

          if (replayed > 0) {
            addChatMessage('SYSTEM', `TikTok chat synced. Replaying last ${replayed} message${replayed === 1 ? '' : 's'}...`, 'tiktok', false);
          } else if (!state.startupSyncAnnounced) {
            addChatMessage('SYSTEM', 'TikTok chat synced. Waiting for new messages...', 'tiktok', false);
          }
          state.startupSyncAnnounced = true;
          setPlatformSpeechSuppressed?.('tiktok', false);
          return;
        }

        for (const msg of messages) {
          const msgId = getMessageId(msg);
          if (state.seenMessages.has(msgId)) continue;

          state.seenMessages.add(msgId);
          await processMessage(msg, true, false);
        }

        if (state.seenMessages.size > 1000) {
          const items = Array.from(state.seenMessages);
          state.seenMessages = new Set(items.slice(-1000));
        }
      } catch (err) {
        console.error('TikTok polling error:', err);
      } finally {
        if (state.connected && loopToken === state.pollLoopToken) {
          schedulePoll(loopToken, 2000);
        }
      }
    }

    async function connectToTikTok() {
      const username = normalizeTikTokUsernameInput(elements.tiktokUsernameInput.value);
      if (!username) {
        updateStatus('Enter TikTok username', false, true);
        return;
      }

      elements.tiktokUsernameInput.value = username;
      settingsStore.setItem('tiktok_username_cache', username);

      elements.connectTikTokBtn.disabled = true;
      updateStatus('Connecting to TikTok...', true);

      try {
        setPlatformSpeechSuppressed?.('tiktok', true);
        const response = await fetch('/api/tiktok/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        });

        const data = await response.json().catch(() => ({}));
        if (!data.success) {
          throw new Error(data.error || 'Connection failed');
        }

        state.connected = true;
        state.isFirstPoll = true;
        state.seenMessages.clear();
        state.hasAudienceSnapshot = false;
        state.startupSyncUntilMs = Date.now() + STARTUP_SYNC_WINDOW_MS;
        state.startupSyncAnnounced = false;
        state.pollLoopToken += 1;
        elements.disconnectTikTokBtn.disabled = false;
        clearOnlineUsers('tiktok');
        await refreshAudience();
        notifyConnectionState(true);

        requestWakeLock();
        updateStatus('TikTok connected', true);
        addChatMessage('SYSTEM', `Connected to @${data.username || username}`, 'tiktok', false);

        schedulePoll(state.pollLoopToken, 0);
      } catch (err) {
        setPlatformSpeechSuppressed?.('tiktok', false);
        updateStatus(`TikTok error: ${err.message}`, false, true);
        elements.connectTikTokBtn.disabled = false;
        notifyConnectionState(false);
      }
    }

    function disconnectTikTok() {
      setPlatformSpeechSuppressed?.('tiktok', false);
      state.connected = false;
      state.lastPollTime = Date.now();
      state.pollLoopToken += 1;
      state.hasAudienceSnapshot = false;
      state.startupSyncUntilMs = 0;
      state.startupSyncAnnounced = false;
      clearOnlineUsers('tiktok');
      stopPolling();

      releaseWakeLockIfIdle();

      elements.connectTikTokBtn.disabled = false;
      elements.disconnectTikTokBtn.disabled = true;
      notifyConnectionState(false);
      addChatMessage('SYSTEM', 'TikTok disconnected', 'tiktok', false);
      updateStatus(getYouTubeConnected() ? 'YouTube connected' : 'Ready to connect...');
    }

    function attachUiHandlers() {
      elements.connectTikTokBtn.addEventListener('click', connectToTikTok);
      elements.disconnectTikTokBtn.addEventListener('click', disconnectTikTok);
    }

    async function autoConnectFromSaved() {
      const username = elements.tiktokUsernameInput.value.trim();
      if (!username) return;
      console.log('Auto-connecting to TikTok...');
      await connectToTikTok();
    }

    return {
      attachUiHandlers,
      autoConnectFromSaved,
      refreshAudience,
      isConnected,
      disconnect: disconnectTikTok
    };
  }

  window.createTikTokController = createTikTokController;
})();

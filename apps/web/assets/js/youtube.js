(function initYouTubeModule() {
  function createYouTubeController(deps) {
    const {
      elements,
      getNextApiKey,
      rotateToNextKey,
      getApiKeyCount,
      saveSettings,
      updateStatus,
      addChatMessage,
      clearOnlineUsers,
      requestWakeLock,
      releaseWakeLockIfIdle,
      getUserDisplayName,
      rememberUserProfile,
      onlineUsers,
      renderOnlineUsers,
      autoAssignVoiceIfNeeded,
      speakText,
      getStartupBacklogCount,
      youtubeOnlineUserTtlMs,
      onConnectionStateChange
    } = deps;

    const state = {
      connected: false,
      liveChatId: null,
      nextPageToken: null,
      seenMessages: new Set(),
      isFirstPoll: true,
      lastPollTime: null,
      pollLoopToken: 0
    };

    function isConnected() {
      return state.connected;
    }

    function notifyConnectionState(connected) {
      if (typeof onConnectionStateChange === 'function') {
        onConnectionStateChange({ platform: 'youtube', connected: !!connected });
      }
    }

    function clearSavedStreamUrl() {
      elements.streamUrlInput.value = '';
      window.settingsStore.removeItem('yt_tts_stream_url');
    }

    function isUnavailableStreamError(error) {
      const message = (error?.message || '').toLowerCase();
      return message.includes('video not found')
        || message.includes('not a live stream')
        || message.includes('no active live chat')
        || message.includes('invalid youtube url')
        || message.includes('invalid stream url');
    }

    function extractVideoId(url) {
      const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
        /youtube\.com\/live\/([^&\n?#]+)/
      ];

      for (const pattern of patterns) {
        const match = String(url || '').match(pattern);
        if (match) return match[1];
      }
      return null;
    }

    function resolveStartupBacklogCount() {
      if (typeof getStartupBacklogCount !== 'function') return 0;
      const value = Number(getStartupBacklogCount());
      if (!Number.isFinite(value)) return 0;
      return Math.max(0, Math.min(20, Math.floor(value)));
    }

    function getYouTubeErrorMessage(errorData, fallback = '') {
      const nested = errorData?.error?.message;
      if (typeof nested === 'string' && nested.trim()) return nested;
      return String(fallback || '').trim();
    }

    function getYouTubeErrorReasons(errorData) {
      const reasons = Array.isArray(errorData?.error?.errors) ? errorData.error.errors : [];
      return reasons
        .map((entry) => String(entry?.reason || '').trim().toLowerCase())
        .filter(Boolean);
    }

    function shouldRotateKeyForYouTubeError(status, errorData) {
      if (getApiKeyCount() <= 1) return false;
      if (status !== 400 && status !== 403) return false;

      const message = getYouTubeErrorMessage(errorData).toLowerCase();
      const reasons = getYouTubeErrorReasons(errorData);
      const recoverableReasons = new Set([
        'quotaexceeded',
        'dailylimitexceeded',
        'dailylimitexceededunreg',
        'userratelimitexceeded',
        'ratelimitexceeded',
        'forbidden',
        'keyinvalid',
        'iprefererblocked',
        'ipblocked',
        'accessnotconfigured',
        'servicenotenabled',
        'apikeynotvalid'
      ]);

      if (reasons.some((reason) => recoverableReasons.has(reason))) return true;

      return message.includes('quota')
        || message.includes('forbidden')
        || message.includes('api key')
        || message.includes('key invalid')
        || message.includes('access not configured')
        || message.includes('service not enabled')
        || message.includes('daily limit');
    }

    async function getLiveChatId(videoId, apiKey) {
      const attempts = Math.max(1, getApiKeyCount());
      let keyToTry = apiKey || getNextApiKey();
      let lastError = null;

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          const response = await fetch(
            `/api/youtube/videos?part=liveStreamingDetails&id=${videoId}&key=${keyToTry}`
          );

          if (!response.ok) {
            let errorMessage = `API Error: ${response.status}`;
            let errorData = null;
            try {
              errorData = await response.json();
              errorMessage = getYouTubeErrorMessage(errorData, errorMessage);
            } catch (parseErr) {
              // keep generic message
            }
            if (shouldRotateKeyForYouTubeError(response.status, errorData) && rotateToNextKey()) {
              keyToTry = getNextApiKey();
              console.warn(`⚠️ /videos returned ${response.status}, rotating key and retrying...`);
              continue;
            }
            throw new Error(errorMessage);
          }

          const data = await response.json();
          if (!data.items || data.items.length === 0) {
            throw new Error('Video not found or not a live stream');
          }

          const liveChatId = data.items[0].liveStreamingDetails?.activeLiveChatId;
          if (!liveChatId) {
            throw new Error('No active live chat found');
          }

          return liveChatId;
        } catch (error) {
          lastError = error;
          const msg = String(error?.message || '').toLowerCase();
          const shouldRetry = (msg.includes('quota')
            || msg.includes('forbidden')
            || msg.includes('api key')
            || msg.includes('access not configured')) && rotateToNextKey();
          if (shouldRetry) {
            keyToTry = getNextApiKey();
            console.warn('⚠️ Retrying getLiveChatId with next API key...');
            continue;
          }
          throw error;
        }
      }

      throw lastError || new Error('Failed to get live chat ID');
    }

    async function findLiveStream(apiKey, input) {
      try {
        updateStatus('Searching for live streams...', true);

        let channelId = null;

        const channelIdMatch = String(input || '').match(/channel\/([^\/\?]+)/);
        const handleMatch = String(input || '').match(/@([^\/\?]+)/);

        if (channelIdMatch) {
          channelId = channelIdMatch[1];
          console.log('Using channel ID directly:', channelId);
        } else {
          let handle = handleMatch
            ? handleMatch[1]
            : String(input || '').replace(/^https?:\/\/(www\.)?youtube\.com\/?/i, '');
          handle = handle.replace(/^@/, '').trim();

          if (!handle) {
            throw new Error('Could not parse channel handle');
          }

          console.log('Looking up handle:', handle);

          let response = await fetch(
            `/api/youtube/channels?part=id&forHandle=${handle}&key=${apiKey}`
          );

          if (!response.ok && (response.status === 400 || response.status === 403)) {
            let errorData = null;
            try {
              errorData = await response.json();
            } catch (parseErr) {
              errorData = null;
            }
            if (shouldRotateKeyForYouTubeError(response.status, errorData)) {
              console.warn(`⚠️ Key issue on forHandle (${response.status}), rotating key...`);
              if (rotateToNextKey()) {
                apiKey = getNextApiKey();
                response = await fetch(
                  `/api/youtube/channels?part=id&forHandle=${handle}&key=${apiKey}`
                );
              }
            }
          }

          let data = response.ok ? await response.json() : null;
          if (!data || !data.items || data.items.length === 0) {
            console.log('forHandle returned nothing, trying forUsername...');
            response = await fetch(
              `/api/youtube/channels?part=id&forUsername=${handle}&key=${apiKey}`
            );

            if (!response.ok && (response.status === 400 || response.status === 403)) {
              let errorData = null;
              try {
                errorData = await response.json();
              } catch (parseErr) {
                errorData = null;
              }
              if (shouldRotateKeyForYouTubeError(response.status, errorData)) {
                console.warn(`⚠️ Key issue on forUsername (${response.status}), rotating key...`);
                if (rotateToNextKey()) {
                  apiKey = getNextApiKey();
                  response = await fetch(
                    `/api/youtube/channels?part=id&forUsername=${handle}&key=${apiKey}`
                  );
                }
              }
            }

            data = response.ok ? await response.json() : null;
          }

          if (!data || !data.items || data.items.length === 0) {
            throw new Error(`Channel "@${handle}" not found`);
          }

          channelId = data.items[0].id;
          console.log('Resolved channel ID:', channelId);
        }

        const searchResponse = await fetch(
          `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
        );

        if (!searchResponse.ok && (searchResponse.status === 400 || searchResponse.status === 403)) {
          let errorData = null;
          try {
            errorData = await searchResponse.json();
          } catch (parseErr) {
            errorData = null;
          }
          if (shouldRotateKeyForYouTubeError(searchResponse.status, errorData)) {
            console.warn(`⚠️ Key issue on search (${searchResponse.status}), rotating key...`);
            if (rotateToNextKey()) {
              apiKey = getNextApiKey();
              const retryResponse = await fetch(
                `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
              );
              if (!retryResponse.ok) {
                throw new Error('Failed to search after key rotation');
              }
              const retryData = await retryResponse.json();
              if (!retryData.items || retryData.items.length === 0) {
                throw new Error('No live streams found on this channel');
              }

              const liveVideo = retryData.items[0];
              const videoId = liveVideo.id.videoId;
              const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
              elements.streamUrlInput.value = videoUrl;
              saveSettings();
              updateStatus(`✓ Found: ${liveVideo.snippet.title}`, false);
              return videoUrl;
            }
            throw new Error('All API keys exhausted');
          }
        }

        if (!searchResponse.ok) {
          const err = await searchResponse.json();
          throw new Error(err.error?.message || 'Failed to search for live streams');
        }

        const searchData = await searchResponse.json();
        if (!searchData.items || searchData.items.length === 0) {
          throw new Error('No live streams found on this channel');
        }

        const liveVideo = searchData.items[0];
        const videoId = liveVideo.id.videoId;
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        elements.streamUrlInput.value = videoUrl;
        saveSettings();
        updateStatus(`✓ Found: ${liveVideo.snippet.title}`, false);

        return videoUrl;
      } catch (error) {
        console.error('Find stream error:', error);
        updateStatus(`${error.message}`, false, true);
        throw error;
      }
    }

    async function pollYouTubeMessages(isReconnect = false, loopToken = state.pollLoopToken) {
      if (!state.connected || !state.liveChatId || loopToken !== state.pollLoopToken) return;

      const apiKey = getNextApiKey();
      let url = `/api/youtube/liveChat/messages?liveChatId=${state.liveChatId}&part=snippet,authorDetails&key=${apiKey}`;

      if (state.nextPageToken) {
        url += `&pageToken=${state.nextPageToken}`;
      }

      try {
        const response = await fetch(url);

        if (!response.ok) {
          let errorData = null;
          try {
            errorData = await response.json();
          } catch (parseErr) {
            errorData = null;
          }
          if (shouldRotateKeyForYouTubeError(response.status, errorData)) {
            if (rotateToNextKey()) {
              setTimeout(() => pollYouTubeMessages(isReconnect, loopToken), 1000);
              return;
            }
          }
          throw new Error(getYouTubeErrorMessage(errorData, 'Error fetching messages'));
        }

        const data = await response.json();
        state.nextPageToken = data.nextPageToken;
        state.lastPollTime = Date.now();

        const messages = data.items || [];

        if (state.isFirstPoll && !isReconnect) {
          const now = Date.now();
          const cutoff = now - youtubeOnlineUserTtlMs;
          const startupBacklogCount = resolveStartupBacklogCount();

          messages.forEach((msg) => {
            state.seenMessages.add(msg.id);

            const author = msg?.authorDetails?.displayName;
            if (!author) return;

            const avatarUrl = msg?.authorDetails?.profileImageUrl || null;
            rememberUserProfile({
              username: author,
              platform: 'youtube',
              displayName: author,
              avatar: avatarUrl
            });

            const publishedAtMs = Date.parse(msg?.snippet?.publishedAt || '');
            const lastSeen = Number.isFinite(publishedAtMs) ? publishedAtMs : now;
            if (lastSeen < cutoff) return;

            const existing = onlineUsers.youtube.get(author) || {};
            onlineUsers.youtube.set(author, {
              ...existing,
              displayName: getUserDisplayName(author, 'youtube') || author,
              avatar: avatarUrl || existing.avatar || null,
              lastSeen
            });
          });

          renderOnlineUsers();
          state.isFirstPoll = false;
          console.log(`Initial sync: received ${messages.length} message(s), startup backlog=${startupBacklogCount}.`);

          let replayed = 0;
          if (startupBacklogCount > 0) {
            const replayCandidates = messages.slice(-startupBacklogCount);
            for (const msg of replayCandidates) {
              const author = msg?.authorDetails?.displayName;
              const text = msg?.snippet?.displayMessage;
              if (!author || !text) continue;
              await autoAssignVoiceIfNeeded(author, 'youtube');
              speakText(author, text, 'youtube');
              replayed += 1;
            }
          }

          if (replayed > 0) {
            addChatMessage('SYSTEM', `YouTube chat synced. Replaying last ${replayed} message${replayed === 1 ? '' : 's'}...`, 'youtube', false);
          } else {
            addChatMessage('SYSTEM', 'YouTube chat synced. Waiting for new messages...', 'youtube', false);
          }
        } else {
          for (const msg of messages) {
            if (state.seenMessages.has(msg.id)) continue;

            state.seenMessages.add(msg.id);
            const author = msg.authorDetails.displayName;
            const text = msg.snippet.displayMessage;
            const avatarUrl = msg.authorDetails.profileImageUrl;
            rememberUserProfile({
              username: author,
              platform: 'youtube',
              displayName: author,
              avatar: avatarUrl
            });

            const publishedAtMs = Date.parse(msg?.snippet?.publishedAt || '');
            const existing = onlineUsers.youtube.get(author) || {};
            onlineUsers.youtube.set(author, {
              ...existing,
              displayName: getUserDisplayName(author, 'youtube') || author,
              avatar: avatarUrl || existing.avatar || null,
              lastSeen: Number.isFinite(publishedAtMs) ? publishedAtMs : Date.now()
            });

            renderOnlineUsers();
            await autoAssignVoiceIfNeeded(author, 'youtube');
            speakText(author, text, 'youtube');
          }
        }

        const interval = data.pollingIntervalMillis || 5000;
        setTimeout(() => pollYouTubeMessages(false, loopToken), interval);
      } catch (error) {
        console.error('YouTube Poll Error:', error);
        updateStatus(`YouTube Poll Error: ${error.message}`, false, true);
        setTimeout(() => pollYouTubeMessages(false, loopToken), 10000);
      }
    }

    async function connectToYouTube() {
      console.log('▶ Connect YouTube requested');
      let url = elements.streamUrlInput.value.trim();
      const apiKey = getNextApiKey();

      if (!apiKey || getApiKeyCount() === 0) {
        updateStatus('Error: No API Keys added. Please type a key and press Enter.', false, true);
        elements.apiKeyTextInput.focus();
        return;
      }

      if (!url) {
        const channelUrl = elements.channelUrlInput.value.trim();
        if (channelUrl) {
          updateStatus('No stream URL set. Finding live stream from channel...', true);
          try {
            url = await findLiveStream(apiKey, channelUrl);
          } catch (error) {
            updateStatus(`YouTube error: ${error.message}`, false, true);
            return;
          }
        }
      }

      if (!url) {
        updateStatus('Enter YouTube stream URL or channel URL', false, true);
        return;
      }

      const videoId = extractVideoId(url);
      if (!videoId) {
        updateStatus('Invalid YouTube URL', false, true);
        return;
      }

      elements.connectYouTubeBtn.disabled = true;
      updateStatus('Connecting to YouTube...', true);

      try {
        state.liveChatId = await getLiveChatId(videoId, getNextApiKey());

        const now = Date.now();
        const isReconnect = state.lastPollTime && (now - state.lastPollTime < 120000);

        if (!isReconnect) {
          state.seenMessages.clear();
          state.isFirstPoll = true;
        }

        state.nextPageToken = null;
        state.connected = true;
        state.pollLoopToken += 1;
        elements.disconnectYouTubeBtn.disabled = false;
        clearOnlineUsers('youtube');
        notifyConnectionState(true);

        requestWakeLock();
        updateStatus('YouTube connected', true);
        addChatMessage('SYSTEM', 'Connected to YouTube stream', 'youtube', false);

        pollYouTubeMessages(isReconnect, state.pollLoopToken);
      } catch (error) {
        updateStatus(`YouTube error: ${error.message}`, false, true);
        elements.connectYouTubeBtn.disabled = false;
        notifyConnectionState(false);
      }
    }

    function disconnectYouTube() {
      state.connected = false;
      state.liveChatId = null;
      state.nextPageToken = null;
      state.lastPollTime = Date.now();
      state.pollLoopToken += 1;
      clearOnlineUsers('youtube');

      releaseWakeLockIfIdle();

      elements.connectYouTubeBtn.disabled = false;
      elements.disconnectYouTubeBtn.disabled = true;
      notifyConnectionState(false);

      addChatMessage('SYSTEM', 'YouTube disconnected', 'youtube', false);
      updateStatus('Ready to connect...');
    }

    async function autoConnectFromSaved() {
      const hasApiKey = getApiKeyCount() > 0;
      const streamUrl = elements.streamUrlInput.value.trim();
      const channelUrl = elements.channelUrlInput.value.trim();

      if (!hasApiKey) return;

      if (streamUrl) {
        console.log('Auto-connecting to YouTube with saved stream URL...');
        const videoId = extractVideoId(streamUrl);

        if (videoId) {
          try {
            await getLiveChatId(videoId, getNextApiKey());
            await connectToYouTube();
            return;
          } catch (error) {
            const shouldClearSavedUrl = isUnavailableStreamError(error);
            if (shouldClearSavedUrl) {
              console.log('Saved stream URL is unavailable, clearing and trying auto-find...', error.message);
              clearSavedStreamUrl();

              if (channelUrl) {
                try {
                  await findLiveStream(getNextApiKey(), channelUrl);
                  console.log('Auto-found stream, connecting...');
                  await connectToYouTube();
                  return;
                } catch (findError) {
                  console.log('Auto-find also failed:', findError.message);
                  updateStatus('No live stream found for auto-connect', false, false);
                }
              }
            } else {
              console.log('Saved stream URL check failed, keeping saved URL:', error.message);
            }
          }
        } else {
          console.log('Invalid stream URL format, clearing...');
          clearSavedStreamUrl();

          if (channelUrl) {
            try {
              await findLiveStream(getNextApiKey(), channelUrl);
              await connectToYouTube();
              return;
            } catch (error) {
              console.log('Auto-find failed:', error.message);
            }
          }
        }
      } else if (channelUrl) {
        console.log('No saved stream URL, trying to auto-find...');
        try {
          await findLiveStream(getNextApiKey(), channelUrl);
          await connectToYouTube();
        } catch (error) {
          console.log('Auto-find failed:', error.message);
        }
      }
    }

    function attachUiHandlers() {
      elements.findStreamBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        const apiKey = getNextApiKey();
        const channelUrl = elements.channelUrlInput.value.trim();

        if (!apiKey) {
          updateStatus('Enter API key first', false, true);
          return;
        }

        if (!channelUrl) {
          updateStatus('Enter channel URL first', false, true);
          return;
        }

        saveSettings();

        try {
          elements.findStreamBtn.disabled = true;
          elements.findStreamBtn.textContent = '🔄 Searching...';
          await findLiveStream(apiKey, channelUrl);
          updateStatus('Stream found!', false);
        } catch (error) {
          updateStatus('No live stream found', false, true);
        } finally {
          elements.findStreamBtn.disabled = false;
          elements.findStreamBtn.textContent = '🔍 Find';
        }
      });

      elements.connectYouTubeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        connectToYouTube();
      });
      elements.disconnectYouTubeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        disconnectYouTube();
      });
    }

    return {
      attachUiHandlers,
      autoConnectFromSaved,
      isConnected,
      saveSettings,
      disconnect: disconnectYouTube,
      findLiveStream,
      getLiveChatId,
      extractVideoId
    };
  }

  window.createYouTubeController = createYouTubeController;
})();

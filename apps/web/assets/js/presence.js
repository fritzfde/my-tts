(function initPresenceModule() {
  function createPresenceController({
    elements,
    ttlMsByPlatform,
    initialTikTokTtlMs,
    resolveDisplayName,
    onUserJoined,
    onUserLeft
  }) {
    const state = {
      onlineUsers: {
        youtube: new Map(),
        tiktok: new Map()
      },
      tiktokLiveViewerCount: 0,
      tiktokOnlineUserTtlMs: Number.isFinite(Number(initialTikTokTtlMs))
        ? Number(initialTikTokTtlMs)
        : Number(ttlMsByPlatform?.tiktok || 45000)
    };

    function formatUserSeenAgo(lastSeenTs) {
      const seconds = Math.max(0, Math.floor((Date.now() - lastSeenTs) / 1000));
      if (seconds < 60) return 'now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      return `${hours}h`;
    }

    function getPlatformTtlMs(platform) {
      if (platform === 'tiktok') return state.tiktokOnlineUserTtlMs;
      return Number(ttlMsByPlatform?.youtube || 120000);
    }

    function emitUserJoined(platform, username, data = {}) {
      if (typeof onUserJoined !== 'function') return;
      try {
        onUserJoined({
          platform,
          username,
          displayName: data?.displayName || username,
          avatar: data?.avatar || null,
          source: data?.source || '',
          lastSeen: data?.lastSeen || Date.now()
        });
      } catch (err) {
        console.warn('Presence join callback failed:', err);
      }
    }

    function emitUserLeft(platform, username, data = {}, reason = 'stale') {
      if (typeof onUserLeft !== 'function') return;
      try {
        onUserLeft({
          platform,
          username,
          displayName: data?.displayName || username,
          avatar: data?.avatar || null,
          source: data?.source || '',
          lastSeen: data?.lastSeen || 0,
          reason
        });
      } catch (err) {
        console.warn('Presence leave callback failed:', err);
      }
    }

    function pruneOnlineUsers() {
      ['youtube', 'tiktok'].forEach((platform) => {
        const cutoff = Date.now() - getPlatformTtlMs(platform);
        state.onlineUsers[platform].forEach((value, username) => {
          if (!value || value.lastSeen < cutoff) {
            state.onlineUsers[platform].delete(username);
            emitUserLeft(platform, username, value, 'stale');
          }
        });
      });
    }

    function renderPlatformList(platform, listEl, countEl) {
      if (!listEl || !countEl) return;

      const entries = Array.from(state.onlineUsers[platform].entries())
        .sort((a, b) => (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0));

      countEl.textContent = String(entries.length);
      if (platform === 'tiktok' && state.tiktokLiveViewerCount > 0) {
        countEl.title = `Showing ${entries.length} detected users (active + lurkers). Live viewer count: ${state.tiktokLiveViewerCount}`;
      } else {
        countEl.title = '';
      }

      if (entries.length === 0) {
        listEl.innerHTML = '<div class="online-users-empty">No users detected</div>';
        return;
      }

      listEl.innerHTML = entries.map(([username, data]) => {
        const displayName = resolveDisplayName({
          username,
          platform,
          displayName: data?.displayName
        });
        const avatar = data?.avatar || (window.userAvatars && window.userAvatars.get(`${platform}:${username}`));
        const avatarMarkup = avatar
          ? `<img src="${escapeAttribute(avatar)}" alt="${escapeAttribute(displayName)}" class="online-user-avatar">`
          : '<span class="online-user-avatar" style="display: inline-flex; align-items: center; justify-content: center; font-size: 0.65rem; background: rgba(255,255,255,0.14);">👤</span>';

        return `
          <div class="online-user-item" title="${escapeAttribute(username)}">
            ${avatarMarkup}
            <span class="online-user-name">${escapeHtml(displayName)}</span>
            <span class="online-user-time">${formatUserSeenAgo(data.lastSeen)}</span>
          </div>
        `;
      }).join('');
    }

    function render() {
      pruneOnlineUsers();

      renderPlatformList('youtube', elements.onlineYouTubeUsersEl, elements.onlineYouTubeCountEl);
      renderPlatformList('tiktok', elements.onlineTikTokUsersEl, elements.onlineTikTokCountEl);
    }

    function markUserOnline(username, platform, {
      displayName = '',
      avatar = null,
      lastSeen = Date.now(),
      emitLifecycleEvents = true
    } = {}) {
      if (!username || !platform || !state.onlineUsers[platform]) return;
      const isNewUser = !state.onlineUsers[platform].has(username);

      const resolvedDisplayName = resolveDisplayName({ username, platform, displayName });
      if (avatar) {
        window.userAvatars.set(`${platform}:${username}`, avatar);
      }

      const existing = state.onlineUsers[platform].get(username) || {};
      state.onlineUsers[platform].set(username, {
        ...existing,
        displayName: resolvedDisplayName,
        avatar: avatar || existing.avatar || null,
        lastSeen: Number.isFinite(Number(lastSeen)) ? Number(lastSeen) : Date.now()
      });

      if (isNewUser && emitLifecycleEvents !== false) {
        emitUserJoined(platform, username, {
          displayName: resolvedDisplayName,
          avatar: avatar || existing.avatar || null,
          source: existing?.source || '',
          lastSeen
        });
      }

      render();
    }

    function clearPlatform(platform) {
      if (!state.onlineUsers[platform]) return;
      state.onlineUsers[platform].clear();
      if (platform === 'tiktok') {
        state.tiktokLiveViewerCount = 0;
      }
      render();
    }

    function setTikTokViewerCount(value) {
      const num = Number(value);
      state.tiktokLiveViewerCount = Number.isFinite(num) && num >= 0 ? num : 0;
    }

    function getTikTokViewerCount() {
      return state.tiktokLiveViewerCount;
    }

    function setTikTokTtlMs(value) {
      const ttl = Number(value);
      if (Number.isFinite(ttl) && ttl >= 10000 && ttl <= 180000) {
        state.tiktokOnlineUserTtlMs = ttl;
      }
    }

    function getTikTokTtlMs() {
      return state.tiktokOnlineUserTtlMs;
    }

    function setPlatformUsers(platform, usersMap, options = {}) {
      if (!state.onlineUsers[platform] || !(usersMap instanceof Map)) return;
      const previous = state.onlineUsers[platform];
      const emitLifecycleEvents = options?.emitLifecycleEvents !== false;

      if (emitLifecycleEvents) {
        usersMap.forEach((data, username) => {
          if (!previous.has(username)) {
            emitUserJoined(platform, username, data);
          }
        });

        previous.forEach((data, username) => {
          if (!usersMap.has(username)) {
            emitUserLeft(platform, username, data, 'snapshot');
          }
        });
      }

      state.onlineUsers[platform] = usersMap;
    }

    return {
      onlineUsers: state.onlineUsers,
      render,
      markUserOnline,
      clearPlatform,
      setTikTokViewerCount,
      getTikTokViewerCount,
      setTikTokTtlMs,
      getTikTokTtlMs,
      getPlatformTtlMs,
      setPlatformUsers
    };
  }

  window.createPresenceController = createPresenceController;
})();

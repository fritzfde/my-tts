// Server-backed settings store (SQLite via backend API)
(function initSettingsStore() {
  const SETTINGS_SCOPE = new URLSearchParams(window.location.search).get('scope') || 'local-dev';
  const SETTINGS_SYNC_DEBOUNCE_MS = 400;
  let settingsSyncReady = false;
  let settingsSyncTimer = null;
  const settingsMap = new Map();

  function getSettingsSnapshot() {
    const snapshot = {};
    settingsMap.forEach((value, key) => {
      snapshot[key] = value;
    });
    return snapshot;
  }

  function buildSettingsPayload() {
    return {
      scope: SETTINGS_SCOPE,
      settings: getSettingsSnapshot()
    };
  }

  function persistSettingsToServer({ keepalive = false, preferBeacon = false } = {}) {
    const payload = buildSettingsPayload();
    const body = JSON.stringify(payload);

    if (preferBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/settings', blob)) {
          return Promise.resolve();
        }
      } catch (err) {
        console.warn('Failed to persist settings via sendBeacon, falling back to fetch:', err);
      }
    }

    return fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive
    }).catch((err) => {
      console.error('Failed to persist settings to server DB:', err);
    });
  }

  function flushSettingsSync({ onUnload = false } = {}) {
    if (!settingsSyncReady) return Promise.resolve();
    if (settingsSyncTimer) {
      clearTimeout(settingsSyncTimer);
      settingsSyncTimer = null;
    }
    return persistSettingsToServer({
      keepalive: onUnload,
      preferBeacon: onUnload
    });
  }

  function scheduleSettingsSync() {
    if (!settingsSyncReady) return;
    if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
    settingsSyncTimer = setTimeout(() => {
      settingsSyncTimer = null;
      persistSettingsToServer();
    }, SETTINGS_SYNC_DEBOUNCE_MS);
  }

  function loadSettingsFromServerSync() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `/api/settings?scope=${encodeURIComponent(SETTINGS_SCOPE)}`, false);
      xhr.send();

      if (xhr.status < 200 || xhr.status >= 300) {
        console.warn('Settings DB load failed:', xhr.status);
        return null;
      }

      const data = JSON.parse(xhr.responseText || '{}');
      if (!data.settings || typeof data.settings !== 'object') return {};
      return data.settings;
    } catch (err) {
      console.warn('Settings DB not available at startup, continuing with empty settings store:', err);
      return null;
    }
  }

  const settingsStore = {
    get length() {
      return settingsMap.size;
    },
    key(index) {
      return Array.from(settingsMap.keys())[index] || null;
    },
    getItem(key) {
      return settingsMap.has(key) ? settingsMap.get(key) : null;
    },
    setItem(key, value) {
      settingsMap.set(String(key), String(value));
      scheduleSettingsSync();
    },
    removeItem(key) {
      settingsMap.delete(String(key));
      scheduleSettingsSync();
    },
    clear() {
      settingsMap.clear();
      scheduleSettingsSync();
    },
    flush(options) {
      return flushSettingsSync(options);
    }
  };

  function hydrateSettingsStoreFromServer() {
    const serverSettings = loadSettingsFromServerSync();
    if (!serverSettings) return;

    settingsMap.clear();
    Object.entries(serverSettings).forEach(([key, value]) => {
      settingsMap.set(key, String(value));
    });
    console.log(`✓ Loaded ${settingsMap.size} settings from server DB`);
  }

  hydrateSettingsStoreFromServer();
  settingsSyncReady = true;

  window.addEventListener('pagehide', () => {
    void flushSettingsSync({ onUnload: true });
  });

  window.addEventListener('beforeunload', () => {
    void flushSettingsSync({ onUnload: true });
  });

  // Expose for app modules/scripts.
  window.SETTINGS_SCOPE = SETTINGS_SCOPE;
  window.settingsStore = settingsStore;
})();

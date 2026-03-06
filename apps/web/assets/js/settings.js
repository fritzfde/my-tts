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

  function persistSettingsToServer() {
    const payload = {
      scope: SETTINGS_SCOPE,
      settings: getSettingsSnapshot()
    };

    return fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch((err) => {
      console.error('Failed to persist settings to server DB:', err);
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

  // Expose for app modules/scripts.
  window.SETTINGS_SCOPE = SETTINGS_SCOPE;
  window.settingsStore = settingsStore;
})();

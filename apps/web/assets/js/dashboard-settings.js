(function initDashboardSettingsModule() {
  function createDashboardSettingsController({
    settingsStore,
    elements = {},
    defaults = {},
    callbacks = {}
  }) {
    const state = {
      initialized: false
    };

    const channelUrlInput = elements.channelUrlInput || null;
    const streamUrlInput = elements.streamUrlInput || null;
    const tiktokUsernameInput = elements.tiktokUsernameInput || null;
    const testMessageInput = elements.testMessageInput || null;
    const voicePreviewTextInput = elements.voicePreviewTextInput || null;
    const volumeSlider = elements.volumeSlider || null;
    const volumeValue = elements.volumeValue || null;
    const youtubeStartupBacklogInput = elements.youtubeStartupBacklogInput || null;
    const youtubeStartupBacklogLabel = elements.youtubeStartupBacklogLabel || null;
    const youtubeStartupBacklogDownBtn = elements.youtubeStartupBacklogDownBtn || null;
    const youtubeStartupBacklogUpBtn = elements.youtubeStartupBacklogUpBtn || null;

    function normalizeStartupBacklog(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return '0';
      const clamped = Math.max(0, Math.min(20, Math.floor(parsed)));
      return String(clamped);
    }

    function updateStartupBacklogLabel(value) {
      if (!youtubeStartupBacklogLabel) return;
      const normalized = Number(normalizeStartupBacklog(value));
      youtubeStartupBacklogLabel.textContent = `Play last ${normalized} chat messages on reload (YouTube + TikTok)`;
    }

    function loadSettings() {
      const savedKeys = settingsStore.getItem('yt_tts_api_keys');
      let nextApiKeys = [];
      if (savedKeys) {
        try {
          nextApiKeys = JSON.parse(savedKeys);
        } catch (e) {
          nextApiKeys = [];
        }
      } else {
        const legacy = settingsStore.getItem('yt_tts_api_key');
        if (legacy) {
          nextApiKeys = legacy.split(',').map((key) => key.trim()).filter((key) => key.length > 0);
        } else if (Array.isArray(defaults.defaultApiKeys)) {
          nextApiKeys = defaults.defaultApiKeys.slice();
        }
      }

      callbacks.setApiKeys?.(nextApiKeys);
      callbacks.renderApiKeyTags?.();

      const savedChannelUrl = settingsStore.getItem('yt_tts_channel_url');
      if (channelUrlInput) {
        channelUrlInput.value = savedChannelUrl || defaults.defaultChannelUrl || '';
      }

      const savedStreamUrl = settingsStore.getItem('yt_tts_stream_url');
      if (streamUrlInput && savedStreamUrl) {
        streamUrlInput.value = savedStreamUrl;
      }

      const savedTikTokUsername = settingsStore.getItem('tiktok_username_cache');
      if (tiktokUsernameInput && savedTikTokUsername) {
        tiktokUsernameInput.value = savedTikTokUsername;
      }

      const savedTestMessage = settingsStore.getItem('yt_tts_test_message');
      const unifiedTestMessage = savedTestMessage || defaults.defaultTestMessage || '';
      if (testMessageInput) {
        testMessageInput.value = unifiedTestMessage;
      }
      if (voicePreviewTextInput) {
        voicePreviewTextInput.value = unifiedTestMessage;
      }

      const savedVolume = settingsStore.getItem('yt_tts_volume');
      if (volumeSlider) {
        volumeSlider.value = savedVolume || defaults.defaultVolume || '100';
      }
      if (volumeValue && volumeSlider) {
        volumeValue.textContent = `${volumeSlider.value}%`;
      }

      const savedStartupBacklog = settingsStore.getItem('yt_tts_startup_backlog_count');
      if (youtubeStartupBacklogInput) {
        const normalized = normalizeStartupBacklog(
          savedStartupBacklog ?? defaults.defaultStartupBacklog ?? defaults.defaultYouTubeStartupBacklog ?? '0'
        );
        youtubeStartupBacklogInput.value = normalized;
        updateStartupBacklogLabel(normalized);
      }
    }

    function saveSettings() {
      const keys = callbacks.getApiKeys?.() || [];
      settingsStore.setItem('yt_tts_api_keys', JSON.stringify(keys));

      const channelUrl = channelUrlInput ? channelUrlInput.value.trim() : '';
      const streamUrl = streamUrlInput ? streamUrlInput.value.trim() : '';
      if (channelUrl) settingsStore.setItem('yt_tts_channel_url', channelUrl);
      if (streamUrl) settingsStore.setItem('yt_tts_stream_url', streamUrl);
      if (youtubeStartupBacklogInput) {
        settingsStore.setItem('yt_tts_startup_backlog_count', normalizeStartupBacklog(youtubeStartupBacklogInput.value));
      }
    }

    function bindChannelAndStream() {
      channelUrlInput?.addEventListener('change', saveSettings);
      streamUrlInput?.addEventListener('change', saveSettings);
    }

    function bindVolume() {
      if (!volumeSlider) return;
      volumeSlider.addEventListener('input', () => {
        if (volumeValue) {
          volumeValue.textContent = `${volumeSlider.value}%`;
        }
        settingsStore.setItem('yt_tts_volume', volumeSlider.value);
      });
    }

    function bindTestMessage() {
      if (!testMessageInput) return;
      testMessageInput.addEventListener('input', () => {
        settingsStore.setItem('yt_tts_test_message', testMessageInput.value);
        if (voicePreviewTextInput && voicePreviewTextInput.value !== testMessageInput.value) {
          voicePreviewTextInput.value = testMessageInput.value;
        }
      });
    }

    function bindStartupBacklog() {
      if (!youtubeStartupBacklogInput) return;
      const persist = () => {
        const normalized = normalizeStartupBacklog(youtubeStartupBacklogInput.value);
        youtubeStartupBacklogInput.value = normalized;
        settingsStore.setItem('yt_tts_startup_backlog_count', normalized);
        updateStartupBacklogLabel(normalized);
      };

      const adjust = (delta) => {
        const current = Number(normalizeStartupBacklog(youtubeStartupBacklogInput.value));
        const next = normalizeStartupBacklog(current + Number(delta || 0));
        youtubeStartupBacklogInput.value = next;
        settingsStore.setItem('yt_tts_startup_backlog_count', next);
        updateStartupBacklogLabel(next);
      };

      youtubeStartupBacklogInput.addEventListener('input', persist);
      youtubeStartupBacklogInput.addEventListener('change', persist);
      youtubeStartupBacklogInput.addEventListener('blur', persist);
      youtubeStartupBacklogDownBtn?.addEventListener('click', () => adjust(-1));
      youtubeStartupBacklogUpBtn?.addEventListener('click', () => adjust(1));
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      bindChannelAndStream();
      bindVolume();
      bindTestMessage();
      bindStartupBacklog();
    }

    return {
      state,
      init,
      loadSettings,
      saveSettings
    };
  }

  window.createDashboardSettingsController = createDashboardSettingsController;
})();

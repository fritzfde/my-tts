(function initStartupOrchestratorModule() {
  function createStartupOrchestratorController({
    callbacks = {},
    setIntervalFn,
    setTimeoutFn,
    clearIntervalFn,
    refreshOnlineUsersMs = 15000,
    refreshAudienceMs = 4000,
    autoConnectDelayMs = 1500
  }) {
    const callSetInterval = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval;
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const callClearInterval = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval;

    const state = {
      initialized: false,
      onlineUsersIntervalId: null,
      audienceIntervalId: null,
      autoConnectTimeoutId: null
    };

    function init() {
      if (state.initialized) return;
      state.initialized = true;

      callbacks.loadSettings?.();
      callbacks.loadUserVoices?.();
      callbacks.renderOnlineUsers?.();

      state.onlineUsersIntervalId = callSetInterval(() => {
        callbacks.renderOnlineUsers?.();
      }, refreshOnlineUsersMs);

      state.audienceIntervalId = callSetInterval(() => {
        if (!callbacks.isTikTokConnected?.()) return;
        const ttController = callbacks.getTikTokController?.();
        if (ttController && typeof ttController.refreshAudience === 'function') {
          void ttController.refreshAudience();
        }
      }, refreshAudienceMs);

      state.autoConnectTimeoutId = callSetTimeout(async () => {
        const ytController = callbacks.getYouTubeController?.();
        if (ytController && typeof ytController.autoConnectFromSaved === 'function') {
          await ytController.autoConnectFromSaved();
        }
        const ttController = callbacks.getTikTokController?.();
        if (ttController && typeof ttController.autoConnectFromSaved === 'function') {
          await ttController.autoConnectFromSaved();
        }
      }, autoConnectDelayMs);
    }

    function dispose() {
      if (state.onlineUsersIntervalId) {
        callClearInterval(state.onlineUsersIntervalId);
        state.onlineUsersIntervalId = null;
      }
      if (state.audienceIntervalId) {
        callClearInterval(state.audienceIntervalId);
        state.audienceIntervalId = null;
      }
      state.initialized = false;
    }

    return {
      state,
      init,
      dispose
    };
  }

  window.createStartupOrchestratorController = createStartupOrchestratorController;
})();

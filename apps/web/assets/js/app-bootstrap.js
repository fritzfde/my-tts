(function initAppBootstrapModule() {
  function createAppBootstrapController({ callbacks = {} }) {
    const state = {
      initialized: false
    };

    function init() {
      if (state.initialized) return;
      state.initialized = true;

      callbacks.loadHiddenVoices?.();
      callbacks.initVoiceUi?.();
      callbacks.afterVoiceUi?.();

      callbacks.initLanguageFilters?.();
      callbacks.afterLanguageFilters?.();

      callbacks.initOllamaGender?.();
      callbacks.initAudioRuntime?.();

      callbacks.afterInit?.();
    }

    return {
      state,
      init
    };
  }

  window.createAppBootstrapController = createAppBootstrapController;
})();

(function initOllamaGenderModule() {
  function createOllamaGenderController({
    windowRef,
    speechSynthesisRef,
    settingsStore,
    voicesController,
    elements = {},
    callbacks = {},
    fetchFn,
    setTimeoutFn,
    setIntervalFn,
    clearIntervalFn
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const speech = speechSynthesisRef || (win && win.speechSynthesis ? win.speechSynthesis : null);
    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const callSetInterval = typeof setIntervalFn === 'function' ? setIntervalFn : setInterval;
    const callClearInterval = typeof clearIntervalFn === 'function' ? clearIntervalFn : clearInterval;

    const state = {
      refreshIntervalId: null,
      initialized: false
    };

    function loadGenderCache() {
      voicesController.loadGenderCache();
    }

    function saveGenderCache() {
      voicesController.saveGenderCache();
    }

    function setOllamaStatus(online) {
      voicesController.setOllamaOnline(online);
      const statusEl = elements.ollamaStatusEl;
      if (!statusEl) return;

      statusEl.classList.remove('online', 'offline');
      if (online) {
        statusEl.classList.add('online');
        statusEl.textContent = 'Ollama: online (LLM detection active)';
      } else {
        statusEl.classList.add('offline');
        statusEl.textContent = 'Ollama: offline (start ollama serve to enable auto-detection)';
      }
    }

    async function refreshOllamaStatus() {
      if (!elements.ollamaStatusEl || !callFetch) return;

      const controller = new AbortController();
      const timeout = callSetTimeout(() => controller.abort(), 1800);

      try {
        const response = await callFetch('http://localhost:11434/api/tags', {
          method: 'GET',
          signal: controller.signal
        });
        setOllamaStatus(response.ok);
      } catch (error) {
        setOllamaStatus(false);
      } finally {
        clearTimeout(timeout);
      }
    }

    function populateGenderVoiceSelects() {
      const maleVoiceSelect = elements.maleVoiceSelect;
      const femaleVoiceSelect = elements.femaleVoiceSelect;
      if (!maleVoiceSelect || !femaleVoiceSelect) return;

      const savedMale = settingsStore.getItem('default_male_voice');
      const savedFemale = settingsStore.getItem('default_female_voice');
      const currentMale = maleVoiceSelect.value;
      const currentFemale = femaleVoiceSelect.value;

      const selectedMale = callbacks.populateVoiceSelectElement
        ? callbacks.populateVoiceSelectElement(maleVoiceSelect, savedMale || currentMale)
        : (savedMale || currentMale || '');
      const selectedFemale = callbacks.populateVoiceSelectElement
        ? callbacks.populateVoiceSelectElement(femaleVoiceSelect, savedFemale || currentFemale)
        : (savedFemale || currentFemale || '');

      const visibleSystemVoices = callbacks.getAllVoiceEntries
        ? callbacks.getAllVoiceEntries({ includeHidden: false }).filter((entry) => !entry.isCloned)
        : [];

      if (!savedMale && !currentMale) {
        const maleVoice = visibleSystemVoices.find((entry) => (
          /male|man|boy|david|mark|george|daniel|thomas/i.test(entry.name)
        ));
        if (maleVoice) maleVoiceSelect.value = maleVoice.id;
      }

      if (!savedFemale && !currentFemale) {
        const femaleVoice = visibleSystemVoices.find((entry) => (
          /female|woman|girl|samantha|victoria|zira|anna|karen|moira/i.test(entry.name)
        ));
        if (femaleVoice) femaleVoiceSelect.value = femaleVoice.id;
      }

      const finalMale = maleVoiceSelect.value || selectedMale;
      const finalFemale = femaleVoiceSelect.value || selectedFemale;
      if (!savedMale && finalMale) settingsStore.setItem('default_male_voice', finalMale);
      if (!savedFemale && finalFemale) settingsStore.setItem('default_female_voice', finalFemale);

      console.log('✓ Gender voice selects populated');
    }

    async function detectGenderWithLLM(username) {
      try {
        const gender = await voicesController.detectGenderWithLLM(username, {
          fetchFn: callFetch
        });
        if (gender) {
          console.log(`🤖 LLM detected: ${username} → ${gender}`);
        }
        return gender;
      } catch (error) {
        console.error('❌ LLM gender detection error:', error.message);
        return null;
      }
    }

    async function detectGender(username) {
      const cacheKey = String(username || '').toLowerCase();
      const cache = voicesController.state.genderCache || {};

      if (cache[cacheKey]) {
        console.log(`💾 Cached gender for ${username}: ${cache[cacheKey]}`);
        return cache[cacheKey];
      }

      const gender = await detectGenderWithLLM(username);
      if (!gender) return null;

      cache[cacheKey] = gender;
      saveGenderCache();
      return gender;
    }

    async function autoAssignVoiceIfNeeded(author, platform) {
      const autoGenderDetectionCheckbox = elements.autoGenderDetectionCheckbox;
      const maleVoiceSelect = elements.maleVoiceSelect;
      const femaleVoiceSelect = elements.femaleVoiceSelect;

      try {
        const result = await voicesController.autoAssignVoiceIfNeeded(author, platform, {
          autoEnabled: Boolean(autoGenderDetectionCheckbox && autoGenderDetectionCheckbox.checked),
          maleVoiceId: maleVoiceSelect ? maleVoiceSelect.value : '',
          femaleVoiceId: femaleVoiceSelect ? femaleVoiceSelect.value : '',
          detectGenderFn: detectGender,
          getVoiceName: callbacks.getVoiceName
        });
        if (result?.assigned) {
          const resolvedName = callbacks.getVoiceName ? callbacks.getVoiceName(result.voiceId) : result.voiceId;
          console.log(`✨ Auto-assigned ${result.gender} voice to ${author}: ${resolvedName}`);
        }
      } catch (error) {
        console.error('Auto-assign voice error:', error);
      }
    }

    function initGenderVoiceSelectPersistence() {
      const maleVoiceSelect = elements.maleVoiceSelect;
      const femaleVoiceSelect = elements.femaleVoiceSelect;

      if (maleVoiceSelect) {
        maleVoiceSelect.addEventListener('change', () => {
          settingsStore.setItem('default_male_voice', maleVoiceSelect.value);
          console.log('Saved default male voice:', maleVoiceSelect.value);
        });
      }

      if (femaleVoiceSelect) {
        femaleVoiceSelect.addEventListener('change', () => {
          settingsStore.setItem('default_female_voice', femaleVoiceSelect.value);
          console.log('Saved default female voice:', femaleVoiceSelect.value);
        });
      }
    }

    function initAutoDetectionPreference() {
      const autoGenderDetectionCheckbox = elements.autoGenderDetectionCheckbox;
      if (!autoGenderDetectionCheckbox) return;

      const savedPref = settingsStore.getItem('auto_gender_detection');
      if (savedPref === 'true') {
        autoGenderDetectionCheckbox.checked = true;
      }

      autoGenderDetectionCheckbox.addEventListener('change', () => {
        settingsStore.setItem('auto_gender_detection', autoGenderDetectionCheckbox.checked);
        console.log('Auto gender detection:', autoGenderDetectionCheckbox.checked ? 'enabled' : 'disabled');
        refreshOllamaStatus();
      });
    }

    function wireVoicesChangedHandler() {
      if (!speech) return;

      if (speech.onvoiceschanged !== undefined) {
        const originalVoicesChanged = speech.onvoiceschanged;
        speech.onvoiceschanged = () => {
          if (typeof originalVoicesChanged === 'function') originalVoicesChanged();
          callbacks.loadVoices?.();
          populateGenderVoiceSelects();
        };
      } else {
        callSetTimeout(populateGenderVoiceSelects, 1000);
      }
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;

      loadGenderCache();
      initGenderVoiceSelectPersistence();
      initAutoDetectionPreference();
      populateGenderVoiceSelects();
      refreshOllamaStatus();
      state.refreshIntervalId = callSetInterval(refreshOllamaStatus, 30000);
      wireVoicesChangedHandler();
    }

    function dispose() {
      if (state.refreshIntervalId) {
        callClearInterval(state.refreshIntervalId);
        state.refreshIntervalId = null;
      }
      state.initialized = false;
    }

    return {
      state,
      init,
      dispose,
      loadGenderCache,
      saveGenderCache,
      setOllamaStatus,
      refreshOllamaStatus,
      populateGenderVoiceSelects,
      detectGenderWithLLM,
      detectGender,
      autoAssignVoiceIfNeeded
    };
  }

  window.createOllamaGenderController = createOllamaGenderController;
})();

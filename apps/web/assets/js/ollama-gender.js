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
      initialized: false,
      activeModel: ''
    };
    const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

    const OLLAMA_MODEL_PREFERENCE = [
      'qwen2.5:7b-instruct',
      'qwen2.5:14b',
      'llama3:8b',
      'llama3',
      'qwen2.5:7b'
    ];

    function loadGenderCache() {
      voicesController.loadGenderCache();
    }

    function saveGenderCache() {
      voicesController.saveGenderCache();
    }

    function getSavedOllamaModel() {
      return String(settingsStore.getItem('ollama_gender_model') || '').trim();
    }

    function normalizeOllamaBaseUrl(value) {
      const raw = String(value || '').trim();
      if (!raw) return DEFAULT_OLLAMA_BASE_URL;

      const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
      return withProtocol.replace(/\/+$/, '');
    }

    function getSavedOllamaBaseUrl() {
      return normalizeOllamaBaseUrl(settingsStore.getItem('ollama_base_url'));
    }

    function saveOllamaBaseUrl(baseUrl) {
      settingsStore.setItem('ollama_base_url', normalizeOllamaBaseUrl(baseUrl));
    }

    function getOllamaBaseUrl() {
      return normalizeOllamaBaseUrl(
        elements.ollamaBaseUrlInput ? elements.ollamaBaseUrlInput.value : getSavedOllamaBaseUrl()
      );
    }

    function saveOllamaModel(model) {
      const normalized = String(model || '').trim();
      if (!normalized) return;
      settingsStore.setItem('ollama_gender_model', normalized);
    }

    function pickOllamaModel(modelNames = []) {
      const available = Array.isArray(modelNames)
        ? modelNames.map((name) => String(name || '').trim()).filter(Boolean)
        : [];
      if (available.length === 0) return '';

      const savedModel = getSavedOllamaModel();
      if (savedModel && available.includes(savedModel)) {
        return savedModel;
      }

      const preferred = OLLAMA_MODEL_PREFERENCE.find((name) => available.includes(name));
      return preferred || available[0];
    }

    function setOllamaStatus(online, model = '') {
      voicesController.setOllamaOnline(online);
      const statusEl = elements.ollamaStatusEl;
      if (!statusEl) return;

      const baseUrl = getOllamaBaseUrl();
      statusEl.classList.remove('online', 'offline');
      statusEl.title = baseUrl;
      if (online) {
        statusEl.classList.add('online');
        const label = String(model || '').trim();
        statusEl.textContent = label
          ? `Ollama: online (${label})`
          : 'Ollama: online (LLM detection active)';
      } else {
        statusEl.classList.add('offline');
        statusEl.textContent = `Ollama: offline (${baseUrl})`;
      }
    }

    async function refreshOllamaStatus() {
      if (!elements.ollamaStatusEl || !callFetch) return;

      const controller = new AbortController();
      const timeout = callSetTimeout(() => controller.abort(), 1800);

      try {
        const response = await callFetch(`${getOllamaBaseUrl()}/api/tags`, {
          method: 'GET',
          signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        const modelNames = Array.isArray(data?.models)
          ? data.models
            .map((entry) => String(entry?.name || '').trim())
            .filter(Boolean)
          : [];
        const activeModel = response.ok ? pickOllamaModel(modelNames) : '';
        state.activeModel = activeModel;
        if (activeModel) saveOllamaModel(activeModel);
        setOllamaStatus(Boolean(response.ok && activeModel), activeModel);
      } catch (error) {
        state.activeModel = '';
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
          fetchFn: callFetch,
          model: state.activeModel || getSavedOllamaModel() || undefined,
          baseUrl: getOllamaBaseUrl()
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

    function initOllamaBaseUrlPreference() {
      const baseUrlInput = elements.ollamaBaseUrlInput;
      if (!baseUrlInput) return;

      const savedBaseUrl = getSavedOllamaBaseUrl();
      baseUrlInput.value = savedBaseUrl;
      baseUrlInput.placeholder = DEFAULT_OLLAMA_BASE_URL;
      baseUrlInput.title = 'Ollama base URL';

      const persistBaseUrl = () => {
        const normalized = normalizeOllamaBaseUrl(baseUrlInput.value);
        baseUrlInput.value = normalized;
        saveOllamaBaseUrl(normalized);
        refreshOllamaStatus();
      };

      baseUrlInput.addEventListener('change', persistBaseUrl);
      baseUrlInput.addEventListener('blur', persistBaseUrl);
      baseUrlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          persistBaseUrl();
        }
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
      initOllamaBaseUrlPreference();
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

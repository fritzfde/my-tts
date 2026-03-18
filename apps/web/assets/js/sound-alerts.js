(function initSoundAlertsModule() {
  function createSoundAlertsController({
    windowRef,
    documentRef,
    settingsStore,
    elements = {},
    callbacks = {},
    fetchFn,
    confirmFn,
    setTimeoutFn,
    clearTimeoutFn,
    nowFn
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const callClearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout;
    const callNow = typeof nowFn === 'function' ? nowFn : Date.now;
    const callConfirm = typeof confirmFn === 'function'
      ? confirmFn
      : (win && typeof win.confirm === 'function' ? win.confirm.bind(win) : (() => true));

    const state = {
      initialized: false,
      customSounds: [],
      soundKeywords: {},
      soundKeywordEnabled: {},
      soundVoiceKeywordEnabled: {},
      soundVolumes: {},
      soundKeywordJob: null,
      soundKeywordGenerationPromise: null,
      rules: [],
      knownGiftNames: [],
      activeAudio: null,
      activeSoundPath: '',
      openSoundPickerRuleId: '',
      pendingDeleteSoundPath: '',
      pendingDeleteButton: null,
      pendingDeleteResetTimer: null,
      openSoundSettingsPath: '',
      keywordFilter: '',
      visitorHistory: {},
      activePresenceSessions: {},
      pendingLifecycleTimers: {}
    };

    const SOUND_ALERT_RULES_KEY = 'sound_alert_rules';
    const SOUND_KEYWORDS_KEY = 'sound_keyword_map';
    const SOUND_KEYWORDS_ENABLED_KEY = 'sound_keyword_enabled_map';
    const SOUND_VOICE_KEYWORDS_ENABLED_KEY = 'sound_voice_keyword_enabled_map';
    const SOUND_VOLUMES_KEY = 'sound_volume_map';
    const SOUND_KEYWORD_JOB_KEY = 'sound_keyword_generation_job';
    const SOUND_LIBRARY_KEYWORD_FILTER_KEY = 'sound_library_keyword_filter';
    const KNOWN_GIFT_NAMES_KEY = 'tiktok_known_gift_names';
    const VISITOR_HISTORY_KEY = 'presence_visitor_history';
    const LIFECYCLE_EVENT_TYPES = new Set(['join', 'leave']);
    const EVENT_TYPES = [
      { value: 'gift_any', label: 'Any gift' },
      { value: 'gift_name', label: 'Certain gift' },
      { value: 'gift_value', label: 'Gift diamond value' },
      { value: 'follow', label: 'New follower/subscriber' },
      { value: 'share', label: 'Stream share' },
      { value: 'join', label: 'Viewer joins stream' },
      { value: 'leave', label: 'Viewer leaves stream' }
    ];

    function normalizeGiftValue(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return '';
      return String(Math.floor(parsed));
    }

    function getEventConditionType(eventType) {
      if (eventType === 'gift_name') return 'gift_name';
      if (eventType === 'gift_value') return 'gift_value';
      return '';
    }

    function normalizeGiftName(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    }

    function normalizePresenceUserKey(platform, username) {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      const normalizedUsername = String(username || '').trim().toLowerCase();
      if (!normalizedPlatform || !normalizedUsername) return '';
      return `${normalizedPlatform}:${normalizedUsername}`;
    }

    function normalizeMinStaySeconds(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return 0;
      return Math.min(86400, Math.floor(parsed));
    }

    function isLifecycleEventType(eventType) {
      return LIFECYCLE_EVENT_TYPES.has(String(eventType || '').trim().toLowerCase());
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function normalizeSoundPath(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const withoutPrefix = raw.startsWith('custom-') ? raw.replace(/^custom-/, '') : raw;
      if (withoutPrefix.startsWith('/sounds/custom/')) {
        return withoutPrefix.replace('/sounds/custom/', '/sounds/');
      }
      return withoutPrefix;
    }

    function parseKeywordList(value) {
      const rawItems = Array.isArray(value)
        ? value
        : String(value || '').split(/[\n,]/);
      const keywords = [];
      rawItems.forEach((entry) => {
        const normalized = String(entry || '').trim();
        if (!normalized) return;
        if (keywords.some((item) => item.toLowerCase() === normalized.toLowerCase())) return;
        keywords.push(normalized);
      });
      return keywords;
    }

    function normalizeKeywordFilter(value) {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function isSupportedEventType(value) {
      return EVENT_TYPES.some((entry) => entry.value === value);
    }

    function createRule(seed = {}) {
      const eventType = isSupportedEventType(seed.eventType) ? seed.eventType : 'gift_any';
      const conditionType = getEventConditionType(eventType);
      let eventValue = '';
      if (conditionType === 'gift_name') {
        eventValue = String(seed.eventValue || '').trim();
      } else if (conditionType === 'gift_value') {
        eventValue = normalizeGiftValue(seed.eventValue || '');
      }
      const soundPath = normalizeSoundPath(seed.soundPath || seed.sound || seed.value || '');
      const enabled = seed.enabled !== false;
      const recurringOnly = isLifecycleEventType(eventType) ? seed.recurringOnly === true : false;
      const minStaySeconds = isLifecycleEventType(eventType)
        ? normalizeMinStaySeconds(seed.minStaySeconds)
        : 0;
      return {
        id: seed.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        eventValue,
        soundPath,
        enabled,
        recurringOnly,
        minStaySeconds
      };
    }

    function loadRules() {
      const raw = settingsStore.getItem(SOUND_ALERT_RULES_KEY);
      if (!raw) {
        state.rules = [];
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          state.rules = [];
          return;
        }
        state.rules = parsed.map((entry) => createRule(entry));
      } catch (err) {
        console.error('Failed to parse sound alert rules:', err);
        state.rules = [];
      }
    }

    function saveRules() {
      settingsStore.setItem(SOUND_ALERT_RULES_KEY, JSON.stringify(state.rules));
    }

    function loadSoundKeywords() {
      const raw = settingsStore.getItem(SOUND_KEYWORDS_KEY);
      if (!raw) {
        state.soundKeywords = {};
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, keywords]) => {
          const normalizedPath = normalizeSoundPath(soundPath);
          if (!normalizedPath) return;
          const normalizedKeywords = parseKeywordList(keywords);
          if (normalizedKeywords.length === 0) return;
          next[normalizedPath] = normalizedKeywords;
        });
        state.soundKeywords = next;
      } catch (err) {
        console.error('Failed to parse sound keywords:', err);
        state.soundKeywords = {};
      }
    }

    function saveSoundKeywords() {
      settingsStore.setItem(SOUND_KEYWORDS_KEY, JSON.stringify(state.soundKeywords));
    }

    function loadSoundKeywordEnabled() {
      const raw = settingsStore.getItem(SOUND_KEYWORDS_ENABLED_KEY);
      if (!raw) {
        state.soundKeywordEnabled = {};
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, enabled]) => {
          const normalizedPath = normalizeSoundPath(soundPath);
          if (!normalizedPath) return;
          next[normalizedPath] = enabled === true;
        });
        state.soundKeywordEnabled = next;
      } catch (err) {
        console.error('Failed to parse sound keyword enabled map:', err);
        state.soundKeywordEnabled = {};
      }
    }

    function saveSoundKeywordEnabled() {
      settingsStore.setItem(SOUND_KEYWORDS_ENABLED_KEY, JSON.stringify(state.soundKeywordEnabled));
    }

    function loadSoundVoiceKeywordEnabled() {
      const raw = settingsStore.getItem(SOUND_VOICE_KEYWORDS_ENABLED_KEY);
      if (!raw) {
        state.soundVoiceKeywordEnabled = {};
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, enabled]) => {
          const normalizedPath = normalizeSoundPath(soundPath);
          if (!normalizedPath) return;
          next[normalizedPath] = enabled === true;
        });
        state.soundVoiceKeywordEnabled = next;
      } catch (err) {
        console.error('Failed to parse sound voice keyword enabled map:', err);
        state.soundVoiceKeywordEnabled = {};
      }
    }

    function saveSoundVoiceKeywordEnabled() {
      settingsStore.setItem(SOUND_VOICE_KEYWORDS_ENABLED_KEY, JSON.stringify(state.soundVoiceKeywordEnabled));
    }

    function loadSoundVolumes() {
      const raw = settingsStore.getItem(SOUND_VOLUMES_KEY);
      if (!raw) {
        state.soundVolumes = {};
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([soundPath, value]) => {
          const normalizedPath = normalizeSoundPath(soundPath);
          const numeric = Number(value);
          if (!normalizedPath || !Number.isFinite(numeric)) return;
          next[normalizedPath] = Math.max(0, Math.min(100, Math.round(numeric)));
        });
        state.soundVolumes = next;
      } catch (err) {
        console.error('Failed to parse sound volume map:', err);
        state.soundVolumes = {};
      }
    }

    function saveSoundVolumes() {
      settingsStore.setItem(SOUND_VOLUMES_KEY, JSON.stringify(state.soundVolumes));
    }

    function loadSoundLibraryKeywordFilter() {
      state.keywordFilter = normalizeKeywordFilter(settingsStore.getItem(SOUND_LIBRARY_KEYWORD_FILTER_KEY));
      if (elements.soundLibraryKeywordFilterInput) {
        elements.soundLibraryKeywordFilterInput.value = state.keywordFilter;
      }
    }

    function saveSoundLibraryKeywordFilter() {
      settingsStore.setItem(SOUND_LIBRARY_KEYWORD_FILTER_KEY, state.keywordFilter);
    }

    function normalizeSoundKeywordJob(value) {
      const raw = value && typeof value === 'object' ? value : {};
      const pendingItems = Array.isArray(raw.pendingItems)
        ? raw.pendingItems
          .map((entry) => ({ kind: 'sound', soundPath: normalizeSoundPath(entry?.soundPath || entry) }))
          .filter((entry) => entry.soundPath)
        : [];
      const total = Number(raw.total);
      const normalizedTotal = Number.isFinite(total) && total >= pendingItems.length
        ? Math.floor(total)
        : pendingItems.length;
      return {
        pendingItems,
        total: normalizedTotal
      };
    }

    function loadSoundKeywordJob() {
      const raw = settingsStore.getItem(SOUND_KEYWORD_JOB_KEY);
      if (!raw) {
        state.soundKeywordJob = null;
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const job = normalizeSoundKeywordJob(parsed);
        state.soundKeywordJob = job.pendingItems.length > 0 ? job : null;
      } catch (err) {
        console.error('Failed to parse sound keyword job:', err);
        state.soundKeywordJob = null;
      }
    }

    function saveSoundKeywordJob() {
      if (!state.soundKeywordJob || !Array.isArray(state.soundKeywordJob.pendingItems) || state.soundKeywordJob.pendingItems.length === 0) {
        settingsStore.removeItem(SOUND_KEYWORD_JOB_KEY);
        state.soundKeywordJob = null;
        return;
      }

      settingsStore.setItem(SOUND_KEYWORD_JOB_KEY, JSON.stringify({
        pendingItems: state.soundKeywordJob.pendingItems,
        total: state.soundKeywordJob.total
      }));
    }

    function getSoundKeywordJobProgress() {
      const total = Number(state.soundKeywordJob?.total || 0);
      const remaining = Array.isArray(state.soundKeywordJob?.pendingItems) ? state.soundKeywordJob.pendingItems.length : 0;
      const completed = Math.max(0, total - remaining);
      return { total, remaining, completed };
    }

    function updateSoundKeywordGenerateButton() {
      const button = elements.soundLibraryGenerateBtn || null;
      if (!button) return;

      const { total, completed } = getSoundKeywordJobProgress();
      button.disabled = Boolean(state.soundKeywordGenerationPromise);
      if (total > 0) {
        button.textContent = state.soundKeywordGenerationPromise
          ? `Generating ${completed}/${total}`
          : `Resume ${completed}/${total}`;
        updateSoundKeywordToggleButtons();
        return;
      }

      button.textContent = '✨ Suggest Missing';
      updateSoundKeywordToggleButtons();
    }

    function getEligibleSoundKeywordPaths() {
      return state.customSounds
        .map((sound) => normalizeSoundPath(sound.path))
        .filter((soundPath) => soundPath && getSoundKeywords(soundPath).length > 0);
    }

    function getSoundKeywordToggleState(kind = 'viewer') {
      const eligiblePaths = getEligibleSoundKeywordPaths();
      const isEnabled = kind === 'voice'
        ? isSoundVoiceKeywordTriggerEnabled
        : isSoundKeywordTriggerEnabled;
      const enabledCount = eligiblePaths.filter((soundPath) => isEnabled(soundPath)).length;
      return {
        total: eligiblePaths.length,
        enabledCount,
        allEnabled: eligiblePaths.length > 0 && enabledCount === eligiblePaths.length
      };
    }

    function updateSoundKeywordToggleButtons() {
      [
        {
          button: elements.soundLibraryViewerKeywordToggleBtn || null,
          kind: 'viewer',
          label: 'viewer chat'
        },
        {
          button: elements.soundLibraryVoiceKeywordToggleBtn || null,
          kind: 'voice',
          label: 'voice'
        }
      ].forEach(({ button, kind, label }) => {
        if (!button) return;
        const { total, allEnabled } = getSoundKeywordToggleState(kind);
        button.disabled = Boolean(state.soundKeywordGenerationPromise) || total === 0;
        if (kind === 'viewer') {
          button.textContent = allEnabled ? 'Disable per-item viewer chat' : 'Enable per-item viewer chat';
          button.title = total > 0
            ? `${allEnabled ? 'Disable' : 'Enable'} per-sound viewer chat keyword triggers for all ${total} sound file(s) that already have keywords`
            : 'Generate or enter keywords first, then you can enable per-sound viewer chat triggers here';
          return;
        }
        button.textContent = allEnabled ? `Disable all ${label}` : `Enable all ${label}`;
        button.title = total > 0
          ? `${allEnabled ? 'Disable' : 'Enable'} ${label} keyword triggers for all ${total} sound file(s) that already have keywords`
          : `Generate or enter keywords first, then you can enable all ${label} triggers here`;
      });
    }

    function getSoundLabel(rawSoundPath = '') {
      const normalizedPath = normalizeSoundPath(rawSoundPath);
      if (!normalizedPath) return '';
      const match = state.customSounds.find((sound) => normalizeSoundPath(sound.path) === normalizedPath);
      if (match && String(match.name || '').trim()) {
        return String(match.name || '').trim();
      }
      return normalizedPath.split('/').pop() || normalizedPath;
    }

    function formatSoundCountdown(remainingSeconds = 0) {
      const numeric = Math.max(0, Number(remainingSeconds) || 0);
      if (numeric >= 60) {
        const minutes = Math.floor(numeric / 60);
        const seconds = Math.ceil(numeric % 60);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
      }
      if (numeric >= 10) {
        return `${Math.ceil(numeric)}s`;
      }
      return `${numeric.toFixed(1)}s`;
    }

    function updateFloatingSoundUi() {
      const container = elements.activeSoundFloating || null;
      const button = elements.activeSoundFloatingBtn || null;
      const settingsBtn = elements.activeSoundFloatingSettingsBtn || null;
      const nameEl = elements.activeSoundFloatingName || null;
      const countdownEl = elements.activeSoundFloatingCountdown || null;
      const progressFill = elements.activeSoundFloatingProgressFill || null;
      const audio = state.activeAudio;
      const soundPath = normalizeSoundPath(state.activeSoundPath);

      if (!container || !button || !nameEl || !countdownEl || !progressFill) return;

      if (!audio || !soundPath) {
        container.hidden = true;
        container.classList?.remove?.('is-visible');
        button.disabled = true;
        if (settingsBtn) settingsBtn.disabled = true;
        nameEl.textContent = '';
        countdownEl.textContent = '';
        progressFill.style.transform = 'scaleX(0)';
        updateActiveSoundCardUi();
        return;
      }

      const duration = Number(audio.duration);
      const currentTime = Number(audio.currentTime);
      const hasDuration = Number.isFinite(duration) && duration > 0;
      const safeCurrentTime = Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
      const remaining = hasDuration ? Math.max(0, duration - safeCurrentTime) : 0;
      const progress = hasDuration ? Math.max(0, Math.min(1, safeCurrentTime / duration)) : 0;

      container.hidden = false;
      container.classList?.add?.('is-visible');
      button.disabled = false;
      if (settingsBtn) settingsBtn.disabled = false;
      button.title = 'Click to stop the current sound';
      nameEl.textContent = getSoundLabel(soundPath);
      countdownEl.textContent = hasDuration ? formatSoundCountdown(remaining) : 'Playing';
      progressFill.style.transform = `scaleX(${progress.toFixed(4)})`;
      updateActiveSoundCardUi();
    }

    function updateActiveSoundCardUi() {
      const cardsEl = elements.soundLibraryCards || null;
      if (!cardsEl || typeof cardsEl.querySelectorAll !== 'function') return;
      const activeSoundPath = normalizeSoundPath(state.activeSoundPath);
      cardsEl.querySelectorAll('.sound-library-card[data-sound-path]').forEach((card) => {
        const cardPath = normalizeSoundPath(card.getAttribute('data-sound-path') || '');
        const isPlaying = Boolean(activeSoundPath) && cardPath === activeSoundPath;
        card.classList.toggle('playing', isPlaying);
      });
    }

    function bindActiveSoundEvents(audio) {
      if (!audio || audio.__soundFloatingBound === true) return;
      audio.__soundFloatingBound = true;

      const syncIfCurrent = () => {
        if (state.activeAudio !== audio) return;
        updateFloatingSoundUi();
      };

      if (typeof audio.addEventListener === 'function') {
        ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'error'].forEach((eventName) => {
          audio.addEventListener(eventName, syncIfCurrent);
        });
      }
    }

    function closeSoundSettings() {
      state.openSoundSettingsPath = '';
      const popup = elements.soundSettingsPopup || null;
      if (popup && popup.style) {
        popup.style.display = 'none';
      }
    }

    function syncSoundSettingsPopup() {
      const popup = elements.soundSettingsPopup || null;
      const soundPath = normalizeSoundPath(state.openSoundSettingsPath);
      if (!popup) return;

      if (!soundPath) {
        if (popup.style) popup.style.display = 'none';
        return;
      }

      if (popup.style) {
        popup.style.display = 'flex';
      }
      if (elements.soundSettingsName) {
        elements.soundSettingsName.textContent = getSoundLabel(soundPath);
      }
      if (elements.soundSettingsKeywords) {
        elements.soundSettingsKeywords.value = getSoundKeywords(soundPath).join('\n');
      }
      if (elements.soundSettingsVolume) {
        elements.soundSettingsVolume.value = String(getSoundVolume(soundPath));
      }
      if (elements.soundSettingsVolumeValue) {
        elements.soundSettingsVolumeValue.textContent = `${getSoundVolume(soundPath)}%`;
      }
      if (elements.soundSettingsViewerKeywordEnabled) {
        elements.soundSettingsViewerKeywordEnabled.checked = isSoundKeywordTriggerEnabled(soundPath);
      }
      if (elements.soundSettingsVoiceKeywordEnabled) {
        elements.soundSettingsVoiceKeywordEnabled.checked = isSoundVoiceKeywordTriggerEnabled(soundPath);
      }
      if (elements.soundSettingsPlayBtn) {
        elements.soundSettingsPlayBtn.disabled = false;
      }
      if (elements.soundSettingsGenerateKeywordsBtn) {
        elements.soundSettingsGenerateKeywordsBtn.disabled = false;
        elements.soundSettingsGenerateKeywordsBtn.textContent = '✨ Generate';
      }
    }

    function openSoundSettings(soundPath = '') {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) {
        closeSoundSettings();
        return;
      }
      clearPendingDeleteSoundConfirm();
      state.openSoundSettingsPath = normalizedPath;
      syncSoundSettingsPopup();
    }

    function saveSoundSettingsFromPopup() {
      const soundPath = normalizeSoundPath(state.openSoundSettingsPath);
      if (!soundPath) return false;

      setSoundKeywords(soundPath, parseKeywordList(elements.soundSettingsKeywords?.value || ''));
      setSoundVolume(soundPath, elements.soundSettingsVolume?.value ?? 100);
      setSoundKeywordTriggerEnabled(soundPath, Boolean(elements.soundSettingsViewerKeywordEnabled?.checked));
      setSoundVoiceKeywordTriggerEnabled(soundPath, Boolean(elements.soundSettingsVoiceKeywordEnabled?.checked));
      renderSoundCards();
      updateSoundKeywordToggleButtons();
      closeSoundSettings();
      return true;
    }

    async function generateKeywordsForSound(soundPath = '', { persist = true, quiet = false } = {}) {
      if (!callFetch) {
        throw new Error('Fetch is not available');
      }

      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return { soundPath: '', keywords: [], warning: '' };

      const response = await callFetch('/api/media-keywords/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ kind: 'sound', soundPath: normalizedPath }]
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Keyword generation failed');
      }

      const entry = Array.isArray(data.results)
        ? data.results.find((result) => normalizeSoundPath(result?.soundPath || '') === normalizedPath)
        : null;
      const keywords = parseKeywordList(entry?.keywords);

      if (persist) {
        if (keywords.length > 0) {
          setSoundKeywords(normalizedPath, keywords);
          if (!Object.prototype.hasOwnProperty.call(state.soundKeywordEnabled, normalizedPath)) {
            setSoundKeywordTriggerEnabled(normalizedPath, false);
          }
          if (!Object.prototype.hasOwnProperty.call(state.soundVoiceKeywordEnabled, normalizedPath)) {
            setSoundVoiceKeywordTriggerEnabled(normalizedPath, false);
          }
        }
        renderSoundCards();
        updateSoundKeywordToggleButtons();
      }

      if (!quiet) {
        callbacks.updateStatus?.(
          keywords.length > 0
            ? `✓ Generated keywords for ${getSoundLabel(normalizedPath)}`
            : `No keyword suggestions were generated for ${getSoundLabel(normalizedPath)}.`,
          false,
          keywords.length === 0
        );
      }

      return {
        soundPath: normalizedPath,
        keywords,
        warning: String(entry?.warning || '')
      };
    }

    function migrateLegacySoundKeywordEnabled() {
      let changed = false;
      Object.keys(state.soundKeywords).forEach((soundPath) => {
        if (Object.prototype.hasOwnProperty.call(state.soundKeywordEnabled, soundPath)) return;
        if (parseKeywordList(state.soundKeywords[soundPath]).length === 0) return;
        state.soundKeywordEnabled[soundPath] = true;
        changed = true;
      });
      if (changed) saveSoundKeywordEnabled();
    }

    function migrateLegacySoundVoiceKeywordEnabled() {
      let changed = false;
      Object.keys(state.soundKeywords).forEach((soundPath) => {
        if (Object.prototype.hasOwnProperty.call(state.soundVoiceKeywordEnabled, soundPath)) return;
        if (parseKeywordList(state.soundKeywords[soundPath]).length === 0) return;
        state.soundVoiceKeywordEnabled[soundPath] = true;
        changed = true;
      });
      if (changed) saveSoundVoiceKeywordEnabled();
    }

    function loadKnownGiftNames() {
      const raw = settingsStore.getItem(KNOWN_GIFT_NAMES_KEY);
      if (!raw) {
        state.knownGiftNames = [];
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          state.knownGiftNames = [];
          return;
        }
        const unique = Array.from(new Set(
          parsed
            .map((name) => String(name || '').trim())
            .filter(Boolean)
        ));
        unique.sort((a, b) => a.localeCompare(b));
        state.knownGiftNames = unique;
      } catch (err) {
        console.error('Failed to parse known TikTok gift names:', err);
        state.knownGiftNames = [];
      }
    }

    function saveKnownGiftNames() {
      settingsStore.setItem(KNOWN_GIFT_NAMES_KEY, JSON.stringify(state.knownGiftNames));
    }

    function loadVisitorHistory() {
      const raw = settingsStore.getItem(VISITOR_HISTORY_KEY);
      if (!raw) {
        state.visitorHistory = {};
        return;
      }

      try {
        const parsed = JSON.parse(raw);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([key, value]) => {
          const normalizedKey = String(key || '').trim().toLowerCase();
          if (!normalizedKey) return;
          const visits = Number(value?.visits);
          const lastSeen = Number(value?.lastSeen);
          next[normalizedKey] = {
            visits: Number.isFinite(visits) && visits > 0 ? Math.floor(visits) : 0,
            lastSeen: Number.isFinite(lastSeen) && lastSeen > 0 ? Math.floor(lastSeen) : 0
          };
        });
        state.visitorHistory = next;
      } catch (err) {
        console.error('Failed to parse visitor history:', err);
        state.visitorHistory = {};
      }
    }

    function saveVisitorHistory() {
      settingsStore.setItem(VISITOR_HISTORY_KEY, JSON.stringify(state.visitorHistory));
    }

    function registerGiftName(name) {
      const normalized = String(name || '').trim();
      if (!normalized) return false;

      const hasName = state.knownGiftNames.some(
        (candidate) => normalizeGiftName(candidate) === normalizeGiftName(normalized)
      );
      if (hasName) return false;

      state.knownGiftNames.push(normalized);
      state.knownGiftNames.sort((a, b) => a.localeCompare(b));
      saveKnownGiftNames();
      if (typeof callbacks.onKnownGiftNamesChanged === 'function') {
        callbacks.onKnownGiftNamesChanged(state.knownGiftNames.slice());
      }
      renderRules();
      return true;
    }

    function setKnownGiftNames(nextNames = []) {
      const merged = Array.from(new Set([
        ...state.knownGiftNames,
        ...nextNames
          .map((name) => String(name || '').trim())
          .filter(Boolean)
      ]));
      merged.sort((a, b) => a.localeCompare(b));
      state.knownGiftNames = merged;
      saveKnownGiftNames();
      if (typeof callbacks.onKnownGiftNamesChanged === 'function') {
        callbacks.onKnownGiftNamesChanged(state.knownGiftNames.slice());
      }
      renderRules();
    }

    function getKnownGiftNames() {
      return state.knownGiftNames.slice();
    }

    function getSoundKeywords(soundPath = '') {
      return parseKeywordList(state.soundKeywords[normalizeSoundPath(soundPath)] || []);
    }

    function setSoundKeywords(soundPath = '', keywords = []) {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      const normalizedKeywords = parseKeywordList(keywords);
      if (normalizedKeywords.length === 0) {
        delete state.soundKeywords[normalizedPath];
      } else {
        state.soundKeywords[normalizedPath] = normalizedKeywords;
      }
      saveSoundKeywords();
    }

    function isSoundKeywordTriggerEnabled(soundPath = '') {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return false;
      if (Object.prototype.hasOwnProperty.call(state.soundKeywordEnabled, normalizedPath)) {
        return state.soundKeywordEnabled[normalizedPath] === true;
      }
      return false;
    }

    function setSoundKeywordTriggerEnabled(soundPath = '', enabled = false) {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      state.soundKeywordEnabled[normalizedPath] = enabled === true;
      saveSoundKeywordEnabled();
    }

    function isSoundVoiceKeywordTriggerEnabled(soundPath = '') {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return false;
      if (Object.prototype.hasOwnProperty.call(state.soundVoiceKeywordEnabled, normalizedPath)) {
        return state.soundVoiceKeywordEnabled[normalizedPath] === true;
      }
      return false;
    }

    function setSoundVoiceKeywordTriggerEnabled(soundPath = '', enabled = false) {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      state.soundVoiceKeywordEnabled[normalizedPath] = enabled === true;
      saveSoundVoiceKeywordEnabled();
    }

    function getSoundVolume(soundPath = '') {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return 100;
      const numeric = Number(state.soundVolumes[normalizedPath]);
      if (!Number.isFinite(numeric)) return 100;
      return Math.max(0, Math.min(100, Math.round(numeric)));
    }

    function setSoundVolume(soundPath = '', value = 100) {
      const normalizedPath = normalizeSoundPath(soundPath);
      if (!normalizedPath) return;
      const numeric = Number(value);
      state.soundVolumes[normalizedPath] = Number.isFinite(numeric)
        ? Math.max(0, Math.min(100, Math.round(numeric)))
        : 100;
      saveSoundVolumes();
    }

    function pruneSoundKeywords() {
      const validPaths = new Set(state.customSounds.map((sound) => normalizeSoundPath(sound.path)));
      let changed = false;
      Object.keys(state.soundKeywords).forEach((soundPath) => {
        if (validPaths.has(soundPath)) return;
        delete state.soundKeywords[soundPath];
        changed = true;
      });
      if (changed) saveSoundKeywords();

      let enabledChanged = false;
      Object.keys(state.soundKeywordEnabled).forEach((soundPath) => {
        if (validPaths.has(soundPath)) return;
        delete state.soundKeywordEnabled[soundPath];
        enabledChanged = true;
      });
      if (enabledChanged) saveSoundKeywordEnabled();

      let voiceEnabledChanged = false;
      Object.keys(state.soundVoiceKeywordEnabled).forEach((soundPath) => {
        if (validPaths.has(soundPath)) return;
        delete state.soundVoiceKeywordEnabled[soundPath];
        voiceEnabledChanged = true;
      });
      if (voiceEnabledChanged) saveSoundVoiceKeywordEnabled();

      let volumeChanged = false;
      Object.keys(state.soundVolumes).forEach((soundPath) => {
        if (validPaths.has(soundPath)) return;
        delete state.soundVolumes[soundPath];
        volumeChanged = true;
      });
      if (volumeChanged) saveSoundVolumes();
    }

    function getSoundKeywordEntries() {
      return state.customSounds
        .map((sound) => ({
          soundPath: normalizeSoundPath(sound.path),
          keywords: getSoundKeywords(sound.path),
          viewerEnabled: isSoundKeywordTriggerEnabled(sound.path),
          voiceEnabled: isSoundVoiceKeywordTriggerEnabled(sound.path)
        }))
        .filter((entry) => entry.soundPath && entry.viewerEnabled && entry.keywords.length > 0);
    }

    function getAllSoundKeywordEntries() {
      return state.customSounds
        .map((sound) => ({
          soundPath: normalizeSoundPath(sound.path),
          keywords: getSoundKeywords(sound.path),
          viewerEnabled: isSoundKeywordTriggerEnabled(sound.path),
          voiceEnabled: isSoundVoiceKeywordTriggerEnabled(sound.path)
        }))
        .filter((entry) => entry.soundPath && entry.keywords.length > 0);
    }

    function getFilteredSoundCards() {
      const keywordFilter = normalizeKeywordFilter(
        elements.soundLibraryKeywordFilterInput?.value || state.keywordFilter
      );
      return state.customSounds.filter((sound) => {
        if (!keywordFilter) return true;
        const path = normalizeSoundPath(sound.path);
        const keywords = getSoundKeywords(path);
        const label = String(sound.name || '').trim() || path;
        const haystack = [label, path, ...keywords].join(' ').toLowerCase();
        return haystack.includes(keywordFilter);
      });
    }

    function getActiveLifecycleRules(eventType) {
      const normalizedEventType = String(eventType || '').trim().toLowerCase();
      return state.rules.filter((rule) => (
        rule.enabled !== false
        && rule.eventType === normalizedEventType
      ));
    }

    function hasActiveLifecycleRules(eventType) {
      return getActiveLifecycleRules(eventType).length > 0;
    }

    function hasConfiguredLifecycleRules(eventType) {
      const normalizedEventType = String(eventType || '').trim().toLowerCase();
      return state.rules.some((rule) => rule.eventType === normalizedEventType);
    }

    function resolveLifecycleAnimationTrigger(eventType) {
      if (typeof callbacks.resolveAnimationForRule !== 'function') return '';
      const value = callbacks.resolveAnimationForRule({ eventType: String(eventType || '').trim().toLowerCase() });
      if (Array.isArray(value)) {
        return String(value[0] || '').trim();
      }
      return String(value || '').trim();
    }

    function canTriggerLifecycleAnimation(username, platform) {
      if (typeof callbacks.canTriggerAnimation !== 'function') return true;
      return callbacks.canTriggerAnimation(username, platform) !== false;
    }

    function triggerLifecycleAnimation(event = {}) {
      const eventType = String(event.type || '').trim().toLowerCase();
      const platform = String(event.platform || '').trim().toLowerCase();
      const username = String(event.username || '').trim();
      const trigger = resolveLifecycleAnimationTrigger(eventType);
      if (!trigger || !platform || !username) return false;
      if (!canTriggerLifecycleAnimation(username, platform)) return false;
      callbacks.triggerAnimation?.(trigger, platform, username, eventType);
      return true;
    }

    function clearPendingLifecycleTimer(userKey) {
      const normalizedUserKey = String(userKey || '').trim().toLowerCase();
      if (!normalizedUserKey) return;
      const timerId = state.pendingLifecycleTimers[normalizedUserKey];
      if (!timerId) return;
      callClearTimeout(timerId);
      delete state.pendingLifecycleTimers[normalizedUserKey];
    }

    function buildLifecycleContext(event = {}, session = null) {
      const eventType = String(event.type || '').trim().toLowerCase();
      const platform = String(event.platform || '').trim().toLowerCase();
      const username = String(event.username || '').trim();
      const userKey = normalizePresenceUserKey(platform, username);
      const effectiveSession = session || state.activePresenceSessions[userKey] || null;
      const joinedAt = Number(effectiveSession?.joinedAt || 0);
      const recurring = Boolean(effectiveSession?.recurring);
      const staySeconds = joinedAt > 0
        ? Math.max(0, Math.floor((callNow() - joinedAt) / 1000))
        : 0;

      return {
        type: eventType,
        platform,
        username,
        displayName: String(event.displayName || effectiveSession?.displayName || username).trim() || username,
        avatar: event.avatar || effectiveSession?.avatar || null,
        userKey,
        isRecurring: recurring,
        staySeconds
      };
    }

    function doesLifecycleRuleMatch(rule, event = {}) {
      if (!rule || rule.enabled === false) return false;
      if (!isLifecycleEventType(rule.eventType) || rule.eventType !== event.type) return false;
      if (rule.recurringOnly && !event.isRecurring) return false;
      if (normalizeMinStaySeconds(rule.minStaySeconds) > Number(event.staySeconds || 0)) return false;
      return true;
    }

    function findMatchingLifecycleRule(event = {}) {
      return getActiveLifecycleRules(event.type).find((rule) => doesLifecycleRuleMatch(rule, event)) || null;
    }

    function getNextLifecycleDelayMs(event = {}) {
      const activeRules = getActiveLifecycleRules(event.type);
      const currentStay = Number(event.staySeconds || 0);
      const candidates = activeRules
        .filter((rule) => !rule.recurringOnly || event.isRecurring)
        .map((rule) => normalizeMinStaySeconds(rule.minStaySeconds) - currentStay)
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);

      if (candidates.length === 0) return 0;
      return Math.min(...candidates) * 1000;
    }

    function markVisitorSeen(platform, username) {
      const userKey = normalizePresenceUserKey(platform, username);
      if (!userKey) return { userKey: '', recurring: false };

      const previous = state.visitorHistory[userKey] || { visits: 0, lastSeen: 0 };
      const recurring = Number(previous.visits || 0) > 0;
      state.visitorHistory[userKey] = {
        visits: Math.max(0, Number(previous.visits || 0)) + 1,
        lastSeen: callNow()
      };
      saveVisitorHistory();
      return { userKey, recurring };
    }

    function playLifecycleRule(rule, event = {}) {
      if (!rule) return false;
      const playedAnimation = triggerLifecycleAnimation(event);
      const soundPath = normalizeSoundPath(rule.soundPath);
      const playedSound = soundPath ? playSound(soundPath) : false;
      return playedAnimation || playedSound;
    }

    function scheduleJoinLifecycleEvaluation(userKey, baseEvent = {}) {
      const normalizedUserKey = String(userKey || '').trim().toLowerCase();
      const session = state.activePresenceSessions[normalizedUserKey];
      if (!session || session.lifecycleHandled) return false;

      clearPendingLifecycleTimer(normalizedUserKey);
      const context = buildLifecycleContext(baseEvent, session);
      const delayMs = getNextLifecycleDelayMs(context);
      if (!delayMs) return false;

      state.pendingLifecycleTimers[normalizedUserKey] = callSetTimeout(() => {
        delete state.pendingLifecycleTimers[normalizedUserKey];
        const liveSession = state.activePresenceSessions[normalizedUserKey];
        if (!liveSession || liveSession.lifecycleHandled) return;

        const nextContext = buildLifecycleContext(baseEvent, liveSession);
        const matchingRule = findMatchingLifecycleRule(nextContext);
        if (matchingRule) {
          liveSession.lifecycleHandled = true;
          playLifecycleRule(matchingRule, nextContext);
          return;
        }

        scheduleJoinLifecycleEvaluation(normalizedUserKey, baseEvent);
      }, delayMs);

      return true;
    }

    function clearPresenceState(platform = '') {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      Object.keys(state.pendingLifecycleTimers).forEach((userKey) => {
        if (normalizedPlatform && !userKey.startsWith(`${normalizedPlatform}:`)) return;
        clearPendingLifecycleTimer(userKey);
      });
      Object.keys(state.activePresenceSessions).forEach((userKey) => {
        if (normalizedPlatform && !userKey.startsWith(`${normalizedPlatform}:`)) return;
        delete state.activePresenceSessions[userKey];
      });
    }

    function handleLifecycleEvent(event = {}) {
      const context = buildLifecycleContext(event);
      if (!isLifecycleEventType(context.type) || !context.userKey) return false;

      if (context.type === 'join') {
        const visit = markVisitorSeen(context.platform, context.username);
        const session = {
          joinedAt: callNow(),
          recurring: visit.recurring,
          displayName: context.displayName,
          avatar: context.avatar,
          lifecycleHandled: false
        };
        state.activePresenceSessions[visit.userKey] = session;
        clearPendingLifecycleTimer(visit.userKey);

        const joinContext = buildLifecycleContext(event, session);
        const matchingRule = findMatchingLifecycleRule(joinContext);
        if (matchingRule) {
          session.lifecycleHandled = true;
          return playLifecycleRule(matchingRule, joinContext);
        }

        if (hasConfiguredLifecycleRules('join')) {
          if (!hasActiveLifecycleRules('join')) return false;
          return scheduleJoinLifecycleEvaluation(visit.userKey, event);
        }

        session.lifecycleHandled = true;
        return triggerLifecycleAnimation(joinContext);
      }

      const existingSession = state.activePresenceSessions[context.userKey] || null;
      clearPendingLifecycleTimer(context.userKey);
      const leaveContext = buildLifecycleContext(event, existingSession);
      if (existingSession) {
        delete state.activePresenceSessions[context.userKey];
      }

      if (!hasConfiguredLifecycleRules('leave')) {
        return triggerLifecycleAnimation(leaveContext);
      }

      if (!hasActiveLifecycleRules('leave')) return false;
      const matchingRule = findMatchingLifecycleRule(leaveContext);
      if (!matchingRule) return false;
      return playLifecycleRule(matchingRule, leaveContext);
    }

    function getSoundLabel(soundPath = '') {
      const normalized = normalizeSoundPath(soundPath);
      if (!normalized) return 'No sound';

      const matched = state.customSounds.find((sound) => normalizeSoundPath(sound.path) === normalized);
      if (matched?.name) return matched.name;

      const filename = normalized.split('/').pop() || normalized;
      return filename;
    }

    function renderSoundPicker(rule) {
      const selectedPath = normalizeSoundPath(rule.soundPath);
      const selectedLabel = getSoundLabel(selectedPath);
      const isOpen = state.openSoundPickerRuleId === rule.id;
      const customOptionsMarkup = state.customSounds.map((sound) => {
        const path = normalizeSoundPath(sound.path);
        const label = String(sound.name || '').trim() || getSoundLabel(path);
        const selectedClass = path === selectedPath ? ' is-selected' : '';
        return `
          <div class="sound-alert-sound-option-row">
            <button
              type="button"
              class="sound-alert-sound-option${selectedClass}"
              data-action="select-sound-option"
              data-sound-path="${escapeAttribute(path)}"
              title="${escapeAttribute(label)}"
            >
              <span class="sound-alert-sound-option-label">${escapeHtml(label)}</span>
            </button>
            <button
              type="button"
              class="secondary sound-alert-sound-option-play"
              data-action="play-sound-option"
              data-sound-path="${escapeAttribute(path)}"
              title="Play ${escapeAttribute(label)}"
            >
              ▶
            </button>
          </div>
        `;
      }).join('');

      return `
        <div class="sound-alert-sound-picker${isOpen ? ' is-open' : ''}">
          <button
            type="button"
            class="secondary sound-alert-sound-trigger"
            data-action="toggle-sound-picker"
            aria-expanded="${isOpen ? 'true' : 'false'}"
            title="${escapeAttribute(selectedLabel)}"
          >
            <span class="sound-alert-sound-trigger-label">${escapeHtml(selectedLabel)}</span>
            <span class="sound-alert-sound-trigger-caret" aria-hidden="true">▾</span>
          </button>
          <div class="sound-alert-sound-menu">
            <div class="sound-alert-sound-option-row">
              <button
                type="button"
                class="sound-alert-sound-option${selectedPath ? '' : ' is-selected'}"
                data-action="select-sound-option"
                data-sound-path=""
                title="No sound"
              >
                <span class="sound-alert-sound-option-label">No sound</span>
              </button>
            </div>
            ${customOptionsMarkup || '<div class="sound-alert-sound-empty">No sounds uploaded</div>'}
          </div>
        </div>
      `;
    }

    function getRuleById(ruleId) {
      return state.rules.find((rule) => rule.id === ruleId) || null;
    }

    function resolveAnimationSummary(rule) {
      if (!rule || typeof callbacks.resolveAnimationForRule !== 'function') return '—';
      const value = callbacks.resolveAnimationForRule(rule);
      if (!value) return '—';
      if (Array.isArray(value)) {
        const filtered = value.map((entry) => String(entry || '').trim()).filter(Boolean);
        if (filtered.length === 0) return '—';
        if (filtered.length === 1) return filtered[0];
        return `${filtered[0]} +${filtered.length - 1}`;
      }
      return String(value);
    }

    function resolveAnimationTriggers(rule) {
      if (!rule || typeof callbacks.resolveAnimationForRule !== 'function') return [];
      const value = callbacks.resolveAnimationForRule(rule);
      if (!value) return [];
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
      }
      const normalized = String(value || '').trim();
      return normalized ? [normalized] : [];
    }

    function getAnimationTriggerOptions() {
      if (typeof callbacks.getAnimationTriggerOptions !== 'function') return [];
      const values = callbacks.getAnimationTriggerOptions();
      if (!Array.isArray(values)) return [];
      return values
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    }

    function toAnimationTriggerOptionsMarkup(selectedTrigger = '') {
      const selected = String(selectedTrigger || '').trim();
      const options = getAnimationTriggerOptions();
      const optionsMarkup = options.map((trigger) => {
        const isSelected = trigger === selected ? ' selected' : '';
        return `<option value="${escapeAttribute(trigger)}"${isSelected}>${escapeHtml(trigger)}</option>`;
      }).join('');
      return `<option value="">Select animation</option>${optionsMarkup}`;
    }

    function renderGiftNamesDataList() {
      const datalist = elements.soundAlertGiftNamesDatalist || null;
      if (!datalist) return;
      datalist.innerHTML = state.knownGiftNames
        .map((name) => `<option value="${escapeAttribute(name)}"></option>`)
        .join('');
    }

    function renderRules() {
      const tbody = elements.soundAlertRulesBody || null;
      if (!tbody) return;

      renderGiftNamesDataList();

      if (!Array.isArray(state.rules) || state.rules.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="sound-alert-empty-row">No alert rules yet. Add one below.</td>
          </tr>
        `;
        return;
      }

      const eventOptionsMarkup = EVENT_TYPES
        .map((entry) => `<option value="${entry.value}">${escapeHtml(entry.label)}</option>`)
        .join('');
      tbody.innerHTML = state.rules.map((rule) => {
        const conditionType = getEventConditionType(rule.eventType);
        let conditionCell = '<span class="sound-alert-muted">—</span>';
        if (conditionType === 'gift_name') {
          conditionCell = `
            <input
              type="text"
              data-field="eventValue"
              value="${escapeAttribute(rule.eventValue)}"
              list="soundAlertGiftNamesDatalist"
              placeholder="Gift name"
              class="sound-alert-gift-name-input"
            >
          `;
        } else if (conditionType === 'gift_value') {
          conditionCell = `
            <input
              type="number"
              data-field="eventValue"
              value="${escapeAttribute(rule.eventValue)}"
              min="1"
              step="1"
              placeholder="Diamond value"
              class="sound-alert-gift-name-input"
            >
          `;
        } else if (isLifecycleEventType(rule.eventType)) {
          conditionCell = `
            <div class="sound-alert-lifecycle-cell">
              <label class="sound-alert-toggle" title="Only trigger for users seen before in a previous visit.">
                <input type="checkbox" data-field="recurringOnly"${rule.recurringOnly ? ' checked' : ''}>
                <span>Recurring</span>
              </label>
              <label class="sound-alert-stay-field" title="Trigger only after the viewer stayed this many seconds. 0 means immediately.">
                <span>Stay</span>
                <input
                  type="number"
                  data-field="minStaySeconds"
                  value="${rule.minStaySeconds > 0 ? escapeAttribute(rule.minStaySeconds) : ''}"
                  min="0"
                  step="1"
                  placeholder="0"
                  class="sound-alert-stay-input"
                >
                <span>s</span>
              </label>
            </div>
          `;
        }

        const animationTriggers = resolveAnimationTriggers(rule);
        const primaryAnimationTrigger = animationTriggers[0] || '';
        const animationSummary = resolveAnimationSummary(rule);
        const animationOptionsMarkup = toAnimationTriggerOptionsMarkup(primaryAnimationTrigger);

        return `
          <tr data-rule-id="${escapeAttribute(rule.id)}"${rule.enabled ? '' : ' class="sound-alert-row-disabled"'}>
            <td>
              <select data-field="eventType" class="sound-alert-event-type">
                ${eventOptionsMarkup}
              </select>
            </td>
            <td class="sound-alert-enabled-cell">
              <label class="sound-alert-toggle sound-alert-enabled-toggle" title="Temporarily deactivate this alert rule without deleting it.">
                <input type="checkbox" data-field="enabled"${rule.enabled ? ' checked' : ''}>
                <span>${rule.enabled ? 'On' : 'Off'}</span>
              </label>
            </td>
            <td>${conditionCell}</td>
            <td>
              <div class="sound-alert-sound-cell">
                ${renderSoundPicker(rule)}
              </div>
            </td>
            <td>
              <div class="sound-alert-animation-cell">
                <select data-field="animationTrigger" class="sound-alert-animation-select" title="${escapeAttribute(animationSummary)}">
                  ${animationOptionsMarkup}
                </select>
              </div>
            </td>
            <td class="sound-alert-row-actions">
              <button type="button" class="secondary sound-alert-play-btn" data-action="play">▶ Play</button>
              <button type="button" class="secondary sound-alert-delete-btn" data-action="delete">Delete</button>
            </td>
          </tr>
        `;
      }).join('');

      state.rules.forEach((rule) => {
        const safeRuleId = String(rule.id || '').replace(/"/g, '\\"');
        const row = tbody.querySelector(`tr[data-rule-id="${safeRuleId}"]`);
        if (!row) return;

        const eventTypeSelect = row.querySelector('select[data-field="eventType"]');
        if (eventTypeSelect) {
          eventTypeSelect.value = rule.eventType;
        }

        const animationSelect = row.querySelector('select[data-field="animationTrigger"]');
        if (animationSelect) {
          const animationTriggers = resolveAnimationTriggers(rule);
          animationSelect.value = animationTriggers[0] || '';
        }
      });
    }

    function renderSoundCards() {
      const cardsEl = elements.soundLibraryCards || null;
      if (!cardsEl) return;
      clearPendingDeleteSoundConfirm();

      if (!Array.isArray(state.customSounds) || state.customSounds.length === 0) {
        cardsEl.innerHTML = '<div class="sound-library-empty">No custom sounds uploaded yet.</div>';
        updateSoundKeywordToggleButtons();
        return;
      }

      const filteredSounds = getFilteredSoundCards();
      if (filteredSounds.length === 0) {
        cardsEl.innerHTML = '<div class="sound-library-empty">No sounds match the current keyword filter.</div>';
        updateSoundKeywordToggleButtons();
        return;
      }

      cardsEl.innerHTML = filteredSounds.map((sound) => {
        const path = normalizeSoundPath(sound.path);
        const label = String(sound.name || '').trim() || path;
        const keywords = getSoundKeywords(path);
        const keywordEnabled = isSoundKeywordTriggerEnabled(path);
        const voiceKeywordEnabled = isSoundVoiceKeywordTriggerEnabled(path);
        const summaryParts = [];
        if (keywords.length > 0) {
          summaryParts.push(`${keywords.length} keyword${keywords.length === 1 ? '' : 's'}`);
          if (keywordEnabled) summaryParts.push('Viewer chat');
          if (voiceKeywordEnabled) summaryParts.push('Voice');
        }
        const summaryText = summaryParts.length > 0 ? summaryParts.join(' • ') : 'No keywords';

        return `
          <div class="sound-library-card${normalizeSoundPath(state.activeSoundPath) === path ? ' playing' : ''}" data-sound-path="${escapeAttribute(path)}" title="${escapeAttribute(label)}">
            <div class="sound-library-card-top">
              <button type="button" class="sound-library-card-main" data-action="play-card-sound" data-sound-path="${escapeAttribute(path)}">
                <span class="sound-library-card-name">${escapeHtml(label)}</span>
                <span class="sound-library-card-summary">${escapeHtml(summaryText)}</span>
                <span class="sound-library-card-stop-hint" aria-hidden="true">⏹ Stop</span>
              </button>
              <button
                type="button"
                class="secondary sound-library-card-settings"
                data-action="open-card-sound-settings"
                data-sound-path="${escapeAttribute(path)}"
                title="Sound settings"
                aria-label="Sound settings"
              >⚙</button>
              <button
                type="button"
                class="sound-library-card-delete"
                data-action="delete-card-sound"
                data-sound-path="${escapeAttribute(path)}"
                title="Delete sound"
                aria-label="Delete sound"
              >
                <span class="sound-library-card-delete-track" aria-hidden="true">
                  <span class="sound-library-card-delete-face">Delete</span>
                  <span class="sound-library-card-delete-face">✓</span>
                </span>
              </button>
            </div>
          </div>
        `;
      }).join('');
      syncSoundSettingsPopup();
      updateSoundKeywordToggleButtons();
      updateActiveSoundCardUi();
    }

    async function loadCustomSounds() {
      if (!callFetch) return;
      try {
        const response = await callFetch('/api/sounds/list');
        const data = await response.json();
        state.customSounds = (Array.isArray(data.custom) ? data.custom : [])
          .map((entry) => ({
            name: String(entry.name || '').trim(),
            path: normalizeSoundPath(entry.path)
          }))
          .filter((entry) => entry.name && entry.path)
          .sort((a, b) => a.name.localeCompare(b.name));

        pruneSoundKeywords();

        renderSoundCards();
        const validPaths = new Set(state.customSounds.map((sound) => normalizeSoundPath(sound.path)));
        if (state.openSoundSettingsPath && !validPaths.has(state.openSoundSettingsPath)) {
          closeSoundSettings();
        } else {
          syncSoundSettingsPopup();
        }
        renderRules();
        updateFloatingSoundUi();
      } catch (err) {
        console.error('Failed to load custom sounds:', err);
      }
    }

    function clearSoundReferences(soundPath) {
      const normalized = normalizeSoundPath(soundPath);
      if (!normalized) return;
      let changed = false;

      state.rules.forEach((rule) => {
        if (normalizeSoundPath(rule.soundPath) !== normalized) return;
        rule.soundPath = '';
        changed = true;
      });

      if (!changed) return;
      saveRules();
      renderRules();
    }

    function clearSoundKeywordReferences(soundPath) {
      const normalized = normalizeSoundPath(soundPath);
      if (!normalized) return;
      let changed = false;
      if (state.soundKeywords[normalized]) {
        delete state.soundKeywords[normalized];
        saveSoundKeywords();
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(state.soundKeywordEnabled, normalized)) {
        delete state.soundKeywordEnabled[normalized];
        saveSoundKeywordEnabled();
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(state.soundVoiceKeywordEnabled, normalized)) {
        delete state.soundVoiceKeywordEnabled[normalized];
        saveSoundVoiceKeywordEnabled();
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(state.soundVolumes, normalized)) {
        delete state.soundVolumes[normalized];
        saveSoundVolumes();
        changed = true;
      }
      return changed;
    }

    function getVolume() {
      if (typeof callbacks.getVolume === 'function') {
        const value = Number(callbacks.getVolume());
        if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
      }
      return 1;
    }

    function getCombinedSoundVolume(soundPath = '') {
      return getVolume() * (getSoundVolume(soundPath) / 100);
    }

    function stopActiveAudio() {
      const active = state.activeAudio;
      if (!active) return;
      try {
        if (typeof active.pause === 'function') {
          active.pause();
        }
        if (typeof active.currentTime === 'number') {
          active.currentTime = 0;
        }
      } catch (err) {
        console.warn('Failed to stop active sound preview:', err);
      } finally {
        if (state.activeAudio === active) {
          state.activeAudio = null;
          state.activeSoundPath = '';
        }
        updateFloatingSoundUi();
      }
    }

    function clearPendingDeleteSoundConfirm() {
      if (state.pendingDeleteResetTimer) {
        callClearTimeout(state.pendingDeleteResetTimer);
        state.pendingDeleteResetTimer = null;
      }

      const button = state.pendingDeleteButton;
      if (button && button.classList) {
        button.classList.remove('is-confirming');
        button.removeAttribute('aria-pressed');
        button.setAttribute('title', 'Delete sound');
      }

      state.pendingDeleteSoundPath = '';
      state.pendingDeleteButton = null;
    }

    function armDeleteSoundConfirm(button, soundPath) {
      if (!button || !soundPath) return;
      clearPendingDeleteSoundConfirm();

      state.pendingDeleteSoundPath = soundPath;
      state.pendingDeleteButton = button;
      button.classList.add('is-confirming');
      button.setAttribute('aria-pressed', 'true');
      button.setAttribute('title', 'Click again to delete');

      state.pendingDeleteResetTimer = callSetTimeout(() => {
        clearPendingDeleteSoundConfirm();
      }, 2500);
    }

    function playSound(rawSoundPath) {
      const soundPath = normalizeSoundPath(rawSoundPath);
      if (!soundPath) return false;
      if (!win || typeof win.Audio !== 'function') return false;

      try {
        stopActiveAudio();
        const audio = new win.Audio(soundPath);
        audio.volume = getCombinedSoundVolume(soundPath);
        state.activeAudio = audio;
        state.activeSoundPath = soundPath;
        bindActiveSoundEvents(audio);
        updateFloatingSoundUi();

        if (typeof audio.addEventListener === 'function') {
          const clearActiveIfCurrent = () => {
            if (state.activeAudio === audio) {
              state.activeAudio = null;
              state.activeSoundPath = '';
              updateFloatingSoundUi();
            }
          };
          audio.addEventListener('ended', clearActiveIfCurrent);
          audio.addEventListener('pause', clearActiveIfCurrent);
          audio.addEventListener('error', clearActiveIfCurrent);
        }

        audio.play().catch((err) => {
          if (state.activeAudio === audio) {
            state.activeAudio = null;
            state.activeSoundPath = '';
            updateFloatingSoundUi();
          }
          console.error('Sound play error:', err);
        });
        return true;
      } catch (err) {
        if (state.activeAudio) {
          state.activeAudio = null;
          state.activeSoundPath = '';
        }
        updateFloatingSoundUi();
        console.error('Failed to play sound:', err);
        return false;
      }
    }

    function buildMissingSoundKeywordItems() {
      return state.customSounds
        .map((sound) => normalizeSoundPath(sound.path))
        .filter((soundPath) => soundPath && getSoundKeywords(soundPath).length === 0)
        .map((soundPath) => ({ kind: 'sound', soundPath }));
    }

    function resolveSoundForEvent(event = {}) {
      const eventType = String(event.type || '').trim().toLowerCase();
      const activeRules = state.rules.filter((rule) => rule.enabled !== false);

      if (eventType === 'gift') {
        const giftNameKey = normalizeGiftName(event.giftName || event.gift || '');
        if (giftNameKey) {
          const specific = activeRules.find((rule) => (
            rule.eventType === 'gift_name'
            && normalizeGiftName(rule.eventValue) === giftNameKey
            && normalizeSoundPath(rule.soundPath)
          ));
          if (specific) return normalizeSoundPath(specific.soundPath);
        }

        const diamondCandidates = Array.from(new Set(
          [event.diamondCount, event.diamondUnitCount]
            .map((entry) => normalizeGiftValue(entry))
            .filter(Boolean)
        ));
        if (diamondCandidates.length > 0) {
          const byValue = activeRules.find((rule) => (
            rule.eventType === 'gift_value'
            && diamondCandidates.includes(normalizeGiftValue(rule.eventValue))
            && normalizeSoundPath(rule.soundPath)
          ));
          if (byValue) return normalizeSoundPath(byValue.soundPath);
        }

        const anyGift = activeRules.find((rule) => (
          rule.eventType === 'gift_any'
          && normalizeSoundPath(rule.soundPath)
        ));
        if (anyGift) return normalizeSoundPath(anyGift.soundPath);
      }

      if (eventType === 'follow' || eventType === 'share') {
        const direct = activeRules.find((rule) => (
          rule.eventType === eventType
          && normalizeSoundPath(rule.soundPath)
        ));
        if (direct) return normalizeSoundPath(direct.soundPath);
      }

      if (isLifecycleEventType(eventType)) {
        const matchingRule = findMatchingLifecycleRule({
          type: eventType,
          isRecurring: Boolean(event.isRecurring),
          staySeconds: Number(event.staySeconds || 0)
        });
        if (matchingRule && normalizeSoundPath(matchingRule.soundPath)) {
          return normalizeSoundPath(matchingRule.soundPath);
        }
      }

      return '';
    }

    function toggleSoundUploadDropState(enabled) {
      const uploadBtn = elements.soundLibraryUploadBtn || null;
      if (!uploadBtn || !uploadBtn.classList) return;
      uploadBtn.classList.toggle('is-drop-target', Boolean(enabled));
    }

    async function handleUploadSound(overrideFile = null) {
      const uploadInput = elements.soundLibraryUploadInput || null;
      const uploadBtn = elements.soundLibraryUploadBtn || null;
      if (!uploadInput || !uploadBtn || !callFetch) return;

      const file = overrideFile || uploadInput.files?.[0];
      if (!file) {
        callbacks.updateStatus?.('Select a sound file first', false, true);
        return;
      }

      const formData = new FormData();
      formData.append('sound', file);

      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';

        const response = await callFetch('/api/sounds/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Upload failed');
        }

        await loadCustomSounds();
        try {
          await generateKeywordsForSound(data.path || `/sounds/${data.filename}`, { persist: true, quiet: true });
        } catch (keywordErr) {
          console.warn('Sound keyword generation skipped after upload:', keywordErr);
        }
        callbacks.updateStatus?.(`✓ Sound uploaded: ${data.filename}`, false);
        uploadInput.value = '';
      } catch (err) {
        console.error('Sound upload failed:', err);
        callbacks.updateStatus?.(`Upload failed: ${err.message}`, false, true);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = '⬆️ Upload Sound';
      }
    }

    async function handleDeleteSound(soundPath = '') {
      if (!callFetch) return;
      const selectedPath = normalizeSoundPath(soundPath);
      if (!selectedPath) return;

      const filename = selectedPath.split('/').pop() || '';
      clearPendingDeleteSoundConfirm();
      if (state.openSoundSettingsPath === selectedPath) {
        closeSoundSettings();
      }

      try {
        const response = await callFetch(`/api/sounds/${encodeURIComponent(filename)}`, {
          method: 'DELETE'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Delete failed');
        }

        clearSoundReferences(selectedPath);
        clearSoundKeywordReferences(selectedPath);
        await loadCustomSounds();
        callbacks.updateStatus?.(`✓ Sound deleted: ${filename}`, false);
      } catch (err) {
        console.error('Sound delete failed:', err);
        callbacks.updateStatus?.(`Delete failed: ${err.message}`, false, true);
      }
    }

    async function generateMissingSoundKeywords({ resumeOnly = false } = {}) {
      if (!callFetch) return;
      if (state.soundKeywordGenerationPromise) return state.soundKeywordGenerationPromise;

      const job = state.soundKeywordJob && state.soundKeywordJob.pendingItems.length > 0
        ? state.soundKeywordJob
        : (resumeOnly
          ? null
          : (() => {
            const pendingItems = buildMissingSoundKeywordItems();
            if (pendingItems.length === 0) return null;
            return { pendingItems, total: pendingItems.length };
          })());

      if (!job) {
        if (!resumeOnly) {
          callbacks.updateStatus?.('No sounds need keyword suggestions.', false);
        }
        updateSoundKeywordGenerateButton();
        return;
      }

      state.soundKeywordJob = normalizeSoundKeywordJob(job);
      saveSoundKeywordJob();
      updateSoundKeywordGenerateButton();

      const runner = (async () => {
        let updatedCount = 0;
        let warningCount = 0;

        callbacks.updateStatus?.(
          `Generating keyword suggestions for ${state.soundKeywordJob.total} sound file(s)...`,
          false
        );

        while (state.soundKeywordJob && state.soundKeywordJob.pendingItems.length > 0) {
          updateSoundKeywordGenerateButton();
          const chunk = state.soundKeywordJob.pendingItems.slice(0, 25);
          const response = await callFetch('/api/media-keywords/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: chunk })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Keyword generation failed');
          }

          (Array.isArray(data.results) ? data.results : []).forEach((entry) => {
            const soundPath = normalizeSoundPath(entry?.soundPath || '');
            if (!soundPath) return;
            const keywords = parseKeywordList(entry?.keywords);
            if (keywords.length > 0) {
              setSoundKeywords(soundPath, keywords);
              if (!Object.prototype.hasOwnProperty.call(state.soundKeywordEnabled, soundPath)) {
                setSoundKeywordTriggerEnabled(soundPath, false);
              }
              if (!Object.prototype.hasOwnProperty.call(state.soundVoiceKeywordEnabled, soundPath)) {
                setSoundVoiceKeywordTriggerEnabled(soundPath, false);
              }
              updatedCount += 1;
            }
            if (entry?.warning) warningCount += 1;
          });

          state.soundKeywordJob.pendingItems = state.soundKeywordJob.pendingItems.slice(chunk.length);
          saveSoundKeywordJob();
        }

        renderSoundCards();
        callbacks.updateStatus?.(
          updatedCount > 0
            ? `✓ Suggested keywords for ${updatedCount} sound file(s)${warningCount ? ` (${warningCount} used filename fallback)` : ''}`
            : 'No sound keywords could be suggested.',
          false,
          updatedCount === 0
        );
      })().catch((err) => {
        console.error('Generate sound keywords failed:', err);
        callbacks.updateStatus?.(`Keyword generation failed: ${err.message}`, false, true);
      }).finally(() => {
        state.soundKeywordGenerationPromise = null;
        updateSoundKeywordGenerateButton();
      });

      state.soundKeywordGenerationPromise = runner;
      updateSoundKeywordGenerateButton();
      return runner;
    }

    function setAllSoundKeywordTriggers(kind = 'viewer', enabled = false) {
      const normalizedEnabled = enabled === true;
      const isEnabled = kind === 'voice'
        ? isSoundVoiceKeywordTriggerEnabled
        : isSoundKeywordTriggerEnabled;
      const setEnabled = kind === 'voice'
        ? setSoundVoiceKeywordTriggerEnabled
        : setSoundKeywordTriggerEnabled;
      let changedCount = 0;
      getEligibleSoundKeywordPaths().forEach((soundPath) => {
        if (isEnabled(soundPath) === normalizedEnabled) return;
        setEnabled(soundPath, normalizedEnabled);
        changedCount += 1;
      });

      renderSoundCards();
      if (changedCount > 0) {
        callbacks.updateStatus?.(
          `✓ ${normalizedEnabled ? 'Enabled' : 'Disabled'} ${kind === 'voice' ? 'voice' : 'viewer chat'} keyword triggers for ${changedCount} sound file(s).`,
          false
        );
      }
    }

    async function refreshKnownGiftsFromTikTok() {
      if (typeof callbacks.fetchKnownGiftNames !== 'function') return;
      try {
        const names = await callbacks.fetchKnownGiftNames();
        if (Array.isArray(names) && names.length > 0) {
          setKnownGiftNames(names);
        } else {
          renderRules();
        }
      } catch (err) {
        console.error('Failed to refresh TikTok gifts:', err);
      }
    }

    function bindEvents() {
      const addRuleBtn = elements.addSoundAlertRuleBtn || null;
      const rulesBody = elements.soundAlertRulesBody || null;
      const refreshGiftsBtn = elements.refreshTikTokGiftsBtn || null;
      const uploadBtn = elements.soundLibraryUploadBtn || null;
      const generateBtn = elements.soundLibraryGenerateBtn || null;
      const viewerKeywordToggleBtn = elements.soundLibraryViewerKeywordToggleBtn || null;
      const voiceKeywordToggleBtn = elements.soundLibraryVoiceKeywordToggleBtn || null;
      const keywordFilterInput = elements.soundLibraryKeywordFilterInput || null;
      const soundCards = elements.soundLibraryCards || null;
      const soundSettingsBackdrop = elements.soundSettingsPopupBackdrop || null;
      const soundSettingsSaveBtn = elements.soundSettingsSaveBtn || null;
      const soundSettingsCancelBtn = elements.soundSettingsCancelBtn || null;
      const soundSettingsPlayBtn = elements.soundSettingsPlayBtn || null;
      const soundSettingsGenerateKeywordsBtn = elements.soundSettingsGenerateKeywordsBtn || null;
      const soundSettingsVolume = elements.soundSettingsVolume || null;
      const activeSoundFloatingBtn = elements.activeSoundFloatingBtn || null;

      if (addRuleBtn) {
        addRuleBtn.addEventListener('click', () => {
          state.rules.push(createRule({ eventType: 'gift_any' }));
          saveRules();
          renderRules();
        });
      }

      if (refreshGiftsBtn) {
        refreshGiftsBtn.addEventListener('click', () => {
          void refreshKnownGiftsFromTikTok();
        });
      }

      if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
          if (uploadBtn.disabled) return;
          elements.soundLibraryUploadInput?.click();
        });
      }

      if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
          if (generateBtn.disabled) return;
          await generateMissingSoundKeywords();
        });
      }

      if (viewerKeywordToggleBtn) {
        viewerKeywordToggleBtn.addEventListener('click', () => {
          if (viewerKeywordToggleBtn.disabled) return;
          const { allEnabled } = getSoundKeywordToggleState('viewer');
          const nextEnabled = !allEnabled;
          const total = getSoundKeywordToggleState('viewer').total;
          const label = nextEnabled ? 'enable' : 'disable';
          if (!callConfirm(`Do you want to ${label} per-item viewer chat for all ${total} sound file(s) with keywords?`)) {
            return;
          }
          setAllSoundKeywordTriggers('viewer', nextEnabled);
        });
      }

      if (voiceKeywordToggleBtn) {
        voiceKeywordToggleBtn.addEventListener('click', () => {
          if (voiceKeywordToggleBtn.disabled) return;
          const { allEnabled } = getSoundKeywordToggleState('voice');
          const nextEnabled = !allEnabled;
          const total = getSoundKeywordToggleState('voice').total;
          const label = nextEnabled ? 'enable' : 'disable';
          if (!callConfirm(`Do you want to ${label} per-item voice triggers for all ${total} sound file(s) with keywords?`)) {
            return;
          }
          setAllSoundKeywordTriggers('voice', nextEnabled);
        });
      }

      if (keywordFilterInput) {
        keywordFilterInput.addEventListener('input', () => {
          state.keywordFilter = normalizeKeywordFilter(keywordFilterInput.value);
          saveSoundLibraryKeywordFilter();
          renderSoundCards();
        });
      }

      const uploadInput = elements.soundLibraryUploadInput || null;
      if (uploadInput) {
        uploadInput.addEventListener('change', () => {
          void handleUploadSound();
        });
      }

      if (uploadBtn) {
        ['dragenter', 'dragover'].forEach((eventName) => {
          uploadBtn.addEventListener(eventName, (event) => {
            event.preventDefault();
            toggleSoundUploadDropState(true);
          });
        });
        ['dragleave', 'dragend'].forEach((eventName) => {
          uploadBtn.addEventListener(eventName, () => {
            toggleSoundUploadDropState(false);
          });
        });
        uploadBtn.addEventListener('drop', (event) => {
          event.preventDefault();
          toggleSoundUploadDropState(false);
          const file = event.dataTransfer?.files?.[0];
          if (!file) return;
          void handleUploadSound(file);
        });
      }

      if (soundCards) {
        soundCards.addEventListener('click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;

          const actionButton = target.closest('button[data-action]');
          if (!actionButton) return;

          const soundPath = normalizeSoundPath(actionButton.getAttribute('data-sound-path') || '');
          const action = actionButton.getAttribute('data-action');
          if (!soundPath || !action) return;

          if (action === 'play-card-sound') {
            clearPendingDeleteSoundConfirm();
            if (normalizeSoundPath(state.activeSoundPath) === soundPath && state.activeAudio) {
              stopActiveAudio();
              return;
            }
            playSound(soundPath);
            return;
          }

          if (action === 'open-card-sound-settings') {
            openSoundSettings(soundPath);
            return;
          }

          if (action === 'delete-card-sound') {
            if (state.pendingDeleteSoundPath === soundPath) {
              void handleDeleteSound(soundPath);
              return;
            }
            armDeleteSoundConfirm(actionButton, soundPath);
          }
        });
      }

      if (soundSettingsBackdrop) {
        soundSettingsBackdrop.addEventListener('click', () => {
          closeSoundSettings();
        });
      }

      if (soundSettingsCancelBtn) {
        soundSettingsCancelBtn.addEventListener('click', () => {
          closeSoundSettings();
        });
      }

      if (soundSettingsSaveBtn) {
        soundSettingsSaveBtn.addEventListener('click', () => {
          saveSoundSettingsFromPopup();
        });
      }

      if (soundSettingsPlayBtn) {
        soundSettingsPlayBtn.addEventListener('click', () => {
          if (!state.openSoundSettingsPath) return;
          playSound(state.openSoundSettingsPath);
        });
      }

      if (soundSettingsGenerateKeywordsBtn) {
        soundSettingsGenerateKeywordsBtn.addEventListener('click', async () => {
          const soundPath = normalizeSoundPath(state.openSoundSettingsPath);
          if (!soundPath) return;
          soundSettingsGenerateKeywordsBtn.disabled = true;
          soundSettingsGenerateKeywordsBtn.textContent = 'Generating...';
          try {
            const result = await generateKeywordsForSound(soundPath, { persist: false, quiet: true });
            if (elements.soundSettingsKeywords) {
              elements.soundSettingsKeywords.value = result.keywords.join('\n');
            }
            if (result.keywords.length === 0) {
              callbacks.updateStatus?.(`No keyword suggestions were generated for ${getSoundLabel(soundPath)}.`, false, true);
            }
          } catch (err) {
            console.error('Sound popup keyword generation failed:', err);
            callbacks.updateStatus?.(`Keyword generation failed: ${err.message}`, false, true);
          } finally {
            if (elements.soundSettingsGenerateKeywordsBtn) {
              elements.soundSettingsGenerateKeywordsBtn.disabled = false;
              elements.soundSettingsGenerateKeywordsBtn.textContent = '✨ Generate';
            }
          }
        });
      }

      if (soundSettingsVolume) {
        soundSettingsVolume.addEventListener('input', () => {
          if (elements.soundSettingsVolumeValue) {
            elements.soundSettingsVolumeValue.textContent = `${Math.round(Number(soundSettingsVolume.value) || 0)}%`;
          }
        });
      }

      if (activeSoundFloatingBtn) {
        activeSoundFloatingBtn.addEventListener('click', () => {
          stopActiveAudio();
        });
      }

      const activeSoundFloatingSettingsBtn = elements.activeSoundFloatingSettingsBtn || null;
      if (activeSoundFloatingSettingsBtn) {
        activeSoundFloatingSettingsBtn.addEventListener('click', (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const soundPath = normalizeSoundPath(state.activeSoundPath);
          if (!soundPath) return;
          openSoundSettings(soundPath);
        });
      }

      if (doc) {
        doc.addEventListener('click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;

          if (state.openSoundPickerRuleId) {
            const picker = target.closest('.sound-alert-sound-picker');
            if (!picker) {
              state.openSoundPickerRuleId = '';
              renderRules();
            }
          }

          if (!state.pendingDeleteButton) return;
          const deleteButton = target.closest('.sound-library-card-delete');
          if (deleteButton === state.pendingDeleteButton) return;
          clearPendingDeleteSoundConfirm();
        });
      }

      if (rulesBody) {
        rulesBody.addEventListener('input', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          const input = target.closest('input[data-field]');
          if (!input) return;

          const row = input.closest('tr[data-rule-id]');
          const ruleId = row?.dataset?.ruleId || '';
          const rule = getRuleById(ruleId);
          if (!rule) return;

          const field = input.getAttribute('data-field');
          if (field === 'eventValue' && rule.eventType === 'gift_value') {
            rule.eventValue = normalizeGiftValue(input.value || '');
            if (String(input.value || '') !== rule.eventValue) {
              input.value = rule.eventValue;
            }
          } else if (field === 'eventValue') {
            rule.eventValue = String(input.value || '').trim();
          } else if (field === 'minStaySeconds') {
            rule.minStaySeconds = normalizeMinStaySeconds(input.value);
            if (String(input.value || '') !== (rule.minStaySeconds > 0 ? String(rule.minStaySeconds) : '')) {
              input.value = rule.minStaySeconds > 0 ? String(rule.minStaySeconds) : '';
            }
          }
          saveRules();
        });

        rulesBody.addEventListener('change', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          const field = target.getAttribute('data-field');
          if (!field) return;

          const row = target.closest('tr[data-rule-id]');
          const ruleId = row?.dataset?.ruleId || '';
          const rule = getRuleById(ruleId);
          if (!rule) return;

          if (field === 'eventType') {
            const nextType = String(target.value || 'gift_any');
            rule.eventType = isSupportedEventType(nextType) ? nextType : 'gift_any';
            const nextConditionType = getEventConditionType(rule.eventType);
            if (!nextConditionType) {
              rule.eventValue = '';
            } else if (nextConditionType === 'gift_value') {
              rule.eventValue = normalizeGiftValue(rule.eventValue);
            }
            if (!isLifecycleEventType(rule.eventType)) {
              rule.recurringOnly = false;
              rule.minStaySeconds = 0;
            }
            saveRules();
            renderRules();
            return;
          }

          if (field === 'soundPath') {
            rule.soundPath = normalizeSoundPath(target.value);
            saveRules();
            renderRules();
            return;
          }

          if (field === 'enabled') {
            rule.enabled = Boolean(target.checked);
            saveRules();
            renderRules();
            return;
          }

          if (field === 'animationTrigger') {
            const selectedAnimation = String(target.value || '').trim();
            const result = selectedAnimation
              ? callbacks.assignAnimationForRule?.(rule, selectedAnimation)
              : callbacks.clearAnimationForRule?.(rule);
            if (result === false) {
              renderRules();
              return;
            }
            if (result && typeof result === 'object' && result.ok === false) {
              callbacks.updateStatus?.(result.message || 'Failed to update animation', false, true);
              renderRules();
              return;
            }
            renderRules();
            return;
          }

          if (field === 'recurringOnly') {
            rule.recurringOnly = Boolean(target.checked);
            saveRules();
            return;
          }

          if (field === 'minStaySeconds') {
            rule.minStaySeconds = normalizeMinStaySeconds(target.value);
            if ('value' in target) {
              target.value = rule.minStaySeconds > 0 ? String(rule.minStaySeconds) : '';
            }
            saveRules();
          }
        });

        rulesBody.addEventListener('click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          const actionBtn = target.closest('button[data-action]');
          if (!actionBtn) return;

          const row = actionBtn.closest('tr[data-rule-id]');
          const ruleId = row?.dataset?.ruleId || '';
          const rule = getRuleById(ruleId);
          if (!rule) return;

          const action = actionBtn.getAttribute('data-action');
          if (action === 'toggle-sound-picker') {
            state.openSoundPickerRuleId = state.openSoundPickerRuleId === ruleId ? '' : ruleId;
            renderRules();
            return;
          }

          if (action === 'select-sound-option') {
            rule.soundPath = normalizeSoundPath(actionBtn.getAttribute('data-sound-path') || '');
            state.openSoundPickerRuleId = '';
            saveRules();
            renderRules();
            return;
          }

          if (action === 'play-sound-option') {
            playSound(actionBtn.getAttribute('data-sound-path') || '');
            return;
          }

          if (action === 'play') {
            playSound(rule.soundPath);
            return;
          }

          if (action === 'delete') {
            state.rules = state.rules.filter((entry) => entry.id !== ruleId);
            saveRules();
            renderRules();
          }
        });
      }

    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      loadRules();
      loadSoundKeywords();
      loadSoundKeywordEnabled();
      loadSoundVoiceKeywordEnabled();
      loadSoundVolumes();
      loadSoundLibraryKeywordFilter();
      loadSoundKeywordJob();
      migrateLegacySoundKeywordEnabled();
      migrateLegacySoundVoiceKeywordEnabled();
      loadKnownGiftNames();
      loadVisitorHistory();
      bindEvents();
      updateSoundKeywordGenerateButton();
      updateSoundKeywordToggleButtons();
      renderRules();
      updateFloatingSoundUi();
      void loadCustomSounds().then(() => generateMissingSoundKeywords({ resumeOnly: true }));
      void refreshKnownGiftsFromTikTok();
    }

    return {
      state,
      init,
      loadCustomSounds,
      renderRules,
      registerGiftName,
      setKnownGiftNames,
      getKnownGiftNames,
      getSoundKeywordEntries,
      getAllSoundKeywordEntries,
      getFilteredSoundCards,
      getSoundKeywords,
      getSoundLabel,
      getActiveSoundPath: () => state.activeSoundPath,
      stopActiveAudio,
      openSoundSettings,
      closeSoundSettings,
      saveSoundSettings: saveSoundSettingsFromPopup,
      generateKeywordsForSound,
      resolveSoundForEvent,
      handleLifecycleEvent,
      clearPresenceState,
      playSound,
      clearSoundReferences,
      normalizeSoundPath,
      loadVisitorHistory,
      saveVisitorHistory
    };
  }

  window.createSoundAlertsController = createSoundAlertsController;
})();

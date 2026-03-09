(function initVoicesModule() {
  function createVoicesController({ settingsStore }) {
    const VOICE_GROUP_ORDER = ['custom', 'en', 'de', 'es', 'uk', 'ru'];
    const VOICE_GROUP_LABELS = {
      custom: '🎙️ Custom Voices',
      en: '🇺🇸 English',
      de: '🇩🇪 German',
      es: '🇪🇸 Spanish',
      uk: '🇺🇦 Ukrainian',
      ru: '🇷🇺 Russian'
    };
    const DEFAULT_CLONED_LANGUAGE = 'en';
    const CLONED_VOICE_LANGUAGE_OPTIONS = [
      { code: 'en', label: 'English' },
      { code: 'de', label: 'German' },
      { code: 'es', label: 'Spanish' },
      { code: 'fr', label: 'French' },
      { code: 'it', label: 'Italian' },
      { code: 'pt', label: 'Portuguese' },
      { code: 'pl', label: 'Polish' },
      { code: 'tr', label: 'Turkish' },
      { code: 'ru', label: 'Russian' },
      { code: 'nl', label: 'Dutch' },
      { code: 'cs', label: 'Czech' },
      { code: 'ar', label: 'Arabic' },
      { code: 'zh-cn', label: 'Chinese (Simplified)' },
      { code: 'ja', label: 'Japanese' },
      { code: 'ko', label: 'Korean' },
      { code: 'hu', label: 'Hungarian' },
      { code: 'hi', label: 'Hindi' }
    ];
    const CLONED_VOICE_LANGUAGE_CODE_SET = new Set(
      CLONED_VOICE_LANGUAGE_OPTIONS.map((entry) => entry.code)
    );

    const state = {
      voices: [],
      clonedVoices: [],
      customVoiceLanguages: {},
      hiddenVoices: new Set(),
      enabledLanguages: new Set(VOICE_GROUP_ORDER.filter((code) => code !== 'custom')),
      userVoices: {},
      recentUsers: [],
      genderCache: {},
      ollamaOnline: false
    };

    function replaceArray(target, values) {
      target.length = 0;
      if (!Array.isArray(values)) return;
      values.forEach((value) => target.push(value));
    }

    function replaceObject(target, source) {
      Object.keys(target).forEach((key) => delete target[key]);
      Object.entries(source || {}).forEach(([key, value]) => {
        target[key] = value;
      });
    }

    function replaceSet(target, values) {
      target.clear();
      values.forEach((value) => target.add(value));
    }

    function getVoiceLanguageCode(lang) {
      const code = String(lang || '').toLowerCase().substring(0, 2);
      return VOICE_GROUP_ORDER.includes(code) ? code : null;
    }

    function normalizeClonedLanguageCode(language) {
      const candidate = String(language || '').trim().toLowerCase().replace('_', '-');
      if (!candidate) return DEFAULT_CLONED_LANGUAGE;
      if (candidate === 'zh') return 'zh-cn';
      if (CLONED_VOICE_LANGUAGE_CODE_SET.has(candidate)) return candidate;
      return DEFAULT_CLONED_LANGUAGE;
    }

    function buildVoiceGroups({ includeHidden = true, ignoreLanguageFilters = false } = {}) {
      const grouped = new Map();
      VOICE_GROUP_ORDER.forEach((groupKey) => grouped.set(groupKey, []));

      const sortedClonedVoices = [...state.clonedVoices].sort((a, b) => (
        String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
      ));

      sortedClonedVoices.forEach((voiceName) => {
        const voiceId = `cloned-${voiceName}`;
        const isHidden = state.hiddenVoices.has(voiceId);
        if (!includeHidden && isHidden) return;
        grouped.get('custom').push({
          id: voiceId,
          name: voiceName,
          groupKey: 'custom',
          isCloned: true,
          isHidden
        });
      });

      state.voices.forEach((voice, index) => {
        const groupKey = getVoiceLanguageCode(voice.lang);
        if (!groupKey) return;
        if (!ignoreLanguageFilters && state.enabledLanguages.size > 0 && !state.enabledLanguages.has(groupKey)) return;

        const voiceId = `system-${index}`;
        const isHidden = state.hiddenVoices.has(voiceId);
        if (!includeHidden && isHidden) return;

        grouped.get(groupKey).push({
          id: voiceId,
          name: voice.name,
          groupKey,
          isCloned: false,
          isHidden
        });
      });

      grouped.forEach((groupVoices) => {
        groupVoices.sort((a, b) => (
          String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true })
        ));
      });

      return VOICE_GROUP_ORDER
        .map((groupKey) => ({
          key: groupKey,
          label: VOICE_GROUP_LABELS[groupKey],
          voices: grouped.get(groupKey) || []
        }))
        .filter((group) => group.voices.length > 0);
    }

    function getAllVoiceEntries(options = {}) {
      return buildVoiceGroups(options).flatMap((group) => group.voices);
    }

    function findVoiceEntryById(voiceId) {
      if (!voiceId) return null;
      return getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
        .find((entry) => entry.id === voiceId) || null;
    }

    function populateVoiceSelectElement(select, preferredVoiceId = '') {
      if (!select) return '';

      select.innerHTML = '';
      const groups = buildVoiceGroups({ includeHidden: false });

      groups.forEach((group) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;

        group.voices.forEach((entry) => {
          const option = document.createElement('option');
          option.value = entry.id;
          option.textContent = entry.name;
          optgroup.appendChild(option);
        });

        if (optgroup.children.length > 0) {
          select.appendChild(optgroup);
        }
      });

      const options = Array.from(select.querySelectorAll('option'));
      if (options.length === 0) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No voices available';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        return '';
      }

      const targetValue = preferredVoiceId && options.some((opt) => opt.value === preferredVoiceId)
        ? preferredVoiceId
        : options[0].value;
      select.value = targetValue;
      return targetValue;
    }

    function buildVoiceOptionsMarkup(selectedVoiceId = '', {
      escapeAttribute = (value) => String(value ?? ''),
      escapeHtml = (value) => String(value ?? '')
    } = {}) {
      const groups = buildVoiceGroups({ includeHidden: false });
      if (groups.length === 0) {
        return '<option value="" disabled selected>No voices available</option>';
      }

      return groups.map((group) => {
        const optionsMarkup = group.voices.map((entry) => (
          `<option value="${escapeAttribute(entry.id)}"${entry.id === selectedVoiceId ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`
        )).join('');

        return `<optgroup label="${escapeAttribute(group.label)}">${optionsMarkup}</optgroup>`;
      }).join('');
    }

    function setSystemVoices(nextVoices) {
      replaceArray(state.voices, Array.isArray(nextVoices) ? nextVoices : []);
    }

    function setClonedVoices(nextClonedVoices) {
      const clean = Array.isArray(nextClonedVoices)
        ? nextClonedVoices
          .map((value) => String(value || '').trim())
          .filter(Boolean)
        : [];
      replaceArray(state.clonedVoices, clean);
      if (pruneCustomVoiceLanguages()) {
        saveCustomVoiceLanguages();
      }
    }

    function loadCustomVoiceLanguages() {
      const saved = settingsStore.getItem('custom_voice_languages');
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved);
        const next = {};
        Object.entries(parsed && typeof parsed === 'object' ? parsed : {}).forEach(([voiceName, language]) => {
          const normalizedVoiceName = String(voiceName || '').trim();
          if (!normalizedVoiceName) return;
          next[normalizedVoiceName] = normalizeClonedLanguageCode(language);
        });
        replaceObject(state.customVoiceLanguages, next);
      } catch (e) {
        console.error('Error loading custom voice languages:', e);
        replaceObject(state.customVoiceLanguages, {});
      }
    }

    function saveCustomVoiceLanguages() {
      settingsStore.setItem('custom_voice_languages', JSON.stringify(state.customVoiceLanguages));
    }

    function pruneCustomVoiceLanguages() {
      const clonedSet = new Set(state.clonedVoices);
      let changed = false;
      Object.keys(state.customVoiceLanguages).forEach((voiceName) => {
        if (!clonedSet.has(voiceName)) {
          delete state.customVoiceLanguages[voiceName];
          changed = true;
        }
      });
      return changed;
    }

    function getCustomVoiceLanguage(voiceName) {
      const normalizedVoiceName = String(voiceName || '').trim();
      if (!normalizedVoiceName) return DEFAULT_CLONED_LANGUAGE;
      return normalizeClonedLanguageCode(state.customVoiceLanguages[normalizedVoiceName]);
    }

    function setCustomVoiceLanguage(voiceName, language) {
      const normalizedVoiceName = String(voiceName || '').trim();
      if (!normalizedVoiceName) return DEFAULT_CLONED_LANGUAGE;

      const normalizedLanguage = normalizeClonedLanguageCode(language);
      if (normalizedLanguage === DEFAULT_CLONED_LANGUAGE) {
        delete state.customVoiceLanguages[normalizedVoiceName];
      } else {
        state.customVoiceLanguages[normalizedVoiceName] = normalizedLanguage;
      }
      return normalizedLanguage;
    }

    function loadHiddenVoices() {
      const saved = settingsStore.getItem('hidden_voices');
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved);
        const ids = Array.isArray(parsed)
          ? parsed.map((value) => String(value || '').trim()).filter(Boolean)
          : [];
        replaceSet(state.hiddenVoices, ids);
      } catch (e) {
        console.error('Error loading hidden voices:', e);
      }
    }

    function saveHiddenVoices() {
      settingsStore.setItem('hidden_voices', JSON.stringify(Array.from(state.hiddenVoices)));
    }

    function hideVoice(voiceId) {
      if (!voiceId) return;
      state.hiddenVoices.add(voiceId);
    }

    function showVoice(voiceId) {
      if (!voiceId) return;
      state.hiddenVoices.delete(voiceId);
    }

    function hideAllVoices() {
      getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
        .forEach((entry) => state.hiddenVoices.add(entry.id));
    }

    function showAllVoices() {
      state.hiddenVoices.clear();
    }

    function toggleGroupHidden(groupKey, action) {
      if (!groupKey || !action) return;
      const targetGroup = buildVoiceGroups({ includeHidden: true })
        .find((group) => group.key === groupKey);
      if (!targetGroup) return;

      targetGroup.voices.forEach((entry) => {
        if (action === 'hide') {
          state.hiddenVoices.add(entry.id);
        } else {
          state.hiddenVoices.delete(entry.id);
        }
      });
    }

    function loadLanguageFilters() {
      const saved = settingsStore.getItem('enabled_languages');
      const allowedLangs = VOICE_GROUP_ORDER.filter((code) => code !== 'custom');

      if (!saved) {
        replaceSet(state.enabledLanguages, allowedLangs);
        return;
      }

      try {
        const langs = JSON.parse(saved);
        const next = Array.isArray(langs)
          ? langs.filter((code) => allowedLangs.includes(code))
          : [];
        if (next.length === 0) {
          replaceSet(state.enabledLanguages, allowedLangs);
          return;
        }
        replaceSet(state.enabledLanguages, next);
      } catch (e) {
        console.error('Error loading language filters:', e);
        replaceSet(state.enabledLanguages, allowedLangs);
      }
    }

    function saveLanguageFilters() {
      settingsStore.setItem('enabled_languages', JSON.stringify(Array.from(state.enabledLanguages)));
    }

    function setLanguageEnabled(lang, enabled) {
      const normalized = String(lang || '').trim();
      if (!normalized || normalized === 'custom') return;
      if (enabled) state.enabledLanguages.add(normalized);
      else state.enabledLanguages.delete(normalized);
    }

    function loadUserVoices() {
      const savedVoices = settingsStore.getItem('user_voices');
      if (savedVoices) {
        try {
          const parsed = JSON.parse(savedVoices);
          replaceObject(state.userVoices, parsed && typeof parsed === 'object' ? parsed : {});
        } catch (e) {
          replaceObject(state.userVoices, {});
        }
      }

      const savedRecentUsers = settingsStore.getItem('recent_users');
      if (savedRecentUsers) {
        try {
          const parsed = JSON.parse(savedRecentUsers);
          const recent = Array.isArray(parsed)
            ? parsed.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
          replaceArray(state.recentUsers, recent);
        } catch (e) {
          replaceArray(state.recentUsers, []);
        }
      }
    }

    function saveUserVoices() {
      settingsStore.setItem('user_voices', JSON.stringify(state.userVoices));
      settingsStore.setItem('recent_users', JSON.stringify(state.recentUsers));
    }

    function getUserVoiceKey(username, platform) {
      return `${platform}:${username}`;
    }

    function getVoiceForUser(username, platform) {
      const userKey = getUserVoiceKey(username, platform);
      return state.userVoices[userKey];
    }

    function setVoiceForUser(username, platform, voiceId) {
      const userKey = getUserVoiceKey(username, platform);
      state.userVoices[userKey] = voiceId;
    }

    function removeVoiceForUser(username, platform) {
      const userKey = getUserVoiceKey(username, platform);
      delete state.userVoices[userKey];
    }

    function addRecentUser(userKey, maxSize = 20) {
      const normalized = String(userKey || '').trim();
      if (!normalized || normalized.startsWith('SYSTEM:')) return;
      if (state.recentUsers.includes(normalized)) return;

      state.recentUsers.unshift(normalized);
      if (state.recentUsers.length > maxSize) {
        state.recentUsers.splice(maxSize);
      }
    }

    function loadGenderCache() {
      try {
        const saved = settingsStore.getItem('gender_cache');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        replaceObject(state.genderCache, parsed && typeof parsed === 'object' ? parsed : {});
      } catch (e) {
        console.error('Error loading gender cache:', e);
        replaceObject(state.genderCache, {});
      }
    }

    function saveGenderCache() {
      try {
        settingsStore.setItem('gender_cache', JSON.stringify(state.genderCache));
      } catch (e) {
        console.error('Error saving gender cache:', e);
      }
    }

    function setOllamaOnline(online) {
      state.ollamaOnline = Boolean(online);
    }

    function isOllamaOnline() {
      return Boolean(state.ollamaOnline);
    }

    async function detectGenderWithLLM(username, {
      fetchFn,
      model = 'llama3:8b',
      baseUrl = 'http://localhost:11434'
    } = {}) {
      if (!isOllamaOnline()) return null;

      const resolvedFetch = typeof fetchFn === 'function'
        ? fetchFn
        : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
      if (!resolvedFetch) return null;

      const normalizedBaseUrl = String(baseUrl || 'http://localhost:11434')
        .trim()
        .replace(/\/+$/, '');

      const prompt = `Username: "${username}"

Task: Predict user's gender based on this username. Consider:
- Names hidden in leet speak (e.g., "3m1ly" = Emily, "D4N13L" = Daniel)
- Decorations like xX, _, numbers, special characters
- Keywords like "girl", "boy", "queen", "king", "princess", "lord"
- International names and unicode characters
- Gaming culture naming patterns

Respond with ONLY ONE WORD (lowercase):
male
female
neutral

Answer:`;

      const response = await resolvedFetch(`${normalizedBaseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 5
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();
      const answer = String(data?.response || '').trim().toLowerCase();
      return ['male', 'female', 'neutral'].includes(answer) ? answer : null;
    }

    async function detectGender(username, options = {}) {
      const cacheKey = String(username || '').toLowerCase();
      if (!cacheKey) return null;

      if (state.genderCache[cacheKey]) {
        return state.genderCache[cacheKey];
      }

      const gender = await detectGenderWithLLM(username, options);
      if (!gender) return null;

      state.genderCache[cacheKey] = gender;
      saveGenderCache();
      return gender;
    }

    async function autoAssignVoiceIfNeeded(author, platform, {
      autoEnabled = false,
      maleVoiceId = '',
      femaleVoiceId = '',
      detectGenderFn = null,
      getVoiceName = null,
      onAssigned = null,
      detectGenderOptions = {}
    } = {}) {
      const normalizedAuthor = String(author || '').trim();
      const normalizedPlatform = String(platform || '').trim();
      if (!normalizedAuthor || !normalizedPlatform) {
        return { assigned: false, reason: 'invalid_user' };
      }

      const userKey = getUserVoiceKey(normalizedAuthor, normalizedPlatform);

      if (state.userVoices[userKey]) {
        return { assigned: false, reason: 'already_assigned' };
      }

      if (!autoEnabled) {
        return { assigned: false, reason: 'disabled' };
      }

      if (!isOllamaOnline()) {
        return { assigned: false, reason: 'ollama_offline' };
      }

      const resolveGender = typeof detectGenderFn === 'function'
        ? detectGenderFn
        : (username) => detectGender(username, detectGenderOptions);

      const gender = await resolveGender(normalizedAuthor);
      if (!gender || gender === 'neutral') {
        return { assigned: false, reason: 'neutral_or_unknown' };
      }

      let assignedVoiceId = '';
      if (gender === 'male') {
        assignedVoiceId = maleVoiceId;
      } else if (gender === 'female') {
        assignedVoiceId = femaleVoiceId;
      }

      if (!assignedVoiceId) {
        return { assigned: false, reason: 'missing_voice' };
      }

      state.userVoices[userKey] = assignedVoiceId;
      saveUserVoices();

      if (typeof onAssigned === 'function') {
        const voiceName = typeof getVoiceName === 'function' ? getVoiceName(assignedVoiceId) : assignedVoiceId;
        onAssigned({
          author: normalizedAuthor,
          platform: normalizedPlatform,
          gender,
          voiceId: assignedVoiceId,
          voiceName
        });
      }

      return { assigned: true, gender, voiceId: assignedVoiceId };
    }

    loadCustomVoiceLanguages();

    return {
      state,
      constants: {
        VOICE_GROUP_ORDER,
        VOICE_GROUP_LABELS,
        DEFAULT_CLONED_LANGUAGE,
        CLONED_VOICE_LANGUAGE_OPTIONS
      },
      getVoiceLanguageCode,
      normalizeClonedLanguageCode,
      buildVoiceGroups,
      getAllVoiceEntries,
      findVoiceEntryById,
      populateVoiceSelectElement,
      buildVoiceOptionsMarkup,
      setSystemVoices,
      setClonedVoices,
      loadCustomVoiceLanguages,
      saveCustomVoiceLanguages,
      getCustomVoiceLanguage,
      setCustomVoiceLanguage,
      loadHiddenVoices,
      saveHiddenVoices,
      hideVoice,
      showVoice,
      hideAllVoices,
      showAllVoices,
      toggleGroupHidden,
      loadLanguageFilters,
      saveLanguageFilters,
      setLanguageEnabled,
      loadUserVoices,
      saveUserVoices,
      getVoiceForUser,
      setVoiceForUser,
      removeVoiceForUser,
      addRecentUser,
      loadGenderCache,
      saveGenderCache,
      setOllamaOnline,
      isOllamaOnline,
      detectGenderWithLLM,
      detectGender,
      autoAssignVoiceIfNeeded
    };
  }

  window.createVoicesController = createVoicesController;
})();

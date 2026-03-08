(function initSoundAlertsModule() {
  function createSoundAlertsController({
    windowRef,
    documentRef,
    settingsStore,
    elements = {},
    callbacks = {},
    fetchFn,
    confirmFn
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const callConfirm = typeof confirmFn === 'function'
      ? confirmFn
      : (win && typeof win.confirm === 'function' ? win.confirm.bind(win) : (() => true));

    const state = {
      initialized: false,
      customSounds: [],
      rules: [],
      knownGiftNames: [],
      activeAudio: null
    };

    const SOUND_ALERT_RULES_KEY = 'sound_alert_rules';
    const KNOWN_GIFT_NAMES_KEY = 'tiktok_known_gift_names';
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
      return {
        id: seed.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        eventType,
        eventValue,
        soundPath,
        enabled
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

    function toCustomSoundOptionsMarkup(selectedValue = '') {
      const normalizedSelected = normalizeSoundPath(selectedValue);
      const customMarkup = state.customSounds.map((sound) => {
        const path = normalizeSoundPath(sound.path);
        const selected = path === normalizedSelected ? ' selected' : '';
        return `<option value="${escapeAttribute(path)}"${selected}>🎵 ${escapeHtml(sound.name)}</option>`;
      }).join('');
      return `<option value="">🔇 No sound</option>${customMarkup}`;
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
            <td colspan="5" class="sound-alert-empty-row">No alert rules yet. Add one below.</td>
          </tr>
        `;
        return;
      }

      const eventOptionsMarkup = EVENT_TYPES
        .map((entry) => `<option value="${entry.value}">${escapeHtml(entry.label)}</option>`)
        .join('');
      const soundOptionsMarkup = toCustomSoundOptionsMarkup();

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
        }

        const animationTriggers = resolveAnimationTriggers(rule);
        const primaryAnimationTrigger = animationTriggers[0] || '';
        const animationSummary = resolveAnimationSummary(rule);
        const animationOptionsMarkup = toAnimationTriggerOptionsMarkup(primaryAnimationTrigger);

        return `
          <tr data-rule-id="${escapeAttribute(rule.id)}">
            <td>
              <select data-field="eventType" class="sound-alert-event-type">
                ${eventOptionsMarkup}
              </select>
            </td>
            <td>${conditionCell}</td>
            <td>
              <div class="sound-alert-sound-cell">
                <select data-field="soundPath" class="sound-alert-sound-select">
                  ${soundOptionsMarkup}
                </select>
                <button type="button" class="secondary sound-alert-inline-play" data-action="preview-selected" title="Play selected sound">▶</button>
              </div>
            </td>
            <td>
              <div class="sound-alert-animation-cell">
                <span class="sound-alert-animation-ref" title="${escapeAttribute(animationSummary)}">${escapeHtml(animationSummary)}</span>
                <div class="sound-alert-animation-controls">
                  <select data-field="animationTrigger" class="sound-alert-animation-select">
                    ${animationOptionsMarkup}
                  </select>
                  <button type="button" class="secondary sound-alert-assign-btn" data-action="assign-animation">Assign</button>
                  <button type="button" class="secondary sound-alert-clear-animation-btn" data-action="clear-animation">Clear</button>
                </div>
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

        const soundSelect = row.querySelector('select[data-field="soundPath"]');
        if (soundSelect) {
          const normalizedSoundPath = normalizeSoundPath(rule.soundPath);
          if (Array.from(soundSelect.options).some((opt) => opt.value === normalizedSoundPath)) {
            soundSelect.value = normalizedSoundPath;
          } else {
            soundSelect.value = '';
          }
        }
      });
    }

    function renderSoundCards() {
      const cardsEl = elements.soundLibraryCards || null;
      if (!cardsEl) return;

      if (!Array.isArray(state.customSounds) || state.customSounds.length === 0) {
        cardsEl.innerHTML = '<div class="sound-library-empty">No custom sounds uploaded yet.</div>';
        return;
      }

      cardsEl.innerHTML = state.customSounds.map((sound) => {
        const path = normalizeSoundPath(sound.path);
        const label = String(sound.name || '').trim() || path;

        return `
          <div class="sound-library-card" title="${escapeAttribute(label)}">
            <button type="button" class="sound-library-card-main" data-action="play-card-sound" data-sound-path="${escapeAttribute(path)}">
              <span class="sound-library-card-name">${escapeHtml(label)}</span>
            </button>
            <button type="button" class="sound-library-card-delete" data-action="delete-card-sound" data-sound-path="${escapeAttribute(path)}">
              Delete
            </button>
          </div>
        `;
      }).join('');
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

        renderSoundCards();
        renderRules();
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

    function getVolume() {
      if (typeof callbacks.getVolume === 'function') {
        const value = Number(callbacks.getVolume());
        if (Number.isFinite(value)) return Math.min(1, Math.max(0, value));
      }
      return 1;
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
        }
      }
    }

    function playSound(rawSoundPath) {
      const soundPath = normalizeSoundPath(rawSoundPath);
      if (!soundPath) return false;
      if (!win || typeof win.Audio !== 'function') return false;

      try {
        stopActiveAudio();
        const audio = new win.Audio(soundPath);
        audio.volume = getVolume();
        state.activeAudio = audio;

        if (typeof audio.addEventListener === 'function') {
          const clearActiveIfCurrent = () => {
            if (state.activeAudio === audio) {
              state.activeAudio = null;
            }
          };
          audio.addEventListener('ended', clearActiveIfCurrent);
          audio.addEventListener('pause', clearActiveIfCurrent);
          audio.addEventListener('error', clearActiveIfCurrent);
        }

        audio.play().catch((err) => {
          if (state.activeAudio === audio) {
            state.activeAudio = null;
          }
          console.error('Sound play error:', err);
        });
        return true;
      } catch (err) {
        if (state.activeAudio) {
          state.activeAudio = null;
        }
        console.error('Failed to play sound:', err);
        return false;
      }
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

      if (eventType === 'follow' || eventType === 'share' || eventType === 'join' || eventType === 'leave') {
        const direct = activeRules.find((rule) => (
          rule.eventType === eventType
          && normalizeSoundPath(rule.soundPath)
        ));
        if (direct) return normalizeSoundPath(direct.soundPath);
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
      const shouldDelete = callConfirm(`Delete custom sound "${filename}"?`);
      if (!shouldDelete) return;

      try {
        const response = await callFetch(`/api/sounds/${encodeURIComponent(filename)}`, {
          method: 'DELETE'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Delete failed');
        }

        clearSoundReferences(selectedPath);
        await loadCustomSounds();
        callbacks.updateStatus?.(`✓ Sound deleted: ${filename}`, false);
      } catch (err) {
        console.error('Sound delete failed:', err);
        callbacks.updateStatus?.(`Delete failed: ${err.message}`, false, true);
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
      const soundCards = elements.soundLibraryCards || null;

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
            playSound(soundPath);
            return;
          }

          if (action === 'delete-card-sound') {
            void handleDeleteSound(soundPath);
          }
        });
      }

      if (rulesBody) {
        rulesBody.addEventListener('input', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target) return;
          const input = target.closest('input[data-field="eventValue"]');
          if (!input) return;

          const row = input.closest('tr[data-rule-id]');
          const ruleId = row?.dataset?.ruleId || '';
          const rule = getRuleById(ruleId);
          if (!rule) return;

          if (rule.eventType === 'gift_value') {
            rule.eventValue = normalizeGiftValue(input.value || '');
            if (String(input.value || '') !== rule.eventValue) {
              input.value = rule.eventValue;
            }
          } else {
            rule.eventValue = String(input.value || '').trim();
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
            saveRules();
            renderRules();
            return;
          }

          if (field === 'soundPath') {
            rule.soundPath = normalizeSoundPath(target.value);
            saveRules();
            renderRules();
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
          if (action === 'preview-selected') {
            const select = row?.querySelector('select[data-field="soundPath"]');
            playSound(select?.value || '');
            return;
          }

          if (action === 'play') {
            playSound(rule.soundPath);
            return;
          }

          if (action === 'assign-animation') {
            const selectedAnimation = String(
              row?.querySelector('select[data-field="animationTrigger"]')?.value || ''
            ).trim();
            if (!selectedAnimation) {
              callbacks.updateStatus?.('Select animation first', false, true);
              return;
            }

            const result = callbacks.assignAnimationForRule?.(rule, selectedAnimation);
            if (result === false) {
              return;
            }
            if (result && typeof result === 'object' && result.ok === false) {
              callbacks.updateStatus?.(result.message || 'Failed to assign animation', false, true);
              return;
            }

            renderRules();
            return;
          }

          if (action === 'clear-animation') {
            const result = callbacks.clearAnimationForRule?.(rule);
            if (result === false) {
              return;
            }
            if (result && typeof result === 'object' && result.ok === false) {
              callbacks.updateStatus?.(result.message || 'Failed to clear animation', false, true);
              return;
            }
            renderRules();
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
      loadKnownGiftNames();
      bindEvents();
      renderRules();
      void loadCustomSounds();
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
      resolveSoundForEvent,
      playSound,
      clearSoundReferences,
      normalizeSoundPath
    };
  }

  window.createSoundAlertsController = createSoundAlertsController;
})();

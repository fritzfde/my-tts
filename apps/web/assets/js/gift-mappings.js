(function initGiftMappingsModule() {
  function createGiftMappingsController({ settingsStore }) {
    const state = {
      byName: {},
      byValue: {},
      default: { type: 'sound', value: '' },
      defaultAnimation: { type: 'animation', value: '' }
    };
    const cycleState = {
      byName: {},
      byValue: {},
      defaultAnimation: 0
    };

    function toAnimationTriggerList(value) {
      if (Array.isArray(value)) {
        return value
          .filter((v) => typeof v === 'string' && v.trim())
          .map((v) => v.trim());
      }
      if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
      }
      return [];
    }

    function normalizeGiftNameKey(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    }

    function toDiamondLookupKeys(value) {
      const values = Array.isArray(value) ? value : [value];
      const keys = [];

      values.forEach((candidate) => {
        const numeric = Number(candidate);
        if (!Number.isFinite(numeric)) return;
        const key = String(Math.max(0, Math.floor(numeric)));
        if (!keys.includes(key)) keys.push(key);
      });

      return keys;
    }

    function normalizeCustomSoundPath(pathValue) {
      const raw = String(pathValue || '').trim();
      if (!raw) return '';
      if (raw.startsWith('/sounds/custom/')) {
        return raw.replace('/sounds/custom/', '/sounds/');
      }
      return raw;
    }

    function normalizeSoundSelection(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';

      if (raw.startsWith('custom-')) {
        const normalizedPath = normalizeCustomSoundPath(raw.slice('custom-'.length));
        return normalizedPath ? `custom-${normalizedPath}` : '';
      }

      if (raw.startsWith('/sounds/')) {
        const normalizedPath = normalizeCustomSoundPath(raw);
        return normalizedPath ? `custom-${normalizedPath}` : '';
      }

      return raw;
    }

    function findByNameEntry(giftName) {
      if (!giftName && giftName !== 0) return null;
      if (Object.prototype.hasOwnProperty.call(state.byName, giftName)) {
        return { key: giftName, entry: state.byName[giftName] };
      }

      const normalizedTarget = normalizeGiftNameKey(giftName);
      if (!normalizedTarget) return null;

      for (const [key, entry] of Object.entries(state.byName || {})) {
        if (normalizeGiftNameKey(key) === normalizedTarget) {
          return { key, entry };
        }
      }

      return null;
    }

    function normalizeGiftAction(action) {
      if (!action || typeof action !== 'object') {
        return { type: 'sound', value: '' };
      }

      if (action.type === 'animation') {
        const unique = Array.from(new Set(toAnimationTriggerList(action.value)));
        if (unique.length > 1) {
          return { type: 'animation', value: unique };
        }
        return { type: 'animation', value: unique[0] || '' };
      }

      return {
        type: 'sound',
        value: normalizeSoundSelection(action.value)
      };
    }

    function normalizeAnimationAction(action) {
      const normalized = normalizeGiftAction(action);
      if (normalized.type !== 'animation') {
        return { type: 'animation', value: '' };
      }
      return normalized;
    }

    function normalizeGiftMappings(raw) {
      const byName = {};
      const byValue = {};
      const normalizedDefault = normalizeGiftAction(raw?.default || { type: 'sound', value: '' });
      const defaultSoundValue = normalizedDefault.type === 'sound' ? normalizedDefault.value : '';
      const hasExplicitDefaultAnimation = Boolean(
        raw
        && (
          Object.prototype.hasOwnProperty.call(raw, 'defaultAnimation')
          || Object.prototype.hasOwnProperty.call(raw, 'default_animation')
        )
      );
      let normalizedDefaultAnimation = normalizeAnimationAction(
        raw?.defaultAnimation || raw?.default_animation || { type: 'animation', value: '' }
      );

      Object.entries(raw?.byName || {}).forEach(([giftName, action]) => {
        byName[giftName] = normalizeGiftAction(action);
      });

      Object.entries(raw?.byValue || {}).forEach(([diamondValue, action]) => {
        byValue[diamondValue] = normalizeGiftAction(action);
      });

      // Backward compatibility:
      // old configs used byValue["1"] as "default animation".
      if (!hasExplicitDefaultAnimation) {
        const legacyDefault = normalizeAnimationAction(byValue?.['1']);
        if (toAnimationTriggerList(legacyDefault.value).length > 0) {
          normalizedDefaultAnimation = legacyDefault;
        }
      }

      return {
        byName,
        byValue,
        default: { type: 'sound', value: defaultSoundValue },
        defaultAnimation: normalizedDefaultAnimation
      };
    }

    function resetCycleState() {
      cycleState.byName = {};
      cycleState.byValue = {};
      cycleState.defaultAnimation = 0;
    }

    function applyNormalizedMappings(next) {
      state.byName = next.byName || {};
      state.byValue = next.byValue || {};
      state.default = next.default || { type: 'sound', value: '' };
      state.defaultAnimation = normalizeAnimationAction(next.defaultAnimation);
      resetCycleState();
    }

    function load() {
      const saved = settingsStore.getItem('gift_mappings');
      if (saved) {
        try {
          applyNormalizedMappings(normalizeGiftMappings(JSON.parse(saved)));
          return state;
        } catch (e) {
          console.error('Error loading gift mappings:', e);
        }
      }

      applyNormalizedMappings(normalizeGiftMappings(state));
      return state;
    }

    function save() {
      settingsStore.setItem('gift_mappings', JSON.stringify(state));
    }

    function setDefaultSound(soundValue) {
      state.default.type = 'sound';
      state.default.value = normalizeSoundSelection(soundValue);
    }

    function getDefaultAnimationAction() {
      return normalizeAnimationAction(state.defaultAnimation);
    }

    function setDefaultAnimationAction(action) {
      state.defaultAnimation = normalizeAnimationAction(action);
      cycleState.defaultAnimation = 0;
    }

    function isDefaultAnimationTrigger(trigger) {
      if (!trigger) return false;
      const values = toAnimationTriggerList(getDefaultAnimationAction().value);
      return values.includes(trigger);
    }

    function addDefaultAnimationTrigger(trigger) {
      const normalizedTrigger = String(trigger || '').trim();
      if (!normalizedTrigger) return;

      const values = toAnimationTriggerList(getDefaultAnimationAction().value);
      if (!values.includes(normalizedTrigger)) values.push(normalizedTrigger);
      setDefaultAnimationAction({
        type: 'animation',
        value: values.length > 1 ? values : (values[0] || '')
      });
    }

    function removeDefaultAnimationTrigger(trigger) {
      const normalizedTrigger = String(trigger || '').trim();
      if (!normalizedTrigger) return;

      const values = toAnimationTriggerList(getDefaultAnimationAction().value)
        .filter((value) => value !== normalizedTrigger);
      setDefaultAnimationAction({
        type: 'animation',
        value: values.length > 1 ? values : (values[0] || '')
      });
    }

    function clearSoundReferences(soundValue) {
      if (!soundValue) return;
      const normalizedTarget = normalizeSoundSelection(soundValue);
      if (!normalizedTarget) return;

      if (
        state.default?.type === 'sound'
        && normalizeSoundSelection(state.default.value) === normalizedTarget
      ) {
        state.default.value = '';
      }

      Object.values(state.byName || {}).forEach((entry) => {
        if (
          entry?.type === 'sound'
          && normalizeSoundSelection(entry.value) === normalizedTarget
        ) {
          entry.value = '';
        }
      });

      Object.values(state.byValue || {}).forEach((entry) => {
        if (
          entry?.type === 'sound'
          && normalizeSoundSelection(entry.value) === normalizedTarget
        ) {
          entry.value = '';
        }
      });
    }

    function getGiftAction(giftName, diamondCount) {
      function resolveGiftAction(entry, keyType, key) {
        const normalized = normalizeGiftAction(entry);
        if (normalized.type !== 'animation') {
          return normalized;
        }

        const triggers = toAnimationTriggerList(normalized.value);
        if (triggers.length === 0) {
          return { type: 'animation', value: '' };
        }

        if (triggers.length === 1) {
          return { type: 'animation', value: triggers[0] };
        }

        const currentState = keyType === 'byName' ? cycleState.byName : cycleState.byValue;
        const currentIndex = Number.isInteger(currentState[key]) ? currentState[key] : 0;
        const index = currentIndex % triggers.length;
        currentState[key] = (index + 1) % triggers.length;
        return { type: 'animation', value: triggers[index] };
      }

      function resolveDefaultAnimationAction() {
        const normalized = getDefaultAnimationAction();
        const triggers = toAnimationTriggerList(normalized.value);
        if (triggers.length === 0) {
          return { type: 'animation', value: '' };
        }
        if (triggers.length === 1) {
          return { type: 'animation', value: triggers[0] };
        }

        const currentIndex = Number.isInteger(cycleState.defaultAnimation)
          ? cycleState.defaultAnimation
          : 0;
        const index = currentIndex % triggers.length;
        cycleState.defaultAnimation = (index + 1) % triggers.length;
        return { type: 'animation', value: triggers[index] };
      }

      const byNameMatch = findByNameEntry(giftName);
      if (byNameMatch) {
        const resolved = resolveGiftAction(byNameMatch.entry, 'byName', byNameMatch.key);
        console.log(`🎁 Using name-based mapping for ${byNameMatch.key}:`, resolved);
        return resolved;
      }

      const diamondKeys = toDiamondLookupKeys(diamondCount);
      for (const key of diamondKeys) {
        if (!Object.prototype.hasOwnProperty.call(state.byValue, key)) continue;
        const resolved = resolveGiftAction(state.byValue[key], 'byValue', key);
        console.log(`🎁 Using value-based mapping for ${key}💎:`, resolved);
        return resolved;
      }

      const defaultAnimation = resolveDefaultAnimationAction();
      if (defaultAnimation.value) {
        console.log('🎁 Using default animation mapping:', defaultAnimation);
        return defaultAnimation;
      }

      console.log('🎁 Using default sound mapping:', state.default);
      return state.default;
    }

    return {
      state,
      toAnimationTriggerList,
      normalizeGiftAction,
      normalizeGiftMappings,
      load,
      save,
      setDefaultSound,
      getDefaultAnimationAction,
      setDefaultAnimationAction,
      isDefaultAnimationTrigger,
      addDefaultAnimationTrigger,
      removeDefaultAnimationTrigger,
      clearSoundReferences,
      getGiftAction
    };
  }

  window.createGiftMappingsController = createGiftMappingsController;
})();

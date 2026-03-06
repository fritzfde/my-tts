(function initAnimationMappingsModule() {
  function createAnimationMappingsController({ settingsStore }) {
    const state = {
      animationMappings: {},
      availableAnimations: []
    };

    function replaceMappings(nextMappings) {
      Object.keys(state.animationMappings).forEach((key) => delete state.animationMappings[key]);
      Object.entries(nextMappings || {}).forEach(([key, value]) => {
        state.animationMappings[key] = value;
      });
    }

    function replaceAvailableAnimations(nextAnimations) {
      state.availableAnimations.splice(0, state.availableAnimations.length, ...(nextAnimations || []));
    }

    function normalizeTriggerFromFilename(filename) {
      return String(filename || '')
        .replace(/\.[^/.]+$/, '')
        .trim()
        .toLowerCase();
    }

    function createDefaultAnimationMapping(filename) {
      return {
        file: filename,
        position: 'bottom-left',
        scale: 1.0
      };
    }

    function toAnimationMappingObject(data, fallbackFilename = '') {
      if (typeof data === 'object' && data !== null) {
        return {
          file: data.file || fallbackFilename,
          position: data.position || 'bottom-left',
          scale: Number.isFinite(Number(data.scale)) ? Number(data.scale) : 1.0
        };
      }

      return createDefaultAnimationMapping(typeof data === 'string' ? data : fallbackFilename);
    }

    function getAnimationFileFromMapping(data) {
      if (typeof data === 'string') return data;
      if (typeof data === 'object' && data !== null) return data.file || '';
      return '';
    }

    function findAnimationMappingEntryByFile(filename, source = state.animationMappings) {
      for (const [trigger, data] of Object.entries(source)) {
        if (getAnimationFileFromMapping(data) === filename) {
          return { trigger, data: toAnimationMappingObject(data, filename) };
        }
      }
      return null;
    }

    function buildUniqueAnimationTrigger(base, source = state.animationMappings, ignoreTrigger = '') {
      const cleanBase = (base || 'animation').trim().toLowerCase();
      let candidate = cleanBase || 'animation';
      let index = 1;
      while (Object.prototype.hasOwnProperty.call(source, candidate) && candidate !== ignoreTrigger) {
        candidate = `${cleanBase}-${index}`;
        index += 1;
      }
      return candidate;
    }

    function loadMappings() {
      const saved = settingsStore.getItem('animation_mappings');
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved);
        const normalized = {};
        Object.entries(parsed || {}).forEach(([trigger, data]) => {
          normalized[trigger] = toAnimationMappingObject(data, getAnimationFileFromMapping(data));
        });
        replaceMappings(normalized);
      } catch (e) {
        console.error('Error loading animation mappings:', e);
      }
    }

    function saveMappings() {
      settingsStore.setItem('animation_mappings', JSON.stringify(state.animationMappings));
    }

    async function loadAvailableAnimations() {
      const response = await fetch('/api/animations/list');
      const data = await response.json();
      const sorted = (data.animations || []).sort((a, b) => a.name.localeCompare(b.name));
      replaceAvailableAnimations(sorted);
      return sorted;
    }

    function syncFromFiles() {
      const fileSet = new Set(state.availableAnimations.map((anim) => anim.filename));
      const nextMappings = {};
      const usedFiles = new Set();
      const triggerRenames = [];
      let created = 0;
      let removed = 0;
      let deduped = 0;

      Object.entries(state.animationMappings).forEach(([trigger, rawData]) => {
        const file = getAnimationFileFromMapping(rawData);
        if (!file || !fileSet.has(file)) {
          removed += 1;
          return;
        }
        if (usedFiles.has(file)) {
          deduped += 1;
          return;
        }

        const normalized = toAnimationMappingObject(rawData, file);
        const safeTrigger = buildUniqueAnimationTrigger(trigger, nextMappings);
        if (safeTrigger !== trigger) {
          deduped += 1;
          triggerRenames.push([trigger, safeTrigger]);
        }

        nextMappings[safeTrigger] = {
          file,
          position: normalized.position,
          scale: normalized.scale
        };
        usedFiles.add(file);
      });

      state.availableAnimations.forEach((anim) => {
        if (usedFiles.has(anim.filename)) return;
        const baseTrigger = normalizeTriggerFromFilename(anim.filename) || 'animation';
        const uniqueTrigger = buildUniqueAnimationTrigger(baseTrigger, nextMappings);
        nextMappings[uniqueTrigger] = createDefaultAnimationMapping(anim.filename);
        usedFiles.add(anim.filename);
        created += 1;
      });

      const removedTriggers = Object.keys(state.animationMappings)
        .filter((trigger) => !Object.prototype.hasOwnProperty.call(nextMappings, trigger));
      const changed = JSON.stringify(state.animationMappings) !== JSON.stringify(nextMappings);

      if (changed) {
        replaceMappings(nextMappings);
      }

      return {
        changed,
        created,
        removed,
        deduped,
        triggerRenames,
        removedTriggers
      };
    }

    return {
      state,
      normalizeTriggerFromFilename,
      createDefaultAnimationMapping,
      toAnimationMappingObject,
      getAnimationFileFromMapping,
      findAnimationMappingEntryByFile,
      buildUniqueAnimationTrigger,
      loadMappings,
      saveMappings,
      loadAvailableAnimations,
      syncFromFiles
    };
  }

  window.createAnimationMappingsController = createAnimationMappingsController;
})();

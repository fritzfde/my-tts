(function initStickerMappingsModule() {
  function createStickerMappingsController({
    settingsStore,
    escapeAttribute,
    escapeHtml,
    addChatMessage,
    triggerAnimation
  }) {
    const state = {
      mappings: {}
    };

    function save() {
      settingsStore.setItem('sticker_mappings', JSON.stringify(state.mappings));
    }

    function normalizeStickerMappingEntry(key, data) {
      if (typeof data === 'object' && data !== null) {
        return {
          name: typeof data.name === 'string' && data.name.trim() ? data.name : key,
          image: typeof data.image === 'string' && data.image.trim() ? data.image : null,
          trigger: typeof data.trigger === 'string' ? data.trigger : ''
        };
      }
      return {
        name: key,
        image: null,
        trigger: typeof data === 'string' ? data : ''
      };
    }

    function load() {
      const saved = settingsStore.getItem('sticker_mappings');
      if (!saved) return;

      try {
        const parsed = JSON.parse(saved);
        const normalized = {};
        Object.entries(parsed || {}).forEach(([key, data]) => {
          normalized[key] = normalizeStickerMappingEntry(key, data);
        });

        Object.keys(state.mappings).forEach((key) => delete state.mappings[key]);
        Object.entries(normalized).forEach(([key, value]) => {
          state.mappings[key] = value;
        });
      } catch (e) {
        console.error('Error loading sticker mappings:', e);
      }
    }

    function getEntries() {
      return Object.entries(state.mappings).map(([key, data]) => {
        const normalized = normalizeStickerMappingEntry(key, data);
        return { key, ...normalized };
      });
    }

    function getAvailableStickerOptions() {
      return getEntries()
        .sort((a, b) => String(a.name || a.key).localeCompare(String(b.name || b.key)));
    }

    function getStickerTriggerForKey(stickerKey) {
      const data = state.mappings[stickerKey];
      if (!data) return '';
      return typeof data === 'string' ? data : (data.trigger || '');
    }

    function findStickerKeyForAnimationTrigger(trigger) {
      const match = getEntries().find((entry) => (entry.trigger || '') === trigger);
      return match ? match.key : '';
    }

    function hasStickerForAnimationTrigger(trigger) {
      return Boolean(findStickerKeyForAnimationTrigger(trigger));
    }

    function findFirstStickerEntryForAnimationTrigger(trigger) {
      const key = findStickerKeyForAnimationTrigger(trigger);
      if (!key) return null;
      const data = normalizeStickerMappingEntry(key, state.mappings[key]);
      return { key, ...data };
    }

    function moveStickerAnimationReferences(oldTrigger, newTrigger) {
      if (!oldTrigger || !newTrigger || oldTrigger === newTrigger) return;
      Object.entries(state.mappings).forEach(([key, data]) => {
        const normalized = normalizeStickerMappingEntry(key, data);
        if (normalized.trigger === oldTrigger) {
          normalized.trigger = newTrigger;
          state.mappings[key] = normalized;
        }
      });
    }

    function removeStickerAnimationReferences(trigger) {
      if (!trigger) return;
      Object.entries(state.mappings).forEach(([key, data]) => {
        const normalized = normalizeStickerMappingEntry(key, data);
        if (normalized.trigger === trigger) {
          normalized.trigger = '';
          state.mappings[key] = normalized;
        }
      });
    }

    function assignStickerToTrigger(stickerKey, trigger) {
      if (!stickerKey) return;

      const targetTrigger = typeof trigger === 'string' ? trigger : '';
      const current = normalizeStickerMappingEntry(stickerKey, state.mappings[stickerKey]);

      Object.entries(state.mappings).forEach(([key, data]) => {
        const normalized = normalizeStickerMappingEntry(key, data);
        if (key === stickerKey || (targetTrigger && normalized.trigger === targetTrigger)) {
          normalized.trigger = '';
          state.mappings[key] = normalized;
        }
      });

      if (!targetTrigger) return;
      current.trigger = targetTrigger;
      state.mappings[stickerKey] = current;
    }

    function setStickerForAnimationTrigger(trigger, stickerKey) {
      if (!trigger) return;
      if (!stickerKey) {
        removeStickerAnimationReferences(trigger);
        return;
      }
      assignStickerToTrigger(stickerKey, trigger);
    }

    function ensureStickerEntry(stickerKey, { name = '', image = null } = {}) {
      if (!stickerKey) return null;
      const existingRaw = state.mappings[stickerKey];
      const existing = normalizeStickerMappingEntry(stickerKey, existingRaw);
      let changed = false;

      if (!existingRaw) {
        changed = true;
      }
      if (name && existing.name !== name) {
        existing.name = name;
        changed = true;
      }
      if (image && existing.image !== image) {
        existing.image = image;
        changed = true;
      }

      if (changed) {
        state.mappings[stickerKey] = existing;
        save();
      } else if (!existingRaw) {
        state.mappings[stickerKey] = existing;
      }

      return existing;
    }

    function handleStickerAnimation(msg) {
      const emoteKey = msg.emoteId || msg.emoteName;
      if (!emoteKey) return;

      if (!state.mappings[emoteKey]) {
        state.mappings[emoteKey] = {
          name: msg.emoteName || `Sticker ${emoteKey}`,
          image: msg.emoteImage || null,
          trigger: ''
        };

        save();
        addChatMessage('SYSTEM', `📚 New sticker captured: ${emoteKey.slice(0, 12)}... Assign an animation!`, 'SYSTEM', false);
      } else {
        const existing = normalizeStickerMappingEntry(emoteKey, state.mappings[emoteKey]);
        let changed = false;
        if (msg.emoteName && existing.name !== msg.emoteName) {
          existing.name = msg.emoteName;
          changed = true;
        }
        if (msg.emoteImage && existing.image !== msg.emoteImage) {
          existing.image = msg.emoteImage;
          changed = true;
        }
        state.mappings[emoteKey] = existing;
        if (changed) save();
      }

      const animTrigger = getStickerTriggerForKey(emoteKey);
      if (animTrigger) {
        triggerAnimation(animTrigger, 'tiktok', msg.author);
      }
    }

    function buildStickerChatItemHtml(emote, fallbackName = '') {
      const stickerKey = String(emote?.emoteId || emote?.emoteName || '').trim();
      if (!stickerKey) return '';

      const stickerName = String(emote?.emoteName || fallbackName || `Sticker ${stickerKey}`).trim();
      const stickerImage = emote?.emoteImage || emote?.emoteImageUrl || null;
      ensureStickerEntry(stickerKey, { name: stickerName, image: stickerImage });

      const assignedTrigger = getStickerTriggerForKey(stickerKey);
      const statusLabel = assignedTrigger ? `Mapped to: ${assignedTrigger}` : 'Unassigned';
      const actionLabel = 'Assign';
      const imageMarkup = stickerImage
        ? `<img src="${escapeAttribute(stickerImage)}" alt="${escapeAttribute(stickerName)}" class="chat-sticker-image">`
        : '<span class="chat-sticker-image" style="display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem;">🎭</span>';
      const unassignButton = assignedTrigger
        ? `<button type="button" class="secondary chat-sticker-unassign-btn" data-sticker-key="${escapeAttribute(stickerKey)}" title="Unassign">×</button>`
        : '';

      return `
        <span class="chat-sticker-item${assignedTrigger ? ' is-mapped' : ''}" data-sticker-key="${escapeAttribute(stickerKey)}" data-sticker-name="${escapeAttribute(stickerName)}" title="${escapeAttribute(stickerName)} — ${escapeAttribute(statusLabel)}">
          ${imageMarkup}
          <span class="chat-sticker-controls">
            <button
              type="button"
              class="secondary chat-sticker-assign-btn"
              data-sticker-key="${escapeAttribute(stickerKey)}"
              data-sticker-name="${escapeAttribute(stickerName)}"
              data-sticker-image="${escapeAttribute(stickerImage || '')}"
              data-sticker-trigger="${escapeAttribute(assignedTrigger || '')}"
            >${actionLabel}</button>
            ${unassignButton}
          </span>
        </span>
      `;
    }

    function buildStickerChatListHtml(emotes = []) {
      const parts = emotes.map((emote) => buildStickerChatItemHtml(emote)).filter(Boolean);
      if (parts.length === 0) return '';
      return `<span class="chat-sticker-list">${parts.join('')}</span>`;
    }

    return {
      state: state.mappings,
      save,
      load,
      normalizeStickerMappingEntry,
      getEntries,
      getAvailableStickerOptions,
      getStickerTriggerForKey,
      findStickerKeyForAnimationTrigger,
      hasStickerForAnimationTrigger,
      findFirstStickerEntryForAnimationTrigger,
      moveStickerAnimationReferences,
      removeStickerAnimationReferences,
      assignStickerToTrigger,
      setStickerForAnimationTrigger,
      ensureStickerEntry,
      handleStickerAnimation,
      buildStickerChatItemHtml,
      buildStickerChatListHtml
    };
  }

  window.createStickerMappingsController = createStickerMappingsController;
})();

(function initStickerUiModule() {
  function createStickerUiController({
    windowRef,
    documentRef,
    elements = {},
    state = {},
    helpers = {},
    callbacks = {}
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);

    const stateRef = {
      activeStickerAssignKey: '',
      eventsAttached: false
    };

    function getStickerMappings() {
      return (state.stickerMappings && typeof state.stickerMappings === 'object')
        ? state.stickerMappings
        : {};
    }

    function normalizeStickerMappingEntry(key, data) {
      if (typeof helpers.normalizeStickerMappingEntry === 'function') {
        return helpers.normalizeStickerMappingEntry(key, data);
      }
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

    function getAnimationTriggers() {
      if (typeof callbacks.getAnimationTriggers === 'function') {
        const provided = callbacks.getAnimationTriggers();
        return Array.isArray(provided) ? [...provided].sort((a, b) => a.localeCompare(b)) : [];
      }

      const mappings = (state.animationMappings && typeof state.animationMappings === 'object')
        ? state.animationMappings
        : {};
      return Object.keys(mappings).sort((a, b) => a.localeCompare(b));
    }

    function syncPopupStickerPickerIfNeeded() {
      const activePopup = callbacks.getActiveAnimationPopup?.();
      if (!activePopup?.trigger) return;
      const selectedKey = callbacks.findStickerKeyForAnimationTrigger
        ? callbacks.findStickerKeyForAnimationTrigger(activePopup.trigger)
        : '';
      callbacks.populateAnimationPopupStickerOptions?.(selectedKey);
    }

    function buildStickerAssignAnimationOptions(selectedTrigger = '') {
      const select = elements.stickerAssignAnimationSelect;
      if (!select || !doc) return;

      const triggers = getAnimationTriggers();
      select.innerHTML = '<option value="">No animation assigned</option>';
      triggers.forEach((trigger) => {
        const option = doc.createElement('option');
        option.value = trigger;
        option.textContent = trigger;
        if (selectedTrigger && selectedTrigger === trigger) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      if (!selectedTrigger) {
        select.value = '';
      }
    }

    function refreshChatStickerUiForKey(stickerKey) {
      if (!stickerKey || !doc) return;
      const assignedTrigger = callbacks.getStickerTriggerForKey
        ? callbacks.getStickerTriggerForKey(stickerKey)
        : '';
      const mapped = Boolean(assignedTrigger);

      doc.querySelectorAll('.chat-sticker-item').forEach((item) => {
        if (!item || !item.dataset || item.dataset.stickerKey !== stickerKey) return;

        item.classList?.toggle?.('is-mapped', mapped);
        const stickerName = item.dataset.stickerName || stickerKey;
        item.title = mapped
          ? `${stickerName} — Mapped to: ${assignedTrigger}`
          : `${stickerName} — Unassigned`;

        const controls = item.querySelector?.('.chat-sticker-controls');
        if (!controls) return;

        const assignBtn = controls.querySelector?.('.chat-sticker-assign-btn');
        if (assignBtn) {
          assignBtn.textContent = 'Assign';
          assignBtn.dataset.stickerTrigger = assignedTrigger || '';
        }

        const existingUnassign = controls.querySelector?.('.chat-sticker-unassign-btn');
        if (mapped && !existingUnassign && doc.createElement) {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'secondary chat-sticker-unassign-btn';
          btn.dataset.stickerKey = stickerKey;
          btn.title = 'Unassign';
          btn.textContent = '×';
          controls.appendChild(btn);
        }
        if (!mapped && existingUnassign && typeof existingUnassign.remove === 'function') {
          existingUnassign.remove();
        }
      });
    }

    function closeStickerAssignModal() {
      if (!elements.stickerAssignModal) return;
      elements.stickerAssignModal.style.display = 'none';
      stateRef.activeStickerAssignKey = '';
    }

    function openStickerAssignFromChat(stickerKey, stickerImage = '', stickerName = '') {
      if (!elements.stickerAssignModal || !elements.stickerAssignAnimationSelect) return;
      if (!stickerKey) return;

      const ensured = callbacks.ensureStickerEntry?.(stickerKey, {
        name: stickerName || `Sticker ${stickerKey}`,
        image: stickerImage || null
      }) || normalizeStickerMappingEntry(stickerKey, getStickerMappings()[stickerKey]);

      stateRef.activeStickerAssignKey = stickerKey;
      const currentTrigger = callbacks.getStickerTriggerForKey
        ? callbacks.getStickerTriggerForKey(stickerKey)
        : '';
      const displayName = ensured?.name || stickerName || stickerKey;
      const displayImage = ensured?.image || stickerImage || '';

      if (elements.stickerAssignName) {
        elements.stickerAssignName.textContent = displayName;
      }
      if (elements.stickerAssignCurrent) {
        elements.stickerAssignCurrent.textContent = currentTrigger
          ? `Currently mapped to: ${currentTrigger}`
          : 'Currently unassigned';
      }
      if (elements.stickerAssignPreviewImage) {
        if (displayImage) {
          elements.stickerAssignPreviewImage.src = displayImage;
          elements.stickerAssignPreviewImage.style.display = 'block';
        } else {
          elements.stickerAssignPreviewImage.removeAttribute?.('src');
          elements.stickerAssignPreviewImage.style.display = 'none';
        }
      }

      buildStickerAssignAnimationOptions(currentTrigger);
      elements.stickerAssignModal.style.display = 'flex';
    }

    async function handleStickerAssignSave() {
      const stickerKey = stateRef.activeStickerAssignKey;
      if (!stickerKey) return;

      const nextTrigger = elements.stickerAssignAnimationSelect
        ? elements.stickerAssignAnimationSelect.value
        : '';
      callbacks.assignStickerToTrigger?.(stickerKey, nextTrigger);
      callbacks.saveStickerMappings?.();
      callbacks.renderAnimationMappings?.();
      refreshChatStickerUiForKey(stickerKey);
      syncPopupStickerPickerIfNeeded();
      closeStickerAssignModal();
    }

    function attachEvents() {
      if (stateRef.eventsAttached) return;
      stateRef.eventsAttached = true;

      if (elements.chatFeed) {
        elements.chatFeed.addEventListener('click', (event) => {
          const target = event?.target;
          if (!target || typeof target.closest !== 'function') return;

          const unassignButton = target.closest('.chat-sticker-unassign-btn');
          if (unassignButton) {
            event.preventDefault?.();
            const stickerKey = unassignButton.dataset?.stickerKey || '';
            if (!stickerKey) return;

            callbacks.assignStickerToTrigger?.(stickerKey, '');
            callbacks.saveStickerMappings?.();
            callbacks.renderAnimationMappings?.();
            refreshChatStickerUiForKey(stickerKey);
            syncPopupStickerPickerIfNeeded();
            return;
          }

          const assignButton = target.closest('.chat-sticker-assign-btn');
          if (!assignButton) return;
          event.preventDefault?.();
          const stickerKey = assignButton.dataset?.stickerKey || '';
          const stickerName = assignButton.dataset?.stickerName || '';
          const stickerImage = assignButton.dataset?.stickerImage || '';
          openStickerAssignFromChat(stickerKey, stickerImage, stickerName);
        });
      }

      if (elements.stickerAssignCancelBtn) {
        elements.stickerAssignCancelBtn.addEventListener('click', () => {
          closeStickerAssignModal();
        });
      }

      if (elements.stickerAssignModal) {
        elements.stickerAssignModal.addEventListener('click', (event) => {
          if (event.target === elements.stickerAssignModal) {
            closeStickerAssignModal();
          }
        });
      }

      if (elements.stickerAssignSaveBtn) {
        elements.stickerAssignSaveBtn.addEventListener('click', async () => {
          await handleStickerAssignSave();
        });
      }
    }

    function exposeWindowHelpers() {
      if (!win) return;
      win.closeStickerAssignModal = closeStickerAssignModal;
      win.openStickerAssignFromChat = openStickerAssignFromChat;
    }

    function init() {
      exposeWindowHelpers();
      attachEvents();
    }

    return {
      state: stateRef,
      buildStickerAssignAnimationOptions,
      refreshChatStickerUiForKey,
      closeStickerAssignModal,
      openStickerAssignFromChat,
      handleStickerAssignSave,
      attachEvents,
      init
    };
  }

  window.createStickerUiController = createStickerUiController;
})();

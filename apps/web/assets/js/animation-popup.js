(function initAnimationPopupModule() {
  function createAnimationPopupController({
    windowRef,
    alertFn,
    confirmFn,
    fetchFn,
    elements = {},
    state = {},
    helpers = {},
    callbacks = {}
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);

    const alertDialog = typeof alertFn === 'function'
      ? alertFn
      : (win && typeof win.alert === 'function' ? win.alert.bind(win) : () => {});
    const confirmDialog = typeof confirmFn === 'function'
      ? confirmFn
      : (win && typeof win.confirm === 'function' ? win.confirm.bind(win) : () => false);

    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);

    const stateRef = {
      activePopup: null,
      activePosition: 'bottom-left',
      eventsAttached: false
    };

    function getAnimationMappings() {
      return (state.animationMappings && typeof state.animationMappings === 'object')
        ? state.animationMappings
        : {};
    }

    function getGiftMappings() {
      return (state.giftMappings && typeof state.giftMappings === 'object')
        ? state.giftMappings
        : { byName: {}, byValue: {} };
    }

    function clampAnimationScale(value) {
      const min = 0.5;
      const max = 3;
      if (!Number.isFinite(value)) return 1;
      return Math.min(max, Math.max(min, value));
    }

    function formatAnimationScale(value) {
      const rounded = Math.round(value * 100) / 100;
      const text = rounded.toFixed(2);
      return text.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    }

    function getAnimationPopupScaleValue() {
      const scaleInput = elements.animationPopupScale;
      if (!scaleInput) return 1;
      const raw = parseFloat(scaleInput.value);
      return clampAnimationScale(raw);
    }

    function setAnimationPopupScaleValue(value) {
      const scaleInput = elements.animationPopupScale;
      if (!scaleInput) return;
      scaleInput.value = formatAnimationScale(clampAnimationScale(value));
    }

    function setAnimationPopupPosition(position) {
      stateRef.activePosition = position || 'bottom-left';
      const positionGrid = elements.animationPopupPositionGrid;
      if (!positionGrid) return;
      positionGrid.querySelectorAll('.animation-position-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.position === stateRef.activePosition);
      });
    }

    function getAnimationFileUrl(filename) {
      if (typeof helpers.getAnimationFileUrl === 'function') {
        return helpers.getAnimationFileUrl(filename);
      }
      return `/animations/${encodeURIComponent(filename || '')}`;
    }

    function stopAnimationPopupPreview() {
      const previewVideo = elements.animationPopupPreviewVideo || null;
      if (!previewVideo) return;
      try {
        previewVideo.pause();
      } catch {}
      try {
        previewVideo.currentTime = 0;
      } catch {}
    }

    function setAnimationPopupPreview(filename) {
      const previewVideo = elements.animationPopupPreviewVideo || null;
      if (!previewVideo) return;
      const safeFilename = String(filename || '').trim();
      if (!safeFilename) {
        previewVideo.removeAttribute('src');
        previewVideo.load?.();
        return;
      }
      const nextSrc = getAnimationFileUrl(safeFilename);
      if (previewVideo.getAttribute('src') !== nextSrc) {
        previewVideo.src = nextSrc;
        previewVideo.load?.();
      }
      previewVideo.muted = false;
      previewVideo.loop = true;
      previewVideo.playsInline = true;
    }

    function closeAnimationCardPopup() {
      if (!elements.animationCardPopup) return;
      stopAnimationPopupPreview();
      elements.animationCardPopup.style.display = 'none';
      stateRef.activePopup = null;
    }

    function closeAnimationGeneralSettingsPopup() {
      if (!elements.animationGeneralSettingsPopup) return;
      elements.animationGeneralSettingsPopup.style.display = 'none';
    }

    function openAnimationGeneralSettingsPopupPanel() {
      if (!elements.animationGeneralSettingsPopup) return;
      elements.animationGeneralSettingsPopup.style.display = 'flex';
    }

    function openAnimationCardPopup(trigger, filename) {
      if (!elements.animationCardPopup || !elements.animationPopupName || !elements.animationPopupScale) return;

      const mappings = getAnimationMappings();
      const currentData = helpers.toAnimationMappingObject
        ? helpers.toAnimationMappingObject(mappings[trigger], filename)
        : { file: filename, position: 'bottom-left', scale: 1 };
      const currentGiftName = helpers.findFirstGiftNameForAnimationTrigger
        ? helpers.findFirstGiftNameForAnimationTrigger(trigger)
        : '';
      const currentGiftValue = helpers.findFirstGiftValueForAnimationTrigger
        ? helpers.findFirstGiftValueForAnimationTrigger(trigger)
        : '';
      const currentStickerKey = helpers.findStickerKeyForAnimationTrigger
        ? helpers.findStickerKeyForAnimationTrigger(trigger)
        : '';
      const isDefaultGiftAnimation = helpers.isDefaultGiftAnimationTrigger
        ? helpers.isDefaultGiftAnimationTrigger(trigger)
        : false;
      const followTrigger = helpers.getEventAnimationTrigger
        ? helpers.getEventAnimationTrigger('follow')
        : '';
      const shareTrigger = helpers.getEventAnimationTrigger
        ? helpers.getEventAnimationTrigger('share')
        : '';
      stateRef.activePopup = { trigger, filename };

      elements.animationPopupName.value = trigger;
      setAnimationPopupPosition(currentData.position || 'bottom-left');
      setAnimationPopupScaleValue(currentData.scale ?? 1.0);
      if (elements.animationPopupGiftName) elements.animationPopupGiftName.value = currentGiftName;
      if (elements.animationPopupGiftValue) elements.animationPopupGiftValue.value = currentGiftValue;
      if (elements.animationPopupKeywords) {
        elements.animationPopupKeywords.value = Array.isArray(currentData.keywords)
          ? currentData.keywords.join('\n')
          : '';
        if (typeof elements.animationPopupKeywords.setAttribute === 'function') {
          elements.animationPopupKeywords.setAttribute('title', 'Keywords');
        }
      }
      if (elements.animationPopupKeywordEnabled) {
        elements.animationPopupKeywordEnabled.checked = currentData.keywordTriggerEnabled === true;
      }
      if (elements.animationPopupVoiceKeywordEnabled) {
        elements.animationPopupVoiceKeywordEnabled.checked = currentData.voiceKeywordTriggerEnabled === true;
      }
      if (typeof callbacks.populateAnimationPopupStickerOptions === 'function') {
        callbacks.populateAnimationPopupStickerOptions(currentStickerKey);
      }
      if (elements.animationPopupMapFollow) {
        elements.animationPopupMapFollow.checked = followTrigger === trigger;
      }
      if (elements.animationPopupMapShare) {
        elements.animationPopupMapShare.checked = shareTrigger === trigger;
      }
      if (elements.animationPopupMakeDefault) elements.animationPopupMakeDefault.checked = isDefaultGiftAnimation;
      setAnimationPopupPreview(filename);
      elements.animationCardPopup.style.display = 'flex';
      elements.animationPopupName.focus();
    }

    function parseKeywordList(value) {
      const seen = new Set();
      return String(value || '')
        .split(/[\n,]/)
        .map((entry) => String(entry || '').trim())
        .filter((entry) => {
          if (!entry) return false;
          const key = entry.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }

    async function handlePopupSave() {
      if (!stateRef.activePopup) return;
      const mappings = getAnimationMappings();
      const gifts = getGiftMappings();
      const oldTrigger = stateRef.activePopup.trigger;
      const filename = stateRef.activePopup.filename;

      const desiredTrigger = helpers.normalizeTriggerFromFilename
        ? helpers.normalizeTriggerFromFilename(elements.animationPopupName?.value || oldTrigger)
        : String(elements.animationPopupName?.value || oldTrigger || '').trim().toLowerCase();
      if (!desiredTrigger) {
        alertDialog('Name cannot be empty.');
        return;
      }

      const uniqueTrigger = helpers.buildUniqueAnimationTrigger
        ? helpers.buildUniqueAnimationTrigger(desiredTrigger, mappings, oldTrigger)
        : desiredTrigger;
      if (uniqueTrigger !== desiredTrigger) {
        alertDialog(`Name "${desiredTrigger}" already exists. Using "${uniqueTrigger}" instead.`);
      }

      const scaleValue = getAnimationPopupScaleValue();
      const nextGiftName = elements.animationPopupGiftName ? elements.animationPopupGiftName.value.trim() : '';
      const nextGiftValueRaw = elements.animationPopupGiftValue ? elements.animationPopupGiftValue.value.trim() : '';
      const hasGiftValueInput = nextGiftValueRaw.length > 0;
      const parsedGiftValue = Number(nextGiftValueRaw);
      if (hasGiftValueInput && (!Number.isFinite(parsedGiftValue) || parsedGiftValue <= 0)) {
        alertDialog('Diamond value must be a positive number.');
        return;
      }

      const mapFollowToAnimation = Boolean(elements.animationPopupMapFollow?.checked);
      const mapShareToAnimation = Boolean(elements.animationPopupMapShare?.checked);
      const makeDefaultGiftAnimation = Boolean(elements.animationPopupMakeDefault?.checked);
      const nextGiftValue = hasGiftValueInput ? String(Math.floor(parsedGiftValue)) : '';
      const nextStickerKey = elements.animationPopupSticker ? elements.animationPopupSticker.value : '';
      const currentData = helpers.toAnimationMappingObject
        ? helpers.toAnimationMappingObject(mappings[oldTrigger], filename)
        : { file: filename, position: 'bottom-left', scale: 1 };
      const prevGiftName = helpers.findFirstGiftNameForAnimationTrigger
        ? helpers.findFirstGiftNameForAnimationTrigger(oldTrigger)
        : '';
      const prevGiftValue = helpers.findFirstGiftValueForAnimationTrigger
        ? helpers.findFirstGiftValueForAnimationTrigger(oldTrigger)
        : '';

      const updatedData = {
        file: filename,
        position: stateRef.activePosition || currentData.position || 'bottom-left',
        scale: Number.isFinite(scaleValue) ? scaleValue : currentData.scale,
        keywords: elements.animationPopupKeywords
          ? parseKeywordList(elements.animationPopupKeywords.value)
          : (Array.isArray(currentData.keywords) ? currentData.keywords : []),
        keywordTriggerEnabled: Boolean(elements.animationPopupKeywordEnabled?.checked),
        voiceKeywordTriggerEnabled: Boolean(elements.animationPopupVoiceKeywordEnabled?.checked)
      };

      callbacks.moveGiftAnimationReferences?.(oldTrigger, uniqueTrigger);
      callbacks.moveStickerAnimationReferences?.(oldTrigger, uniqueTrigger);
      callbacks.moveEventAnimationReferences?.(oldTrigger, uniqueTrigger);

      if (oldTrigger !== uniqueTrigger) {
        delete mappings[oldTrigger];
      }
      mappings[uniqueTrigger] = updatedData;

      if (prevGiftName && prevGiftName !== nextGiftName) {
        callbacks.removeGiftAnimationReferenceForKey?.(gifts.byName, prevGiftName, uniqueTrigger);
      }
      if (nextGiftName) {
        callbacks.addGiftAnimationReference?.(gifts.byName, nextGiftName, uniqueTrigger);
      }

      if (prevGiftValue && prevGiftValue !== nextGiftValue) {
        callbacks.removeGiftAnimationReferenceForKey?.(gifts.byValue, prevGiftValue, uniqueTrigger);
      }
      if (nextGiftValue) {
        callbacks.addGiftAnimationReference?.(gifts.byValue, nextGiftValue, uniqueTrigger);
      }

      if (makeDefaultGiftAnimation) {
        callbacks.addDefaultGiftAnimationReference?.(uniqueTrigger);
      } else {
        callbacks.removeDefaultGiftAnimationReference?.(uniqueTrigger);
      }

      const previousFollowTrigger = helpers.getEventAnimationTrigger
        ? helpers.getEventAnimationTrigger('follow')
        : '';
      const previousShareTrigger = helpers.getEventAnimationTrigger
        ? helpers.getEventAnimationTrigger('share')
        : '';
      if (mapFollowToAnimation) {
        callbacks.setEventAnimationTrigger?.('follow', uniqueTrigger);
      } else if (previousFollowTrigger === oldTrigger || previousFollowTrigger === uniqueTrigger) {
        callbacks.setEventAnimationTrigger?.('follow', '');
      }

      if (mapShareToAnimation) {
        callbacks.setEventAnimationTrigger?.('share', uniqueTrigger);
      } else if (previousShareTrigger === oldTrigger || previousShareTrigger === uniqueTrigger) {
        callbacks.setEventAnimationTrigger?.('share', '');
      }

      callbacks.setStickerForAnimationTrigger?.(uniqueTrigger, nextStickerKey);

      await callbacks.saveAnimationMappings?.();
      callbacks.saveGiftMappings?.();
      callbacks.saveEventAnimationMappings?.();
      callbacks.saveStickerMappings?.();
      callbacks.renderGiftMappings?.();
      callbacks.renderAnimationMappings?.();
      closeAnimationCardPopup();
    }

    async function handlePopupDelete() {
      if (!stateRef.activePopup) return;
      const mappings = getAnimationMappings();
      const { filename } = stateRef.activePopup;
      const shouldDelete = confirmDialog(`Delete file "${filename}" from /animations?`);
      if (!shouldDelete) return;

      if (!callFetch) {
        alertDialog('Delete failed: fetch is not available in this environment.');
        return;
      }

      try {
        const response = await callFetch(`/api/animations/file/${encodeURIComponent(filename)}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Delete failed');
        }

        Object.keys(mappings).forEach((trigger) => {
          const file = helpers.getAnimationFileFromMapping
            ? helpers.getAnimationFileFromMapping(mappings[trigger])
            : '';
          if (file !== filename) return;
          callbacks.removeGiftAnimationReferences?.(trigger);
          callbacks.removeEventAnimationReferences?.(trigger);
          callbacks.removeStickerAnimationReferences?.(trigger);
          delete mappings[trigger];
        });

        await callbacks.saveAnimationMappings?.();
        callbacks.saveGiftMappings?.();
        callbacks.saveEventAnimationMappings?.();
        callbacks.saveStickerMappings?.();
        callbacks.renderGiftMappings?.();
        await callbacks.loadAvailableAnimations?.();
        closeAnimationCardPopup();
      } catch (err) {
        console.error('Animation delete error:', err);
        alertDialog(`Failed to delete animation: ${err.message}`);
      }
    }

    function attachEvents() {
      if (stateRef.eventsAttached) return;
      stateRef.eventsAttached = true;

      if (elements.animationPopupCancelBtn) {
        elements.animationPopupCancelBtn.addEventListener('click', closeAnimationCardPopup);
      }
      if (elements.animationPopupBackdrop) {
        elements.animationPopupBackdrop.addEventListener('click', closeAnimationCardPopup);
      }
      if (elements.openAnimationGeneralSettingsBtn) {
        elements.openAnimationGeneralSettingsBtn.addEventListener('click', (event) => {
          event.preventDefault();
          openAnimationGeneralSettingsPopupPanel();
        });
      }
      if (elements.animationGeneralSettingsCloseBtn) {
        elements.animationGeneralSettingsCloseBtn.addEventListener('click', closeAnimationGeneralSettingsPopup);
      }
      if (elements.animationGeneralSettingsBackdrop) {
        elements.animationGeneralSettingsBackdrop.addEventListener('click', closeAnimationGeneralSettingsPopup);
      }
      if (elements.animationPopupPositionGrid) {
        elements.animationPopupPositionGrid.querySelectorAll('.animation-position-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            setAnimationPopupPosition(btn.dataset.position);
          });
        });
      }
      if (elements.animationPopupScaleUpBtn) {
        elements.animationPopupScaleUpBtn.addEventListener('click', () => {
          const nextValue = getAnimationPopupScaleValue() + 0.25;
          setAnimationPopupScaleValue(nextValue);
        });
      }
      if (elements.animationPopupScaleDownBtn) {
        elements.animationPopupScaleDownBtn.addEventListener('click', () => {
          const nextValue = getAnimationPopupScaleValue() - 0.25;
          setAnimationPopupScaleValue(nextValue);
        });
      }
      if (elements.animationPopupSaveBtn) {
        elements.animationPopupSaveBtn.addEventListener('click', async () => {
          await handlePopupSave();
        });
      }
      if (elements.animationPopupDeleteBtn) {
        elements.animationPopupDeleteBtn.addEventListener('click', async () => {
          await handlePopupDelete();
        });
      }
    }

    return {
      state: stateRef,
      clampAnimationScale,
      formatAnimationScale,
      getAnimationPopupScaleValue,
      setAnimationPopupScaleValue,
      setAnimationPopupPosition,
      closeAnimationCardPopup,
      closeAnimationGeneralSettingsPopup,
      openAnimationGeneralSettingsPopupPanel,
      openAnimationCardPopup,
      getActivePopup: () => stateRef.activePopup,
      getActivePosition: () => stateRef.activePosition,
      attachEvents
    };
  }

  window.createAnimationPopupController = createAnimationPopupController;
})();

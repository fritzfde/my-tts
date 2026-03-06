(function initAnimationUiModule() {
  function createAnimationUiController({
    windowRef,
    documentRef,
    IntersectionObserverRef,
    promptFn,
    alertFn,
    fetchFn,
    settingsStore,
    elements = {},
    state = {},
    helpers = {},
    callbacks = {},
    defaults = {}
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const IntersectionObserverCtor = IntersectionObserverRef
      || (win && win.IntersectionObserver)
      || (typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : null);

    const promptDialog = typeof promptFn === 'function'
      ? promptFn
      : (win && typeof win.prompt === 'function' ? win.prompt.bind(win) : null);
    const alertDialog = typeof alertFn === 'function'
      ? alertFn
      : (win && typeof win.alert === 'function' ? win.alert.bind(win) : () => {});

    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);

    const stateRef = {
      animationThumbnailObserver: null,
      controlsInitialized: false,
      eventsAttached: false
    };

    function getAvailableAnimations() {
      return Array.isArray(state.availableAnimations) ? state.availableAnimations : [];
    }

    function getAnimationMappings() {
      return (state.animationMappings && typeof state.animationMappings === 'object')
        ? state.animationMappings
        : {};
    }

    function getActivePlaybackMap() {
      return state.activeAnimationCardPlayback instanceof Map
        ? state.activeAnimationCardPlayback
        : new Map();
    }

    function normalizeTriggerFromFilename(filename) {
      if (typeof helpers.normalizeTriggerFromFilename === 'function') {
        return helpers.normalizeTriggerFromFilename(filename);
      }
      return String(filename || '')
        .replace(/\.[^/.]+$/, '')
        .trim()
        .toLowerCase();
    }

    function getAnimationFileFromMapping(data) {
      if (typeof helpers.getAnimationFileFromMapping === 'function') {
        return helpers.getAnimationFileFromMapping(data);
      }
      if (typeof data === 'string') return data;
      if (typeof data === 'object' && data !== null) return data.file || '';
      return '';
    }

    function escapeAttribute(value) {
      if (typeof helpers.escapeAttribute === 'function') {
        return helpers.escapeAttribute(value);
      }
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function ensureAnimationVideoSource(video) {
      if (!video) return;
      if (typeof callbacks.bindAnimationThumbnailDurationListener === 'function') {
        callbacks.bindAnimationThumbnailDurationListener(video);
      }
      if (video.dataset.src && !video.getAttribute('src')) {
        video.setAttribute('src', video.dataset.src);
        video.load();
      }
    }

    function playAnimationThumbnail(video) {
      if (!video) return;
      ensureAnimationVideoSource(video);
      if (video.paused) {
        video.play().catch(() => {});
      }
    }

    function stopAnimationThumbnail(video) {
      if (!video) return;
      video.pause();
      try {
        video.currentTime = 0;
      } catch (err) {
        // Some browsers may block currentTime until metadata is available.
      }
    }

    function isThumbnailInteractionActive(button) {
      if (!button) return false;
      return (
        button.matches(':hover')
        || button.matches(':focus')
        || button.matches(':focus-visible')
      );
    }

    function wireThumbnailLazyLoading(container) {
      if (stateRef.animationThumbnailObserver) {
        stateRef.animationThumbnailObserver.disconnect();
        stateRef.animationThumbnailObserver = null;
      }

      if (!container) return;
      const videos = container.querySelectorAll('.animation-thumb-video');
      if (videos.length === 0) return;

      if (!IntersectionObserverCtor) {
        videos.forEach((video) => ensureAnimationVideoSource(video));
        return;
      }

      stateRef.animationThumbnailObserver = new IntersectionObserverCtor((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          ensureAnimationVideoSource(entry.target);
          observer.unobserve(entry.target);
        });
      }, {
        root: container,
        rootMargin: '160px 0px',
        threshold: 0.01
      });

      videos.forEach((video) => {
        if (typeof callbacks.bindAnimationThumbnailDurationListener === 'function') {
          callbacks.bindAnimationThumbnailDurationListener(video);
        }

        // If src is already set, skip observer-driven hydration to avoid visible flicker on rerender.
        if (video.getAttribute('src')) return;
        stateRef.animationThumbnailObserver.observe(video);
      });
    }

    function wireThumbnailHoverPlayback(container) {
      if (!container) return;
      const cardButtons = container.querySelectorAll('.preview-mapping-btn');

      cardButtons.forEach((btn) => {
        const video = btn.querySelector('.animation-thumb-video');
        if (!video) return;

        const play = () => {
          playAnimationThumbnail(video);
        };

        const stop = () => {
          const card = btn.closest('.animation-mapping-card');
          if (card && card.classList.contains('playing')) return;
          stopAnimationThumbnail(video);
        };

        if (btn.closest('.animation-mapping-card')?.classList.contains('playing')) {
          play();
        } else {
          stop();
        }

        btn.addEventListener('mouseenter', play);
        btn.addEventListener('mouseleave', stop);
        btn.addEventListener('focus', play);
        btn.addEventListener('blur', stop);
      });
    }

    function getFilteredSortedAnimationCards() {
      const sortMode = elements.animationSortSelect?.value || 'name';
      const mapFilter = elements.animationMapFilterSelect?.value || 'all';
      const stickerFilter = elements.animationStickerFilterSelect?.value || 'all';

      const cards = getAvailableAnimations().map((anim) => {
        const mapped = typeof helpers.findAnimationMappingEntryByFile === 'function'
          ? helpers.findAnimationMappingEntryByFile(anim.filename)
          : null;
        const trigger = mapped ? mapped.trigger : normalizeTriggerFromFilename(anim.filename);
        const giftNames = typeof helpers.findGiftNamesForAnimationTrigger === 'function'
          ? helpers.findGiftNamesForAnimationTrigger(trigger)
          : [];
        const giftValues = typeof helpers.findGiftValuesForAnimationTrigger === 'function'
          ? helpers.findGiftValuesForAnimationTrigger(trigger)
          : [];
        const hasDefaultGift = typeof helpers.isDefaultGiftAnimationTrigger === 'function'
          ? helpers.isDefaultGiftAnimationTrigger(trigger)
          : false;

        const numericGiftValues = giftValues
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0);
        const hasNumericGiftValue = numericGiftValues.length > 0;
        const hasGiftNameMapping = giftNames.length > 0;

        const hasGiftMapping = hasGiftNameMapping || giftValues.length > 0 || hasDefaultGift;
        const hasStickerMapping = typeof helpers.hasStickerForAnimationTrigger === 'function'
          ? helpers.hasStickerForAnimationTrigger(trigger)
          : false;
        const mappedAny = hasGiftMapping || hasStickerMapping;
        const timestampMsRaw = Number(
          anim?.mtimeMs ?? anim?.modifiedAtMs ?? anim?.birthtimeMs ?? anim?.createdAtMs ?? 0
        );
        const timestampMs = Number.isFinite(timestampMsRaw) ? timestampMsRaw : 0;

        const hasDefaultOnly = hasDefaultGift && !hasNumericGiftValue && !hasGiftNameMapping;
        let valueSortBucket = 5; // fallback: unmapped/other
        if (hasDefaultOnly) {
          valueSortBucket = 0; // default-only fallback
        } else if (hasNumericGiftValue) {
          valueSortBucket = 1; // value-based gift mappings (1,2,3...)
        } else if (hasGiftNameMapping) {
          valueSortBucket = 2; // gift-name mappings
        } else if (hasStickerMapping) {
          valueSortBucket = 3; // sticker-only mappings
        } else if (mappedAny) {
          valueSortBucket = 4; // other mapped cases
        }

        return {
          anim,
          trigger,
          giftSortKey: (giftNames[0] || '').toLowerCase(),
          valueSortKey: hasNumericGiftValue
            ? Math.min(...numericGiftValues)
            : Number.POSITIVE_INFINITY,
          valueSortBucket,
          hasDefaultGift,
          hasNumericGiftValue,
          hasGiftNameMapping,
          timestampMs,
          hasStickerMapping,
          mappedAny
        };
      });

      const filtered = cards.filter((card) => {
        if (mapFilter === 'mapped' && !card.mappedAny) return false;
        if (mapFilter === 'unmapped' && card.mappedAny) return false;
        if (stickerFilter === 'with-sticker' && !card.hasStickerMapping) return false;
        if (stickerFilter === 'without-sticker' && card.hasStickerMapping) return false;
        return true;
      });

      filtered.sort((a, b) => {
        if (sortMode === 'newest') {
          const byNewest = b.timestampMs - a.timestampMs;
          if (byNewest !== 0) return byNewest;
        } else if (sortMode === 'oldest') {
          const byOldest = a.timestampMs - b.timestampMs;
          if (byOldest !== 0) return byOldest;
        } else if (sortMode === 'gift') {
          if (a.giftSortKey && !b.giftSortKey) return -1;
          if (!a.giftSortKey && b.giftSortKey) return 1;
          const byGift = a.giftSortKey.localeCompare(b.giftSortKey);
          if (byGift !== 0) return byGift;
        } else if (sortMode === 'value') {
          const byBucket = a.valueSortBucket - b.valueSortBucket;
          if (byBucket !== 0) return byBucket;

          if (a.hasNumericGiftValue && b.hasNumericGiftValue) {
            const byValue = a.valueSortKey - b.valueSortKey;
            if (byValue !== 0) return byValue;
          }

          if (a.hasGiftNameMapping && b.hasGiftNameMapping) {
            const byGiftName = a.giftSortKey.localeCompare(b.giftSortKey);
            if (byGiftName !== 0) return byGiftName;
          }
        }
        return a.trigger.localeCompare(b.trigger);
      });

      return filtered;
    }

    function captureRenderedThumbnailVideos(container) {
      const byFile = new Map();
      if (!container || typeof container.querySelectorAll !== 'function') return byFile;

      container.querySelectorAll('.animation-thumb-video').forEach((video) => {
        const file = video?.dataset?.file || '';
        if (!file || byFile.has(file)) return;
        byFile.set(file, video);
      });

      return byFile;
    }

    function restoreRenderedThumbnailVideos(container, previousVideosByFile) {
      if (!container || typeof container.querySelectorAll !== 'function') return;
      if (!(previousVideosByFile instanceof Map) || previousVideosByFile.size === 0) return;

      container.querySelectorAll('.animation-thumb-video').forEach((nextVideo) => {
        const file = nextVideo?.dataset?.file || '';
        if (!file) return;

        const previousVideo = previousVideosByFile.get(file);
        if (!previousVideo) return;

        if (typeof callbacks.bindAnimationThumbnailDurationListener === 'function') {
          callbacks.bindAnimationThumbnailDurationListener(previousVideo);
        }

        previousVideo.className = nextVideo.className;
        previousVideo.dataset.src = nextVideo.dataset.src || previousVideo.dataset.src || '';
        previousVideo.dataset.file = nextVideo.dataset.file || previousVideo.dataset.file || '';
        previousVideo.muted = true;
        previousVideo.loop = true;
        previousVideo.playsInline = true;
        previousVideo.preload = 'metadata';
        if (!previousVideo.getAttribute('src') && previousVideo.dataset.src) {
          previousVideo.setAttribute('src', previousVideo.dataset.src);
        }

        if (typeof nextVideo.replaceWith === 'function') {
          nextVideo.replaceWith(previousVideo);
        }
      });
    }

    function renderAnimationMappings() {
      const list = elements.animationMappingsList;
      if (!list) return;

      if (typeof callbacks.updateStopAnimationButtonState === 'function') {
        callbacks.updateStopAnimationButtonState();
      }

      const availableAnimations = getAvailableAnimations();
      if (availableAnimations.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; grid-column: 1 / -1;">No animation files found in /animations folder. Upload one to get started.</div>';
        return;
      }

      const cards = getFilteredSortedAnimationCards();
      if (cards.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; grid-column: 1 / -1;">No animations match current sort/filter.</div>';
        return;
      }

      const previousVideosByFile = captureRenderedThumbnailVideos(list);
      const activePlayback = getActivePlaybackMap();
      list.innerHTML = cards.map(({ anim, trigger }) => {
        const safeTrigger = escapeAttribute(trigger);
        const safeFilename = escapeAttribute(anim.filename);
        const fileUrl = typeof helpers.getAnimationFileUrl === 'function'
          ? helpers.getAnimationFileUrl(anim.filename)
          : `/animations/${encodeURIComponent(anim.filename)}`;
        const visibilityBadges = typeof helpers.renderAnimationVisibilityBadges === 'function'
          ? helpers.renderAnimationVisibilityBadges(trigger)
          : '';

        const playbackState = activePlayback.get(trigger);
        const now = Date.now();
        const isPlaying = Boolean(playbackState && playbackState.endAtMs > now);
        let playProgress = 0;
        let countdown = '';

        if (isPlaying) {
          const remainingMs = Math.max(0, playbackState.endAtMs - now);
          const totalMs = Math.max(200, playbackState.durationSeconds * 1000);
          const elapsedMs = Math.max(0, totalMs - remainingMs);
          playProgress = Math.min(1, elapsedMs / totalMs);
          countdown = typeof helpers.formatAnimationPlaybackCountdown === 'function'
            ? helpers.formatAnimationPlaybackCountdown(remainingMs)
            : '';
        }

        return `
    <div class="animation-mapping-card${isPlaying ? ' playing' : ''}" data-animation-trigger="${safeTrigger}" data-animation-file="${safeFilename}" style="--play-progress:${playProgress.toFixed(4)}" title="${safeTrigger}">
      <button class="secondary animation-thumb-btn preview-mapping-btn" data-trigger="${safeTrigger}" title="${safeTrigger}">
        <video class="animation-thumb-video" src="${fileUrl}" data-src="${fileUrl}" data-file="${safeFilename}" muted loop playsinline preload="metadata"></video>
        ${visibilityBadges}
        <span class="animation-thumb-overlay">▶ Play</span>
        <span class="animation-playing-state" aria-hidden="true">
          <span class="animation-playing-label">Playing</span>
          <span class="animation-playing-countdown">${countdown}</span>
          <span class="animation-playing-progress"><span class="animation-playing-progress-fill"></span></span>
        </span>
      </button>
      <button class="animation-gear-btn open-animation-settings-btn" data-trigger="${safeTrigger}" data-file="${safeFilename}" title="Settings">⚙️</button>
    </div>
  `;
      }).join('');

      restoreRenderedThumbnailVideos(list, previousVideosByFile);

      wireThumbnailLazyLoading(list);
      wireThumbnailHoverPlayback(list);

      list.querySelectorAll('.preview-mapping-btn').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          const trigger = event.currentTarget.dataset.trigger;
          const animationData = getAnimationMappings()[trigger];
          const filename = getAnimationFileFromMapping(animationData);

          console.log(`🎬 Testing: ${trigger} → ${filename}`);
          if (typeof callbacks.triggerAnimation === 'function') {
            const success = await callbacks.triggerAnimation(trigger, 'manual', 'Test', 'test');
            if (success) {
              console.log(`✅ Triggered: ${trigger}`);
            }
          }
        });
      });

      list.querySelectorAll('.open-animation-settings-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof callbacks.openAnimationCardPopup === 'function') {
            callbacks.openAnimationCardPopup(btn.dataset.trigger, btn.dataset.file);
          }
        });
      });

      if (typeof callbacks.updateAnimationPlaybackUi === 'function') {
        callbacks.updateAnimationPlaybackUi();
      }
    }

    function initAnimationListControls() {
      if (stateRef.controlsInitialized) return;
      stateRef.controlsInitialized = true;

      const controls = [
        { element: elements.animationSortSelect, key: 'animation_sort_mode', fallback: 'name' },
        { element: elements.animationMapFilterSelect, key: 'animation_map_filter', fallback: 'all' },
        { element: elements.animationStickerFilterSelect, key: 'animation_sticker_filter', fallback: 'all' }
      ];

      controls.forEach(({ element, key, fallback }) => {
        if (!element) return;
        const saved = settingsStore?.getItem?.(key);
        if (saved && Array.from(element.options).some((opt) => opt.value === saved)) {
          element.value = saved;
        } else {
          element.value = fallback;
        }
        element.addEventListener('change', () => {
          settingsStore?.setItem?.(key, element.value);
          renderAnimationMappings();
        });
      });
    }

    function attachEvents() {
      if (stateRef.eventsAttached) return;
      stateRef.eventsAttached = true;

      if (elements.uploadAnimationBtn && elements.uploadAnimationInput) {
        elements.uploadAnimationBtn.addEventListener('click', () => elements.uploadAnimationInput.click());
        elements.uploadAnimationInput.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;

          const defaultName = normalizeTriggerFromFilename(file.name) || 'animation';
          const nameInput = promptDialog
            ? promptDialog('Animation name:', defaultName)
            : defaultName;

          if (nameInput === null) {
            elements.uploadAnimationInput.value = '';
            return;
          }

          const customName = String(nameInput || '').trim() || defaultName;
          const formData = new FormData();
          formData.append('animation', file);
          formData.append('name', customName);

          if (!callFetch) {
            alertDialog('Upload failed: fetch is not available in this environment.');
            elements.uploadAnimationInput.value = '';
            return;
          }

          try {
            const response = await callFetch('/api/animations/upload', {
              method: 'POST',
              body: formData
            });

            if (!response.ok) {
              const err = await response.json().catch(() => ({}));
              throw new Error(err.error || 'Upload failed');
            }

            if (typeof callbacks.loadAvailableAnimations === 'function') {
              await callbacks.loadAvailableAnimations();
            }
          } catch (err) {
            console.error('Animation upload error:', err);
            alertDialog(`Upload failed: ${err.message}`);
          } finally {
            elements.uploadAnimationInput.value = '';
          }
        });
      }

      if (elements.syncAnimationsBtn) {
        elements.syncAnimationsBtn.addEventListener('click', async () => {
          try {
            if (typeof callbacks.loadAvailableAnimations === 'function') {
              await callbacks.loadAvailableAnimations();
            }
            if (typeof callbacks.syncAnimationMappingsFromFiles === 'function') {
              await callbacks.syncAnimationMappingsFromFiles({ showAlert: true });
            }
            renderAnimationMappings();
          } catch (err) {
            console.error('Sync animations error:', err);
            alertDialog('Failed to sync animations');
          }
        });
      }

      if (elements.stopAnimationBtn) {
        if (typeof callbacks.updateStopAnimationButtonState === 'function') {
          callbacks.updateStopAnimationButtonState();
        }

        elements.stopAnimationBtn.addEventListener('click', async () => {
          elements.stopAnimationBtn.disabled = true;
          if (typeof callbacks.stopAllActiveAnimations === 'function') {
            await callbacks.stopAllActiveAnimations();
          }
          if (typeof callbacks.updateStopAnimationButtonState === 'function') {
            callbacks.updateStopAnimationButtonState();
          }
        });
      }
    }

    function init() {
      initAnimationListControls();
      attachEvents();
    }

    return {
      state: stateRef,
      ensureAnimationVideoSource,
      playAnimationThumbnail,
      stopAnimationThumbnail,
      isThumbnailInteractionActive,
      wireThumbnailLazyLoading,
      wireThumbnailHoverPlayback,
      getFilteredSortedAnimationCards,
      renderAnimationMappings,
      initAnimationListControls,
      attachEvents,
      init
    };
  }

  window.createAnimationUiController = createAnimationUiController;
})();

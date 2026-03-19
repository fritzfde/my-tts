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
      eventsAttached: false,
      currentSortMode: '',
      currentSortDirection: '',
      currentMapFilter: 'all',
      currentStickerFilter: 'all',
      currentKeywordFilter: '',
      customOrder: [],
      durationSortProbeInFlight: new Set(),
      durationSortProbeAttempted: new Set(),
      durationSortProbeQueue: [],
      durationSortProbeQueued: new Set(),
      durationSortRerenderTimer: null
    };
    const SORT_DIRECTION_UP = 'asc';
    const SORT_DIRECTION_DOWN = 'desc';
    const DURATION_SORT_PROBE_CONCURRENCY = 2;
    const DURATION_SORT_RERENDER_DEBOUNCE_MS = 120;
    const DURATION_BADGE_WARM_LIMIT = 36;
    const SORT_MODE_DEFAULT_DIRECTION = {
      name: SORT_DIRECTION_UP,
      gift: SORT_DIRECTION_UP,
      value: SORT_DIRECTION_UP,
      length: SORT_DIRECTION_DOWN
    };
    const MAP_FILTER_VALUES = ['all', 'mapped', 'unmapped'];
    const STICKER_FILTER_VALUES = ['all', 'with-sticker', 'without-sticker'];
    const KEYWORD_FILTER_STORAGE_KEY = 'animation_keyword_filter';

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
      bindDurationBadgeListener(video);
      if (video.dataset.src && !video.getAttribute('src')) {
        video.setAttribute('src', video.dataset.src);
        video.load();
      }
    }

    function formatDurationBadgeLabel(durationSeconds) {
      const numeric = Number(durationSeconds);
      if (!Number.isFinite(numeric) || numeric <= 0) return '';
      return `${Math.ceil(numeric)}s`;
    }

    function updateDurationBadgeForVideo(video) {
      if (!video) return;
      const card = typeof video.closest === 'function'
        ? video.closest('.animation-mapping-card')
        : null;
      if (!card) return;
      const badge = card.querySelector('.animation-thumb-duration');
      if (!badge) return;
      const label = formatDurationBadgeLabel(video.duration);
      badge.textContent = label;
      badge.classList.toggle('is-visible', Boolean(label));
    }

    function bindDurationBadgeListener(video) {
      if (!video) return;
      if (video.dataset.durationBadgeBound !== '1') {
        video.dataset.durationBadgeBound = '1';
        video.addEventListener('loadedmetadata', () => {
          updateDurationBadgeForVideo(video);
        });
      }
      updateDurationBadgeForVideo(video);
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

    function normalizeSortMode(value) {
      const raw = String(value || '').trim().toLowerCase();
      if (raw === 'oldest' || raw === 'newest') return 'name';
      if (raw === 'gift' || raw === 'value' || raw === 'length' || raw === 'name') return raw;
      return 'name';
    }

    function normalizeSortDirection(value, fallback = SORT_DIRECTION_UP) {
      const raw = String(value || '').trim().toLowerCase();
      if (raw === SORT_DIRECTION_UP || raw === SORT_DIRECTION_DOWN) return raw;
      return fallback;
    }

    function getDefaultSortDirection(sortMode) {
      return SORT_MODE_DEFAULT_DIRECTION[sortMode] || SORT_DIRECTION_UP;
    }

    function toLegacySortSelectValue(sortMode, sortDirection) {
      if (sortMode === 'name') {
        return sortDirection === SORT_DIRECTION_DOWN ? 'newest' : 'oldest';
      }
      return sortMode;
    }

    function normalizeFilterValue(value, allowed, fallback) {
      const raw = String(value || '').trim().toLowerCase();
      return allowed.includes(raw) ? raw : fallback;
    }

    function normalizeKeywordFilter(value) {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    function parseCustomOrder(rawValue) {
      if (!rawValue) return [];
      try {
        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((entry) => typeof entry === 'string' && entry.trim())
          .map((entry) => entry.trim());
      } catch (err) {
        return [];
      }
    }

    function compareCardsBySortMode(a, b, sortMode) {
      if (sortMode === 'name') {
        const byOldest = a.timestampMs - b.timestampMs;
        if (byOldest !== 0) return byOldest;
        return a.trigger.localeCompare(b.trigger);
      }

      if (sortMode === 'gift') {
        if (a.giftSortKey && !b.giftSortKey) return -1;
        if (!a.giftSortKey && b.giftSortKey) return 1;
        const byGift = a.giftSortKey.localeCompare(b.giftSortKey);
        if (byGift !== 0) return byGift;
        return 0;
      }

      if (sortMode === 'value') {
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

      if (sortMode === 'length') {
        const byDuration = a.durationSortKey - b.durationSortKey;
        if (byDuration !== 0) return byDuration;
      }

      return a.trigger.localeCompare(b.trigger);
    }

    function getKnownDurationSecondsForAnimation(anim) {
      const directDuration = Number(anim?.durationSeconds ?? anim?.duration ?? anim?.lengthSeconds ?? 0);
      if (Number.isFinite(directDuration) && directDuration > 0) {
        return directDuration;
      }

      if (typeof helpers.getCachedAnimationDurationSeconds === 'function') {
        const cachedDuration = Number(helpers.getCachedAnimationDurationSeconds(anim?.filename || ''));
        if (Number.isFinite(cachedDuration) && cachedDuration > 0) {
          return cachedDuration;
        }
      }

      return null;
    }

    function scheduleDurationMetadataRerender() {
      if (stateRef.durationSortRerenderTimer) return;
      stateRef.durationSortRerenderTimer = setTimeout(() => {
        stateRef.durationSortRerenderTimer = null;
        if (elements.animationMappingsList) {
          renderAnimationMappings();
        }
      }, DURATION_SORT_RERENDER_DEBOUNCE_MS);
    }

    function drainDurationSortProbeQueue() {
      while (
        stateRef.durationSortProbeInFlight.size < DURATION_SORT_PROBE_CONCURRENCY
        && stateRef.durationSortProbeQueue.length > 0
      ) {
        const filename = stateRef.durationSortProbeQueue.shift();
        if (!filename) continue;
        stateRef.durationSortProbeQueued.delete(filename);
        stateRef.durationSortProbeInFlight.add(filename);

        Promise.resolve(helpers.probeAnimationDurationSeconds(filename))
          .catch((err) => {
            console.debug('Animation duration sort probe failed:', err);
            return null;
          })
          .finally(() => {
            stateRef.durationSortProbeInFlight.delete(filename);
            scheduleDurationMetadataRerender();
            drainDurationSortProbeQueue();
          });
      }
    }

    function scheduleDurationSortProbe(filename) {
      if (!filename) return;
      if (stateRef.durationSortProbeInFlight.has(filename)) return;
      if (stateRef.durationSortProbeAttempted.has(filename)) return;
      if (stateRef.durationSortProbeQueued.has(filename)) return;
      if (typeof helpers.probeAnimationDurationSeconds !== 'function') return;

      stateRef.durationSortProbeAttempted.add(filename);
      stateRef.durationSortProbeQueued.add(filename);
      stateRef.durationSortProbeQueue.push(filename);
      drainDurationSortProbeQueue();
    }

    function warmDurationMetadata(cards = []) {
      const eagerAll = stateRef.currentSortMode === 'length';
      const cardsToWarm = eagerAll ? cards : cards.slice(0, DURATION_BADGE_WARM_LIMIT);
      cardsToWarm.forEach((card) => {
        if (card.hasKnownDuration) return;
        scheduleDurationSortProbe(card.anim?.filename || '');
      });
    }

    function getEffectiveCustomOrder(cards) {
      const validTriggers = new Set(cards.map((card) => card.trigger));
      const cleaned = stateRef.customOrder.filter((trigger) => validTriggers.has(trigger));
      const missingCards = cards
        .filter((card) => !cleaned.includes(card.trigger))
        .sort((a, b) => compareCardsBySortMode(a, b, 'name'));
      const missing = missingCards.map((card) => card.trigger);
      return cleaned.concat(missing);
    }

    function moveTriggerInCustomOrder(draggedTrigger, targetTrigger) {
      if (!draggedTrigger || !targetTrigger || draggedTrigger === targetTrigger) return false;
      const allCards = buildAnimationCardMetadata();
      const nextOrder = getEffectiveCustomOrder(allCards);
      const fromIndex = nextOrder.indexOf(draggedTrigger);
      const toIndex = nextOrder.indexOf(targetTrigger);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;
      nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, draggedTrigger);
      stateRef.customOrder = nextOrder;
      return true;
    }

    function renderSortButtonsUi() {
      const sortButtons = Array.isArray(elements.animationSortChipButtons)
        ? elements.animationSortChipButtons
        : [];
      if (sortButtons.length === 0) return;

      sortButtons.forEach((button) => {
        if (!button) return;
        const mode = normalizeSortMode(button.dataset?.sortMode || 'name');
        const baseLabel = String(button.dataset?.baseLabel || button.textContent || '').trim() || mode;
        button.dataset.baseLabel = baseLabel;
        const active = mode === stateRef.currentSortMode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        if (active) {
          const arrow = stateRef.currentSortDirection === SORT_DIRECTION_UP ? '↑' : '↓';
          button.textContent = `${baseLabel} ${arrow}`;
        } else {
          button.textContent = baseLabel;
        }
      });
    }

    function renderFilterButtonsUi() {
      const mapFilterBtn = elements.animationMapFilterBtn || null;
      const stickerFilterBtn = elements.animationStickerFilterBtn || null;
      const mapLabels = { all: 'All', mapped: 'Mapped', unmapped: 'Unmapped' };
      const stickerLabels = { all: 'All', 'with-sticker': 'With Sticker', 'without-sticker': 'Without Sticker' };

      if (mapFilterBtn) {
        mapFilterBtn.textContent = `Mappings: ${mapLabels[stateRef.currentMapFilter] || 'All'}`;
        mapFilterBtn.classList.toggle('active', stateRef.currentMapFilter !== 'all');
      }
      if (stickerFilterBtn) {
        stickerFilterBtn.textContent = `Stickers: ${stickerLabels[stateRef.currentStickerFilter] || 'All'}`;
        stickerFilterBtn.classList.toggle('active', stateRef.currentStickerFilter !== 'all');
      }
    }

    function syncHiddenControlsFromState() {
      if (elements.animationSortSelect) {
        elements.animationSortSelect.value = toLegacySortSelectValue(
          stateRef.currentSortMode,
          stateRef.currentSortDirection
        );
      }
      if (elements.animationMapFilterSelect) {
        elements.animationMapFilterSelect.value = stateRef.currentMapFilter;
      }
      if (elements.animationStickerFilterSelect) {
        elements.animationStickerFilterSelect.value = stateRef.currentStickerFilter;
      }
      if (elements.animationKeywordFilterInput) {
        elements.animationKeywordFilterInput.value = stateRef.currentKeywordFilter;
      }
    }

    function persistListControlsState() {
      settingsStore?.setItem?.('animation_sort_mode', toLegacySortSelectValue(
        stateRef.currentSortMode,
        stateRef.currentSortDirection
      ));
      settingsStore?.setItem?.('animation_sort_direction', stateRef.currentSortDirection);
      settingsStore?.setItem?.('animation_map_filter', stateRef.currentMapFilter);
      settingsStore?.setItem?.('animation_sticker_filter', stateRef.currentStickerFilter);
      settingsStore?.setItem?.(KEYWORD_FILTER_STORAGE_KEY, stateRef.currentKeywordFilter);
      settingsStore?.setItem?.('animation_custom_order', JSON.stringify(stateRef.customOrder || []));
    }

    function applyListControlsState({ rerender = true } = {}) {
      syncHiddenControlsFromState();
      renderSortButtonsUi();
      renderFilterButtonsUi();
      persistListControlsState();
      if (rerender) {
        renderAnimationMappings();
      }
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
        bindDurationBadgeListener(video);

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

    function wireCardDragSorting(container) {
      if (!container) return;
      const cards = Array.from(container.querySelectorAll('.animation-mapping-card'));
      const dragEnabled = stateRef.currentSortMode === 'name';

      cards.forEach((card) => {
        card.classList.toggle('sort-draggable', dragEnabled);
        card.setAttribute('draggable', dragEnabled ? 'true' : 'false');
      });

      if (!dragEnabled) return;

      let draggedTrigger = '';
      cards.forEach((card) => {
        card.addEventListener('dragstart', (event) => {
          draggedTrigger = String(card.dataset.animationTrigger || '');
          card.classList.add('is-dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', draggedTrigger);
          }
        });

        card.addEventListener('dragover', (event) => {
          if (!draggedTrigger) return;
          const targetTrigger = String(card.dataset.animationTrigger || '');
          if (!targetTrigger || targetTrigger === draggedTrigger) return;
          event.preventDefault();
          card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', () => {
          card.classList.remove('drag-over');
        });

        card.addEventListener('drop', (event) => {
          event.preventDefault();
          const targetTrigger = String(card.dataset.animationTrigger || '');
          cards.forEach((entry) => entry.classList.remove('drag-over'));
          if (!draggedTrigger || !targetTrigger || targetTrigger === draggedTrigger) return;
          const moved = moveTriggerInCustomOrder(draggedTrigger, targetTrigger);
          if (!moved) return;
          applyListControlsState();
        });

        card.addEventListener('dragend', () => {
          cards.forEach((entry) => {
            entry.classList.remove('drag-over');
            entry.classList.remove('is-dragging');
          });
          draggedTrigger = '';
        });
      });
    }

    function buildAnimationCardMetadata() {
      return getAvailableAnimations().map((anim) => {
        const mapped = typeof helpers.findAnimationMappingEntryByFile === 'function'
          ? helpers.findAnimationMappingEntryByFile(anim.filename)
          : null;
        const mappedData = mapped && typeof mapped.data === 'object' && mapped.data !== null
          ? mapped.data
          : {};
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
        const knownDurationSeconds = getKnownDurationSecondsForAnimation(anim);

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
          durationSeconds: knownDurationSeconds,
          hasKnownDuration: Number.isFinite(knownDurationSeconds) && knownDurationSeconds > 0,
          durationSortKey: Number.isFinite(knownDurationSeconds) && knownDurationSeconds > 0
            ? knownDurationSeconds
            : Number.POSITIVE_INFINITY,
          hasStickerMapping,
          mappedAny,
          keywords: Array.isArray(mappedData.keywords) ? mappedData.keywords : []
        };
      });
    }

    function getFilteredSortedAnimationCards() {
      const rawSortMode = elements.animationSortSelect?.value || stateRef.currentSortMode || 'name';
      const sortMode = normalizeSortMode(rawSortMode);
      const fallbackDirection = rawSortMode === 'newest'
        ? SORT_DIRECTION_DOWN
        : getDefaultSortDirection(sortMode);
      const sortDirection = normalizeSortDirection(stateRef.currentSortDirection, fallbackDirection);
      const mapFilter = normalizeFilterValue(
        elements.animationMapFilterSelect?.value || stateRef.currentMapFilter,
        MAP_FILTER_VALUES,
        'all'
      );
      const stickerFilter = normalizeFilterValue(
        elements.animationStickerFilterSelect?.value || stateRef.currentStickerFilter,
        STICKER_FILTER_VALUES,
        'all'
      );
      const keywordFilter = normalizeKeywordFilter(
        elements.animationKeywordFilterInput?.value || stateRef.currentKeywordFilter
      );

      const cards = buildAnimationCardMetadata();
      const customOrder = getEffectiveCustomOrder(cards);
      const customOrderIndex = new Map(customOrder.map((trigger, index) => [trigger, index]));
      const hasManualCustomOrder = stateRef.customOrder.length > 0;

      const filtered = cards.filter((card) => {
        if (mapFilter === 'mapped' && !card.mappedAny) return false;
        if (mapFilter === 'unmapped' && card.mappedAny) return false;
        if (stickerFilter === 'with-sticker' && !card.hasStickerMapping) return false;
        if (stickerFilter === 'without-sticker' && card.hasStickerMapping) return false;
        if (keywordFilter) {
          const haystack = [
            card.trigger,
            card.anim?.filename || '',
            ...(Array.isArray(card.keywords) ? card.keywords : [])
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(keywordFilter)) return false;
        }
        return true;
      });

      warmDurationMetadata(filtered);

      filtered.sort((a, b) => {
        if (sortMode === 'length') {
          const durationKnownA = a.hasKnownDuration ? 0 : 1;
          const durationKnownB = b.hasKnownDuration ? 0 : 1;
          const byKnownDuration = durationKnownA - durationKnownB;
          if (byKnownDuration !== 0) return byKnownDuration;
        }

        if (sortMode === 'name' && hasManualCustomOrder) {
          const orderA = customOrderIndex.has(a.trigger)
            ? customOrderIndex.get(a.trigger)
            : Number.POSITIVE_INFINITY;
          const orderB = customOrderIndex.has(b.trigger)
            ? customOrderIndex.get(b.trigger)
            : Number.POSITIVE_INFINITY;
          const byCustomOrder = orderA - orderB;
          if (byCustomOrder !== 0) {
            return sortDirection === SORT_DIRECTION_DOWN ? -byCustomOrder : byCustomOrder;
          }
        }

        if (sortMode === 'name' && !hasManualCustomOrder) {
          const byTime = a.timestampMs - b.timestampMs;
          if (byTime !== 0) {
            return sortDirection === SORT_DIRECTION_DOWN ? -byTime : byTime;
          }
          return a.trigger.localeCompare(b.trigger);
        }

        const bySortMode = compareCardsBySortMode(a, b, sortMode);
        if (bySortMode !== 0) {
          return sortDirection === SORT_DIRECTION_DOWN ? -bySortMode : bySortMode;
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
        bindDurationBadgeListener(previousVideo);

        previousVideo.className = nextVideo.className;
        previousVideo.dataset.src = nextVideo.dataset.src || previousVideo.dataset.src || '';
        previousVideo.dataset.file = nextVideo.dataset.file || previousVideo.dataset.file || '';
        previousVideo.muted = true;
        previousVideo.loop = true;
        previousVideo.playsInline = true;
        previousVideo.preload = 'none';
        if (!previousVideo.getAttribute('src') && previousVideo.dataset.src) {
          previousVideo.setAttribute('src', previousVideo.dataset.src);
        }

        if (typeof nextVideo.replaceWith === 'function') {
          nextVideo.replaceWith(previousVideo);
        }
        updateDurationBadgeForVideo(previousVideo);
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
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; grid-column: 1 / -1;">No animations match the current sort, filter, or keyword search.</div>';
        return;
      }

      const activePlayback = getActivePlaybackMap();
      const previewPlayback = typeof helpers.getCurrentAnimationPreviewPlayback === 'function'
        ? helpers.getCurrentAnimationPreviewPlayback()
        : null;
      list.innerHTML = cards.map((card) => {
        const { anim, trigger } = card;
        const safeTrigger = escapeAttribute(trigger);
        const safeFilename = escapeAttribute(anim.filename);
        const thumbnailUrl = anim.thumbnailPath
          || (typeof helpers.getAnimationThumbnailUrl === 'function'
            ? helpers.getAnimationThumbnailUrl(anim.filename, anim?.mtimeMs ?? '')
            : '');
        const visibilityBadges = typeof helpers.renderAnimationVisibilityBadges === 'function'
          ? helpers.renderAnimationVisibilityBadges(trigger)
          : '';

        const playbackState = activePlayback.get(trigger);
        const now = Date.now();
        const isPlaying = Boolean(playbackState && playbackState.endAtMs > now);
        const isPreviewing = Boolean(
          !isPlaying
          && previewPlayback
          && previewPlayback.trigger === trigger
          && previewPlayback.endAtMs > now
        );
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
        } else if (isPreviewing) {
          const remainingMs = Math.max(0, previewPlayback.endAtMs - now);
          countdown = typeof helpers.formatAnimationPlaybackCountdown === 'function'
            ? helpers.formatAnimationPlaybackCountdown(remainingMs)
            : '';
        }

        return `
    <div class="animation-mapping-card${isPlaying ? ' playing' : ''}${isPreviewing ? ' previewing' : ''}" data-animation-trigger="${safeTrigger}" data-animation-file="${safeFilename}" style="--play-progress:${playProgress.toFixed(4)}" title="${safeTrigger}">
      <div class="animation-card-media">
        <button class="secondary animation-thumb-btn preview-mapping-btn" data-trigger="${safeTrigger}" title="${safeTrigger}">
          <div class="animation-thumb-poster" aria-hidden="true">
            ${thumbnailUrl ? `<img class="animation-thumb-image" src="${escapeAttribute(thumbnailUrl)}" alt="${safeTrigger}" loading="lazy" decoding="async">` : ''}
            <span class="animation-thumb-poster-filename">${safeFilename}</span>
          </div>
          ${visibilityBadges}
          <span class="animation-thumb-center-badge${card.hasKnownDuration ? ' has-duration' : ''}" aria-hidden="true">
            <span class="animation-thumb-duration${card.hasKnownDuration ? ' is-visible' : ''}">${card.hasKnownDuration ? formatDurationBadgeLabel(card.durationSeconds) : ''}</span>
            <span class="animation-playing-countdown">${countdown}</span>
            <span class="animation-thumb-play-icon">▶</span>
            <span class="animation-thumb-stop-icon">■</span>
          </span>
        </button>
        <button class="animation-gear-btn open-animation-settings-btn" data-trigger="${safeTrigger}" data-file="${safeFilename}" title="Settings">⚙️</button>
      </div>
    </div>
  `;
      }).join('');

      wireCardDragSorting(list);

      list.querySelectorAll('.preview-mapping-btn').forEach((btn) => {
        btn.addEventListener('click', async (event) => {
          event.preventDefault();
          const trigger = event.currentTarget.dataset.trigger;
          const card = typeof event.currentTarget.closest === 'function'
            ? event.currentTarget.closest('.animation-mapping-card')
            : null;
          if (card && card.classList?.contains?.('playing')) {
            if (typeof callbacks.stopAllActiveAnimations === 'function') {
              await callbacks.stopAllActiveAnimations();
            }
            return;
          }

          const animationData = getAnimationMappings()[trigger];
          const filename = getAnimationFileFromMapping(animationData);
          if (typeof callbacks.startAnimationFloatingPreview === 'function') {
            callbacks.startAnimationFloatingPreview(trigger, filename);
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

      const initialRawSortMode = settingsStore?.getItem?.('animation_sort_mode') || 'name';
      const initialSortMode = normalizeSortMode(initialRawSortMode);
      const savedSortDirection = settingsStore?.getItem?.('animation_sort_direction');
      const initialSortDirection = initialRawSortMode === 'newest'
        ? SORT_DIRECTION_DOWN
        : normalizeSortDirection(savedSortDirection, getDefaultSortDirection(initialSortMode));
      const initialMapFilter = normalizeFilterValue(
        settingsStore?.getItem?.('animation_map_filter'),
        MAP_FILTER_VALUES,
        'all'
      );
      const initialStickerFilter = normalizeFilterValue(
        settingsStore?.getItem?.('animation_sticker_filter'),
        STICKER_FILTER_VALUES,
        'all'
      );
      const initialKeywordFilter = normalizeKeywordFilter(
        settingsStore?.getItem?.(KEYWORD_FILTER_STORAGE_KEY)
      );

      stateRef.currentSortMode = initialSortMode;
      stateRef.currentSortDirection = initialSortDirection;
      stateRef.currentMapFilter = initialMapFilter;
      stateRef.currentStickerFilter = initialStickerFilter;
      stateRef.currentKeywordFilter = initialKeywordFilter;
      stateRef.customOrder = parseCustomOrder(settingsStore?.getItem?.('animation_custom_order'));
      applyListControlsState({ rerender: false });

      if (elements.animationSortSelect) {
        elements.animationSortSelect.addEventListener('change', () => {
          const rawSortMode = elements.animationSortSelect.value;
          const nextMode = normalizeSortMode(rawSortMode);
          const isLegacyNewest = rawSortMode === 'newest';
          if (stateRef.currentSortMode !== nextMode) {
            stateRef.currentSortDirection = isLegacyNewest
              ? SORT_DIRECTION_DOWN
              : getDefaultSortDirection(nextMode);
          } else if (isLegacyNewest) {
            stateRef.currentSortDirection = SORT_DIRECTION_DOWN;
          }
          stateRef.currentSortMode = nextMode;
          applyListControlsState();
        });
      }

      if (elements.animationMapFilterSelect) {
        elements.animationMapFilterSelect.addEventListener('change', () => {
          stateRef.currentMapFilter = normalizeFilterValue(
            elements.animationMapFilterSelect.value,
            MAP_FILTER_VALUES,
            'all'
          );
          applyListControlsState();
        });
      }

      if (elements.animationStickerFilterSelect) {
        elements.animationStickerFilterSelect.addEventListener('change', () => {
          stateRef.currentStickerFilter = normalizeFilterValue(
            elements.animationStickerFilterSelect.value,
            STICKER_FILTER_VALUES,
            'all'
          );
          applyListControlsState();
        });
      }

      if (elements.animationKeywordFilterInput) {
        elements.animationKeywordFilterInput.addEventListener('input', () => {
          stateRef.currentKeywordFilter = normalizeKeywordFilter(elements.animationKeywordFilterInput.value);
          applyListControlsState();
        });
      }

      const sortButtons = Array.isArray(elements.animationSortChipButtons)
        ? elements.animationSortChipButtons
        : [];
      sortButtons.forEach((button) => {
        if (!button || typeof button.addEventListener !== 'function') return;
        button.addEventListener('click', () => {
          const nextMode = normalizeSortMode(button.dataset?.sortMode || 'name');
          if (stateRef.currentSortMode === nextMode) {
            stateRef.currentSortDirection = stateRef.currentSortDirection === SORT_DIRECTION_UP
              ? SORT_DIRECTION_DOWN
              : SORT_DIRECTION_UP;
          } else {
            stateRef.currentSortMode = nextMode;
            stateRef.currentSortDirection = getDefaultSortDirection(nextMode);
          }
          applyListControlsState();
        });
      });

      if (elements.animationMapFilterBtn && typeof elements.animationMapFilterBtn.addEventListener === 'function') {
        elements.animationMapFilterBtn.addEventListener('click', () => {
          const currentIndex = MAP_FILTER_VALUES.indexOf(stateRef.currentMapFilter);
          const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % MAP_FILTER_VALUES.length : 0;
          stateRef.currentMapFilter = MAP_FILTER_VALUES[nextIndex];
          applyListControlsState();
        });
      }

      if (elements.animationStickerFilterBtn && typeof elements.animationStickerFilterBtn.addEventListener === 'function') {
        elements.animationStickerFilterBtn.addEventListener('click', () => {
          const currentIndex = STICKER_FILTER_VALUES.indexOf(stateRef.currentStickerFilter);
          const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % STICKER_FILTER_VALUES.length : 0;
          stateRef.currentStickerFilter = STICKER_FILTER_VALUES[nextIndex];
          applyListControlsState();
        });
      }
    }

    function toggleDropTarget(button, enabled) {
      if (!button || !button.classList) return;
      button.classList.toggle('is-drop-target', Boolean(enabled));
    }

    async function uploadAnimationFile(file) {
      if (!file) return;
      if (!callFetch) {
        alertDialog('Upload failed: fetch is not available in this environment.');
        return;
      }

      const defaultName = normalizeTriggerFromFilename(file.name) || 'animation';
      const nameInput = promptDialog
        ? promptDialog('Animation name:', defaultName)
        : defaultName;

      if (nameInput === null) return;

      const customName = String(nameInput || '').trim() || defaultName;
      const formData = new FormData();
      formData.append('animation', file);
      formData.append('name', customName);

      try {
        if (elements.uploadAnimationBtn) {
          elements.uploadAnimationBtn.disabled = true;
        }
        const response = await callFetch('/api/animations/upload', {
          method: 'POST',
          body: formData
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || 'Upload failed');
        }

        if (typeof callbacks.loadAvailableAnimations === 'function') {
          await callbacks.loadAvailableAnimations();
        }
        if (typeof callbacks.generateAnimationKeywordsForFilename === 'function' && data.filename) {
          try {
            await callbacks.generateAnimationKeywordsForFilename(data.filename, { persist: true, quiet: true });
          } catch (keywordErr) {
            console.warn('Animation keyword generation skipped after upload:', keywordErr);
          }
        }
      } catch (err) {
        console.error('Animation upload error:', err);
        alertDialog(`Upload failed: ${err.message}`);
      } finally {
        if (elements.uploadAnimationBtn) {
          elements.uploadAnimationBtn.disabled = false;
        }
      }
    }

    function openAnimationResetPopup() {
      if (!elements.animationResetPopup) return;
      elements.animationResetPopup.style.display = 'flex';
    }

    function closeAnimationResetPopup() {
      if (!elements.animationResetPopup) return;
      elements.animationResetPopup.style.display = 'none';
    }

    function getAnimationResetOptions() {
      return {
        sorting: Boolean(elements.animationResetSorting?.checked),
        names: Boolean(elements.animationResetNames?.checked),
        scale: Boolean(elements.animationResetScale?.checked),
        position: Boolean(elements.animationResetPosition?.checked),
        gifts: Boolean(elements.animationResetGifts?.checked),
        stickers: Boolean(elements.animationResetStickers?.checked),
        events: Boolean(elements.animationResetEvents?.checked)
      };
    }

    function hasAnyResetSelection(options) {
      return Object.values(options || {}).some(Boolean);
    }

    function resetAnimationListControlsToDefaults({ rerender = true } = {}) {
      stateRef.currentSortMode = 'name';
      stateRef.currentSortDirection = SORT_DIRECTION_UP;
      stateRef.currentMapFilter = 'all';
      stateRef.currentStickerFilter = 'all';
      stateRef.customOrder = [];
      applyListControlsState({ rerender });
    }

    function attachEvents() {
      if (stateRef.eventsAttached) return;
      stateRef.eventsAttached = true;

      if (elements.uploadAnimationBtn && elements.uploadAnimationInput) {
        elements.uploadAnimationBtn.addEventListener('click', () => {
          if (elements.uploadAnimationBtn.disabled) return;
          elements.uploadAnimationInput.click();
        });

        elements.uploadAnimationInput.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          await uploadAnimationFile(file);
          elements.uploadAnimationInput.value = '';
        });

        const dropTarget = elements.uploadAnimationBtn;
        ['dragenter', 'dragover'].forEach((eventName) => {
          dropTarget.addEventListener(eventName, (event) => {
            event.preventDefault();
            toggleDropTarget(dropTarget, true);
          });
        });
        ['dragleave', 'dragend'].forEach((eventName) => {
          dropTarget.addEventListener(eventName, () => {
            toggleDropTarget(dropTarget, false);
          });
        });
        dropTarget.addEventListener('drop', async (event) => {
          event.preventDefault();
          toggleDropTarget(dropTarget, false);
          const file = event.dataTransfer?.files?.[0];
          if (!file) return;
          await uploadAnimationFile(file);
          if (elements.uploadAnimationInput) {
            elements.uploadAnimationInput.value = '';
          }
        });
      }

      if (elements.generateAnimationKeywordsBtn) {
        elements.generateAnimationKeywordsBtn.addEventListener('click', async () => {
          if (elements.generateAnimationKeywordsBtn.disabled) return;
          if (typeof callbacks.generateMissingAnimationKeywords === 'function') {
            await callbacks.generateMissingAnimationKeywords();
          }
        });
      }

      if (elements.resetAnimationsBtn) {
        elements.resetAnimationsBtn.addEventListener('click', () => {
          openAnimationResetPopup();
        });
      }

      if (elements.animationResetCancelBtn) {
        elements.animationResetCancelBtn.addEventListener('click', () => {
          closeAnimationResetPopup();
        });
      }

      if (elements.animationResetPopup) {
        const backdrop = elements.animationResetPopup.querySelector('.animation-card-popup-backdrop');
        if (backdrop) {
          backdrop.addEventListener('click', () => {
            closeAnimationResetPopup();
          });
        }
      }

      if (elements.animationResetConfirmBtn) {
        elements.animationResetConfirmBtn.addEventListener('click', async () => {
          const options = getAnimationResetOptions();
          if (!hasAnyResetSelection(options)) {
            alertDialog('Select at least one reset option.');
            return;
          }

          elements.animationResetConfirmBtn.disabled = true;
          try {
            if (typeof callbacks.applyAnimationReset === 'function') {
              await callbacks.applyAnimationReset(options);
            }
            if (options.sorting) {
              resetAnimationListControlsToDefaults({ rerender: false });
            }
            closeAnimationResetPopup();
            renderAnimationMappings();
          } catch (err) {
            console.error('Animation reset failed:', err);
            alertDialog('Failed to reset selected animation settings.');
          } finally {
            elements.animationResetConfirmBtn.disabled = false;
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
      resetAnimationListControlsToDefaults,
      attachEvents,
      init
    };
  }

  window.createAnimationUiController = createAnimationUiController;
})();

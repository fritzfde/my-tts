(function initAnimationPlaybackModule() {
  function createAnimationPlaybackController({
    documentRef,
    fetchFn,
    getAnimationFileUrl,
    getAnimationMappingByTrigger,
    getAnimationFileFromMapping,
    isThumbnailInteractionActive,
    playAnimationThumbnail,
    stopAnimationThumbnail,
    stopButton,
    floatingPreviewContainer = null,
    floatingPreviewButton = null,
    floatingPreviewSettingsButton = null,
    floatingPreviewVideo = null,
    floatingPreviewMode = null,
    floatingPreviewLabel = null,
    floatingPreviewName = null,
    floatingPreviewCountdown = null,
    onOpenFloatingSettings = null,
    fallbackSeconds = 4,
    tickMs = 120,
    stopEndpoint = '/api/animations/stop'
  }) {
    const doc = documentRef || document;

    const state = {
      ticker: null,
      durationSecondsCache: new Map(),
      durationProbePromises: new Map(),
      activePlayback: new Map(),
      previewPlayback: null
    };

    function cacheAnimationDuration(filename, durationSeconds) {
      const numeric = Number(durationSeconds);
      if (!filename || !Number.isFinite(numeric) || numeric <= 0) return;
      state.durationSecondsCache.set(filename, numeric);
    }

    function cacheAnimationDurationFromVideo(video) {
      if (!video) return;
      const filename = video.dataset.file || '';
      const duration = Number(video.duration);
      cacheAnimationDuration(filename, duration);
    }

    function bindAnimationThumbnailDurationListener(video) {
      if (!video || video.dataset.durationBound === '1') return;
      video.dataset.durationBound = '1';
      video.addEventListener('loadedmetadata', () => {
        cacheAnimationDurationFromVideo(video);
      });
    }

    function probeAnimationDurationSeconds(filename) {
      return new Promise((resolve) => {
        if (!filename) {
          resolve(null);
          return;
        }

        const probeVideo = doc.createElement('video');
        const src = getAnimationFileUrl(filename);
        let settled = false;

        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          probeVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
          probeVideo.removeEventListener('error', onError);
          probeVideo.removeAttribute('src');
          probeVideo.load();
          resolve(value);
        };

        const onLoadedMetadata = () => {
          const duration = Number(probeVideo.duration);
          finish(Number.isFinite(duration) && duration > 0 ? duration : null);
        };

        const onError = () => finish(null);
        const timeoutId = setTimeout(() => finish(null), 4500);

        probeVideo.preload = 'metadata';
        probeVideo.muted = true;
        probeVideo.playsInline = true;
        probeVideo.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
        probeVideo.addEventListener('error', onError, { once: true });
        probeVideo.src = src;
        probeVideo.load();
      });
    }

    function getAnimationDurationSeconds(filename) {
      if (!filename) return Promise.resolve(null);

      const cached = state.durationSecondsCache.get(filename);
      if (Number.isFinite(cached) && cached > 0) {
        return Promise.resolve(cached);
      }

      const pending = state.durationProbePromises.get(filename);
      if (pending) return pending;

      const probePromise = probeAnimationDurationSeconds(filename)
        .then((duration) => {
          if (Number.isFinite(duration) && duration > 0) {
            cacheAnimationDuration(filename, duration);
            return duration;
          }
          return null;
        })
        .finally(() => {
          state.durationProbePromises.delete(filename);
        });

      state.durationProbePromises.set(filename, probePromise);
      return probePromise;
    }

    function getCachedAnimationDurationSeconds(filename) {
      if (!filename) return null;
      const cached = Number(state.durationSecondsCache.get(filename));
      return Number.isFinite(cached) && cached > 0 ? cached : null;
    }

    function formatAnimationPlaybackCountdown(remainingMs) {
      const remainingSeconds = Math.max(0, remainingMs / 1000);
      if (remainingSeconds >= 60) {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = Math.ceil(remainingSeconds % 60);
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
      }
      if (remainingSeconds >= 10) {
        return `${Math.ceil(remainingSeconds)}s`;
      }
      return `${remainingSeconds.toFixed(1)}s`;
    }

    function setAnimationCardPlaybackState(trigger, filename, durationSeconds, startedAtMs = Date.now()) {
      const safeDuration = Number(durationSeconds);
      const finalDuration = Number.isFinite(safeDuration) && safeDuration > 0
        ? safeDuration
        : fallbackSeconds;

      state.activePlayback.set(trigger, {
        trigger,
        filename,
        startedAtMs,
        endAtMs: startedAtMs + (finalDuration * 1000),
        durationSeconds: finalDuration
      });

      if (!state.ticker) {
        state.ticker = setInterval(() => {
          updateAnimationPlaybackUi();
        }, tickMs);
      }
      updateAnimationPlaybackUi();
    }

    function updateStopAnimationButtonState() {
      if (!stopButton) return;
      stopButton.disabled = state.activePlayback.size === 0;
    }

    function getCurrentPlayback() {
      const iterator = state.activePlayback.values();
      const next = iterator.next();
      return next && !next.done ? next.value : null;
    }

    function getCurrentPreviewPlayback() {
      return state.previewPlayback || null;
    }

    function getCurrentFloatingPlayback() {
      const livePlayback = getCurrentPlayback();
      if (livePlayback) {
        return { mode: 'live', playback: livePlayback };
      }
      if (state.previewPlayback) {
        return { mode: 'preview', playback: state.previewPlayback };
      }
      return { mode: '', playback: null };
    }

    function clearPreviewPlayback({ resetVideo = true } = {}) {
      state.previewPlayback = null;
      if (resetVideo) {
        pauseFloatingPreviewVideo();
      }
    }

    function pauseFloatingPreviewVideo() {
      if (!floatingPreviewVideo) return;
      try {
        floatingPreviewVideo.pause();
        if (typeof floatingPreviewVideo.currentTime === 'number') {
          floatingPreviewVideo.currentTime = 0;
        }
      } catch (err) {
        // Ignore preview reset issues.
      }
    }

    function updateFloatingPreviewUi() {
      if (!floatingPreviewContainer || !floatingPreviewButton || !floatingPreviewVideo) return;

      const { mode, playback } = getCurrentFloatingPlayback();
      if (!playback) {
        floatingPreviewContainer.hidden = true;
        floatingPreviewContainer.classList?.remove?.('is-visible');
        floatingPreviewButton.disabled = true;
        if (floatingPreviewSettingsButton) {
          floatingPreviewSettingsButton.disabled = true;
        }
        if (floatingPreviewMode) {
          floatingPreviewMode.textContent = 'LIVE';
        }
        if (floatingPreviewLabel) {
          floatingPreviewLabel.textContent = 'Playing now';
        }
        if (floatingPreviewName) {
          floatingPreviewName.textContent = '';
        }
        if (floatingPreviewCountdown) {
          floatingPreviewCountdown.textContent = '';
        }
        pauseFloatingPreviewVideo();
        return;
      }

      const nextSrc = getAnimationFileUrl(playback.filename);
      if (nextSrc && floatingPreviewVideo.dataset.src !== nextSrc) {
        floatingPreviewVideo.dataset.src = nextSrc;
        floatingPreviewVideo.setAttribute('src', nextSrc);
        floatingPreviewVideo.load();
      }
      floatingPreviewVideo.loop = mode === 'live';
      floatingPreviewVideo.muted = mode === 'live';

      floatingPreviewContainer.hidden = false;
      floatingPreviewContainer.classList?.add?.('is-visible');
      floatingPreviewContainer.dataset.mode = mode;
      floatingPreviewButton.disabled = false;
      if (floatingPreviewSettingsButton) {
        floatingPreviewSettingsButton.disabled = false;
      }
      floatingPreviewButton.title = mode === 'preview'
        ? 'Click to stop the preview'
        : 'Click to stop the current animation';

      if (floatingPreviewMode) {
        floatingPreviewMode.textContent = mode === 'preview' ? 'PREVIEW' : 'LIVE';
      }
      if (floatingPreviewLabel) {
        floatingPreviewLabel.textContent = mode === 'preview' ? 'Preview' : 'Playing now';
      }

      if (floatingPreviewName) {
        floatingPreviewName.textContent = playback.trigger || '';
      }
      if (floatingPreviewCountdown) {
        const remainingMs = Math.max(0, playback.endAtMs - Date.now());
        floatingPreviewCountdown.textContent = formatAnimationPlaybackCountdown(remainingMs);
      }

      floatingPreviewVideo.play().catch(() => {});
    }

    function bindFloatingPreviewEvents() {
      if (floatingPreviewVideo) {
        const dataset = floatingPreviewVideo.dataset || (floatingPreviewVideo.dataset = {});
        if (dataset.boundPreviewEnded !== '1') {
          dataset.boundPreviewEnded = '1';
          floatingPreviewVideo.addEventListener('ended', () => {
            if (!state.previewPlayback) return;
            clearPreviewPlayback({ resetVideo: true });
            updateAnimationPlaybackUi();
          });
        }
      }

      if (!floatingPreviewButton) return;
      const dataset = floatingPreviewButton.dataset || (floatingPreviewButton.dataset = {});
      if (dataset.bound === '1') return;
      dataset.bound = '1';
      floatingPreviewButton.addEventListener('click', async (event) => {
        event?.preventDefault?.();
        if (state.activePlayback.size > 0) {
          floatingPreviewButton.disabled = true;
          await stopAllActiveAnimations();
          return;
        }
        if (!state.previewPlayback) return;
        clearPreviewPlayback({ resetVideo: true });
        updateAnimationPlaybackUi();
      });

      if (floatingPreviewSettingsButton) {
        floatingPreviewSettingsButton.addEventListener('click', (event) => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          const { playback } = getCurrentFloatingPlayback();
          if (!playback || typeof onOpenFloatingSettings !== 'function') return;
          onOpenFloatingSettings(playback.trigger, playback.filename);
        });
      }
    }

    function markAnimationCardPlaying(trigger) {
      if (!trigger) return;
      const data = getAnimationMappingByTrigger(trigger);
      if (!data) return;

      const filename = getAnimationFileFromMapping(data);
      if (!filename) return;

      const startedAtMs = Date.now();
      const cachedDuration = state.durationSecondsCache.get(filename);
      const initialDuration = Number.isFinite(cachedDuration) && cachedDuration > 0
        ? cachedDuration
        : fallbackSeconds;

      clearPreviewPlayback({ resetVideo: false });
      state.activePlayback.clear();
      setAnimationCardPlaybackState(trigger, filename, initialDuration, startedAtMs);

      getAnimationDurationSeconds(filename)
        .then((duration) => {
          if (!Number.isFinite(duration) || duration <= 0) return;
          const current = state.activePlayback.get(trigger);
          if (!current) return;
          if (current.startedAtMs !== startedAtMs) return;
          setAnimationCardPlaybackState(trigger, filename, duration, startedAtMs);
        })
        .catch((err) => {
          console.debug('Animation duration probe failed:', err);
        });

      return startedAtMs;
    }

    function startFloatingPreview(trigger, filename = '') {
      const resolvedTrigger = String(trigger || '').trim();
      if (!resolvedTrigger) return false;

      const resolvedFilename = String(filename || '').trim()
        || getAnimationFileFromMapping(getAnimationMappingByTrigger(resolvedTrigger));
      if (!resolvedFilename) return false;

      const existingPreview = state.previewPlayback;
      if (existingPreview && existingPreview.trigger === resolvedTrigger && existingPreview.filename === resolvedFilename) {
        clearPreviewPlayback({ resetVideo: true });
        updateAnimationPlaybackUi();
        return false;
      }

      const startedAtMs = Date.now();
      const cachedDuration = state.durationSecondsCache.get(resolvedFilename);
      const initialDuration = Number.isFinite(cachedDuration) && cachedDuration > 0
        ? cachedDuration
        : fallbackSeconds;

      state.previewPlayback = {
        trigger: resolvedTrigger,
        filename: resolvedFilename,
        startedAtMs,
        endAtMs: startedAtMs + (initialDuration * 1000),
        durationSeconds: initialDuration
      };

      if (!state.ticker) {
        state.ticker = setInterval(() => {
          updateAnimationPlaybackUi();
        }, tickMs);
      }
      updateAnimationPlaybackUi();

      getAnimationDurationSeconds(resolvedFilename)
        .then((duration) => {
          if (!Number.isFinite(duration) || duration <= 0) return;
          if (!state.previewPlayback) return;
          if (state.previewPlayback.startedAtMs !== startedAtMs) return;
          state.previewPlayback = {
            ...state.previewPlayback,
            durationSeconds: duration,
            endAtMs: startedAtMs + (duration * 1000)
          };
          updateAnimationPlaybackUi();
        })
        .catch((err) => {
          console.debug('Animation preview duration probe failed:', err);
        });

      return true;
    }

    function clearAnimationCardPlaybackIfMatches(trigger, startedAtMs) {
      const current = state.activePlayback.get(trigger);
      if (!current) return;
      if (Number.isFinite(startedAtMs) && current.startedAtMs !== startedAtMs) return;
      state.activePlayback.delete(trigger);
      updateAnimationPlaybackUi();
    }

    async function stopAllActiveAnimations() {
      const hadActiveAnimations = state.activePlayback.size > 0;
      const callFetch = typeof fetchFn === 'function'
        ? fetchFn
        : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);

      if (!callFetch) {
        updateAnimationPlaybackUi();
        return false;
      }

      try {
        const response = await callFetch(stopEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'dashboard',
            reason: 'manual-stop'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json().catch(() => ({}));
        const totalClients = Number(payload && payload.clients || 0);
        const obsClients = Number(payload && payload.obsClients || 0);
        console.log(`⏹️ Stop broadcast delivered to ${totalClients} animation overlay client(s), OBS: ${obsClients}`);
        if (totalClients > 0 && obsClients === 0) {
          console.warn('No OBS animation overlay clients detected. If OBS keeps playing, refresh the Browser Source URL/cache.');
        }

        state.activePlayback.clear();
        updateAnimationPlaybackUi();
        return true;
      } catch (err) {
        console.error('❌ Failed to stop active animations:', err);
        if (hadActiveAnimations) {
          alert('Failed to stop animation overlay. Please check server/overlay connection.');
        }
        updateAnimationPlaybackUi();
        return false;
      }
    }

    function updateAnimationPlaybackUi() {
      const now = Date.now();

      for (const [trigger, playback] of state.activePlayback.entries()) {
        if (!playback || playback.endAtMs <= now) {
          state.activePlayback.delete(trigger);
        }
      }
      if (state.previewPlayback && state.previewPlayback.endAtMs <= now) {
        clearPreviewPlayback({ resetVideo: true });
      }

      const cards = doc.querySelectorAll('.animation-mapping-card[data-animation-trigger]');
      cards.forEach((card) => {
        const trigger = card.dataset.animationTrigger || '';
        const playback = state.activePlayback.get(trigger);
        const preview = state.previewPlayback && state.previewPlayback.trigger === trigger
          ? state.previewPlayback
          : null;
        const countdownEl = card.querySelector('.animation-playing-countdown');
        const labelEl = card.querySelector('.animation-playing-label');

        if (!playback) {
          card.classList.remove('playing');
          card.style.removeProperty('--play-progress');
          if (preview) {
            card.classList.add('previewing');
            if (countdownEl) {
              const remainingMs = Math.max(0, preview.endAtMs - now);
              countdownEl.textContent = formatAnimationPlaybackCountdown(remainingMs);
            }
            if (labelEl) {
              labelEl.textContent = 'Preview';
            }
          } else {
            card.classList.remove('previewing');
            if (countdownEl) countdownEl.textContent = '';
            if (labelEl) {
              labelEl.textContent = 'Playing';
            }
          }
          return;
        }

        const remainingMs = Math.max(0, playback.endAtMs - now);
        const totalMs = Math.max(200, playback.durationSeconds * 1000);
        const elapsedMs = Math.max(0, totalMs - remainingMs);
        const progress = Math.min(1, elapsedMs / totalMs);

        card.classList.add('playing');
        card.classList.remove('previewing');
        card.style.setProperty('--play-progress', progress.toFixed(4));
        if (countdownEl) countdownEl.textContent = formatAnimationPlaybackCountdown(remainingMs);
        if (labelEl) {
          labelEl.textContent = 'Playing';
        }
      });

      if (state.activePlayback.size === 0 && !state.previewPlayback && state.ticker) {
        clearInterval(state.ticker);
        state.ticker = null;
      }

      updateStopAnimationButtonState();
      updateFloatingPreviewUi();
    }

    bindFloatingPreviewEvents();

    return {
      state,
      cacheAnimationDuration,
      cacheAnimationDurationFromVideo,
      bindAnimationThumbnailDurationListener,
      probeAnimationDurationSeconds,
      getCachedAnimationDurationSeconds,
      getAnimationDurationSeconds,
      formatAnimationPlaybackCountdown,
      setAnimationCardPlaybackState,
      updateStopAnimationButtonState,
      markAnimationCardPlaying,
      clearAnimationCardPlaybackIfMatches,
      stopAllActiveAnimations,
      updateAnimationPlaybackUi,
      updateFloatingPreviewUi,
      getCurrentPlayback
      ,
      getCurrentPreviewPlayback,
      startFloatingPreview,
      stopFloatingPreview: () => {
        clearPreviewPlayback({ resetVideo: true });
        updateAnimationPlaybackUi();
      }
    };
  }

  window.createAnimationPlaybackController = createAnimationPlaybackController;
})();

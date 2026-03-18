(function initTtsEngineModule() {
  function createTtsEngineController({
    synth,
    ensureAudioContext,
    unlockAudio,
    getReadOptions,
    getPlatformDefaultVoice,
    getUserVoice,
    isMutedVoiceId,
    resolveSystemVoice,
    getSpeechSettings,
    addChatMessage,
    fetchFn,
    getCloneTtsUrl,
    getCloneVoiceLanguage,
    watchdogMs = 30000,
    nowFn = () => Date.now(),
    lowLatencyMaxQueue = 5,
    lowLatencyBusyQueueThreshold = 2,
    lowLatencyStaleMs = 7000,
    lowLatencyBusyMaxChars = 140
  }) {
    const state = {
      currentUtterance: null,
      currentAudio: null,
      messageQueue: [],
      isSpeaking: false,
      speakingWatchdog: null,
      speechSuppressedByPlatform: {
        youtube: false,
        tiktok: false
      }
    };

    function getReadOptionsSafe() {
      if (typeof getReadOptions !== 'function') {
        return { readUsernames: false, readEmojis: true, readLinks: true };
      }
      const options = getReadOptions() || {};
      return {
        readUsernames: Boolean(options.readUsernames),
        readEmojis: Boolean(options.readEmojis),
        readLinks: Boolean(options.readLinks)
      };
    }

    function getSpeechSettingsSafe() {
      if (typeof getSpeechSettings !== 'function') {
        return { rate: 1, pitch: 1, volume: 1 };
      }

      const settings = getSpeechSettings() || {};
      const rate = Number(settings.rate);
      const pitch = Number(settings.pitch);
      const volume = Number(settings.volume);

      return {
        rate: Number.isFinite(rate) ? rate : 1,
        pitch: Number.isFinite(pitch) ? pitch : 1,
        volume: Number.isFinite(volume) ? volume : 1
      };
    }

    function getNowMs() {
      if (typeof nowFn === 'function') {
        const value = Number(nowFn());
        if (Number.isFinite(value)) return value;
      }
      return Date.now();
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeQueuedMessage(message) {
      const source = message && typeof message === 'object' ? message : {};
      const queuedAtMs = Number(source.queuedAtMs);
      return {
        author: typeof source.author === 'string' ? source.author : '',
        text: typeof source.text === 'string' ? source.text : '',
        platform: typeof source.platform === 'string' ? source.platform : 'youtube',
        display: source.display !== false,
        voiceOverride: typeof source.voiceOverride === 'string' ? source.voiceOverride : '',
        queuedAtMs: Number.isFinite(queuedAtMs) ? queuedAtMs : getNowMs()
      };
    }

    function pruneQueuedMessages() {
      const now = getNowMs();
      let droppedStale = 0;
      let droppedOverflow = 0;

      if (Number.isFinite(lowLatencyStaleMs) && lowLatencyStaleMs > 0) {
        state.messageQueue = state.messageQueue.filter((item) => {
          const queuedAtMs = Number(item?.queuedAtMs);
          if (!Number.isFinite(queuedAtMs)) return true;
          const fresh = (now - queuedAtMs) <= lowLatencyStaleMs;
          if (!fresh) droppedStale += 1;
          return fresh;
        });
      }

      if (Number.isFinite(lowLatencyMaxQueue) && lowLatencyMaxQueue > 0 && state.messageQueue.length > lowLatencyMaxQueue) {
        droppedOverflow = state.messageQueue.length - lowLatencyMaxQueue;
        state.messageQueue = state.messageQueue.slice(-lowLatencyMaxQueue);
      }

      if (droppedStale > 0 || droppedOverflow > 0) {
        console.info(`⚡ TTS queue trimmed: stale=${droppedStale}, overflow=${droppedOverflow}, remaining=${state.messageQueue.length}`);
      }
    }

    function isQueuedMessageStale(item) {
      if (!item || !Number.isFinite(lowLatencyStaleMs) || lowLatencyStaleMs <= 0) return false;
      const queuedAtMs = Number(item.queuedAtMs);
      if (!Number.isFinite(queuedAtMs)) return false;
      return (getNowMs() - queuedAtMs) > lowLatencyStaleMs;
    }

    function getQueuePressure(queuedAfterCurrent = state.messageQueue.length) {
      return 1 + Math.max(0, Number(queuedAfterCurrent) || 0);
    }

    function buildLowLatencyPlan(queuePressure) {
      const normalizedPressure = Math.max(0, Number(queuePressure) || 0);
      const active = normalizedPressure >= lowLatencyBusyQueueThreshold;
      if (!active) {
        return {
          active: false,
          skipUsernames: false,
          maxChars: 0,
          systemRate: null,
          clonedPlaybackRate: 1
        };
      }

      const overload = Math.max(0, normalizedPressure - lowLatencyBusyQueueThreshold);
      return {
        active: true,
        skipUsernames: true,
        maxChars: Math.max(80, lowLatencyBusyMaxChars - (overload * 18)),
        systemRateBoost: Math.min(0.38, 0.18 + (overload * 0.06)),
        clonedPlaybackRate: clamp(1.08 + (overload * 0.08), 1.08, 1.28)
      };
    }

    function compactSpeechText(text, maxChars = 0) {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      if (!normalized) return '';
      const limit = Number(maxChars);
      if (!Number.isFinite(limit) || limit <= 0 || normalized.length <= limit) {
        return normalized;
      }
      const trimmed = normalized
        .slice(0, limit)
        .replace(/[,:;.\-_!?]+$/g, '')
        .replace(/\s+\S*$/g, '')
        .trim();
      return `${trimmed || normalized.slice(0, limit).trim()}...`;
    }

    function filterMessage(text) {
      if (!text || typeof text !== 'string') return '';

      const { readEmojis, readLinks } = getReadOptionsSafe();
      let filtered = text;

      if (!readEmojis) {
        filtered = filtered.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
        filtered = filtered.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
        filtered = filtered.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
        filtered = filtered.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
        filtered = filtered.replace(/[\u{2600}-\u{26FF}]/gu, '');
        filtered = filtered.replace(/[\u{2700}-\u{27BF}]/gu, '');
        filtered = filtered.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
        filtered = filtered.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '');
        filtered = filtered.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '');
      }

      if (!readLinks) {
        filtered = filtered.replace(/https?:\/\/[^\s]+/g, '');
        filtered = filtered.replace(/www\.[^\s]+/g, '');
      }

      filtered = filtered.replace(/\s+/g, ' ').trim();
      return filtered;
    }

    async function speakWithCustomVoice(voiceType, text) {
      if (typeof voiceType === 'string' && voiceType.startsWith('cloned-')) {
        const voiceName = voiceType.replace('cloned-', '');
        const cloneUrl = typeof getCloneTtsUrl === 'function' ? getCloneTtsUrl() : '/api/voice-clone/tts';
        const cloneLanguage = typeof getCloneVoiceLanguage === 'function'
          ? (String(getCloneVoiceLanguage(voiceName) || '').trim() || 'en')
          : 'en';
        const fetchCall = typeof fetchFn === 'function'
          ? fetchFn
          : (typeof window !== 'undefined' && typeof window.fetch === 'function' ? window.fetch.bind(window) : null);

        if (!fetchCall) {
          return { utterance: new SpeechSynthesisUtterance(text), isCloned: false };
        }

        try {
          const response = await fetchCall(cloneUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              voice_name: voiceName,
              language: cloneLanguage
            })
          });

          if (response.ok) {
            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.volume = getSpeechSettingsSafe().volume;
            audio.preload = 'auto';
            return { audio, isCloned: true };
          }

          console.error('Cloned voice error:', await response.text());
        } catch (error) {
          console.error('Cloned voice error:', error);
        }
      }

      return { utterance: new SpeechSynthesisUtterance(text), isCloned: false };
    }

    function clearWatchdog() {
      if (state.speakingWatchdog) {
        clearTimeout(state.speakingWatchdog);
        state.speakingWatchdog = null;
      }
    }

    function setupUtteranceHandlers(utterance) {
      utterance.onend = () => {
        console.log('🔊 Speech ended');
        clearWatchdog();
        state.isSpeaking = false;
        processQueue();
      };

      utterance.onerror = (event) => {
        console.error('🔊 Speech error:', event);
        clearWatchdog();
        state.isSpeaking = false;
        processQueue();
      };
    }

    function processQueue() {
      pruneQueuedMessages();
      console.log(`🔊 processQueue called. isSpeaking: ${state.isSpeaking}, queue length: ${state.messageQueue.length}`);

      if (state.isSpeaking || state.messageQueue.length === 0) {
        console.log(`🔊 Exiting: isSpeaking=${state.isSpeaking}, queue empty=${state.messageQueue.length === 0}`);
        return;
      }

      state.isSpeaking = true;
      clearWatchdog();
      state.speakingWatchdog = setTimeout(() => {
        console.warn('⚠️ Speech watchdog triggered - forcing reset');
        state.isSpeaking = false;
        processQueue();
      }, watchdogMs);

      if (typeof ensureAudioContext === 'function') {
        ensureAudioContext();
      }

      const item = normalizeQueuedMessage(state.messageQueue.shift() || {});
      const {
        author = '',
        text = '',
        platform = 'youtube',
        display = false,
        voiceOverride = ''
      } = item;

      if (isQueuedMessageStale(item)) {
        console.info(`⚡ Skipping stale TTS message from ${author || 'unknown'} (${platform})`);
        clearWatchdog();
        state.isSpeaking = false;
        processQueue();
        return;
      }

      console.log(`🔊 Processing: "${text}" from ${author} (${platform})`);

      if (!text) {
        console.warn('🔊 No text, skipping');
        state.isSpeaking = false;
        processQueue();
        return;
      }

      const filteredText = filterMessage(text);
      if (!filteredText.trim()) {
        console.warn('🔊 Text filtered to empty, skipping');
        state.isSpeaking = false;
        processQueue();
        return;
      }

      const platformDefaultVoice = typeof getPlatformDefaultVoice === 'function'
        ? (getPlatformDefaultVoice(platform) || '')
        : '';
      const userHasCustomVoice = voiceOverride && voiceOverride !== platformDefaultVoice;
      const { readUsernames } = getReadOptionsSafe();
      const lowLatencyPlan = buildLowLatencyPlan(getQueuePressure(state.messageQueue.length));
      const shouldReadUsernames = readUsernames && !userHasCustomVoice && !lowLatencyPlan.skipUsernames;
      const baseSpeechText = shouldReadUsernames
        ? `${author} says: ${filteredText}`
        : filteredText;
      const speechText = lowLatencyPlan.active
        ? compactSpeechText(baseSpeechText, lowLatencyPlan.maxChars)
        : baseSpeechText;

      const selectedVoice = voiceOverride;
      const speechSettings = getSpeechSettingsSafe();
      const adaptiveRate = lowLatencyPlan.active
        ? clamp(speechSettings.rate + lowLatencyPlan.systemRateBoost, 0.7, 1.75)
        : speechSettings.rate;

      if (selectedVoice && selectedVoice.startsWith('cloned-')) {
        speakWithCustomVoice(selectedVoice, speechText).then((result) => {
          if (display !== false && typeof addChatMessage === 'function') {
            addChatMessage(author, text, platform, true);
          }

          if (result && result.isCloned && result.audio) {
            result.audio.playbackRate = lowLatencyPlan.active
              ? lowLatencyPlan.clonedPlaybackRate
              : 1;
            result.audio.onended = () => {
              console.log('🔊 Cloned audio ended');
              if (state.currentAudio === result.audio) {
                state.currentAudio = null;
              }
              clearWatchdog();
              state.isSpeaking = false;
              processQueue();
            };
            result.audio.onerror = () => {
              console.error('🔊 Cloned audio error');
              if (state.currentAudio === result.audio) {
                state.currentAudio = null;
              }
              clearWatchdog();
              state.isSpeaking = false;
              processQueue();
            };
            state.currentAudio = result.audio;
            result.audio.play().catch(() => {
              console.warn('⏸️ Audio autoplay blocked. Click page to enable audio.');
              if (state.currentAudio === result.audio) {
                state.currentAudio = null;
              }
              clearWatchdog();
              state.isSpeaking = false;
              if (typeof unlockAudio === 'function') {
                unlockAudio();
              }
            });
            return;
          }

          const utterance = result && result.utterance
            ? result.utterance
            : new SpeechSynthesisUtterance(speechText);
          if (selectedVoice && selectedVoice.startsWith('system-') && typeof resolveSystemVoice === 'function') {
            const resolved = resolveSystemVoice(selectedVoice);
            if (resolved) utterance.voice = resolved;
          }
          utterance.rate = adaptiveRate;
          utterance.pitch = speechSettings.pitch;
          utterance.volume = speechSettings.volume;
          setupUtteranceHandlers(utterance);
          synth.speak(utterance);
          state.currentUtterance = utterance;
        }).catch((error) => {
          console.error('🔊 Cloned voice error:', error);
          clearWatchdog();
          state.isSpeaking = false;
          processQueue();
        });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(speechText);
      if (selectedVoice && selectedVoice.startsWith('system-') && typeof resolveSystemVoice === 'function') {
        const resolved = resolveSystemVoice(selectedVoice);
        if (resolved) utterance.voice = resolved;
      }
      utterance.rate = adaptiveRate;
      utterance.pitch = speechSettings.pitch;
      utterance.volume = speechSettings.volume;
      setupUtteranceHandlers(utterance);

      if (display !== false && typeof addChatMessage === 'function') {
        addChatMessage(author, text, platform, true);
      }

      synth.speak(utterance);
      state.currentUtterance = utterance;
    }

    function enqueueMessage(message) {
      state.messageQueue.push(normalizeQueuedMessage(message));
      pruneQueuedMessages();
    }

    function stopAllSpeech() {
      state.messageQueue = [];
      state.currentUtterance = null;
      state.isSpeaking = false;
      clearWatchdog();

      if (state.currentAudio) {
        try {
          if (typeof state.currentAudio.pause === 'function') {
            state.currentAudio.pause();
          }
          if (typeof state.currentAudio.currentTime === 'number') {
            state.currentAudio.currentTime = 0;
          }
        } catch (err) {
          // Ignore cloned audio cancellation errors.
        } finally {
          state.currentAudio = null;
        }
      }

      if (synth && typeof synth.cancel === 'function') {
        try {
          synth.cancel();
        } catch (err) {
          // Ignore speech synthesis cancellation errors.
        }
      }
    }

    function setPlatformSpeechSuppressed(platform, suppressed) {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      if (!normalizedPlatform) return;
      state.speechSuppressedByPlatform[normalizedPlatform] = Boolean(suppressed);
    }

    function isPlatformSpeechSuppressed(platform) {
      const normalizedPlatform = String(platform || '').trim().toLowerCase();
      if (!normalizedPlatform) return false;
      return state.speechSuppressedByPlatform[normalizedPlatform] === true;
    }

    function speakText(author, text, platform, shouldDisplay = true, options = {}) {
      const defaultVoice = typeof getPlatformDefaultVoice === 'function'
        ? (getPlatformDefaultVoice(platform) || '')
        : '';
      const userVoice = typeof getUserVoice === 'function'
        ? (getUserVoice(author, platform) || '')
        : '';
      const isMuted = typeof isMutedVoiceId === 'function'
        ? isMutedVoiceId(userVoice)
        : false;
      const voiceToUse = userVoice || defaultVoice;

      if (shouldDisplay && typeof addChatMessage === 'function') {
        try {
          addChatMessage(author, text, platform, false);
        } catch (e) {
          // Ignore UI rendering errors, keep speaking pipeline running.
        }
      }

      if (isPlatformSpeechSuppressed(platform) && options?.bypassSuppression !== true) {
        return;
      }

      if (isMuted) {
        return;
      }

      enqueueMessage({
        author,
        text,
        platform,
        display: false,
        voiceOverride: voiceToUse
      });
      processQueue();
    }

    return {
      state,
      filterMessage,
      speakWithCustomVoice,
      processQueue,
      setupUtteranceHandlers,
      enqueueMessage,
      speakText,
      setPlatformSpeechSuppressed,
      isPlatformSpeechSuppressed,
      clearWatchdog,
      stopAllSpeech
    };
  }

  window.createTtsEngineController = createTtsEngineController;
})();

(function initMicTriggerModule() {
  function createMicTriggerController({
    windowRef,
    navigatorRef,
    settingsStore,
    elements = {},
    callbacks = {},
    fetchFn,
    WebSocketRef,
    AudioContextRef
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const nav = navigatorRef || (typeof navigator !== 'undefined' ? navigator : null);
    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const WebSocketCtor = WebSocketRef
      || (win && win.WebSocket)
      || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    const AudioContextCtor = AudioContextRef
      || (win && (win.AudioContext || win.webkitAudioContext))
      || (typeof AudioContext !== 'undefined' ? AudioContext : null);

    const DEFAULT_MIC_ASR_BASE_URL = 'http://127.0.0.1:8001';
    const MIC_ASR_BASE_URL_KEY = 'mic_asr_base_url';
    const MIC_ASR_LANGUAGE_KEY = 'mic_asr_language';
    const MIC_TRIGGER_MODE_KEY = 'mic_trigger_mode';
    const MIC_VOICE_GATE_ENABLED_KEY = 'mic_voice_gate_enabled';
    const MIC_VOICE_PROFILE_KEY = 'mic_voice_profile';
    const MIC_VOICE_SAMPLE_KEY = 'mic_voice_profile_preview_wav';
    const MIC_VOICE_MATCH_THRESHOLD_KEY = 'mic_voice_match_threshold';
    const MIC_VOICE_PROFILE_VERSION = 2;
    const statusClasses = ['online', 'offline', 'listening'];
    const MIC_STARTUP_IGNORE_MS = 2000;
    const MIC_SUGGESTION_CLEAR_MS = 18000;
    const MIC_SUGGESTION_FEW_CLEAR_MS = 24000;
    const MIC_SUGGESTION_SINGLE_CLEAR_MS = 28000;
    const MIC_SUGGESTION_INTERACTION_CLEAR_MS = 12000;
    const MIC_MIN_CONFIDENCE = 0.72;
    const MIC_MIN_SHORT_PHRASE_CONFIDENCE = 0.82;
    const MIC_MIN_SINGLE_WORD_LENGTH = 4;
    const MIC_DUPLICATE_WINDOW_MS = 8000;
    const MIC_VOICE_MATCH_THRESHOLD = 0.74;
    const MIC_VOICE_ENROLL_DURATION_MS = 5500;
    const MIC_VOICE_PROFILE_MAX_VECTOR = 128;

    const state = {
      initialized: false,
      connecting: false,
      listening: false,
      enrolling: false,
      manualStop: false,
      socket: null,
      micStream: null,
      audioContext: null,
      audioSourceNode: null,
      audioSinkNode: null,
      audioWorkletNode: null,
      audioProcessorNode: null,
      lastTranscript: '',
      micLevel: 0,
      listeningStartedAtMs: 0,
      lastAcceptedTranscriptKey: '',
      lastAcceptedTranscriptAtMs: 0,
      voiceProfile: null,
      voiceProfileNeedsRefresh: false,
      voicePreviewDataUrl: '',
      previewAudio: null,
      enrollmentCountdownTimer: null,
      enrollmentCountdownRemaining: 0,
      triggerMode: 'auto',
      suggestions: [],
      suggestionClearTimer: null,
      dockDismissed: false
    };

    function removeSuggestionById(id = '') {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) return;
      state.suggestions = state.suggestions.filter((entry) => String(entry?.id || '').trim() !== normalizedId);
      renderSuggestions();
      scheduleSuggestionClear(getSuggestionClearDelay(state.suggestions.length));
    }

    function updateSuggestionById(id = '', updater = null) {
      const normalizedId = String(id || '').trim();
      if (!normalizedId || typeof updater !== 'function') return;
      state.suggestions = state.suggestions.map((entry) => {
        if (String(entry?.id || '').trim() !== normalizedId) return entry;
        return updater(entry);
      });
    }

    function markSuggestionActive(id = '', extra = {}) {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) return;
      updateSuggestionById(normalizedId, (entry) => ({
        ...entry,
        active: true,
        dismissOnStop: extra.dismissOnStop === true,
        localPreview: extra.localPreview === true
      }));
      renderSuggestions();
      scheduleSuggestionClear(Math.max(MIC_SUGGESTION_INTERACTION_CLEAR_MS, getSuggestionClearDelay(state.suggestions.length)));
    }

    function clearDockSurface() {
      clearSuggestionTimer();
      state.suggestions = [];
      state.dockDismissed = true;
      renderSuggestions();
      renderTranscript('', null, {});
      if (state.listening) {
        setStatus(`Mic active • ${isSuggestionMode() ? 'suggestion mode' : 'listening'} (lang=${describeLanguage()})`, 'listening');
      }
    }

    function normalizeBaseUrl(value) {
      const raw = String(value || '').trim();
      if (!raw) return DEFAULT_MIC_ASR_BASE_URL;
      return raw.replace(/\/+$/, '');
    }

    function normalizeLanguage(value) {
      const normalized = String(value || '').trim().toLowerCase();
      const supported = new Set(['auto', 'en', 'de', 'pl', 'es', 'fr', 'it']);
      return supported.has(normalized) ? normalized : 'auto';
    }

    function normalizeTriggerMode(value) {
      return String(value || '').trim().toLowerCase() === 'suggest' ? 'suggest' : 'auto';
    }

    function normalizeVoiceProfile(raw) {
      if (!raw) return null;
      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          return null;
        }
      }
      const vector = Array.isArray(parsed?.vector) ? parsed.vector : [];
      if (!vector.length || vector.length > MIC_VOICE_PROFILE_MAX_VECTOR) return null;
      const version = Number(parsed?.version || 0);
      if (version !== MIC_VOICE_PROFILE_VERSION) return null;
      const normalizedVector = vector
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
      if (!normalizedVector.length || normalizedVector.length !== vector.length) return null;
      const frameCount = Math.max(0, Number(parsed?.frame_count || parsed?.frameCount || 0));
      return {
        version,
        sampleRate: Math.max(1, Number(parsed?.sample_rate || parsed?.sampleRate || 16000)),
        frameCount,
        vector: normalizedVector
      };
    }

    function hasVoiceProfile() {
      return Boolean(state.voiceProfile && Array.isArray(state.voiceProfile.vector) && state.voiceProfile.vector.length > 0);
    }

    function normalizeVoicePreviewDataUrl(value) {
      const raw = String(value || '').trim();
      if (!raw) return '';
      return raw.startsWith('data:audio/wav;base64,') ? raw : '';
    }

    function isVoiceGateEnabled() {
      return elements.micVoiceGateEnabled?.checked === true;
    }

    function normalizeVoiceMatchThreshold(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return MIC_VOICE_MATCH_THRESHOLD;
      const normalized = numeric > 1 ? (numeric / 100) : numeric;
      return Math.max(0.6, Math.min(0.95, normalized));
    }

    function getVoiceMatchThreshold() {
      const inputValue = elements.micVoiceMatchThreshold?.value;
      const storedValue = settingsStore?.getItem?.(MIC_VOICE_MATCH_THRESHOLD_KEY);
      return normalizeVoiceMatchThreshold(inputValue || storedValue || MIC_VOICE_MATCH_THRESHOLD);
    }

    function updateVoiceMatchThresholdLabel(value = getVoiceMatchThreshold()) {
      if (elements.micVoiceMatchThresholdValue) {
        elements.micVoiceMatchThresholdValue.textContent = `${Math.round(value * 100)}%`;
      }
    }

    function getBaseUrl() {
      const inputValue = elements.micAsrBaseUrlInput?.value;
      const storedValue = settingsStore?.getItem?.(MIC_ASR_BASE_URL_KEY);
      return normalizeBaseUrl(inputValue || storedValue || DEFAULT_MIC_ASR_BASE_URL);
    }

    function getLanguage() {
      const inputValue = elements.micAsrLanguageSelect?.value;
      const storedValue = settingsStore?.getItem?.(MIC_ASR_LANGUAGE_KEY);
      return normalizeLanguage(inputValue || storedValue || 'auto');
    }

    function loadVoiceGateEnabled() {
      const enabled = String(settingsStore?.getItem?.(MIC_VOICE_GATE_ENABLED_KEY) || '').trim().toLowerCase() === 'true';
      if (elements.micVoiceGateEnabled) {
        elements.micVoiceGateEnabled.checked = enabled;
      }
      return enabled;
    }

    function loadVoiceProfile() {
      const rawProfile = settingsStore?.getItem?.(MIC_VOICE_PROFILE_KEY);
      state.voiceProfile = normalizeVoiceProfile(rawProfile);
      state.voiceProfileNeedsRefresh = Boolean(rawProfile) && !state.voiceProfile;
      if (state.voiceProfileNeedsRefresh) {
        settingsStore?.removeItem?.(MIC_VOICE_PROFILE_KEY);
      }
      return state.voiceProfile;
    }

    function loadVoicePreviewSample() {
      state.voicePreviewDataUrl = normalizeVoicePreviewDataUrl(settingsStore?.getItem?.(MIC_VOICE_SAMPLE_KEY));
      return state.voicePreviewDataUrl;
    }

    function loadVoiceMatchThreshold() {
      const threshold = normalizeVoiceMatchThreshold(
        settingsStore?.getItem?.(MIC_VOICE_MATCH_THRESHOLD_KEY) || MIC_VOICE_MATCH_THRESHOLD
      );
      if (elements.micVoiceMatchThreshold) {
        elements.micVoiceMatchThreshold.value = String(Math.round(threshold * 100));
      }
      updateVoiceMatchThresholdLabel(threshold);
      return threshold;
    }

    function saveVoiceGateEnabled() {
      const enabled = isVoiceGateEnabled();
      settingsStore?.setItem?.(MIC_VOICE_GATE_ENABLED_KEY, enabled ? 'true' : 'false');
      return enabled;
    }

    function saveVoiceMatchThreshold() {
      const threshold = getVoiceMatchThreshold();
      settingsStore?.setItem?.(MIC_VOICE_MATCH_THRESHOLD_KEY, String(Math.round(threshold * 100)));
      if (elements.micVoiceMatchThreshold) {
        elements.micVoiceMatchThreshold.value = String(Math.round(threshold * 100));
      }
      updateVoiceMatchThresholdLabel(threshold);
      return threshold;
    }

    function saveVoiceProfile(profile) {
      const normalized = normalizeVoiceProfile(profile);
      state.voiceProfile = normalized;
      state.voiceProfileNeedsRefresh = false;
      if (normalized) {
        settingsStore?.setItem?.(MIC_VOICE_PROFILE_KEY, JSON.stringify(normalized));
      } else {
        settingsStore?.removeItem?.(MIC_VOICE_PROFILE_KEY);
      }
      return normalized;
    }

    function saveVoicePreviewSample(dataUrl) {
      const normalized = normalizeVoicePreviewDataUrl(dataUrl);
      state.voicePreviewDataUrl = normalized;
      if (normalized) {
        settingsStore?.setItem?.(MIC_VOICE_SAMPLE_KEY, normalized);
      } else {
        settingsStore?.removeItem?.(MIC_VOICE_SAMPLE_KEY);
      }
      return normalized;
    }

    function setVoiceProfileStatus(text, tone = '') {
      const node = elements.micVoiceProfileStatus || null;
      if (!node) return;
      node.textContent = text;
      node.classList?.remove('ready', 'recording');
      if (tone === 'ready' || tone === 'recording') {
        node.classList?.add(tone);
      }
    }

    function updateVoiceProfileUi() {
      const enrollBtn = elements.micVoiceEnrollBtn || null;
      const previewBtn = elements.micVoicePreviewBtn || null;
      const clearBtn = elements.micVoiceClearBtn || null;
      const profileReady = hasVoiceProfile();
      const previewReady = Boolean(state.voicePreviewDataUrl);

      if (enrollBtn) {
        if (state.enrolling) {
          const seconds = Math.max(1, Math.ceil(state.enrollmentCountdownRemaining / 1000));
          enrollBtn.textContent = `Recording... ${seconds}s`;
        } else {
          enrollBtn.textContent = profileReady ? 'Replace Voice' : 'Enroll My Voice';
        }
        enrollBtn.disabled = state.enrolling || state.listening || state.connecting;
      }

      if (clearBtn) {
        clearBtn.disabled = state.enrolling || state.listening || state.connecting || !profileReady;
      }

      if (previewBtn) {
        previewBtn.disabled = state.enrolling || state.connecting || !previewReady;
      }

      if (state.enrolling) {
        setVoiceProfileStatus('Recording your voice sample...', 'recording');
        return;
      }

      if (state.voiceProfileNeedsRefresh) {
        setVoiceProfileStatus('Voice profile needs re-enrollment after matcher update.');
        return;
      }

      if (profileReady) {
        const frames = Math.max(0, Number(state.voiceProfile?.frameCount || 0));
        setVoiceProfileStatus(
          frames > 0 ? `Voice profile ready (${frames} voiced frames)` : 'Voice profile ready',
          'ready'
        );
      } else {
        setVoiceProfileStatus('No voice profile enrolled.');
      }
    }

    function setStatus(text, tone = '') {
      const statusEl = elements.micTriggerStatus || null;
      if (!statusEl) return;
      statusEl.textContent = text;
      if (statusEl.classList) {
        statusClasses.forEach((token) => statusEl.classList.remove(token));
        if (tone && statusClasses.includes(tone)) {
          statusEl.classList.add(tone);
        }
      }
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function escapeRegex(value) {
      return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeTranscriptText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isWordChar(value = '') {
      return /^[a-z0-9]$/i.test(String(value || ''));
    }

    function shouldIgnoreTranscript({ text = '', confidence = 0, noSpeechProb = 0, durationMs = 0 } = {}) {
      const normalized = normalizeTranscriptText(text);
      if (!normalized) return { ignore: true, reason: 'empty' };

      const now = Date.now();
      if (state.listeningStartedAtMs > 0 && now - state.listeningStartedAtMs < MIC_STARTUP_IGNORE_MS) {
        return { ignore: true, reason: 'startup' };
      }

      if (Number.isFinite(confidence) && confidence > 0 && confidence < MIC_MIN_CONFIDENCE) {
        return { ignore: true, reason: 'low-confidence' };
      }

      const words = normalized.split(' ').filter(Boolean);
      if (Number.isFinite(noSpeechProb) && noSpeechProb > 0 && noSpeechProb >= 0.55) {
        return { ignore: true, reason: 'high-no-speech-prob' };
      }
      if (Number.isFinite(durationMs) && durationMs > 0 && durationMs < 900) {
        return { ignore: true, reason: 'short-segment' };
      }
      if (words.length === 1 && words[0].length < MIC_MIN_SINGLE_WORD_LENGTH) {
        return { ignore: true, reason: 'too-short' };
      }
      if (words.length <= 2 && Number.isFinite(confidence) && confidence > 0 && confidence < MIC_MIN_SHORT_PHRASE_CONFIDENCE) {
        return { ignore: true, reason: 'short-phrase-low-confidence' };
      }

      if (
        state.lastAcceptedTranscriptKey
        && state.lastAcceptedTranscriptKey === normalized
        && now - state.lastAcceptedTranscriptAtMs < MIC_DUPLICATE_WINDOW_MS
      ) {
        return { ignore: true, reason: 'duplicate' };
      }

      return { ignore: false, normalized };
    }

    function fileNameFromPath(value) {
      return String(value || '').split('/').pop() || String(value || '');
    }

    function dedupeKeywords(matches = []) {
      const seen = new Set();
      const ordered = [];
      matches.forEach((match) => {
        const keyword = String(match?.keyword || '').trim();
        if (!keyword) return;
        const key = keyword.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        ordered.push(keyword);
      });
      return ordered;
    }

    function findWholePhraseRanges(text, keyword) {
      const transcript = String(text || '');
      const phrase = String(keyword || '').trim();
      if (!transcript || !phrase) return [];

      const lowerTranscript = transcript.toLowerCase();
      const lowerPhrase = phrase.toLowerCase();
      const ranges = [];
      let fromIndex = 0;

      while (fromIndex < lowerTranscript.length) {
        const nextIndex = lowerTranscript.indexOf(lowerPhrase, fromIndex);
        if (nextIndex === -1) break;
        const before = nextIndex > 0 ? transcript[nextIndex - 1] : '';
        const afterIndex = nextIndex + phrase.length;
        const after = afterIndex < transcript.length ? transcript[afterIndex] : '';
        if (!isWordChar(before) && !isWordChar(after)) {
          ranges.push({ start: nextIndex, end: afterIndex });
        }
        fromIndex = nextIndex + Math.max(1, phrase.length);
      }

      return ranges;
    }

    function renderHighlightedTranscript(text, matches = []) {
      const transcript = String(text || '');
      if (!transcript) return '';
      const ranges = [];
      dedupeKeywords(matches)
        .sort((left, right) => right.length - left.length)
        .forEach((keyword) => {
          findWholePhraseRanges(transcript, keyword).forEach((range) => {
            const overlaps = ranges.some((entry) => range.start < entry.end && range.end > entry.start);
            if (!overlaps) {
              ranges.push(range);
            }
          });
        });

      if (ranges.length === 0) {
        return escapeHtml(transcript);
      }

      ranges.sort((left, right) => left.start - right.start);
      let html = '';
      let cursor = 0;
      ranges.forEach((range) => {
        if (range.start > cursor) {
          html += escapeHtml(transcript.slice(cursor, range.start));
        }
        html += `<span class="mic-trigger-keyword">${escapeHtml(transcript.slice(range.start, range.end))}</span>`;
        cursor = range.end;
      });
      if (cursor < transcript.length) {
        html += escapeHtml(transcript.slice(cursor));
      }
      return html;
    }

    function formatIgnoredReason(reason = '') {
      return String(reason || '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase());
    }

    function hasStrongPreviewMatch(previewResult = null) {
      if (!previewResult || typeof previewResult !== 'object') return false;
      const topAnimationScore = Number(previewResult.animationMatch?.score || 0);
      const topSoundScore = Number(previewResult.soundMatch?.score || 0);
      return Math.max(topAnimationScore, topSoundScore) >= 0.98;
    }

    function canBypassIgnoredTranscript(reason = '', previewResult = null, transcriptText = '') {
      const normalizedReason = String(reason || '').trim().toLowerCase();
      if (normalizedReason !== 'low-confidence' && normalizedReason !== 'short-phrase-low-confidence') {
        return false;
      }
      if (hasStrongPreviewMatch(previewResult)) {
        return true;
      }
      return callbacks.hasExactMicKeywordMatch?.({ text: transcriptText }) === true;
    }

    function renderTranscript(text = '', triggerResult = null, meta = {}) {
      const transcriptEl = elements.micTriggerTranscript || null;
      const matchesEl = elements.micTriggerMatches || null;
      if (!transcriptEl && !matchesEl) return;
      updateDockVisibility();

      const animationMatches = Array.isArray(triggerResult?.animationMatches) ? triggerResult.animationMatches : [];
      const soundMatches = Array.isArray(triggerResult?.soundMatches) ? triggerResult.soundMatches : [];
      const allMatches = animationMatches.concat(soundMatches);
      const transcript = String(text || '').trim();
      const ignoredReason = String(meta.ignoredReason || '').trim();
      const language = String(meta.language || '').trim().toLowerCase();
      const confidence = Number(meta.confidence || 0);
      const durationMs = Number(meta.durationMs || 0);
      const voiceSimilarity = Number(meta.voiceSimilarity || 0);
      const voiceThreshold = Number(meta.voiceThreshold || 0);
      const preserveTranscript = meta.preserveTranscript === true;

      if (transcriptEl) {
        if (!preserveTranscript) {
          state.dockDismissed = false;
          updateDockVisibility();
          transcriptEl.classList?.toggle('mic-trigger-transcript-ignored', Boolean(ignoredReason));
          if (!transcript) {
            transcriptEl.classList?.add('mic-trigger-transcript-empty');
            if (ignoredReason === 'not-your-voice') {
              transcriptEl.textContent = 'Segment ignored because it did not match your enrolled voice.';
            } else if (ignoredReason) {
              transcriptEl.textContent = `Transcript ignored: ${formatIgnoredReason(ignoredReason)}.`;
            } else {
              transcriptEl.textContent = 'Transcript appears here after each spoken phrase.';
            }
          } else {
            transcriptEl.classList?.remove('mic-trigger-transcript-empty');
            transcriptEl.innerHTML = renderHighlightedTranscript(transcript, allMatches);
          }
        }
      }

      if (!matchesEl) return;
      const badges = [];
      if (ignoredReason) {
        badges.push(`<span class="mic-trigger-badge ignored">Ignored: ${escapeHtml(formatIgnoredReason(ignoredReason))}</span>`);
      }
      if (language) {
        badges.push(`<span class="mic-trigger-badge meta">Language: ${escapeHtml(language.toUpperCase())}</span>`);
      }
      if (confidence > 0) {
        badges.push(`<span class="mic-trigger-badge meta">Confidence: ${Math.round(confidence * 100)}%</span>`);
      }
      if (durationMs > 0) {
        badges.push(`<span class="mic-trigger-badge meta">Segment: ${(durationMs / 1000).toFixed(2)}s</span>`);
      }
      if (voiceSimilarity > 0) {
        const label = ignoredReason === 'not-your-voice' ? 'Voice mismatch' : 'Voice match';
        const extra = voiceThreshold > 0 ? ` / ${Math.round(voiceThreshold * 100)}%` : '';
        badges.push(`<span class="mic-trigger-badge voice">${escapeHtml(label)}: ${Math.round(voiceSimilarity * 100)}%${escapeHtml(extra)}</span>`);
      }
      dedupeKeywords(allMatches).forEach((keyword) => {
        badges.push(`<span class="mic-trigger-badge matched">Keyword: ${escapeHtml(keyword)}</span>`);
      });
      if (triggerResult?.animationMatch?.trigger) {
        badges.push(`<span class="mic-trigger-badge animation">Animation: ${escapeHtml(triggerResult.animationMatch.trigger)}</span>`);
      }
      if (triggerResult?.soundMatch?.soundPath) {
        badges.push(`<span class="mic-trigger-badge sound">Sound: ${escapeHtml(fileNameFromPath(triggerResult.soundMatch.soundPath))}</span>`);
      }
      if (triggerResult?.ignoredBySuppressedKeywords) {
        badges.push('<span class="mic-trigger-badge">Ignored while current sound/animation is playing</span>');
      }
      matchesEl.innerHTML = badges.join('');
    }

    function updateMicLevel(level = 0) {
      const normalized = Math.max(0, Math.min(1, Number(level) || 0));
      state.micLevel = normalized;
      if (elements.micTriggerMeterFill?.style) {
        elements.micTriggerMeterFill.style.width = `${Math.round(normalized * 100)}%`;
      }
      if (elements.micTriggerMeterValue) {
        elements.micTriggerMeterValue.textContent = `${Math.round(normalized * 100)}%`;
      }
    }

    function computeInputLevel(input) {
      if (!input || !input.length) return 0;
      let sumSquares = 0;
      let peak = 0;
      for (let index = 0; index < input.length; index += 1) {
        const sample = Math.abs(Number(input[index]) || 0);
        sumSquares += sample * sample;
        if (sample > peak) peak = sample;
      }
      const rms = Math.sqrt(sumSquares / input.length);
      return Math.min(1, Math.max(peak * 1.35, rms * 4.25));
    }

    function updateToggleButton() {
      const button = elements.micTriggerToggleBtn || null;
      const label = elements.micTriggerToggleLabel || null;
      if (!button) return;
      button.disabled = state.enrolling;
      const nextLabel = state.connecting
        ? 'Connecting Mic...'
        : (state.listening ? 'Stop Mic Listening' : 'Start Mic Listening');
      if (label) {
        label.textContent = nextLabel;
      } else {
        button.textContent = nextLabel;
      }
      if (button.classList) {
        button.classList.toggle('stop', state.listening || state.connecting);
        button.classList.toggle('is-listening', state.listening);
        button.classList.toggle('is-connecting', state.connecting);
      }
      updateDockVisibility();
    }

    function loadBaseUrl() {
      const normalized = normalizeBaseUrl(settingsStore?.getItem?.(MIC_ASR_BASE_URL_KEY) || DEFAULT_MIC_ASR_BASE_URL);
      if (elements.micAsrBaseUrlInput) {
        elements.micAsrBaseUrlInput.value = normalized;
      }
    }

    function loadLanguage() {
      const normalized = normalizeLanguage(settingsStore?.getItem?.(MIC_ASR_LANGUAGE_KEY) || 'auto');
      if (elements.micAsrLanguageSelect) {
        elements.micAsrLanguageSelect.value = normalized;
      }
    }

    function saveBaseUrl() {
      const normalized = getBaseUrl();
      settingsStore?.setItem?.(MIC_ASR_BASE_URL_KEY, normalized);
      if (elements.micAsrBaseUrlInput && elements.micAsrBaseUrlInput.value !== normalized) {
        elements.micAsrBaseUrlInput.value = normalized;
      }
      return normalized;
    }

    function saveLanguage() {
      const normalized = getLanguage();
      settingsStore?.setItem?.(MIC_ASR_LANGUAGE_KEY, normalized);
      if (elements.micAsrLanguageSelect && elements.micAsrLanguageSelect.value !== normalized) {
        elements.micAsrLanguageSelect.value = normalized;
      }
      return normalized;
    }

    function loadTriggerMode() {
      const normalized = normalizeTriggerMode(settingsStore?.getItem?.(MIC_TRIGGER_MODE_KEY) || 'auto');
      state.triggerMode = normalized;
      updateTriggerModeButton();
      return normalized;
    }

    function saveTriggerMode(value = state.triggerMode) {
      const normalized = normalizeTriggerMode(value);
      state.triggerMode = normalized;
      settingsStore?.setItem?.(MIC_TRIGGER_MODE_KEY, normalized);
      updateTriggerModeButton();
      renderSuggestions();
      return normalized;
    }

    function isSuggestionMode() {
      return state.triggerMode === 'suggest';
    }

    function updateTriggerModeButton() {
      const button = elements.micTriggerModeBtn || null;
      if (!button) return;
      const suggestionMode = isSuggestionMode();
      button.textContent = suggestionMode ? 'Suggestion mode' : 'Auto trigger';
      button.classList?.toggle('is-suggestion', suggestionMode);
      button.classList?.toggle('is-auto', !suggestionMode);
      button.title = suggestionMode
        ? 'Suggestions only for animations and sound alerts. Click to switch back to automatic triggering.'
        : 'Automatic triggering is enabled for animations and sound alerts. Click to switch to suggestion mode.';
    }

    function updateDockVisibility() {
      const dock = elements.micTranscriptDock || null;
      if (!dock) return;
      const visible = state.listening || state.connecting;
      dock.hidden = !visible;
      dock.classList?.toggle('is-visible', visible && !state.dockDismissed);
    }

    function clearSuggestionTimer() {
      if (state.suggestionClearTimer) {
        clearTimeout(state.suggestionClearTimer);
        state.suggestionClearTimer = null;
      }
    }

    function buildSuggestions(triggerResult = null, { active = false, dismissOnStop = false } = {}) {
      const suggestions = [];

      const animationTrigger = String(triggerResult?.animationMatch?.trigger || '').trim();
      if (animationTrigger) {
        const animationSuggestion = callbacks.getAnimationSuggestion?.({ trigger: animationTrigger });
        if (animationSuggestion) {
          suggestions.push({
            id: `animation:${animationTrigger}`,
            kind: 'animation',
            active,
            dismissOnStop,
            localPreview: false,
            trigger: String(animationSuggestion.trigger || animationTrigger).trim() || animationTrigger,
            label: String(animationSuggestion.label || animationTrigger).trim() || animationTrigger,
            keyword: String(triggerResult?.animationMatch?.keyword || '').trim(),
            fileUrl: String(animationSuggestion.fileUrl || '').trim(),
            filename: String(animationSuggestion.filename || '').trim()
          });
        }
      }

      const soundPath = String(triggerResult?.soundMatch?.soundPath || '').trim();
      if (soundPath) {
        const soundSuggestion = callbacks.getSoundSuggestion?.({ soundPath });
        if (soundSuggestion) {
          suggestions.push({
            id: `sound:${soundPath}`,
            kind: 'sound',
            active,
            dismissOnStop,
            localPreview: false,
            soundPath: String(soundSuggestion.soundPath || soundPath).trim() || soundPath,
            label: String(soundSuggestion.label || fileNameFromPath(soundPath)).trim() || fileNameFromPath(soundPath),
            keyword: String(triggerResult?.soundMatch?.keyword || '').trim()
          });
        }
      }

      return suggestions;
    }

    function renderSuggestions() {
      const container = elements.micTriggerSuggestions || null;
      const dock = elements.micTranscriptDock || null;
      if (!container) return;

      const visible = Boolean(state.listening && state.suggestions.length > 0);
      container.hidden = !visible;
      dock?.classList?.toggle('has-suggestions', visible);

      if (!visible) {
        container.innerHTML = '';
        return;
      }

      container.innerHTML = state.suggestions.map((suggestion) => {
        const safeLabel = escapeHtml(suggestion.label);
        const safeKeyword = escapeHtml(suggestion.keyword || '');
        const safeKind = escapeHtml(suggestion.kind === 'sound' ? 'Sound alert' : 'Animation');
        const safeSuggestionId = escapeHtml(suggestion.id || '');
        const isActive = suggestion.active === true;
        const safeStatus = isActive ? '<span class="mic-suggestion-status">Active now</span>' : '';

        if (suggestion.kind === 'animation') {
          const safeFileUrl = escapeHtml(suggestion.fileUrl || '');
          const safeTrigger = escapeHtml(suggestion.trigger || '');
          const safeFilename = escapeHtml(suggestion.filename || '');
          const shouldMutePreview = !isActive || suggestion.localPreview === true;
          const shouldLoopPreview = !isActive;
          return `
            <div class="mic-suggestion-card media${isActive ? ' is-active' : ''}" data-kind="animation">
              <button class="mic-suggestion-play-btn" type="button" data-kind="animation" data-suggestion-id="${safeSuggestionId}" data-active="${isActive ? 'true' : 'false'}" data-trigger="${safeTrigger}" title="${isActive ? 'Stop current animation' : 'Play suggested animation'}">
                <video class="mic-suggestion-video" src="${safeFileUrl}" autoplay ${shouldMutePreview ? 'muted ' : ''}${shouldLoopPreview ? 'loop ' : ''}playsinline preload="metadata"></video>
                <span class="mic-suggestion-stop-hint" aria-hidden="true">■ Stop</span>
                <span class="mic-suggestion-body">
                  <span class="mic-suggestion-type">${safeKind}</span>
                  <span class="mic-suggestion-name">${safeLabel}</span>
                  ${safeStatus}
                  ${safeKeyword ? `<span class="mic-suggestion-keyword">Keyword: ${safeKeyword}</span>` : ''}
                </span>
              </button>
              <button class="mic-suggestion-settings-btn" type="button" data-kind="animation" data-trigger="${safeTrigger}" data-filename="${safeFilename}" title="Open animation settings" aria-label="Open animation settings">⚙</button>
            </div>
          `;
        }

        const safeSoundPath = escapeHtml(suggestion.soundPath || '');
        return `
          <div class="mic-suggestion-card sound${isActive ? ' is-active' : ''}" data-kind="sound">
            <button class="mic-suggestion-play-btn" type="button" data-kind="sound" data-suggestion-id="${safeSuggestionId}" data-active="${isActive ? 'true' : 'false'}" data-sound-path="${safeSoundPath}" title="${isActive ? 'Stop current sound alert' : 'Play suggested sound alert'}">
              <span class="mic-suggestion-sound-visual" aria-hidden="true">
                <span class="mic-suggestion-sound-icon">🔊</span>
              </span>
              <span class="mic-suggestion-stop-hint" aria-hidden="true">■ Stop</span>
              <span class="mic-suggestion-body">
                <span class="mic-suggestion-type">${safeKind}</span>
                <span class="mic-suggestion-name">${safeLabel}</span>
                ${safeStatus}
                ${safeKeyword ? `<span class="mic-suggestion-keyword">Keyword: ${safeKeyword}</span>` : ''}
              </span>
            </button>
            <button class="mic-suggestion-settings-btn" type="button" data-kind="sound" data-sound-path="${safeSoundPath}" title="Open sound alert settings" aria-label="Open sound alert settings">⚙</button>
          </div>
        `;
      }).join('');

      if (typeof container.querySelectorAll !== 'function') return;
      container.querySelectorAll('.mic-suggestion-play-btn').forEach((button) => {
        button.addEventListener('click', async () => {
          const kind = String(button.getAttribute('data-kind') || '').trim();
          const suggestionId = String(button.getAttribute('data-suggestion-id') || '').trim();
          const isActive = String(button.getAttribute('data-active') || '').trim() === 'true';
          const suggestion = state.suggestions.find((entry) => String(entry?.id || '').trim() === suggestionId) || null;
          if (kind === 'animation') {
            const trigger = String(button.getAttribute('data-trigger') || '').trim();
            if (trigger) {
              if (isActive) {
                const stopped = await callbacks.stopSuggestedAnimation?.({
                  trigger,
                  previewOnly: suggestion?.localPreview === true
                });
                if (stopped !== false) {
                  setStatus(
                    suggestion?.localPreview
                      ? `Stopped mic animation preview: ${trigger}`
                      : `Stopped mic animation: ${trigger}`,
                    'online'
                  );
                  if (suggestion?.dismissOnStop) {
                    removeSuggestionById(suggestionId);
                  } else {
                    updateSuggestionById(suggestionId, (entry) => ({
                      ...entry,
                      active: false,
                      localPreview: false
                    }));
                    renderSuggestions();
                    scheduleSuggestionClear(getSuggestionClearDelay(state.suggestions.length));
                  }
                }
              } else {
                if (isSuggestionMode()) {
                  const triggered = await callbacks.triggerSuggestedAnimation?.({ trigger });
                  if (triggered !== false) {
                    markSuggestionActive(suggestionId, { dismissOnStop: true, localPreview: false });
                    setStatus(`Mic suggestion triggered animation: ${trigger}`, 'online');
                  }
                } else {
                  const triggered = await callbacks.triggerSuggestedAnimation?.({ trigger });
                  if (triggered !== false) {
                    setStatus(`Mic suggestion triggered animation: ${trigger}`, 'online');
                    markSuggestionActive(suggestionId, { dismissOnStop: false, localPreview: false });
                  }
                }
              }
            }
          } else if (kind === 'sound') {
            const soundPathValue = String(button.getAttribute('data-sound-path') || '').trim();
            if (soundPathValue) {
              if (isActive) {
                const stopped = await callbacks.stopSuggestedSound?.({ soundPath: soundPathValue });
                if (stopped !== false) {
                  setStatus(`Stopped mic sound: ${fileNameFromPath(soundPathValue)}`, 'online');
                  if (suggestion?.dismissOnStop) {
                    removeSuggestionById(suggestionId);
                  } else {
                    updateSuggestionById(suggestionId, (entry) => ({
                      ...entry,
                      active: false
                    }));
                    renderSuggestions();
                    scheduleSuggestionClear(getSuggestionClearDelay(state.suggestions.length));
                  }
                }
              } else {
                const triggered = await callbacks.triggerSuggestedSound?.({ soundPath: soundPathValue });
                if (triggered !== false) {
                  setStatus(`Mic suggestion triggered sound: ${fileNameFromPath(soundPathValue)}`, 'online');
                  markSuggestionActive(suggestionId, { dismissOnStop: false, localPreview: false });
                }
              }
            }
          }
        });
      });
      container.querySelectorAll('.mic-suggestion-settings-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const kind = String(button.getAttribute('data-kind') || '').trim();
          if (kind === 'animation') {
            const trigger = String(button.getAttribute('data-trigger') || '').trim();
            const filename = String(button.getAttribute('data-filename') || '').trim();
            if (trigger) {
              callbacks.openSuggestedAnimationSettings?.({ trigger, filename });
            }
            return;
          }
          if (kind === 'sound') {
            const soundPathValue = String(button.getAttribute('data-sound-path') || '').trim();
            if (soundPathValue) {
              callbacks.openSuggestedSoundSettings?.({ soundPath: soundPathValue });
            }
          }
        });
      });
    }

    function getSuggestionClearDelay(count = 0) {
      if (count <= 1) return MIC_SUGGESTION_SINGLE_CLEAR_MS;
      if (count <= 2) return MIC_SUGGESTION_FEW_CLEAR_MS;
      return MIC_SUGGESTION_CLEAR_MS;
    }

    function scheduleSuggestionClear(delayMs = 0) {
      clearSuggestionTimer();
      if (state.suggestions.length === 0) return;
      const normalizedDelay = Math.max(1000, Number(delayMs) || getSuggestionClearDelay(state.suggestions.length));
      state.suggestionClearTimer = setTimeout(() => {
        state.suggestions = [];
        renderSuggestions();
      }, normalizedDelay);
    }

    function setSuggestions(suggestions = [], { preserveExisting = false } = {}) {
      const nextSuggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
      if (nextSuggestions.length > 0) {
        state.dockDismissed = false;
      }
      if (preserveExisting && nextSuggestions.length === 0 && state.suggestions.length > 0) {
        renderSuggestions();
        scheduleSuggestionClear(getSuggestionClearDelay(state.suggestions.length));
        return;
      }
      clearSuggestionTimer();
      if (preserveExisting && state.suggestions.length > 0 && nextSuggestions.length > 0) {
        const merged = new Map();
        state.suggestions.forEach((entry) => {
          if (!entry?.id) return;
          merged.set(entry.id, entry);
        });
        nextSuggestions.forEach((entry) => {
          if (!entry?.id) return;
          merged.set(entry.id, entry);
        });
        state.suggestions = Array.from(merged.values());
      } else {
        state.suggestions = nextSuggestions;
      }
      renderSuggestions();
      scheduleSuggestionClear(getSuggestionClearDelay(state.suggestions.length));
    }

    function markTranscriptAccepted(text, normalized = '') {
      state.lastTranscript = text;
      state.lastAcceptedTranscriptKey = normalized || normalizeTranscriptText(text);
      state.lastAcceptedTranscriptAtMs = Date.now();
    }

    function buildHealthUrl() {
      return `${getBaseUrl()}/health`;
    }

    function buildProfileExtractUrl() {
      const parsed = new URL(getBaseUrl());
      const basePath = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = `${basePath}/profile/extract`;
      parsed.search = '';
      parsed.searchParams.set('sample_rate', '16000');
      return parsed.toString();
    }

    function buildWsUrl() {
      const baseUrl = getBaseUrl();
      const parsed = new URL(baseUrl);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      const basePath = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = `${basePath}/ws/mic-trigger`;
      parsed.search = '';
      parsed.searchParams.set('language', getLanguage());
      return parsed.toString();
    }

    function shortBaseUrl() {
      try {
        const parsed = new URL(getBaseUrl());
        return parsed.origin;
      } catch {
        return getBaseUrl();
      }
    }

    function describeLanguage() {
      const language = getLanguage();
      return language === 'auto' ? 'auto' : language.toUpperCase();
    }

    function buildSpeakerProfilePayload() {
      if (!isVoiceGateEnabled()) {
        return {
          type: 'speaker_profile',
          enabled: false
        };
      }
      const profile = state.voiceProfile || normalizeVoiceProfile(settingsStore?.getItem?.(MIC_VOICE_PROFILE_KEY));
      if (!profile) return null;
      return {
        type: 'speaker_profile',
        enabled: true,
        threshold: getVoiceMatchThreshold(),
        profile
      };
    }

    function pushSpeakerProfileConfig() {
      if (!state.socket || state.socket.readyState !== WebSocketCtor.OPEN) return false;
      const payload = buildSpeakerProfilePayload();
      if (!payload) return false;
      try {
        state.socket.send(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }

    async function refreshHealth() {
      if (!callFetch) return false;
      try {
        const response = await callFetch(buildHealthUrl());
        if (!response || !response.ok) {
          throw new Error(`HTTP ${response?.status || 'unreachable'}`);
        }
        const data = await response.json().catch(() => ({}));
        if (!state.listening && !state.connecting) {
          const gateSuffix = isVoiceGateEnabled()
            ? (hasVoiceProfile() ? ' • only-my-voice ready' : ' • only-my-voice needs enrollment')
            : '';
          setStatus(
            `Mic ASR online at ${shortBaseUrl()} (${String(data.whisper_model || 'base')}, lang=${describeLanguage()}) • inactive${gateSuffix}`,
            'online'
          );
        }
        return true;
      } catch (err) {
        if (!state.listening && !state.connecting) {
          setStatus(`Mic ASR offline at ${shortBaseUrl()}. Start npm run start:asr, then enable the mic.`, 'offline');
        }
        return false;
      }
    }

    async function captureMicStream() {
      if (!nav?.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not supported in this browser');
      }
      return nav.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    }

    async function requestMicStream() {
      state.micStream = await captureMicStream();
      return state.micStream;
    }

    function downsampleToPcm16(input, inSampleRate, outSampleRate = 16000) {
      if (!input || !input.length) return new ArrayBuffer(0);

      if (inSampleRate === outSampleRate) {
        const out = new Int16Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, input[index]));
          out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        return out.buffer;
      }

      const ratio = inSampleRate / outSampleRate;
      const outLength = Math.max(1, Math.round(input.length / ratio));
      const out = new Int16Array(outLength);
      let inOffset = 0;
      for (let index = 0; index < outLength; index += 1) {
        const nextOffset = Math.min(input.length, Math.round((index + 1) * ratio));
        let accum = 0;
        let count = 0;
        for (let inner = inOffset; inner < nextOffset; inner += 1) {
          accum += input[inner];
          count += 1;
        }
        const sample = count ? (accum / count) : 0;
        const clamped = Math.max(-1, Math.min(1, sample));
        out[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        inOffset = nextOffset;
      }
      return out.buffer;
    }

    function teardownAudioPipeline() {
      if (state.audioWorkletNode) {
        try { state.audioWorkletNode.disconnect(); } catch {}
        if (state.audioWorkletNode.port) {
          state.audioWorkletNode.port.onmessage = null;
        }
        state.audioWorkletNode = null;
      }
      if (state.audioProcessorNode) {
        try { state.audioProcessorNode.disconnect(); } catch {}
        state.audioProcessorNode.onaudioprocess = null;
        state.audioProcessorNode = null;
      }
      if (state.audioSourceNode) {
        try { state.audioSourceNode.disconnect(); } catch {}
        state.audioSourceNode = null;
      }
      if (state.audioSinkNode) {
        try { state.audioSinkNode.disconnect(); } catch {}
        state.audioSinkNode = null;
      }
      if (state.audioContext) {
        try { state.audioContext.close(); } catch {}
        state.audioContext = null;
      }
      if (state.micStream) {
        try {
          state.micStream.getTracks().forEach((track) => track.stop());
        } catch {}
        state.micStream = null;
      }
      updateMicLevel(0);
    }

    function concatArrayBuffers(buffers = []) {
      const totalLength = buffers.reduce((sum, entry) => sum + (entry?.byteLength || 0), 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      buffers.forEach((entry) => {
        if (!entry || !entry.byteLength) return;
        merged.set(new Uint8Array(entry), offset);
        offset += entry.byteLength;
      });
      return merged.buffer;
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...chunk);
      }
      if (typeof btoa === 'function') return btoa(binary);
      if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
      throw new Error('Base64 encoding is not available in this environment');
    }

    function pcm16ToWavDataUrl(pcmBuffer, sampleRate = 16000) {
      const pcmBytes = new Uint8Array(pcmBuffer || 0);
      const wavBuffer = new ArrayBuffer(44 + pcmBytes.byteLength);
      const view = new DataView(wavBuffer);
      const bytes = new Uint8Array(wavBuffer);

      function writeAscii(offset, value) {
        for (let index = 0; index < value.length; index += 1) {
          bytes[offset + index] = value.charCodeAt(index);
        }
      }

      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + pcmBytes.byteLength, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, pcmBytes.byteLength, true);
      bytes.set(pcmBytes, 44);

      return `data:audio/wav;base64,${arrayBufferToBase64(wavBuffer)}`;
    }

    async function recordVoiceEnrollmentSample(durationMs = MIC_VOICE_ENROLL_DURATION_MS) {
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not supported in this browser');
      }

      const stream = await captureMicStream();
      const audioContext = new AudioContextCtor();
      const collected = [];
      let sourceNode = null;
      let sinkNode = null;
      let processorNode = null;

      try {
        if (typeof audioContext.resume === 'function') {
          await audioContext.resume();
        }

        sourceNode = audioContext.createMediaStreamSource(stream);
        sinkNode = audioContext.createGain();
        sinkNode.gain.value = 0;
        processorNode = audioContext.createScriptProcessor(2048, 1, 1);
        processorNode.onaudioprocess = (event) => {
          const input = event?.inputBuffer?.getChannelData?.(0);
          if (!input || !input.length) return;
          updateMicLevel(computeInputLevel(input));
          const pcmBuffer = downsampleToPcm16(input, audioContext.sampleRate, 16000);
          if (pcmBuffer.byteLength > 0) {
            collected.push(pcmBuffer.slice(0));
          }
        };

        sourceNode.connect(processorNode);
        processorNode.connect(sinkNode);
        sinkNode.connect(audioContext.destination);

        state.enrollmentCountdownRemaining = durationMs;
        if (state.enrollmentCountdownTimer) {
          clearInterval(state.enrollmentCountdownTimer);
        }
        state.enrollmentCountdownTimer = setInterval(() => {
          state.enrollmentCountdownRemaining = Math.max(0, state.enrollmentCountdownRemaining - 250);
          updateVoiceProfileUi();
        }, 250);
        updateVoiceProfileUi();

        await new Promise((resolve) => setTimeout(resolve, durationMs));
        return concatArrayBuffers(collected);
      } finally {
        if (state.enrollmentCountdownTimer) {
          clearInterval(state.enrollmentCountdownTimer);
          state.enrollmentCountdownTimer = null;
        }
        state.enrollmentCountdownRemaining = 0;
        try {
          if (processorNode) processorNode.disconnect();
        } catch {}
        if (processorNode) processorNode.onaudioprocess = null;
        try {
          if (sourceNode) sourceNode.disconnect();
        } catch {}
        try {
          if (sinkNode) sinkNode.disconnect();
        } catch {}
        try {
          stream.getTracks().forEach((track) => track.stop());
        } catch {}
        try {
          if (audioContext) await audioContext.close();
        } catch {}
        updateMicLevel(0);
      }
    }

    async function extractVoiceProfile(pcmBuffer) {
      if (!callFetch) {
        throw new Error('fetch is not available');
      }
      const response = await callFetch(buildProfileExtractUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: pcmBuffer
      });
      if (!response?.ok) {
        let detail = `HTTP ${response?.status || 'unreachable'}`;
        try {
          const data = await response.json();
          if (data?.detail) detail = String(data.detail);
        } catch {}
        throw new Error(detail);
      }
      const data = await response.json().catch(() => ({}));
      const normalized = normalizeVoiceProfile(data?.profile);
      if (!normalized) {
        throw new Error('Voice profile extraction returned no usable profile');
      }
      return {
        profile: normalized,
        recommendedThreshold: normalizeVoiceMatchThreshold(data?.recommended_threshold || MIC_VOICE_MATCH_THRESHOLD)
      };
    }

    async function setupAudioCapturePipeline() {
      if (!AudioContextCtor) {
        throw new Error('AudioContext is not supported in this browser');
      }
      if (!state.micStream) {
        throw new Error('Microphone stream is not available');
      }

      const audioContext = new AudioContextCtor();
      state.audioContext = audioContext;
      if (typeof audioContext.resume === 'function') {
        await audioContext.resume();
      }

      state.audioSourceNode = audioContext.createMediaStreamSource(state.micStream);
      state.audioSinkNode = audioContext.createGain();
      state.audioSinkNode.gain.value = 0;

      const canUseWorklet = Boolean(audioContext.audioWorklet && win && typeof win.AudioWorkletNode !== 'undefined');
      if (canUseWorklet) {
        const moduleCode = `
          class PcmCaptureProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs && inputs[0] && inputs[0][0];
              if (input && input.length) {
                this.port.postMessage(input);
              }
              return true;
            }
          }
          registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
        `;
        const blob = new Blob([moduleCode], { type: 'application/javascript' });
        const moduleUrl = URL.createObjectURL(blob);
        try {
          await audioContext.audioWorklet.addModule(moduleUrl);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }

        state.audioWorkletNode = new win.AudioWorkletNode(audioContext, 'pcm-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit'
        });
        state.audioWorkletNode.port.onmessage = (event) => {
          if (!state.socket || state.socket.readyState !== WebSocketCtor.OPEN) return;
          const input = event.data;
          updateMicLevel(computeInputLevel(input));
          const pcmBuffer = downsampleToPcm16(input, audioContext.sampleRate, 16000);
          if (pcmBuffer.byteLength > 0) {
            try { state.socket.send(pcmBuffer); } catch {}
          }
        };
        state.audioSourceNode.connect(state.audioWorkletNode);
        state.audioWorkletNode.connect(state.audioSinkNode);
        state.audioSinkNode.connect(audioContext.destination);
        return;
      }

      state.audioProcessorNode = audioContext.createScriptProcessor(2048, 1, 1);
      state.audioSourceNode.connect(state.audioProcessorNode);
      state.audioProcessorNode.connect(state.audioSinkNode);
      state.audioSinkNode.connect(audioContext.destination);
      state.audioProcessorNode.onaudioprocess = (event) => {
        if (!state.socket || state.socket.readyState !== WebSocketCtor.OPEN) return;
        const input = event.inputBuffer.getChannelData(0);
        updateMicLevel(computeInputLevel(input));
        const pcmBuffer = downsampleToPcm16(input, audioContext.sampleRate, 16000);
        if (pcmBuffer.byteLength > 0) {
          try { state.socket.send(pcmBuffer); } catch {}
        }
      };
    }

    async function enrollVoiceProfile() {
      if (state.enrolling) return false;
      if (state.listening || state.connecting) {
        setStatus('Stop mic listening before enrolling your voice profile.', 'offline');
        return false;
      }

      saveBaseUrl();
      const serviceOnline = await refreshHealth();
      if (!serviceOnline) return false;

      state.enrolling = true;
      updateVoiceProfileUi();
      setStatus('Speak naturally for a few seconds to enroll your voice profile...', 'online');

      try {
        const pcmBuffer = await recordVoiceEnrollmentSample();
        if (!pcmBuffer || pcmBuffer.byteLength < 16000) {
          throw new Error('The recorded sample was too short. Speak for a few seconds and try again.');
        }
        const extracted = await extractVoiceProfile(pcmBuffer);
        saveVoiceProfile(extracted.profile);
        saveVoicePreviewSample(pcm16ToWavDataUrl(pcmBuffer, 16000));
        if (elements.micVoiceMatchThreshold) {
          elements.micVoiceMatchThreshold.value = String(Math.round(extracted.recommendedThreshold * 100));
        }
        saveVoiceMatchThreshold();
        if (elements.micVoiceGateEnabled) {
          elements.micVoiceGateEnabled.checked = true;
        }
        saveVoiceGateEnabled();
        updateVoiceProfileUi();
        setStatus('Voice profile saved. The mic can now react only to your voice.', 'online');
        renderTranscript('', null);
        return true;
      } catch (err) {
        setStatus(`Voice enrollment failed: ${err}`, 'offline');
        return false;
      } finally {
        state.enrolling = false;
        updateVoiceProfileUi();
      }
    }

    function clearVoiceProfile() {
      if (state.previewAudio) {
        try {
          state.previewAudio.pause();
          state.previewAudio.currentTime = 0;
        } catch {}
        state.previewAudio = null;
      }
      saveVoiceProfile(null);
      saveVoicePreviewSample('');
      if (elements.micVoiceGateEnabled) {
        elements.micVoiceGateEnabled.checked = false;
      }
      saveVoiceGateEnabled();
      updateVoiceProfileUi();
      setStatus('Voice profile cleared. Mic commands will react to any voice again.', 'online');
      renderTranscript('', null);
    }

    async function previewVoiceProfile() {
      if (!state.voicePreviewDataUrl) {
        setStatus('No enrolled voice sample is stored yet.', 'offline');
        return false;
      }
      try {
        if (state.previewAudio) {
          try {
            state.previewAudio.pause();
            state.previewAudio.currentTime = 0;
          } catch {}
        }
        const audio = new Audio(state.voicePreviewDataUrl);
        state.previewAudio = audio;
        audio.onended = () => {
          if (state.previewAudio === audio) {
            state.previewAudio = null;
          }
        };
        await audio.play();
        setStatus('Playing enrolled voice sample...', 'online');
        return true;
      } catch (err) {
        setStatus(`Voice preview failed: ${err}`, 'offline');
        return false;
      }
    }

    function handleSocketClose() {
      state.socket = null;
      teardownAudioPipeline();
      const wasManualStop = state.manualStop;
      state.connecting = false;
      state.listening = false;
      updateToggleButton();
      updateVoiceProfileUi();
      setSuggestions([]);

      if (wasManualStop) {
        setStatus('Mic: inactive', '');
        renderTranscript('', null);
        return;
      }

      setStatus(`Mic disconnected from ${shortBaseUrl()}. Re-enable it when the ASR service is available.`, 'offline');
    }

    async function stopListening() {
      state.manualStop = true;
      state.connecting = false;
      state.listening = false;
      state.listeningStartedAtMs = 0;

      const socket = state.socket;
      state.socket = null;
      if (socket) {
        try {
          if (socket.readyState === WebSocketCtor.OPEN) {
            socket.send('flush');
          }
        } catch {}
        try {
          socket.close(1000, 'stop');
        } catch {}
      }

      teardownAudioPipeline();
      updateToggleButton();
      updateVoiceProfileUi();
      setSuggestions([]);
      setStatus('Mic: inactive', '');
      renderTranscript('', null);
      return true;
    }

    async function startListening() {
      if (state.listening || state.connecting) return true;
      if (!WebSocketCtor) {
        setStatus('Mic streaming is not supported in this browser (WebSocket unavailable).', 'offline');
        return false;
      }

      if (isVoiceGateEnabled() && !hasVoiceProfile()) {
        setStatus('Only my voice is enabled, but no voice profile is enrolled yet.', 'offline');
        updateVoiceProfileUi();
        return false;
      }

      saveBaseUrl();
      saveVoiceGateEnabled();
      state.manualStop = false;
      state.connecting = true;
      updateToggleButton();
      updateVoiceProfileUi();
      setSuggestions([]);
      setStatus('Mic: checking local ASR service...', 'online');

      const serviceOnline = await refreshHealth();
      if (!serviceOnline) {
        state.connecting = false;
        updateToggleButton();
        return false;
      }

      try {
        await requestMicStream();
      } catch (err) {
        state.connecting = false;
        updateToggleButton();
        setStatus(`Microphone permission failed: ${err}`, 'offline');
        return false;
      }

      const socket = new WebSocketCtor(buildWsUrl());
      state.socket = socket;
      socket.binaryType = 'arraybuffer';
      setStatus(`Mic: connecting to ${shortBaseUrl()} (lang=${describeLanguage()})...`, 'online');

      socket.onopen = async () => {
        try {
          const speakerProfilePayload = buildSpeakerProfilePayload();
          if (speakerProfilePayload) {
            socket.send(JSON.stringify(speakerProfilePayload));
          }
          await setupAudioCapturePipeline();
          state.connecting = false;
          state.listening = true;
          state.listeningStartedAtMs = Date.now();
          updateToggleButton();
          updateVoiceProfileUi();
          setStatus(
            isSuggestionMode() ? 'Mic active • suggestion mode' : 'Mic active • listening',
            'listening'
          );
        } catch (err) {
          setStatus(`Mic setup failed: ${err}`, 'offline');
          await stopListening();
        }
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ready') {
          const frameMs = Number(message.frame_ms || 0);
          const modeLabel = isSuggestionMode() ? 'suggestion mode' : 'listening';
          setStatus(
            frameMs > 0
              ? `Mic active • ${modeLabel} (lang=${describeLanguage()}, vad=${frameMs}ms)`
              : `Mic active • ${modeLabel} (lang=${describeLanguage()})`,
            'listening'
          );
          return;
        }

          if (message.type === 'error') {
            const detail = String(message.detail || 'unknown error');
            setStatus(`Mic ASR error: ${detail}`, 'offline');
            return;
          }

          if (message.type === 'speaker_profile_status') {
            const enabled = message.enabled === true;
            const similarityThreshold = Number(message.speaker_threshold || 0);
            if (enabled && similarityThreshold > 0) {
              const modeLabel = isSuggestionMode() ? 'suggestion mode' : 'listening';
              setStatus(
                `Mic active • ${modeLabel} (lang=${describeLanguage()}, voice gate ${Math.round(similarityThreshold * 100)}%)`,
                'listening'
              );
            }
            if (!enabled && isVoiceGateEnabled()) {
              setStatus('Only-my-voice gate is enabled but no valid voice profile is loaded.', 'offline');
            }
            return;
          }

          if (message.type === 'speaker_ignored') {
            const similarity = Number(message.speaker_similarity || 0);
            const threshold = Number(message.speaker_threshold || MIC_VOICE_MATCH_THRESHOLD);
            setSuggestions([], { preserveExisting: true });
            setStatus(
              `Mic active • ignored non-matching voice (${Math.round(similarity * 100)}% < ${Math.round(threshold * 100)}%)`,
              'listening'
            );
            renderTranscript('', null, {
              ignoredReason: 'not-your-voice',
              voiceSimilarity: similarity,
              voiceThreshold: threshold,
              preserveTranscript: true
            });
            return;
          }

          if (message.type === 'final') {
            const text = String(message.transcript_text || '').trim();
            if (!text) return;
            const confidence = Number(message.asr_confidence || 0);
            const noSpeechProb = Number(message.asr_no_speech_prob || 0);
            const durationMs = Number(message.segment_duration_ms || 0);
            const voiceSimilarity = Number(message.speaker_similarity || 0);
            const voiceThreshold = Number(message.speaker_threshold || 0);
            const transcriptDecision = shouldIgnoreTranscript({ text, confidence, noSpeechProb, durationMs });
            if (transcriptDecision.ignore) {
              const previewResult = callbacks.previewTranscript?.({
                text,
                language: String(message.language || '').trim(),
                confidence,
                noSpeechProb,
                durationMs,
                latencyMs: Number(message.asr_latency_ms || 0)
              });
              const canBypassForExactMatch = canBypassIgnoredTranscript(
                transcriptDecision.reason,
                previewResult,
                text
              );
              if (canBypassForExactMatch) {
                markTranscriptAccepted(text);
                const triggerResult = isSuggestionMode()
                  ? (previewResult || null)
                  : callbacks.onTranscript?.({
                    text,
                    language: String(message.language || '').trim(),
                    confidence,
                    noSpeechProb,
                    durationMs,
                    latencyMs: Number(message.asr_latency_ms || 0)
                  });
                renderTranscript(text, triggerResult || previewResult || null, {
                  language: String(message.language || '').trim(),
                  confidence,
                  durationMs,
                  voiceSimilarity,
                  voiceThreshold
                });
                if (isSuggestionMode()) {
                  setSuggestions(buildSuggestions(triggerResult || previewResult || null));
                  setStatus(`Mic suggestion ready (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
                } else {
                  setSuggestions(buildSuggestions(triggerResult || previewResult || null, { active: true, dismissOnStop: true }), { preserveExisting: true });
                  setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
                }
                return;
              }
              console.debug(`[mic-trigger] Ignored transcript (${transcriptDecision.reason}):`, text);
              setSuggestions([], { preserveExisting: true });
              renderTranscript(text, null, {
                ignoredReason: transcriptDecision.reason,
                language: String(message.language || '').trim(),
                confidence,
                durationMs,
                voiceSimilarity,
                voiceThreshold,
                preserveTranscript: true
              });
              return;
            }
            markTranscriptAccepted(text, transcriptDecision.normalized);
            const previewResult = callbacks.previewTranscript?.({
              text,
              language: String(message.language || '').trim(),
              confidence,
              noSpeechProb,
              durationMs,
              latencyMs: Number(message.asr_latency_ms || 0)
            });
            const triggerResult = isSuggestionMode()
              ? (previewResult || null)
              : callbacks.onTranscript?.({
                text,
                language: String(message.language || '').trim(),
                confidence,
                noSpeechProb,
                durationMs,
                latencyMs: Number(message.asr_latency_ms || 0)
              });
            renderTranscript(text, triggerResult || previewResult || null, {
              language: String(message.language || '').trim(),
              confidence,
              durationMs,
              voiceSimilarity,
              voiceThreshold
            });
            if (isSuggestionMode()) {
              setSuggestions(buildSuggestions(triggerResult || previewResult || null), { preserveExisting: true });
              setStatus(`Mic suggestion ready (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
            } else {
              setSuggestions(buildSuggestions(triggerResult || previewResult || null, { active: true, dismissOnStop: true }), { preserveExisting: true });
              setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
            }
            return;
          }

          if (message.type === 'ignored') {
            const text = String(message.transcript_text || '').trim();
            const previewResult = callbacks.previewTranscript?.({
              text,
              language: String(message.language || '').trim(),
              confidence: Number(message.asr_confidence || 0),
              noSpeechProb: Number(message.asr_no_speech_prob || 0),
              durationMs: Number(message.segment_duration_ms || 0),
              latencyMs: Number(message.asr_latency_ms || 0)
            });
            if (canBypassIgnoredTranscript(message.ignored_reason, previewResult, text)) {
              markTranscriptAccepted(text);
              const triggerResult = isSuggestionMode()
                ? (previewResult || null)
                : callbacks.onTranscript?.({
                  text,
                  language: String(message.language || '').trim(),
                  confidence: Number(message.asr_confidence || 0),
                  noSpeechProb: Number(message.asr_no_speech_prob || 0),
                  durationMs: Number(message.segment_duration_ms || 0),
                  latencyMs: Number(message.asr_latency_ms || 0)
                });
              renderTranscript(text, triggerResult || previewResult || null, {
                language: String(message.language || '').trim(),
                confidence: Number(message.asr_confidence || 0),
                durationMs: Number(message.segment_duration_ms || 0),
                voiceSimilarity: Number(message.speaker_similarity || 0),
                voiceThreshold: Number(message.speaker_threshold || 0)
              });
              if (isSuggestionMode()) {
                setSuggestions(buildSuggestions(triggerResult || previewResult || null));
                setStatus(`Mic suggestion ready (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
              } else {
                setSuggestions(buildSuggestions(triggerResult || previewResult || null, { active: true, dismissOnStop: true }), { preserveExisting: true });
                setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
              }
              return;
            }
            setSuggestions([], { preserveExisting: true });
            renderTranscript(text, null, {
              ignoredReason: String(message.ignored_reason || 'ignored'),
              language: String(message.language || '').trim(),
              confidence: Number(message.asr_confidence || 0),
              durationMs: Number(message.segment_duration_ms || 0),
              voiceSimilarity: Number(message.speaker_similarity || 0),
              voiceThreshold: Number(message.speaker_threshold || 0),
              preserveTranscript: true
            });
          }
        } catch {
          // Ignore malformed socket payloads.
        }
      };

      socket.onerror = () => {
        if (state.manualStop) return;
        setStatus(`Mic ASR socket error at ${shortBaseUrl()}. Check the Mic ASR URL and whether npm run start:asr is running.`, 'offline');
      };

      socket.onclose = () => {
        handleSocketClose();
      };

      return true;
    }

    async function toggleListening() {
      if (state.listening || state.connecting) {
        return stopListening();
      }
      return startListening();
    }

    function bindEvents() {
      elements.micTriggerToggleBtn?.addEventListener('click', () => {
        void toggleListening();
      });

      if (elements.micAsrBaseUrlInput) {
        const handleBaseUrlChange = () => {
          saveBaseUrl();
          if (!state.listening && !state.connecting) {
            void refreshHealth();
          }
        };
        elements.micAsrBaseUrlInput.addEventListener('change', handleBaseUrlChange);
        elements.micAsrBaseUrlInput.addEventListener('blur', handleBaseUrlChange);
      }

      if (elements.micAsrLanguageSelect) {
        elements.micAsrLanguageSelect.addEventListener('change', async () => {
          saveLanguage();
          if (state.listening || state.connecting) {
            await stopListening();
            await startListening();
            return;
          }
          void refreshHealth();
        });
      }

      if (elements.micVoiceGateEnabled) {
        elements.micVoiceGateEnabled.addEventListener('change', () => {
          const enabled = saveVoiceGateEnabled();
          pushSpeakerProfileConfig();
          if (enabled && !hasVoiceProfile()) {
            setStatus('Only my voice is enabled. Enroll your voice profile before starting the mic.', 'offline');
          } else if (!state.listening && !state.connecting) {
            void refreshHealth();
          }
          updateVoiceProfileUi();
        });
      }

      if (elements.micVoiceMatchThreshold) {
        const handleThresholdChange = () => {
          const threshold = saveVoiceMatchThreshold();
          pushSpeakerProfileConfig();
          if (!state.listening && !state.connecting && isVoiceGateEnabled() && hasVoiceProfile()) {
            setStatus(
              `Only-my-voice threshold set to ${Math.round(threshold * 100)}%. Lower it if your own voice is being rejected.`,
              'online'
            );
          }
        };
        elements.micVoiceMatchThreshold.addEventListener('input', handleThresholdChange);
        elements.micVoiceMatchThreshold.addEventListener('change', handleThresholdChange);
        elements.micVoiceMatchThreshold.addEventListener('blur', handleThresholdChange);
      }

      elements.micTriggerModeBtn?.addEventListener('click', () => {
        const nextMode = isSuggestionMode() ? 'auto' : 'suggest';
        saveTriggerMode(nextMode);
        if (isSuggestionMode()) {
          setStatus('Mic is in suggestion mode. Suggested animations and sound alerts appear below.', 'online');
        } else if (state.listening) {
          setSuggestions([]);
          setStatus(`Mic active • listening (lang=${describeLanguage()})`, 'listening');
        }
      });

      elements.micVoiceEnrollBtn?.addEventListener('click', () => {
        void enrollVoiceProfile();
      });

      elements.micVoicePreviewBtn?.addEventListener('click', () => {
        void previewVoiceProfile();
      });

      elements.micVoiceClearBtn?.addEventListener('click', () => {
        clearVoiceProfile();
      });

      elements.micTranscriptDockCloseBtn?.addEventListener('click', () => {
        clearDockSurface();
      });
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      loadBaseUrl();
      loadLanguage();
      loadTriggerMode();
      loadVoiceGateEnabled();
      loadVoiceProfile();
      loadVoicePreviewSample();
      loadVoiceMatchThreshold();
      bindEvents();
      updateMicLevel(0);
      updateDockVisibility();
      renderTranscript('', null);
      state.listeningStartedAtMs = 0;
      updateToggleButton();
      updateVoiceProfileUi();
      void refreshHealth();
    }

    return {
      state,
      init,
      startListening,
      stopListening,
      toggleListening,
      enrollVoiceProfile,
      previewVoiceProfile,
      clearVoiceProfile,
      refreshHealth,
      normalizeBaseUrl,
      buildWsUrl,
      downsampleToPcm16
    };
  }

  if (typeof window !== 'undefined') {
    window.createMicTriggerController = createMicTriggerController;
  }
})();

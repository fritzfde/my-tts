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
    const statusClasses = ['online', 'offline', 'listening'];
    const MIC_STARTUP_IGNORE_MS = 2000;
    const MIC_MIN_CONFIDENCE = 0.72;
    const MIC_MIN_SHORT_PHRASE_CONFIDENCE = 0.82;
    const MIC_MIN_SINGLE_WORD_LENGTH = 4;
    const MIC_DUPLICATE_WINDOW_MS = 8000;

    const state = {
      initialized: false,
      connecting: false,
      listening: false,
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
      lastAcceptedTranscriptAtMs: 0
    };

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

      const animationMatches = Array.isArray(triggerResult?.animationMatches) ? triggerResult.animationMatches : [];
      const soundMatches = Array.isArray(triggerResult?.soundMatches) ? triggerResult.soundMatches : [];
      const allMatches = animationMatches.concat(soundMatches);
      const transcript = String(text || '').trim();
      const ignoredReason = String(meta.ignoredReason || '').trim();
      const language = String(meta.language || '').trim().toLowerCase();
      const confidence = Number(meta.confidence || 0);
      const durationMs = Number(meta.durationMs || 0);

      if (transcriptEl) {
        transcriptEl.classList?.toggle('mic-trigger-transcript-ignored', Boolean(ignoredReason));
        if (!transcript) {
          transcriptEl.classList?.add('mic-trigger-transcript-empty');
          transcriptEl.textContent = 'Transcript appears here after each spoken phrase.';
        } else {
          transcriptEl.classList?.remove('mic-trigger-transcript-empty');
          transcriptEl.innerHTML = renderHighlightedTranscript(transcript, allMatches);
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
      button.disabled = false;
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

    function buildHealthUrl() {
      return `${getBaseUrl()}/health`;
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

    async function refreshHealth() {
      if (!callFetch) return false;
      try {
        const response = await callFetch(buildHealthUrl());
        if (!response || !response.ok) {
          throw new Error(`HTTP ${response?.status || 'unreachable'}`);
        }
        const data = await response.json().catch(() => ({}));
        if (!state.listening && !state.connecting) {
          setStatus(
            `Mic ASR online at ${shortBaseUrl()} (${String(data.whisper_model || 'base')}, lang=${describeLanguage()}) • inactive`,
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

    async function requestMicStream() {
      if (!nav?.mediaDevices?.getUserMedia) {
        throw new Error('Microphone capture is not supported in this browser');
      }
      state.micStream = await nav.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
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

    function handleSocketClose() {
      state.socket = null;
      teardownAudioPipeline();
      const wasManualStop = state.manualStop;
      state.connecting = false;
      state.listening = false;
      updateToggleButton();

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

      saveBaseUrl();
      state.manualStop = false;
      state.connecting = true;
      updateToggleButton();
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
          await setupAudioCapturePipeline();
          state.connecting = false;
          state.listening = true;
          state.listeningStartedAtMs = Date.now();
          updateToggleButton();
          setStatus('Mic active • listening', 'listening');
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
          setStatus(
            frameMs > 0
              ? `Mic active • listening (lang=${describeLanguage()}, vad=${frameMs}ms)`
              : `Mic active • listening (lang=${describeLanguage()})`,
            'listening'
          );
          return;
        }

          if (message.type === 'error') {
            const detail = String(message.detail || 'unknown error');
            setStatus(`Mic ASR error: ${detail}`, 'offline');
            return;
          }

          if (message.type === 'final') {
            const text = String(message.transcript_text || '').trim();
            if (!text) return;
            const confidence = Number(message.asr_confidence || 0);
            const noSpeechProb = Number(message.asr_no_speech_prob || 0);
            const durationMs = Number(message.segment_duration_ms || 0);
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
                const triggerResult = callbacks.onTranscript?.({
                  text,
                  language: String(message.language || '').trim(),
                  confidence,
                  noSpeechProb,
                  durationMs,
                  latencyMs: Number(message.asr_latency_ms || 0)
                });
                renderTranscript(text, triggerResult || null, {
                  language: String(message.language || '').trim(),
                  confidence,
                  durationMs
                });
                setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
                return;
              }
              console.debug(`[mic-trigger] Ignored transcript (${transcriptDecision.reason}):`, text);
              renderTranscript(text, null, {
                ignoredReason: transcriptDecision.reason,
                language: String(message.language || '').trim(),
                confidence,
                durationMs
              });
              return;
            }
            state.lastTranscript = text;
            state.lastAcceptedTranscriptKey = transcriptDecision.normalized || normalizeTranscriptText(text);
            state.lastAcceptedTranscriptAtMs = Date.now();
            setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
            const triggerResult = callbacks.onTranscript?.({
              text,
              language: String(message.language || '').trim(),
              confidence,
              noSpeechProb,
              durationMs,
              latencyMs: Number(message.asr_latency_ms || 0)
            });
            renderTranscript(text, triggerResult || null, {
              language: String(message.language || '').trim(),
              confidence,
              durationMs
            });
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
              const triggerResult = callbacks.onTranscript?.({
                text,
                language: String(message.language || '').trim(),
                confidence: Number(message.asr_confidence || 0),
                noSpeechProb: Number(message.asr_no_speech_prob || 0),
                durationMs: Number(message.segment_duration_ms || 0),
                latencyMs: Number(message.asr_latency_ms || 0)
              });
              renderTranscript(text, triggerResult || null, {
                language: String(message.language || '').trim(),
                confidence: Number(message.asr_confidence || 0),
                durationMs: Number(message.segment_duration_ms || 0)
              });
              setStatus(`Mic active • heard (${describeLanguage()}): ${text.slice(0, 90)}`, 'listening');
              return;
            }
            renderTranscript(text, null, {
              ignoredReason: String(message.ignored_reason || 'ignored'),
              language: String(message.language || '').trim(),
              confidence: Number(message.asr_confidence || 0),
              durationMs: Number(message.segment_duration_ms || 0)
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
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      loadBaseUrl();
      loadLanguage();
      bindEvents();
      updateMicLevel(0);
      renderTranscript('', null);
      state.listeningStartedAtMs = 0;
      updateToggleButton();
      void refreshHealth();
    }

    return {
      state,
      init,
      startListening,
      stopListening,
      toggleListening,
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

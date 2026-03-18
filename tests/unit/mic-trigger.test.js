const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createSettingsStore(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    }
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    URL,
    Blob,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

function createClassList() {
  const values = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    toggle(token, force) {
      if (force === undefined) {
        if (values.has(token)) {
          values.delete(token);
          return false;
        }
        values.add(token);
        return true;
      }
      if (force) values.add(token);
      else values.delete(token);
      return force;
    },
    contains(token) {
      return values.has(token);
    }
  };
}

function createButton() {
  const listeners = new Map();
  return {
    textContent: '',
    disabled: false,
    classList: createClassList(),
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
}

function createInput() {
  const listeners = new Map();
  return {
    value: '',
    checked: false,
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
}

function createStatusElement() {
  return {
    textContent: '',
    classList: createClassList()
  };
}

function createHtmlElement() {
  return {
    textContent: '',
    innerHTML: '',
    classList: createClassList(),
    style: {}
  };
}

function createSuggestionContainer() {
  const playButtons = [];
  const settingsButtons = [];
  let html = '';
  const container = {
    hidden: true,
    classList: createClassList(),
    querySelectorAll(selector) {
      if (selector === '.mic-suggestion-play-btn' || selector === '.mic-suggestion-card') {
        return playButtons;
      }
      if (selector === '.mic-suggestion-settings-btn') {
        return settingsButtons;
      }
      return [];
    }
  };

  Object.defineProperty(container, 'innerHTML', {
    get() {
      return html;
    },
    set(value) {
      html = String(value || '');
      playButtons.length = 0;
      settingsButtons.length = 0;
      const pattern = /<button class="(mic-suggestion-play-btn|mic-suggestion-settings-btn)" type="button" data-kind="([^"]+)"(?: data-trigger="([^"]*)")?(?: data-filename="([^"]*)")?(?: data-sound-path="([^"]*)")?[^>]*>/g;
      let match;
      while ((match = pattern.exec(html))) {
        const attrs = {
          'data-kind': match[2] || '',
          'data-trigger': match[3] || '',
          'data-filename': match[4] || '',
          'data-sound-path': match[5] || ''
        };
        const listeners = new Map();
        const node = {
          addEventListener(type, cb) {
            listeners.set(type, cb);
          },
          getAttribute(name) {
            return attrs[name] || null;
          },
          trigger(type) {
            const handler = listeners.get(type);
            if (handler) handler();
          }
        };
        if (match[1] === 'mic-suggestion-settings-btn') {
          settingsButtons.push(node);
        } else {
          playButtons.push(node);
        }
      }
    }
  });

  return container;
}

test('mic trigger: loads ASR URL, starts listening, and forwards final transcripts', async () => {
  const { factory } = loadControllerFactory('mic-trigger.js', 'createMicTriggerController');
  const settingsStore = createSettingsStore({
    mic_asr_base_url: 'http://127.0.0.1:9001/',
    mic_asr_language: 'en',
    mic_voice_gate_enabled: 'true',
    mic_voice_profile: JSON.stringify({
      version: 2,
      sample_rate: 16000,
      frame_count: 24,
      vector: [0.12, -0.08, 0.31, 0.27]
    })
  });

  const button = createButton();
  const buttonLabel = { textContent: '' };
  const input = createInput();
  const languageSelect = createInput();
  const voiceGateCheckbox = createInput();
  const voiceEnrollBtn = createButton();
  const voiceClearBtn = createButton();
  const voiceProfileStatus = createStatusElement();
  const status = createStatusElement();
  const meterFill = { style: { width: '0%' } };
  const meterValue = { textContent: '' };
  const transcriptNode = createHtmlElement();
  const matchesNode = createHtmlElement();
  const transcriptCalls = [];
  const previewCalls = [];
  let stoppedTracks = 0;

  class WebSocketMock {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      WebSocketMock.instances.push(this);
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = WebSocketMock.CLOSED;
      if (typeof this.onclose === 'function') {
        this.onclose();
      }
    }

    triggerOpen() {
      this.readyState = WebSocketMock.OPEN;
      if (typeof this.onopen === 'function') {
        this.onopen();
      }
    }

    triggerMessage(payload) {
      if (typeof this.onmessage === 'function') {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
  }
  WebSocketMock.instances = [];

  class AudioContextMock {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
      this.audioWorklet = null;
    }

    async resume() {}

    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {}
      };
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect() {},
        disconnect() {}
      };
    }

    createScriptProcessor() {
      return {
        connect() {},
        disconnect() {},
        onaudioprocess: null
      };
    }

    async close() {}
  }

  const controller = factory({
    settingsStore,
    elements: {
      micTriggerToggleBtn: button,
      micTriggerToggleLabel: buttonLabel,
      micTriggerStatus: status,
      micAsrBaseUrlInput: input,
      micAsrLanguageSelect: languageSelect,
      micVoiceGateEnabled: voiceGateCheckbox,
      micVoiceEnrollBtn: voiceEnrollBtn,
      micVoiceClearBtn: voiceClearBtn,
      micVoiceProfileStatus: voiceProfileStatus,
      micTriggerMeterFill: meterFill,
      micTriggerMeterValue: meterValue,
      micTriggerTranscript: transcriptNode,
      micTriggerMatches: matchesNode
    },
    callbacks: {
      onTranscript: (payload) => {
        transcriptCalls.push(payload);
        if (payload.text === 'we flew very very low') {
          return {
            animationMatch: { trigger: 'trump-we-flew' },
            soundMatch: null,
            animationMatches: [{ keyword: 'very very low' }],
            soundMatches: []
          };
        }
        if (payload.text === 'he died like a dog') {
          return {
            animationMatch: { trigger: 'trump-abu-is-dead' },
            soundMatch: null,
            animationMatches: [{ keyword: 'died like' }],
            soundMatches: []
          };
        }
        return {
          animationMatch: { trigger: 'dance' },
          soundMatch: { soundPath: '/sounds/horn.wav' },
          animationMatches: [{ keyword: 'horn' }],
          soundMatches: [{ keyword: 'horn' }]
        };
      },
      previewTranscript: (payload) => {
        previewCalls.push(payload);
        if (payload.text === 'we flew very very low') {
          return {
            animationMatch: { trigger: 'trump-we-flew', score: 1, keyword: 'very very low' },
            soundMatch: null,
            animationMatches: [{ keyword: 'very very low', score: 1 }],
            soundMatches: []
          };
        }
        if (payload.text === 'he died like a dog') {
          return {
            animationMatch: { trigger: 'trump-abu-is-dead', score: 1, keyword: 'died like' },
            soundMatch: null,
            animationMatches: [{ keyword: 'died like', score: 1 }],
            soundMatches: []
          };
        }
        return {
          animationMatch: { trigger: 'dance', score: 1, keyword: 'very very low' },
          soundMatch: null,
          animationMatches: [{ keyword: 'very very low', score: 1 }],
          soundMatches: []
        };
      },
      hasExactMicKeywordMatch: ({ text }) => {
        return text === 'we flew very very low' || text === 'he died like a dog';
      }
    },
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ whisper_model: 'base' })
    }),
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks() {
              return [{
                stop() {
                  stoppedTracks += 1;
                }
              }];
            }
          };
        }
      }
    },
    WebSocketRef: WebSocketMock,
    AudioContextRef: AudioContextMock
  });

  controller.init();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(input.value, 'http://127.0.0.1:9001');
  assert.equal(languageSelect.value, 'en');
  assert.equal(voiceGateCheckbox.checked, true);
  assert.match(voiceProfileStatus.textContent, /Voice profile ready/i);
  assert.match(status.textContent, /Mic ASR online/);
  assert.equal(buttonLabel.textContent, 'Start Mic Listening');
  assert.equal(transcriptNode.textContent, 'Transcript appears here after each spoken phrase.');
  assert.equal(meterValue.textContent, '0%');

  await controller.startListening();
  assert.equal(WebSocketMock.instances.length, 1);
  assert.equal(WebSocketMock.instances[0].url, 'ws://127.0.0.1:9001/ws/mic-trigger?language=en');

  WebSocketMock.instances[0].triggerOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    JSON.stringify(JSON.parse(WebSocketMock.instances[0].sent[0])),
    JSON.stringify({
      type: 'speaker_profile',
      enabled: true,
      threshold: 0.74,
      profile: {
        version: 2,
        sampleRate: 16000,
        frameCount: 24,
        vector: [0.12, -0.08, 0.31, 0.27]
      }
    })
  );
  controller.state.listeningStartedAtMs = Date.now() - 2000;
  assert.equal(buttonLabel.textContent, 'Stop Mic Listening');

  WebSocketMock.instances[0].triggerMessage({
    type: 'final',
    transcript_text: 'play horn now',
    language: 'en',
    asr_confidence: 0.91,
    asr_latency_ms: 222
  });

  assert.equal(
    JSON.stringify(transcriptCalls),
    JSON.stringify([{
      text: 'play horn now',
      language: 'en',
      confidence: 0.91,
      noSpeechProb: 0,
      durationMs: 0,
      latencyMs: 222
    }])
  );
  assert.match(status.textContent, /heard \(EN\): play horn now/);
  assert.match(transcriptNode.innerHTML, /mic-trigger-keyword/);
  assert.match(transcriptNode.innerHTML, /play /);
  assert.match(transcriptNode.innerHTML, /horn/);
  assert.match(transcriptNode.innerHTML, / now/);
  assert.match(matchesNode.innerHTML, /Animation: dance/);
  assert.match(matchesNode.innerHTML, /Sound: horn\.wav/);

  WebSocketMock.instances[0].triggerMessage({
    type: 'ignored',
    transcript_text: 'Thank you.',
    language: 'en',
    ignored_reason: 'high-no-speech-prob',
    asr_confidence: 0.41,
    segment_duration_ms: 510
  });

  assert.equal(transcriptCalls.length, 1);
  assert.match(transcriptNode.innerHTML, /horn/);
  assert.equal(transcriptNode.classList.contains('mic-trigger-transcript-ignored'), false);
  assert.match(matchesNode.innerHTML, /Ignored: High No Speech Prob/);
  assert.match(matchesNode.innerHTML, /Language: EN/);

  WebSocketMock.instances[0].triggerMessage({
    type: 'final',
    transcript_text: 'we flew very very low',
    language: 'en',
    asr_confidence: 0.5,
    asr_no_speech_prob: 0.02,
    segment_duration_ms: 3570,
    asr_latency_ms: 333
  });

  assert.equal(transcriptCalls.length, 2);
  assert.equal(previewCalls.length, 3);
  assert.equal(transcriptCalls[1].text, 'we flew very very low');
  assert.match(matchesNode.innerHTML, /Keyword: very very low/);

  WebSocketMock.instances[0].triggerMessage({
    type: 'ignored',
    transcript_text: 'he died like a dog',
    language: 'en',
    ignored_reason: 'low-confidence',
    asr_confidence: 0.65,
    segment_duration_ms: 2310,
    asr_latency_ms: 280
  });

  assert.equal(previewCalls.length, 4);
  assert.equal(transcriptCalls.length, 3);
  assert.equal(transcriptCalls[2].text, 'he died like a dog');

  await controller.stopListening();
  assert.equal(buttonLabel.textContent, 'Start Mic Listening');
  assert.equal(stoppedTracks, 1);
  assert.equal(meterFill.style.width, '0%');
});

test('mic trigger: ignored transcripts do not trigger when no exact bypass exists', async () => {
  const { factory } = loadControllerFactory('mic-trigger.js', 'createMicTriggerController');
  const settingsStore = createSettingsStore({
    mic_asr_base_url: 'http://127.0.0.1:9001/',
    mic_asr_language: 'en'
  });

  const button = createButton();
  const buttonLabel = { textContent: '' };
  const input = createInput();
  const languageSelect = createInput();
  const status = createStatusElement();
  const meterFill = { style: { width: '0%' } };
  const meterValue = { textContent: '' };
  const transcriptNode = createHtmlElement();
  const matchesNode = createHtmlElement();
  const transcriptCalls = [];
  const previewCalls = [];

  class WebSocketMock {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      WebSocketMock.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = WebSocketMock.CLOSED;
      if (typeof this.onclose === 'function') {
        this.onclose();
      }
    }

    triggerOpen() {
      this.readyState = WebSocketMock.OPEN;
      if (typeof this.onopen === 'function') {
        this.onopen();
      }
    }

    triggerMessage(payload) {
      if (typeof this.onmessage === 'function') {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
  }
  WebSocketMock.instances = [];

  class AudioContextMock {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
      this.audioWorklet = null;
    }

    async resume() {}

    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {}
      };
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect() {},
        disconnect() {}
      };
    }

    createScriptProcessor() {
      return {
        connect() {},
        disconnect() {},
        onaudioprocess: null
      };
    }

    async close() {}
  }

  const controller = factory({
    settingsStore,
    elements: {
      micTriggerToggleBtn: button,
      micTriggerToggleLabel: buttonLabel,
      micTriggerStatus: status,
      micAsrBaseUrlInput: input,
      micAsrLanguageSelect: languageSelect,
      micTriggerMeterFill: meterFill,
      micTriggerMeterValue: meterValue,
      micTriggerTranscript: transcriptNode,
      micTriggerMatches: matchesNode
    },
    callbacks: {
      onTranscript: (payload) => {
        transcriptCalls.push(payload);
        return {
          animationMatch: { trigger: 'should-not-run' },
          soundMatch: null,
          animationMatches: [],
          soundMatches: []
        };
      },
      previewTranscript: (payload) => {
        previewCalls.push(payload);
        return {
          animationMatch: null,
          soundMatch: null,
          animationMatches: [],
          soundMatches: []
        };
      },
      hasExactMicKeywordMatch: () => false
    },
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ whisper_model: 'base' })
    }),
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks() {
              return [{ stop() {} }];
            }
          };
        }
      }
    },
    WebSocketRef: WebSocketMock,
    AudioContextRef: AudioContextMock
  });

  controller.init();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.startListening();
  WebSocketMock.instances[0].triggerOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.state.listeningStartedAtMs = Date.now() - 4000;

  WebSocketMock.instances[0].triggerMessage({
    type: 'ignored',
    transcript_text: 'we flew very very low',
    language: 'en',
    ignored_reason: 'low-confidence',
    asr_confidence: 0.51,
    segment_duration_ms: 2100,
    asr_latency_ms: 240
  });

  assert.equal(transcriptCalls.length, 0);
  assert.equal(previewCalls.length, 1);
  assert.equal(transcriptNode.classList.contains('mic-trigger-transcript-ignored'), false);
  assert.equal(transcriptNode.textContent, 'Transcript appears here after each spoken phrase.');
  assert.match(matchesNode.innerHTML, /Ignored: Low Confidence/);
  assert.doesNotMatch(matchesNode.innerHTML, /Animation:/);
});

test('mic trigger: only-my-voice gate blocks start without enrolled profile and ignores speaker mismatches', async () => {
  const { factory } = loadControllerFactory('mic-trigger.js', 'createMicTriggerController');
  const settingsStore = createSettingsStore({
    mic_asr_base_url: 'http://127.0.0.1:9001/',
    mic_asr_language: 'en',
    mic_voice_gate_enabled: 'true'
  });

  const button = createButton();
  const buttonLabel = { textContent: '' };
  const input = createInput();
  const languageSelect = createInput();
  const voiceGateCheckbox = createInput();
  const voiceEnrollBtn = createButton();
  const voiceClearBtn = createButton();
  const voiceProfileStatus = createStatusElement();
  const status = createStatusElement();
  const meterFill = { style: { width: '0%' } };
  const meterValue = { textContent: '' };
  const transcriptNode = createHtmlElement();
  const matchesNode = createHtmlElement();
  const transcriptCalls = [];

  class WebSocketMock {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      WebSocketMock.instances.push(this);
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = WebSocketMock.CLOSED;
      if (typeof this.onclose === 'function') {
        this.onclose();
      }
    }

    triggerOpen() {
      this.readyState = WebSocketMock.OPEN;
      if (typeof this.onopen === 'function') {
        this.onopen();
      }
    }

    triggerMessage(payload) {
      if (typeof this.onmessage === 'function') {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
  }
  WebSocketMock.instances = [];

  class AudioContextMock {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
      this.audioWorklet = null;
    }

    async resume() {}

    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {}
      };
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect() {},
        disconnect() {}
      };
    }

    createScriptProcessor() {
      return {
        connect() {},
        disconnect() {},
        onaudioprocess: null
      };
    }

    async close() {}
  }

  const controller = factory({
    settingsStore,
    elements: {
      micTriggerToggleBtn: button,
      micTriggerToggleLabel: buttonLabel,
      micTriggerStatus: status,
      micAsrBaseUrlInput: input,
      micAsrLanguageSelect: languageSelect,
      micVoiceGateEnabled: voiceGateCheckbox,
      micVoiceEnrollBtn: voiceEnrollBtn,
      micVoiceClearBtn: voiceClearBtn,
      micVoiceProfileStatus: voiceProfileStatus,
      micTriggerMeterFill: meterFill,
      micTriggerMeterValue: meterValue,
      micTriggerTranscript: transcriptNode,
      micTriggerMatches: matchesNode
    },
    callbacks: {
      onTranscript: (payload) => {
        transcriptCalls.push(payload);
        return null;
      },
      previewTranscript: () => null,
      hasExactMicKeywordMatch: () => false
    },
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ whisper_model: 'base' })
    }),
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks() {
              return [{ stop() {} }];
            }
          };
        }
      }
    },
    WebSocketRef: WebSocketMock,
    AudioContextRef: AudioContextMock
  });

  controller.init();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const startedWithoutProfile = await controller.startListening();
  assert.equal(startedWithoutProfile, false);
  assert.equal(WebSocketMock.instances.length, 0);
  assert.match(status.textContent, /no voice profile is enrolled/i);

  settingsStore.setItem('mic_voice_profile', JSON.stringify({
    version: 2,
    sample_rate: 16000,
    frame_count: 20,
    vector: [0.22, -0.04, 0.15, 0.19]
  }));
  controller.state.voiceProfile = {
    version: 2,
    sampleRate: 16000,
    frameCount: 20,
    vector: [0.22, -0.04, 0.15, 0.19]
  };

  const started = await controller.startListening();
  assert.equal(started, true);
  WebSocketMock.instances[0].triggerOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));

  WebSocketMock.instances[0].triggerMessage({
    type: 'speaker_ignored',
    speaker_similarity: 0.41,
    speaker_threshold: 0.74
  });

  assert.equal(transcriptCalls.length, 0);
  assert.equal(transcriptNode.textContent, 'Transcript appears here after each spoken phrase.');
  assert.match(matchesNode.innerHTML, /Ignored: Not Your Voice/);
  assert.match(matchesNode.innerHTML, /Voice mismatch: 41% \/ 74%/);
});

test('mic trigger: suggestion mode previews matches without auto-triggering', async () => {
  const { factory } = loadControllerFactory('mic-trigger.js', 'createMicTriggerController');
  const settingsStore = createSettingsStore({
    mic_asr_base_url: 'http://127.0.0.1:9001/',
    mic_asr_language: 'en',
    mic_trigger_mode: 'suggest'
  });

  const button = createButton();
  const buttonLabel = { textContent: '' };
  const input = createInput();
  const languageSelect = createInput();
  const status = createStatusElement();
  const transcriptDock = {
    hidden: true,
    classList: createClassList()
  };
  const modeButton = createButton();
  const meterFill = { style: { width: '0%' } };
  const meterValue = { textContent: '' };
  const transcriptNode = createHtmlElement();
  const matchesNode = createHtmlElement();
  const suggestionsNode = createSuggestionContainer();
  const transcriptCalls = [];
  const previewCalls = [];
  const suggestedAnimations = [];
  const openedAnimationSettings = [];

  class WebSocketMock {
    static OPEN = 1;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      WebSocketMock.instances.push(this);
    }

    send() {}

    close() {
      this.readyState = WebSocketMock.CLOSED;
      if (typeof this.onclose === 'function') {
        this.onclose();
      }
    }

    triggerOpen() {
      this.readyState = WebSocketMock.OPEN;
      if (typeof this.onopen === 'function') {
        this.onopen();
      }
    }

    triggerMessage(payload) {
      if (typeof this.onmessage === 'function') {
        this.onmessage({ data: JSON.stringify(payload) });
      }
    }
  }
  WebSocketMock.instances = [];

  class AudioContextMock {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
      this.audioWorklet = null;
    }

    async resume() {}

    createMediaStreamSource() {
      return {
        connect() {},
        disconnect() {}
      };
    }

    createGain() {
      return {
        gain: { value: 1 },
        connect() {},
        disconnect() {}
      };
    }

    createScriptProcessor() {
      return {
        connect() {},
        disconnect() {},
        onaudioprocess: null
      };
    }

    async close() {}
  }

  const controller = factory({
    settingsStore,
    elements: {
      micTriggerToggleBtn: button,
      micTriggerToggleLabel: buttonLabel,
      micTriggerStatus: status,
      micAsrBaseUrlInput: input,
      micAsrLanguageSelect: languageSelect,
      micTranscriptDock: transcriptDock,
      micTriggerModeBtn: modeButton,
      micTriggerMeterFill: meterFill,
      micTriggerMeterValue: meterValue,
      micTriggerTranscript: transcriptNode,
      micTriggerMatches: matchesNode,
      micTriggerSuggestions: suggestionsNode
    },
    callbacks: {
      onTranscript: (payload) => {
        transcriptCalls.push(payload);
        return {
          animationMatch: { trigger: 'alpha', keyword: 'very very low' },
          soundMatch: null,
          animationMatches: [{ keyword: 'very very low' }],
          soundMatches: []
        };
      },
      previewTranscript: (payload) => {
        previewCalls.push(payload);
        return {
          animationMatch: { trigger: 'alpha', score: 1, keyword: 'very very low' },
          soundMatch: null,
          animationMatches: [{ keyword: 'very very low', score: 1 }],
          soundMatches: []
        };
      },
      hasExactMicKeywordMatch: () => true,
      getAnimationSuggestion: ({ trigger }) => ({
        trigger,
        label: 'Alpha animation',
        fileUrl: '/animations/alpha.mov',
        filename: 'alpha.mov'
      }),
      triggerSuggestedAnimation: ({ trigger }) => {
        suggestedAnimations.push(trigger);
        return true;
      },
      openSuggestedAnimationSettings: ({ trigger, filename }) => {
        openedAnimationSettings.push({ trigger, filename });
        return true;
      }
    },
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ whisper_model: 'base' })
    }),
    navigatorRef: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks() {
              return [{ stop() {} }];
            }
          };
        }
      }
    },
    WebSocketRef: WebSocketMock,
    AudioContextRef: AudioContextMock
  });

  controller.init();
  await controller.startListening();
  WebSocketMock.instances[0].triggerOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.state.listeningStartedAtMs = Date.now() - 3000;

  assert.equal(modeButton.textContent, 'Suggestion mode');
  assert.equal(transcriptDock.hidden, false);

  WebSocketMock.instances[0].triggerMessage({
    type: 'final',
    transcript_text: 'we flew very very low',
    language: 'en',
    asr_confidence: 0.91,
    segment_duration_ms: 2200,
    asr_latency_ms: 180
  });

  assert.equal(previewCalls.length, 1);
  assert.equal(transcriptCalls.length, 0);
  assert.match(status.textContent, /Mic suggestion ready/);
  assert.match(transcriptNode.innerHTML, /very very low/);
  assert.equal(suggestionsNode.hidden, false);
  assert.match(suggestionsNode.innerHTML, /Alpha animation/);

  const suggestionButtons = suggestionsNode.querySelectorAll('.mic-suggestion-play-btn');
  const settingsButtons = suggestionsNode.querySelectorAll('.mic-suggestion-settings-btn');
  assert.equal(suggestionButtons.length, 1);
  assert.equal(settingsButtons.length, 1);
  settingsButtons[0].trigger('click');
  assert.deepEqual(openedAnimationSettings, [{ trigger: 'alpha', filename: 'alpha.mov' }]);
  suggestionButtons[0].trigger('click');

  assert.deepEqual(suggestedAnimations, ['alpha']);
  assert.equal(suggestionsNode.hidden, false);
});

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
    clearTimeout
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

test('mic trigger: loads ASR URL, starts listening, and forwards final transcripts', async () => {
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
  assert.match(status.textContent, /Mic ASR online/);
  assert.equal(buttonLabel.textContent, 'Start Mic Listening');
  assert.equal(transcriptNode.textContent, 'Transcript appears here after each spoken phrase.');
  assert.equal(meterValue.textContent, '0%');

  await controller.startListening();
  assert.equal(WebSocketMock.instances.length, 1);
  assert.equal(WebSocketMock.instances[0].url, 'ws://127.0.0.1:9001/ws/mic-trigger?language=en');

  WebSocketMock.instances[0].triggerOpen();
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  assert.match(transcriptNode.innerHTML, /Thank you\./);
  assert.equal(transcriptNode.classList.contains('mic-trigger-transcript-ignored'), true);
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
  assert.equal(previewCalls.length, 2);
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

  assert.equal(previewCalls.length, 3);
  assert.equal(transcriptCalls.length, 3);
  assert.equal(transcriptCalls[2].text, 'he died like a dog');

  await controller.stopListening();
  assert.equal(buttonLabel.textContent, 'Start Mic Listening');
  assert.equal(stoppedTracks, 1);
  assert.equal(meterFill.style.width, '0%');
});

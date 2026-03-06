const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {}
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

function createButton() {
  const listeners = new Map();
  return {
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
}

test('voice test controls: youtube system voice test speaks utterance', async () => {
  const { factory } = loadControllerFactory('voice-test-controls.js', 'createVoiceTestControlsController');

  const testVoiceYouTubeBtn = createButton();
  const testVoiceTikTokBtn = createButton();
  const spoken = [];
  const chatEvents = [];

  class UtteranceMock {
    constructor(text) {
      this.text = text;
      this.voice = null;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
    }
  }

  const synthRef = {
    speak(utterance) {
      spoken.push(utterance);
    }
  };

  const controller = factory({
    synthRef,
    elements: {
      testVoiceYouTubeBtn,
      testVoiceTikTokBtn,
      testMessageInput: { value: 'hello voice' },
      rateSelect: { value: '1.25' },
      pitchSelect: { value: '0.9' },
      volumeSlider: { value: '80' }
    },
    callbacks: {
      SpeechSynthesisUtteranceCtor: UtteranceMock,
      getSelectedVoiceId: (platform) => (platform === 'youtube' ? 'system-0' : ''),
      resolveSystemVoice: () => ({ name: 'Mock Voice' }),
      speakWithCustomVoice: async () => null,
      unlockAudio: () => {},
      addChatMessage: (...args) => chatEvents.push(args),
      getVoiceName: () => 'Mock Voice'
    },
    defaultTestMessage: 'fallback'
  });

  controller.attachHandlers();
  testVoiceYouTubeBtn.trigger('click');

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'hello voice');
  assert.equal(spoken[0].voice.name, 'Mock Voice');
  assert.equal(spoken[0].rate, 1.25);
  assert.equal(spoken[0].pitch, 0.9);
  assert.equal(spoken[0].volume, 0.8);
  assert.equal(chatEvents.length, 1);
  assert.match(chatEvents[0][1], /Testing YouTube voice/);
});

test('voice test controls: tiktok cloned voice uses custom audio path', async () => {
  const { factory } = loadControllerFactory('voice-test-controls.js', 'createVoiceTestControlsController');
  const testVoiceYouTubeBtn = createButton();
  const testVoiceTikTokBtn = createButton();

  let customVoiceCalls = 0;
  let audioPlayCalls = 0;
  const chatEvents = [];

  const controller = factory({
    synthRef: { speak: () => {} },
    elements: {
      testVoiceYouTubeBtn,
      testVoiceTikTokBtn,
      testMessageInput: { value: 'test text' },
      rateSelect: { value: '1' },
      pitchSelect: { value: '1' },
      volumeSlider: { value: '100' }
    },
    callbacks: {
      getSelectedVoiceId: (platform) => (platform === 'tiktok' ? 'cloned-voice' : ''),
      resolveSystemVoice: () => null,
      speakWithCustomVoice: async () => {
        customVoiceCalls += 1;
        return {
          isCloned: true,
          audio: {
            play: async () => {
              audioPlayCalls += 1;
            }
          }
        };
      },
      unlockAudio: () => {},
      addChatMessage: (...args) => chatEvents.push(args),
      getVoiceName: () => 'Cloned Voice'
    },
    defaultTestMessage: 'fallback'
  });

  controller.attachHandlers();
  testVoiceTikTokBtn.trigger('click');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(customVoiceCalls, 1);
  assert.equal(audioPlayCalls, 1);
  assert.equal(chatEvents.length, 1);
  assert.match(chatEvents[0][1], /Testing TikTok voice/);
});


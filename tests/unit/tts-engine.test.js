const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.voice = null;
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.onend = null;
    this.onerror = null;
  }
}

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this.playbackRate = 1;
    this.onended = null;
    this.onerror = null;
  }

  async play() {
    if (typeof this.onended === 'function') {
      this.onended();
    }
  }
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout,
    SpeechSynthesisUtterance: FakeUtterance,
    Audio: FakeAudio,
    URL: { createObjectURL: () => 'blob://fake-audio' }
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('tts engine: filterMessage strips emojis and links when disabled', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');

  const controller = factory({
    synth: { speak() {} },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: false, readEmojis: false, readLinks: false }),
    getPlatformDefaultVoice: () => '',
    getUserVoice: () => '',
    resolveSystemVoice: () => null,
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: () => {}
  });

  const filtered = controller.filterMessage('Hey 😂 visit https://example.com now');
  assert.equal(filtered, 'Hey visit now');
});

test('tts engine: cloned voice request includes selected language', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  let requestPayload = null;

  const controller = factory({
    synth: { speak() {} },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: false, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => '',
    getUserVoice: () => '',
    resolveSystemVoice: () => null,
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: () => {},
    getCloneVoiceLanguage: (voiceName) => (voiceName === 'berta' ? 'de' : 'en'),
    fetchFn: async (_url, options) => {
      requestPayload = JSON.parse(options.body);
      return {
        ok: true,
        blob: async () => ({})
      };
    }
  });

  const result = await controller.speakWithCustomVoice('cloned-berta', 'Hallo Welt');
  assert.equal(result.isCloned, true);
  assert.equal(requestPayload.voice_name, 'berta');
  assert.equal(requestPayload.language, 'de');
  assert.equal(requestPayload.text, 'Hallo Welt');
});

test('tts engine: speakText applies defaults and username prefix for default voice', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];
  const chatMessages = [];

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: () => '',
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1.25, pitch: 1.1, volume: 0.8 }),
    addChatMessage: (...args) => chatMessages.push(args)
  });

  controller.speakText('alex', 'hello world', 'youtube', true);

  assert.equal(chatMessages.length, 1);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'alex says: hello world');
  assert.equal(spoken[0].voice.id, 'system-1');
  assert.equal(spoken[0].rate, 1.25);
  assert.equal(spoken[0].pitch, 1.1);
  assert.equal(spoken[0].volume, 0.8);

  assert.equal(controller.state.isSpeaking, true);
  spoken[0].onend();
  assert.equal(controller.state.isSpeaking, false);
});

test('tts engine: queue order and no username prefix for custom user voice', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: (author) => (author === 'bob' ? 'system-2' : ''),
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: () => {}
  });

  controller.speakText('bob', 'first message', 'youtube', false);
  controller.speakText('sam', 'second message', 'youtube', false);

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'first message');
  assert.equal(controller.state.messageQueue.length, 1);

  spoken[0].onend();

  assert.equal(spoken.length, 2);
  assert.equal(spoken[1].text, 'sam says: second message');
  assert.equal(controller.state.messageQueue.length, 0);

  spoken[1].onend();
  assert.equal(controller.state.isSpeaking, false);
});

test('tts engine: muted user voice skips enqueue and speech', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];
  const chatMessages = [];

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: () => 'mute-user',
    isMutedVoiceId: (voiceId) => voiceId === 'mute-user',
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: (...args) => chatMessages.push(args)
  });

  controller.speakText('bot_user', 'spam message', 'youtube', true);

  assert.equal(chatMessages.length, 1);
  assert.equal(spoken.length, 0);
  assert.equal(controller.state.messageQueue.length, 0);
  assert.equal(controller.state.isSpeaking, false);
});

test('tts engine: platform suppression blocks speech unless bypassed', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];
  const chatMessages = [];

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: () => '',
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: (...args) => chatMessages.push(args)
  });

  controller.setPlatformSpeechSuppressed('youtube', true);
  controller.speakText('alex', 'hello world', 'youtube', true);

  assert.equal(chatMessages.length, 1);
  assert.equal(spoken.length, 0);
  assert.equal(controller.state.messageQueue.length, 0);

  controller.speakText('alex', 'hello again', 'youtube', false, { bypassSuppression: true });

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'alex says: hello again');
  controller.stopAllSpeech();
});

test('tts engine: low-latency mode trims stale queue entries and keeps newest messages', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];
  let nowMs = 10000;

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: () => '',
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: () => {},
    nowFn: () => nowMs
  });

  controller.enqueueMessage({ author: 'old', text: 'stale message', platform: 'youtube', queuedAtMs: 1000 });
  for (let index = 1; index <= 6; index += 1) {
    controller.enqueueMessage({
      author: `user${index}`,
      text: `message ${index}`,
      platform: 'youtube',
      queuedAtMs: 9000 + index
    });
  }

  assert.equal(controller.state.messageQueue.length, 5);
  controller.processQueue();

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'message 2');
  assert.equal(controller.state.messageQueue.length, 4);
  controller.stopAllSpeech();
});

test('tts engine: low-latency mode skips usernames and boosts rate under backlog', async () => {
  const { factory } = loadControllerFactory('tts-engine.js', 'createTtsEngineController');
  const spoken = [];

  const controller = factory({
    synth: {
      speak(utterance) {
        spoken.push(utterance);
      }
    },
    ensureAudioContext: () => {},
    unlockAudio: () => {},
    getReadOptions: () => ({ readUsernames: true, readEmojis: true, readLinks: true }),
    getPlatformDefaultVoice: () => 'system-1',
    getUserVoice: () => '',
    resolveSystemVoice: (voiceId) => ({ id: voiceId }),
    getSpeechSettings: () => ({ rate: 1, pitch: 1, volume: 1 }),
    addChatMessage: () => {}
  });

  controller.enqueueMessage({ author: 'alex', text: 'first message in line', platform: 'youtube' });
  controller.enqueueMessage({ author: 'bob', text: 'second message in line', platform: 'youtube' });
  controller.enqueueMessage({ author: 'sam', text: 'third message in line', platform: 'youtube' });
  controller.processQueue();

  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'first message in line');
  assert.ok(spoken[0].rate > 1);
  controller.stopAllSpeech();
});

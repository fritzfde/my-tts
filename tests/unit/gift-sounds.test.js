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

function createSelect(inner = '') {
  const listeners = new Map();
  let markup = inner;
  const select = {
    options: [],
    value: '',
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    },
    appendChild(option) {
      this.options.push(option);
      if (option.selected) {
        this.value = option.value;
      }
    },
    set innerHTML(value) {
      markup = value;
      this.options = [];
      this.value = '';
    },
    get innerHTML() {
      return markup;
    }
  };
  return select;
}

function createDocumentStub() {
  return {
    createElement() {
      return {
        value: '',
        textContent: '',
        selected: false
      };
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    }
  };
}

function loadControllerFactory(fileName, factoryName, extraContext = {}) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout,
    ...extraContext
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

test('gift sounds: loadCustomSounds updates selectors and preference', async () => {
  const { factory } = loadControllerFactory('gift-sounds.js', 'createGiftSoundsController');
  const settingsStore = createSettingsStore();
  const giftSoundSelect = createSelect('');
  const customSoundManageSelect = createSelect('');
  const targetSelect = createSelect('');

  let renderGiftMappingsCount = 0;
  const controller = factory({
    settingsStore,
    documentRef: createDocumentStub(),
    elements: {
      giftSoundSelect,
      customSoundManageSelect,
      volumeSlider: { value: '100' }
    },
    callbacks: {
      renderGiftMappings: () => {
        renderGiftMappingsCount += 1;
      }
    },
    fetchFn: async () => ({
      json: async () => ({
        custom: [{ name: 'alpha.wav', path: '/sounds/alpha.wav' }]
      })
    })
  });

  await controller.loadCustomSounds('custom-/sounds/alpha.wav');
  assert.equal(controller.state.customGiftSounds.length, 1);
  assert.equal(giftSoundSelect.options.length, 1);
  assert.equal(giftSoundSelect.value, 'custom-/sounds/alpha.wav');
  assert.equal(settingsStore.getItem('gift_sound_preference'), 'custom-/sounds/alpha.wav');
  assert.equal(customSoundManageSelect.options.length, 1);
  assert.equal(renderGiftMappingsCount, 1);

  controller.populateGiftSoundOptions(targetSelect, 'custom-/sounds/alpha.wav');
  assert.equal(targetSelect.options.length, 1);
  assert.equal(targetSelect.options[0].selected, true);
});

test('gift sounds: playSpecificSound handles default and explicit custom sound', async () => {
  const { factory } = loadControllerFactory('gift-sounds.js', 'createGiftSoundsController');
  const settingsStore = createSettingsStore();
  const giftSoundSelect = createSelect('');
  giftSoundSelect.value = 'custom-/sounds/default.wav';

  const played = [];
  class AudioMock {
    constructor(src) {
      this.src = src;
      this.volume = 0;
      played.push(this);
    }
    play() {
      return Promise.resolve();
    }
  }

  const controller = factory({
    windowRef: { Audio: AudioMock },
    documentRef: createDocumentStub(),
    settingsStore,
    elements: {
      giftSoundSelect,
      volumeSlider: { value: '55' }
    },
    callbacks: {
      ensureAudioContext: () => null
    }
  });

  controller.playSpecificSound('');
  controller.playSpecificSound('custom-/sounds/custom/manual.wav');

  assert.equal(played.length, 2);
  assert.equal(played[0].src, '/sounds/default.wav');
  assert.equal(played[1].src, '/sounds/manual.wav');
  assert.equal(played[0].volume, 0.55);
  assert.equal(played[1].volume, 0.55);
});

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
    AbortController,
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

function createSelect(initial = '') {
  const listeners = new Map();
  return {
    value: initial,
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
  const classes = new Set();
  return {
    textContent: '',
    classList: {
      add: (...tokens) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
      has: (token) => classes.has(token)
    }
  };
}

test('ollama gender: status, cache, and auto-detect preference persistence', async () => {
  const { factory } = loadControllerFactory('ollama-gender.js', 'createOllamaGenderController');
  const settingsStore = createSettingsStore({
    auto_gender_detection: 'true',
    default_male_voice: 'system-male',
    default_female_voice: 'system-female'
  });

  let loadGenderCacheCount = 0;
  let saveGenderCacheCount = 0;
  let llmCalls = 0;
  let setOnlineValue = null;

  const voicesController = {
    state: {
      genderCache: {}
    },
    loadGenderCache() {
      loadGenderCacheCount += 1;
    },
    saveGenderCache() {
      saveGenderCacheCount += 1;
    },
    setOllamaOnline(online) {
      setOnlineValue = online;
    },
    async detectGenderWithLLM() {
      llmCalls += 1;
      return 'female';
    },
    async autoAssignVoiceIfNeeded() {
      return { assigned: false };
    }
  };

  const statusEl = createStatusElement();
  const autoCheckbox = {
    checked: false,
    listeners: new Map(),
    addEventListener(type, cb) {
      this.listeners.set(type, cb);
    },
    trigger(type) {
      const handler = this.listeners.get(type);
      if (handler) handler();
    }
  };
  const maleVoiceSelect = createSelect();
  const femaleVoiceSelect = createSelect();

  const intervals = [];
  const controller = factory({
    settingsStore,
    voicesController,
    elements: {
      ollamaStatusEl: statusEl,
      autoGenderDetectionCheckbox: autoCheckbox,
      maleVoiceSelect,
      femaleVoiceSelect
    },
    callbacks: {
      populateVoiceSelectElement: (select, preferred) => {
        select.value = preferred || '';
        return select.value;
      },
      getAllVoiceEntries: () => [],
      getVoiceName: (voiceId) => voiceId
    },
    fetchFn: async () => ({ ok: true }),
    setIntervalFn: (cb, ms) => {
      intervals.push({ cb, ms });
      return 77;
    },
    clearIntervalFn: () => {}
  });

  controller.init();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(loadGenderCacheCount, 1);
  assert.equal(autoCheckbox.checked, true);
  assert.equal(maleVoiceSelect.value, 'system-male');
  assert.equal(femaleVoiceSelect.value, 'system-female');
  assert.equal(intervals.length, 1);
  assert.equal(setOnlineValue, true);
  assert.equal(statusEl.classList.has('online'), true);

  autoCheckbox.checked = false;
  autoCheckbox.trigger('change');
  assert.equal(settingsStore.getItem('auto_gender_detection'), 'false');

  const first = await controller.detectGender('Alice');
  const second = await controller.detectGender('Alice');
  assert.equal(first, 'female');
  assert.equal(second, 'female');
  assert.equal(llmCalls, 1);
  assert.equal(saveGenderCacheCount, 1);
});

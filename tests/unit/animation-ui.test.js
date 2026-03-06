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
    _dump() {
      return Object.fromEntries(store.entries());
    }
  };
}

function createSelect(options, value = '') {
  const listeners = new Map();
  return {
    value,
    options: options.map((opt) => ({ value: opt })),
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    trigger(event) {
      const handler = listeners.get(event);
      if (handler) handler();
    }
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout,
    FormData: class FormDataStub {
      append() {}
    }
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('animation ui: sorts by value and filters mapped/unmapped', async () => {
  const { factory } = loadControllerFactory('animation-ui.js', 'createAnimationUiController');
  const animationSortSelect = createSelect(['name', 'newest', 'oldest', 'gift', 'value'], 'value');
  const animationMapFilterSelect = createSelect(['all', 'mapped', 'unmapped'], 'all');
  const animationStickerFilterSelect = createSelect(['all', 'with-sticker', 'without-sticker'], 'all');

  const state = {
    availableAnimations: [
      { name: 'A', filename: 'a.mov', mtimeMs: 100 },
      { name: 'B', filename: 'b.mov', mtimeMs: 300 },
      { name: 'C', filename: 'c.mov', mtimeMs: 200 },
      { name: 'D', filename: 'd.mov', mtimeMs: 300 },
      { name: 'E', filename: 'e.mov', mtimeMs: 50 },
      { name: 'F', filename: 'f.mov', mtimeMs: 250 }
    ],
    animationMappings: {
      alpha: { file: 'a.mov' },
      beta: { file: 'b.mov' },
      gamma: { file: 'c.mov' },
      epsilon: { file: 'e.mov' },
      zeta: { file: 'f.mov' }
    },
    activeAnimationCardPlayback: new Map()
  };

  const fileToTrigger = {
    'a.mov': 'alpha',
    'b.mov': 'beta',
    'c.mov': 'gamma',
    'e.mov': 'epsilon',
    'f.mov': 'zeta'
  };

  const controller = factory({
    settingsStore: createSettingsStore(),
    elements: {
      animationSortSelect,
      animationMapFilterSelect,
      animationStickerFilterSelect
    },
    state,
    helpers: {
      normalizeTriggerFromFilename: (filename) => String(filename || '').replace(/\.[^/.]+$/, ''),
      findAnimationMappingEntryByFile: (filename) => {
        const trigger = fileToTrigger[filename];
        return trigger ? { trigger, data: state.animationMappings[trigger] } : null;
      },
      findGiftNamesForAnimationTrigger: (trigger) => {
        if (trigger === 'alpha') return ['Rose'];
        if (trigger === 'epsilon') return ['Apple'];
        return [];
      },
      findGiftValuesForAnimationTrigger: (trigger) => {
        if (trigger === 'alpha') return ['5'];
        if (trigger === 'beta') return ['2'];
        return [];
      },
      isDefaultGiftAnimationTrigger: (trigger) => trigger === 'beta' || trigger === 'zeta',
      hasStickerForAnimationTrigger: (trigger) => trigger === 'gamma'
    }
  });

  const allCards = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(allCards.map((entry) => entry.trigger), ['zeta', 'beta', 'alpha', 'epsilon', 'gamma', 'd']);

  animationMapFilterSelect.value = 'mapped';
  const mappedOnly = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(mappedOnly.map((entry) => entry.trigger), ['zeta', 'beta', 'alpha', 'epsilon', 'gamma']);

  animationMapFilterSelect.value = 'unmapped';
  const unmappedOnly = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(unmappedOnly.map((entry) => entry.trigger), ['d']);

  animationMapFilterSelect.value = 'all';
  animationSortSelect.value = 'newest';
  const newestFirst = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(newestFirst.map((entry) => entry.trigger), ['beta', 'd', 'zeta', 'gamma', 'alpha', 'epsilon']);

  animationSortSelect.value = 'oldest';
  const oldestFirst = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(oldestFirst.map((entry) => entry.trigger), ['epsilon', 'alpha', 'gamma', 'zeta', 'beta', 'd']);
});

test('animation ui: initAnimationListControls hydrates values and persists changes', async () => {
  const { factory } = loadControllerFactory('animation-ui.js', 'createAnimationUiController');

  const animationSortSelect = createSelect(['name', 'newest', 'oldest', 'gift', 'value']);
  const animationMapFilterSelect = createSelect(['all', 'mapped', 'unmapped']);
  const animationStickerFilterSelect = createSelect(['all', 'with-sticker', 'without-sticker']);

  const settingsStore = createSettingsStore({
    animation_sort_mode: 'gift',
    animation_map_filter: 'mapped',
    animation_sticker_filter: 'not-valid'
  });

  const controller = factory({
    settingsStore,
    elements: {
      animationSortSelect,
      animationMapFilterSelect,
      animationStickerFilterSelect,
      animationMappingsList: { innerHTML: '', querySelectorAll: () => [] }
    },
    state: {
      availableAnimations: [],
      animationMappings: {},
      activeAnimationCardPlayback: new Map()
    }
  });

  controller.initAnimationListControls();

  assert.equal(animationSortSelect.value, 'gift');
  assert.equal(animationMapFilterSelect.value, 'mapped');
  assert.equal(animationStickerFilterSelect.value, 'all');

  animationMapFilterSelect.value = 'unmapped';
  animationMapFilterSelect.trigger('change');

  assert.equal(settingsStore.getItem('animation_map_filter'), 'unmapped');
});

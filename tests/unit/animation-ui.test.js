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

function createInput(value = '') {
  const listeners = new Map();
  return {
    value,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    trigger(event) {
      const handler = listeners.get(event);
      if (handler) handler();
    }
  };
}

function createClassList(seed = []) {
  const values = new Set(seed);
  return {
    add(token) {
      values.add(token);
    },
    remove(token) {
      values.delete(token);
    },
    contains(token) {
      return values.has(token);
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
  const animationKeywordFilterInput = createInput();

  const settingsStore = createSettingsStore({
    animation_sort_mode: 'gift',
    animation_map_filter: 'mapped',
    animation_sticker_filter: 'not-valid',
    animation_keyword_filter: 'beautiful dog'
  });

  const controller = factory({
    settingsStore,
    elements: {
      animationSortSelect,
      animationMapFilterSelect,
      animationStickerFilterSelect,
      animationKeywordFilterInput,
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
  assert.equal(animationKeywordFilterInput.value, 'beautiful dog');

  animationMapFilterSelect.value = 'unmapped';
  animationMapFilterSelect.trigger('change');

  assert.equal(settingsStore.getItem('animation_map_filter'), 'unmapped');

  animationKeywordFilterInput.value = 'very very low';
  animationKeywordFilterInput.trigger('input');

  assert.equal(settingsStore.getItem('animation_keyword_filter'), 'very very low');
});

test('animation ui: keyword filter narrows cards by trigger and keywords', async () => {
  const { factory } = loadControllerFactory('animation-ui.js', 'createAnimationUiController');
  const animationSortSelect = createSelect(['name', 'newest', 'oldest', 'gift', 'value'], 'name');
  const animationMapFilterSelect = createSelect(['all', 'mapped', 'unmapped'], 'all');
  const animationStickerFilterSelect = createSelect(['all', 'with-sticker', 'without-sticker'], 'all');
  const animationKeywordFilterInput = createInput('beautiful dog');

  const state = {
    availableAnimations: [
      { name: 'A', filename: 'abu.mov', mtimeMs: 100 },
      { name: 'B', filename: 'flight.mov', mtimeMs: 200 }
    ],
    animationMappings: {
      abu: { file: 'abu.mov', keywords: ['beautiful dog', 'died like'] },
      flight: { file: 'flight.mov', keywords: ['very very low'] }
    },
    activeAnimationCardPlayback: new Map()
  };

  const controller = factory({
    settingsStore: createSettingsStore(),
    elements: {
      animationSortSelect,
      animationMapFilterSelect,
      animationStickerFilterSelect,
      animationKeywordFilterInput
    },
    state,
    helpers: {
      normalizeTriggerFromFilename: (filename) => String(filename || '').replace(/\.[^/.]+$/, ''),
      findAnimationMappingEntryByFile: (filename) => {
        const trigger = filename === 'abu.mov' ? 'abu' : 'flight';
        return { trigger, data: state.animationMappings[trigger] };
      }
    }
  });

  let cards = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(cards.map((entry) => entry.trigger), ['abu']);

  animationKeywordFilterInput.value = 'very very low';
  cards = controller.getFilteredSortedAnimationCards();
  assert.deepEqual(cards.map((entry) => entry.trigger), ['flight']);
});

test('animation ui: clicking an active card stops playback instead of retriggering', async () => {
  const { factory } = loadControllerFactory('animation-ui.js', 'createAnimationUiController');
  const previewListeners = new Map();
  const card = {
    classList: createClassList(['playing'])
  };
  const previewButton = {
    dataset: { trigger: 'alpha' },
    querySelector(selector) {
      if (selector === '.animation-thumb-video') {
        return {
          paused: true,
          className: 'animation-thumb-video',
          getAttribute() {
            return '';
          },
          setAttribute() {},
          addEventListener() {},
          play() { return Promise.resolve(); },
          pause() {},
          currentTime: 0,
          dataset: {},
          load() {}
        };
      }
      return null;
    },
    closest(selector) {
      return selector === '.animation-mapping-card' ? card : null;
    },
    matches() {
      return false;
    },
    addEventListener(event, handler) {
      previewListeners.set(event, handler);
    }
  };
  const list = {
    innerHTML: '',
    querySelectorAll(selector) {
      if (selector === '.preview-mapping-btn') return [previewButton];
      return [];
    }
  };

  let triggerCalls = 0;
  let stopCalls = 0;
  const controller = factory({
    settingsStore: createSettingsStore(),
    elements: {
      animationMappingsList: list
    },
    state: {
      availableAnimations: [{ filename: 'alpha.mov', mtimeMs: 100 }],
      animationMappings: { alpha: { file: 'alpha.mov' } },
      activeAnimationCardPlayback: new Map([
        ['alpha', { trigger: 'alpha', filename: 'alpha.mov', endAtMs: Date.now() + 3000, durationSeconds: 3 }]
      ])
    },
    helpers: {
      normalizeTriggerFromFilename: () => 'alpha',
      getAnimationFileUrl: () => '/animations/alpha.mov',
      getAnimationFileFromMapping: (mapping) => mapping.file,
      escapeAttribute: (value) => String(value),
      findAnimationMappingEntryByFile: () => ({ trigger: 'alpha', data: { file: 'alpha.mov' } }),
      renderAnimationVisibilityBadges: () => '',
      formatAnimationPlaybackCountdown: () => '3.0s'
    },
    callbacks: {
      stopAllActiveAnimations: async () => {
        stopCalls += 1;
      },
      triggerAnimation: async () => {
        triggerCalls += 1;
        return true;
      }
    }
  });

  controller.renderAnimationMappings();
  await previewListeners.get('click')({
    preventDefault() {},
    currentTarget: previewButton
  });

  assert.equal(stopCalls, 1);
  assert.equal(triggerCalls, 0);
});

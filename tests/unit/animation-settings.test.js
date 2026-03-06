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

function createElement(initial = {}) {
  const listeners = new Map();
  return {
    value: '',
    checked: false,
    textContent: '',
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    trigger(event) {
      const handler = listeners.get(event);
      if (handler) handler();
    },
    ...initial
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {}
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('animation settings: init loads persisted values and updates labels', async () => {
  const { factory } = loadControllerFactory('animation-settings.js', 'createAnimationSettingsController');

  const settingsStore = createSettingsStore({
    animations_enabled: 'false',
    animation_volume: '73',
    chroma_key_settings: JSON.stringify({ greenThreshold: 84, tolerance: 41, spillReduction: 0.5 }),
    animation_position: 'top-right'
  });

  const elements = {
    animationsEnabledCheckbox: createElement({ checked: true }),
    animationVolumeSlider: createElement({ value: '100' }),
    animationVolumeValue: createElement({ textContent: '' }),
    greenThresholdSlider: createElement({ value: '100' }),
    chromaToleranceSlider: createElement({ value: '50' }),
    greenThresholdValue: createElement({ textContent: '' }),
    chromaToleranceValue: createElement({ textContent: '' }),
    animationPositionSelect: createElement({ value: 'bottom-left' })
  };

  const controller = factory({
    settingsStore,
    elements
  });

  controller.init();

  assert.equal(elements.animationsEnabledCheckbox.checked, false);
  assert.equal(elements.animationVolumeSlider.value, '73');
  assert.equal(elements.animationVolumeValue.textContent, '73%');
  assert.equal(elements.greenThresholdSlider.value, 84);
  assert.equal(elements.chromaToleranceSlider.value, 41);
  assert.equal(elements.greenThresholdValue.textContent, 84);
  assert.equal(elements.chromaToleranceValue.textContent, 41);
  assert.equal(elements.animationPositionSelect.value, 'top-right');
  assert.equal(controller.getAnimationVolumePercent(), 73);
});

test('animation settings: input/change handlers persist values and trigger callbacks', async () => {
  const { factory } = loadControllerFactory('animation-settings.js', 'createAnimationSettingsController');

  const settingsStore = createSettingsStore();
  const calls = {
    volume: 0,
    chroma: 0
  };

  const elements = {
    animationsEnabledCheckbox: createElement({ checked: true }),
    animationVolumeSlider: createElement({ value: '65' }),
    animationVolumeValue: createElement({ textContent: '' }),
    greenThresholdSlider: createElement({ value: '70' }),
    chromaToleranceSlider: createElement({ value: '60' }),
    greenThresholdValue: createElement({ textContent: '' }),
    chromaToleranceValue: createElement({ textContent: '' }),
    animationPositionSelect: createElement({ value: 'bottom-left' })
  };

  const controller = factory({
    settingsStore,
    elements,
    callbacks: {
      onAnimationVolumeInput: () => {
        calls.volume += 1;
      },
      onChromaInput: () => {
        calls.chroma += 1;
      }
    }
  });

  controller.init();

  elements.animationsEnabledCheckbox.checked = false;
  elements.animationsEnabledCheckbox.trigger('change');
  assert.equal(settingsStore.getItem('animations_enabled'), 'false');

  elements.animationVolumeSlider.value = '88';
  elements.animationVolumeSlider.trigger('input');
  assert.equal(settingsStore.getItem('animation_volume'), '88');
  assert.equal(elements.animationVolumeValue.textContent, '88%');
  assert.equal(calls.volume, 1);

  elements.greenThresholdSlider.value = '92';
  elements.greenThresholdSlider.trigger('input');
  assert.equal(elements.greenThresholdValue.textContent, '92');
  assert.equal(calls.chroma, 1);

  elements.chromaToleranceSlider.value = '38';
  elements.chromaToleranceSlider.trigger('input');
  assert.equal(elements.chromaToleranceValue.textContent, '38');
  assert.equal(calls.chroma, 2);

  elements.greenThresholdSlider.trigger('change');
  const savedChroma = JSON.parse(settingsStore.getItem('chroma_key_settings'));
  assert.equal(savedChroma.greenThreshold, 92);
  assert.equal(savedChroma.tolerance, 38);

  elements.animationPositionSelect.value = 'top-left';
  elements.animationPositionSelect.trigger('change');
  assert.equal(settingsStore.getItem('animation_position'), 'top-left');
});

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

test('app bootstrap: init runs callbacks once in expected order', async () => {
  const { factory } = loadControllerFactory('app-bootstrap.js', 'createAppBootstrapController');
  const calls = [];

  const controller = factory({
    callbacks: {
      loadHiddenVoices: () => calls.push('loadHiddenVoices'),
      initVoiceUi: () => calls.push('initVoiceUi'),
      afterVoiceUi: () => calls.push('afterVoiceUi'),
      initLanguageFilters: () => calls.push('initLanguageFilters'),
      afterLanguageFilters: () => calls.push('afterLanguageFilters'),
      initOllamaGender: () => calls.push('initOllamaGender'),
      initAudioRuntime: () => calls.push('initAudioRuntime'),
      afterInit: () => calls.push('afterInit')
    }
  });

  controller.init();
  controller.init();

  assert.deepEqual(calls, [
    'loadHiddenVoices',
    'initVoiceUi',
    'afterVoiceUi',
    'initLanguageFilters',
    'afterLanguageFilters',
    'initOllamaGender',
    'initAudioRuntime',
    'afterInit'
  ]);
  assert.equal(controller.state.initialized, true);
});


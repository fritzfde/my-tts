const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createFakeElement() {
  return {
    value: '',
    textContent: '',
    style: {},
    addEventListener() {},
    querySelectorAll() { return []; },
    insertBefore() {}
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    document: {
      createElement() {
        return {
          className: '',
          style: {},
          innerHTML: ''
        };
      }
    },
    Element: function Element() {}
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

test('api key manager: set/add/remove/get/rotate', async () => {
  const { factory } = loadControllerFactory('api-key-manager.js', 'createApiKeyManagerController');

  let duplicateEvents = 0;
  let saveEvents = 0;
  const controller = factory({
    elements: {
      apiKeyTagsContainer: createFakeElement(),
      apiKeyTextInput: createFakeElement(),
      apiKeyCountLabel: createFakeElement()
    },
    onSave: () => {
      saveEvents += 1;
    },
    onDuplicate: () => {
      duplicateEvents += 1;
    }
  });

  controller.setKeys(['k1', 'k2']);
  assert.deepEqual(Array.from(controller.getKeys()), ['k1', 'k2']);
  assert.equal(controller.getNextApiKey(), 'k1');

  const rotated = controller.rotateToNextKey();
  assert.equal(rotated, true);
  assert.equal(controller.getNextApiKey(), 'k2');

  controller.addApiKey('k2');
  assert.equal(duplicateEvents, 1);

  controller.addApiKey('k3');
  assert.deepEqual(Array.from(controller.getKeys()), ['k1', 'k2', 'k3']);

  controller.removeApiKey(1);
  assert.deepEqual(Array.from(controller.getKeys()), ['k1', 'k3']);
  assert.ok(saveEvents >= 1);
});

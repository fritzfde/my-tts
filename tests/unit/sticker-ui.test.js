const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createElement(extra = {}) {
  const listeners = new Map();
  return {
    style: { display: '' },
    textContent: '',
    value: '',
    dataset: {},
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    trigger(event, payload = {}) {
      const handler = listeners.get(event);
      if (!handler) return undefined;
      return handler({
        preventDefault() {},
        stopPropagation() {},
        target: payload.target || null,
        ...payload
      });
    },
    ...extra
  };
}

function createSelectElement() {
  const base = createElement();
  let options = [];

  return Object.assign(base, {
    appendChild(option) {
      options.push(option);
      if (option.selected) {
        this.value = option.value;
      }
    },
    get options() {
      return options;
    },
    set innerHTML(value) {
      this._innerHTML = value;
      options = [];
      this.value = '';
    },
    get innerHTML() {
      return this._innerHTML || '';
    }
  });
}

function createDocumentStub(chatItems = []) {
  return {
    createElement(tag) {
      if (tag === 'option') {
        return { value: '', textContent: '', selected: false };
      }
      return createElement();
    },
    querySelectorAll(selector) {
      if (selector === '.chat-sticker-item') {
        return chatItems;
      }
      return [];
    }
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('sticker ui: open modal populates sticker info and animation options', async () => {
  const { factory } = loadControllerFactory('sticker-ui.js', 'createStickerUiController');

  const stickerAssignModal = createElement();
  const stickerAssignPreviewImage = createElement({
    src: '',
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    }
  });
  const stickerAssignName = createElement();
  const stickerAssignCurrent = createElement();
  const stickerAssignAnimationSelect = createSelectElement();

  const controller = factory({
    documentRef: createDocumentStub([]),
    elements: {
      stickerAssignModal,
      stickerAssignPreviewImage,
      stickerAssignName,
      stickerAssignCurrent,
      stickerAssignAnimationSelect
    },
    callbacks: {
      getAnimationTriggers: () => ['beta', 'alpha'],
      ensureStickerEntry: () => ({ name: 'Rose', image: '/img/rose.png' }),
      getStickerTriggerForKey: () => 'alpha'
    }
  });

  controller.openStickerAssignFromChat('sticker-1', '/img/rose.png', 'Rose');

  assert.equal(stickerAssignModal.style.display, 'flex');
  assert.equal(stickerAssignName.textContent, 'Rose');
  assert.equal(stickerAssignCurrent.textContent, 'Currently mapped to: alpha');
  assert.equal(stickerAssignPreviewImage.src, '/img/rose.png');
  assert.equal(stickerAssignPreviewImage.style.display, 'block');
  assert.deepEqual(stickerAssignAnimationSelect.options.map((opt) => opt.value), ['alpha', 'beta']);
  assert.equal(stickerAssignAnimationSelect.value, 'alpha');
  assert.equal(controller.state.activeStickerAssignKey, 'sticker-1');
});

test('sticker ui: save applies mapping, syncs popup sticker picker, closes modal', async () => {
  const { factory } = loadControllerFactory('sticker-ui.js', 'createStickerUiController');

  const stickerAssignModal = createElement();
  const stickerAssignAnimationSelect = createSelectElement();
  stickerAssignAnimationSelect.value = 'beta';

  const calls = {
    assign: [],
    save: 0,
    render: 0,
    popup: []
  };

  const controller = factory({
    documentRef: createDocumentStub([]),
    elements: {
      stickerAssignModal,
      stickerAssignAnimationSelect,
      stickerAssignSaveBtn: createElement()
    },
    callbacks: {
      getAnimationTriggers: () => ['beta'],
      ensureStickerEntry: () => ({ name: 'Gift', image: null }),
      getStickerTriggerForKey: () => '',
      assignStickerToTrigger: (key, trigger) => calls.assign.push([key, trigger]),
      saveStickerMappings: () => {
        calls.save += 1;
      },
      renderAnimationMappings: () => {
        calls.render += 1;
      },
      getActiveAnimationPopup: () => ({ trigger: 'any-trigger' }),
      findStickerKeyForAnimationTrigger: () => 'sticker-1',
      populateAnimationPopupStickerOptions: (key) => calls.popup.push(key)
    }
  });

  controller.openStickerAssignFromChat('sticker-1', '', 'Gift');
  stickerAssignAnimationSelect.value = 'beta';

  await controller.handleStickerAssignSave();

  assert.deepEqual(calls.assign, [['sticker-1', 'beta']]);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 1);
  assert.deepEqual(calls.popup, ['sticker-1']);
  assert.equal(stickerAssignModal.style.display, 'none');
  assert.equal(controller.state.activeStickerAssignKey, '');
});

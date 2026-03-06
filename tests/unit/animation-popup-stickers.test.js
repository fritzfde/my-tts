const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createSelectElement() {
  let options = [];
  return {
    value: '',
    appendChild(option) {
      options.push(option);
      if (option.selected) {
        this.value = option.value;
      }
    },
    set innerHTML(value) {
      this._innerHTML = value;
      options = [];
      this.value = '';
    },
    get innerHTML() {
      return this._innerHTML || '';
    },
    get options() {
      return options;
    }
  };
}

function createPickerElement() {
  return {
    innerHTML: '',
    _buttons: [],
    querySelectorAll(selector) {
      if (selector === '.animation-sticker-option') {
        return this._buttons;
      }
      return [];
    }
  };
}

function makePickerButton(stickerKey = '') {
  let clickHandler = null;
  return {
    dataset: { stickerKey },
    addEventListener(event, handler) {
      if (event === 'click') clickHandler = handler;
    },
    click() {
      if (clickHandler) clickHandler();
    }
  };
}

function createDocumentStub() {
  return {
    createElement(tag) {
      if (tag === 'option') {
        return { value: '', textContent: '', selected: false };
      }
      return { value: '', textContent: '' };
    }
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

test('animation popup stickers: populate fills select and renders picker', async () => {
  const { factory } = loadControllerFactory('animation-popup-stickers.js', 'createAnimationPopupStickersController');

  const select = createSelectElement();
  const picker = createPickerElement();

  const controller = factory({
    documentRef: createDocumentStub(),
    elements: {
      animationPopupSticker: select,
      animationPopupStickerPicker: picker
    },
    helpers: {
      getAvailableStickerOptions: () => [
        { key: 'sticker-1', name: 'Rose', image: '/rose.png', trigger: '' },
        { key: 'sticker-2', name: 'Crown', image: null, trigger: 'dance' }
      ],
      getCurrentPopupTrigger: () => 'dance',
      escapeAttribute: (value) => String(value ?? ''),
      escapeHtml: (value) => String(value ?? '')
    }
  });

  picker._buttons = [makePickerButton(''), makePickerButton('sticker-1')];
  controller.populateAnimationPopupStickerOptions('sticker-2');

  assert.equal(select.value, 'sticker-2');
  assert.deepEqual(select.options.map((opt) => opt.value), ['sticker-1', 'sticker-2']);
  assert.match(picker.innerHTML, /No sticker/);
  assert.match(picker.innerHTML, /Rose/);
  assert.match(picker.innerHTML, /Mapped to this card/);
});

test('animation popup stickers: picker click updates select and rerenders', async () => {
  const { factory } = loadControllerFactory('animation-popup-stickers.js', 'createAnimationPopupStickersController');

  const select = createSelectElement();
  const picker = createPickerElement();

  const controller = factory({
    documentRef: createDocumentStub(),
    elements: {
      animationPopupSticker: select,
      animationPopupStickerPicker: picker
    },
    helpers: {
      getAvailableStickerOptions: () => [
        { key: 'sticker-1', name: 'Rose', image: null, trigger: '' }
      ],
      getCurrentPopupTrigger: () => '',
      escapeAttribute: (value) => String(value ?? ''),
      escapeHtml: (value) => String(value ?? '')
    }
  });

  const noneButton = makePickerButton('');
  const roseButton = makePickerButton('sticker-1');
  picker._buttons = [noneButton, roseButton];
  controller.renderAnimationPopupStickerPicker('');

  roseButton.click();
  assert.equal(select.value, 'sticker-1');
});

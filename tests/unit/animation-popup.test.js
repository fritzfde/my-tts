const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createElement(extra = {}) {
  const listeners = new Map();
  const classSet = new Set();

  return {
    style: { display: '' },
    value: '',
    checked: false,
    dataset: {},
    classList: {
      toggle(name, force) {
        if (typeof force === 'boolean') {
          if (force) classSet.add(name);
          else classSet.delete(name);
          return force;
        }
        if (classSet.has(name)) {
          classSet.delete(name);
          return false;
        }
        classSet.add(name);
        return true;
      },
      contains(name) {
        return classSet.has(name);
      }
    },
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    trigger(event, payload = {}) {
      const handler = listeners.get(event);
      if (!handler) return undefined;
      const normalizedPayload = {
        preventDefault() {},
        stopPropagation() {},
        ...payload
      };
      return handler(normalizedPayload);
    },
    querySelectorAll() {
      return [];
    },
    focus() {
      this._focused = true;
    },
    ...extra
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout,
    encodeURIComponent
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('animation popup: open populates fields and active state', async () => {
  const { factory } = loadControllerFactory('animation-popup.js', 'createAnimationPopupController');

  const posBottomLeft = createElement({ dataset: { position: 'bottom-left' } });
  const posTopRight = createElement({ dataset: { position: 'top-right' } });

  const elements = {
    animationCardPopup: createElement(),
    animationPopupName: createElement(),
    animationPopupPositionGrid: {
      querySelectorAll() {
        return [posBottomLeft, posTopRight];
      }
    },
    animationPopupScale: createElement(),
    animationPopupGiftName: createElement(),
    animationPopupGiftValue: createElement(),
    animationPopupKeywords: createElement(),
    animationPopupKeywordEnabled: createElement(),
    animationPopupSticker: createElement(),
    animationPopupMakeDefault: createElement()
  };

  const state = {
    animationMappings: {
      dance: { file: 'dance.mov', position: 'top-right', scale: 1.25, keywords: ['dance', 'party'], keywordTriggerEnabled: true }
    },
    giftMappings: {
      byName: { Rose: { type: 'animation', value: 'dance' } },
      byValue: { '1': { type: 'animation', value: 'dance' } }
    }
  };

  let selectedStickerKey = null;

  const controller = factory({
    elements,
    state,
    helpers: {
      toAnimationMappingObject: (data, fallbackFilename) => ({
        file: data?.file || fallbackFilename,
        position: data?.position || 'bottom-left',
        scale: Number(data?.scale || 1),
        keywords: Array.isArray(data?.keywords) ? data.keywords : [],
        keywordTriggerEnabled: data?.keywordTriggerEnabled === true
      }),
      findFirstGiftNameForAnimationTrigger: () => 'Rose',
      findFirstGiftValueForAnimationTrigger: () => '1',
      findStickerKeyForAnimationTrigger: () => 'sticker-1',
      isDefaultGiftAnimationTrigger: () => true
    },
    callbacks: {
      populateAnimationPopupStickerOptions: (value) => {
        selectedStickerKey = value;
      }
    }
  });

  controller.openAnimationCardPopup('dance', 'dance.mov');

  assert.equal(elements.animationCardPopup.style.display, 'flex');
  assert.equal(elements.animationPopupName.value, 'dance');
  assert.equal(elements.animationPopupScale.value, '1.25');
  assert.equal(elements.animationPopupGiftName.value, 'Rose');
  assert.equal(elements.animationPopupGiftValue.value, '1');
  assert.equal(elements.animationPopupKeywords.value, 'dance\nparty');
  assert.equal(elements.animationPopupKeywordEnabled.checked, true);
  assert.equal(elements.animationPopupMakeDefault.checked, true);
  assert.equal(selectedStickerKey, 'sticker-1');
  assert.equal(controller.getActivePopup()?.trigger, 'dance');
  assert.equal(controller.getActivePopup()?.filename, 'dance.mov');
  assert.equal(posTopRight.classList.contains('active'), true);
  assert.equal(posBottomLeft.classList.contains('active'), false);
});

test('animation popup: save updates mapping and persists through callbacks', async () => {
  const { factory } = loadControllerFactory('animation-popup.js', 'createAnimationPopupController');

  const posBottomLeft = createElement({ dataset: { position: 'bottom-left' } });
  const posTopCenter = createElement({ dataset: { position: 'top-center' } });

  const elements = {
    animationCardPopup: createElement(),
    animationPopupName: createElement(),
    animationPopupPositionGrid: {
      querySelectorAll() {
        return [posBottomLeft, posTopCenter];
      }
    },
    animationPopupScale: createElement(),
    animationPopupGiftName: createElement(),
    animationPopupGiftValue: createElement(),
    animationPopupKeywords: createElement(),
    animationPopupKeywordEnabled: createElement(),
    animationPopupSticker: createElement(),
    animationPopupMakeDefault: createElement(),
    animationPopupSaveBtn: createElement()
  };

  const state = {
    animationMappings: {
      dance: { file: 'dance.mov', position: 'bottom-left', scale: 1 }
    },
    giftMappings: { byName: {}, byValue: {} }
  };

  const calls = {
    saveAnimationMappings: 0,
    saveGiftMappings: 0,
    saveStickerMappings: 0,
    renderGiftMappings: 0,
    renderAnimationMappings: 0,
    setSticker: []
  };

  const controller = factory({
    elements,
    state,
    helpers: {
      normalizeTriggerFromFilename: (value) => String(value || '').trim().toLowerCase(),
      buildUniqueAnimationTrigger: (base) => base,
      toAnimationMappingObject: (data, fallbackFilename) => ({
        file: data?.file || fallbackFilename,
        position: data?.position || 'bottom-left',
        scale: Number(data?.scale || 1),
        keywords: Array.isArray(data?.keywords) ? data.keywords : [],
        keywordTriggerEnabled: data?.keywordTriggerEnabled === true
      }),
      findFirstGiftNameForAnimationTrigger: () => '',
      findFirstGiftValueForAnimationTrigger: () => '',
      findStickerKeyForAnimationTrigger: () => ''
    },
    callbacks: {
      populateAnimationPopupStickerOptions: () => {},
      moveGiftAnimationReferences: () => {},
      moveStickerAnimationReferences: () => {},
      removeGiftAnimationReferenceForKey: () => {},
      addGiftAnimationReference: () => {},
      setStickerForAnimationTrigger: (trigger, stickerKey) => {
        calls.setSticker.push([trigger, stickerKey]);
      },
      saveAnimationMappings: async () => {
        calls.saveAnimationMappings += 1;
      },
      saveGiftMappings: () => {
        calls.saveGiftMappings += 1;
      },
      saveStickerMappings: () => {
        calls.saveStickerMappings += 1;
      },
      renderGiftMappings: () => {
        calls.renderGiftMappings += 1;
      },
      renderAnimationMappings: () => {
        calls.renderAnimationMappings += 1;
      }
    }
  });

  controller.openAnimationCardPopup('dance', 'dance.mov');
  controller.setAnimationPopupPosition('top-center');
  elements.animationPopupName.value = 'dance-new';
  elements.animationPopupScale.value = '2';
  elements.animationPopupKeywords.value = 'dance, boogie';
  elements.animationPopupKeywordEnabled.checked = true;
  elements.animationPopupSticker.value = 'sticker-a';

  controller.attachEvents();
  await elements.animationPopupSaveBtn.trigger('click');

  assert.equal(state.animationMappings.dance, undefined);
  assert.equal(state.animationMappings['dance-new']?.file, 'dance.mov');
  assert.equal(state.animationMappings['dance-new']?.position, 'top-center');
  assert.equal(state.animationMappings['dance-new']?.scale, 2);
  assert.equal(
    JSON.stringify(state.animationMappings['dance-new']?.keywords),
    JSON.stringify(['dance', 'boogie'])
  );
  assert.equal(state.animationMappings['dance-new']?.keywordTriggerEnabled, true);
  assert.deepEqual(calls.setSticker, [['dance-new', 'sticker-a']]);
  assert.equal(calls.saveAnimationMappings, 1);
  assert.equal(calls.saveGiftMappings, 1);
  assert.equal(calls.saveStickerMappings, 1);
  assert.equal(calls.renderGiftMappings, 1);
  assert.equal(calls.renderAnimationMappings, 1);
  assert.equal(elements.animationCardPopup.style.display, 'none');
});

test('animation popup: unchecking default keeps value 1 mapping and removes default fallback', async () => {
  const { factory } = loadControllerFactory('animation-popup.js', 'createAnimationPopupController');

  const posBottomLeft = createElement({ dataset: { position: 'bottom-left' } });

  const elements = {
    animationCardPopup: createElement(),
    animationPopupName: createElement(),
    animationPopupPositionGrid: {
      querySelectorAll() {
        return [posBottomLeft];
      }
    },
    animationPopupScale: createElement(),
    animationPopupGiftName: createElement(),
    animationPopupGiftValue: createElement(),
    animationPopupSticker: createElement(),
    animationPopupMakeDefault: createElement(),
    animationPopupSaveBtn: createElement()
  };

  const state = {
    animationMappings: {
      dance: { file: 'dance.mov', position: 'bottom-left', scale: 1 }
    },
    giftMappings: {
      byName: {},
      byValue: {
        '1': { type: 'animation', value: 'dance' }
      },
      defaultAnimation: { type: 'animation', value: 'dance' }
    }
  };

  function toTriggerList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string' && value) return [value];
    return [];
  }

  const controller = factory({
    elements,
    state,
    helpers: {
      normalizeTriggerFromFilename: (value) => String(value || '').trim().toLowerCase(),
      buildUniqueAnimationTrigger: (base) => base,
      toAnimationMappingObject: (data, fallbackFilename) => ({
        file: data?.file || fallbackFilename,
        position: data?.position || 'bottom-left',
        scale: Number(data?.scale || 1)
      }),
      findFirstGiftNameForAnimationTrigger: () => '',
      findFirstGiftValueForAnimationTrigger: () => '1',
      findStickerKeyForAnimationTrigger: () => '',
      isDefaultGiftAnimationTrigger: () => true,
      getAnimationFileFromMapping: (data) => (typeof data === 'object' && data ? data.file : '')
    },
    callbacks: {
      populateAnimationPopupStickerOptions: () => {},
      moveGiftAnimationReferences: () => {},
      moveStickerAnimationReferences: () => {},
      addGiftAnimationReference: (group, key, trigger) => {
        const existing = group[key] || { type: 'animation', value: '' };
        const nextValues = Array.from(new Set([...toTriggerList(existing.value), trigger]));
        group[key] = { type: 'animation', value: nextValues.length > 1 ? nextValues : nextValues[0] };
      },
      removeGiftAnimationReferenceForKey: (group, key, trigger) => {
        if (!group[key] || group[key].type !== 'animation') return;
        const nextValues = toTriggerList(group[key].value).filter((value) => value !== trigger);
        if (nextValues.length === 0) {
          delete group[key];
          return;
        }
        group[key].value = nextValues.length > 1 ? nextValues : nextValues[0];
      },
      addDefaultGiftAnimationReference: (trigger) => {
        const existing = state.giftMappings.defaultAnimation?.value || '';
        const nextValues = Array.from(new Set([...toTriggerList(existing), trigger]));
        state.giftMappings.defaultAnimation = {
          type: 'animation',
          value: nextValues.length > 1 ? nextValues : (nextValues[0] || '')
        };
      },
      removeDefaultGiftAnimationReference: (trigger) => {
        const existing = state.giftMappings.defaultAnimation?.value || '';
        const nextValues = toTriggerList(existing).filter((value) => value !== trigger);
        state.giftMappings.defaultAnimation = {
          type: 'animation',
          value: nextValues.length > 1 ? nextValues : (nextValues[0] || '')
        };
      },
      setStickerForAnimationTrigger: () => {},
      saveAnimationMappings: async () => {},
      saveGiftMappings: () => {},
      saveStickerMappings: () => {},
      renderGiftMappings: () => {},
      renderAnimationMappings: () => {}
    }
  });

  controller.openAnimationCardPopup('dance', 'dance.mov');
  elements.animationPopupMakeDefault.checked = false;

  controller.attachEvents();
  await elements.animationPopupSaveBtn.trigger('click');

  assert.equal(state.giftMappings.byValue['1']?.value, 'dance');
  assert.equal(state.giftMappings.defaultAnimation?.value || '', '');
});

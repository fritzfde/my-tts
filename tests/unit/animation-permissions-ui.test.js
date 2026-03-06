const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createClickableElement() {
  const listeners = new Map();
  return {
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
}

function loadControllerFactory(fileName, factoryName, extraContext = {}) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    ...extraContext
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('animation permissions ui: init binds controls and updates state', async () => {
  const { factory, context } = loadControllerFactory(
    'animation-permissions-ui.js',
    'createAnimationPermissionsUiController'
  );

  const globalCheckbox = createClickableElement();
  globalCheckbox.checked = false;
  const manageBtn = createClickableElement();
  const modal = { style: { display: 'none' } };
  const removedClasses = [];
  const list = {
    innerHTML: '',
    classList: {
      remove: (name) => removedClasses.push(name)
    }
  };

  const permissions = {};
  let globalEnabled = true;
  let saveCount = 0;
  let headerArgs = null;
  const chatEvents = [];

  const controller = factory({
    windowRef: context.window,
    elements: {
      globalAnimationTriggerCheckbox: globalCheckbox,
      managePermissionsBtn: manageBtn,
      voiceModal: modal,
      userVoiceList: list
    },
    stateAccessors: {
      getRecentUsers: () => ['youtube:alex', 'tiktok:maria'],
      getGlobalEnabled: () => globalEnabled,
      setGlobalEnabled: (value) => {
        globalEnabled = value;
      },
      getPermissionsMap: () => permissions,
      setPermission: (userKey, permission) => {
        permissions[userKey] = permission;
      },
      deletePermission: (userKey) => {
        delete permissions[userKey];
      }
    },
    callbacks: {
      saveAnimationPermissions: () => {
        saveCount += 1;
      },
      setVoiceModalWideLayout: () => {},
      setVoiceModalHeader: (...args) => {
        headerArgs = args;
      },
      getUserDisplayName: (username) => username.toUpperCase(),
      escapeAttribute: (value) => String(value),
      escapeHtml: (value) => String(value),
      addChatMessage: (...args) => {
        chatEvents.push(args);
      }
    }
  });

  controller.init();
  assert.equal(globalCheckbox.checked, true);
  assert.equal(typeof context.window.setUserAnimationPermission, 'function');

  globalCheckbox.checked = false;
  globalCheckbox.trigger('change');
  assert.equal(globalEnabled, false);
  assert.equal(saveCount, 1);

  manageBtn.trigger('click');
  assert.equal(modal.style.display, 'flex');
  assert.equal(removedClasses.includes('voice-grid-layout'), true);
  assert.deepEqual(headerArgs, [
    'Per-User Animation Permissions',
    'Control which users can trigger animations with stickers.'
  ]);
  assert.match(list.innerHTML, /youtube:alex/);
  assert.match(list.innerHTML, /setUserAnimationPermission/);

  controller.setUserAnimationPermission('youtube:alex', 'allow');
  assert.equal(permissions['youtube:alex'], 'allow');
  assert.equal(saveCount, 2);
  assert.equal(chatEvents.length, 1);

  controller.setUserAnimationPermission('youtube:alex', 'default');
  assert.equal(Object.hasOwn(permissions, 'youtube:alex'), false);
  assert.equal(saveCount, 3);
});


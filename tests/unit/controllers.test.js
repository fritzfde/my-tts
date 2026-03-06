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
    removeItem(key) {
      store.delete(String(key));
    },
    _dump() {
      return Object.fromEntries(store.entries());
    }
  };
}

function loadControllerFactory(fileName, factoryName, extraContext = {}) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {},
    setTimeout,
    clearTimeout,
    ...extraContext
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('gift mappings: round-robin + default sound cleanup', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('gift-mappings.js', 'createGiftMappingsController');
  const controller = factory({ settingsStore });

  controller.state.byValue['5'] = { type: 'animation', value: ['alpha', 'beta'] };
  controller.state.default = { type: 'sound', value: 'custom-/sounds/custom/x.wav' };

  const first = controller.getGiftAction('Rose', 5);
  const second = controller.getGiftAction('Rose', 5);
  const third = controller.getGiftAction('Rose', 5);
  assert.equal(first.type, 'animation');
  assert.equal(first.value, 'alpha');
  assert.equal(second.type, 'animation');
  assert.equal(second.value, 'beta');
  assert.equal(third.type, 'animation');
  assert.equal(third.value, 'alpha');

  controller.state.byName.Rose = { type: 'sound', value: 'custom-/sounds/custom/x.wav' };
  controller.clearSoundReferences('custom-/sounds/custom/x.wav');
  assert.equal(controller.state.default.value, '');
  assert.equal(controller.state.byName.Rose.value, '');
});

test('gift mappings: name matching is case-insensitive and diamond candidates support unit fallback', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('gift-mappings.js', 'createGiftMappingsController');
  const controller = factory({ settingsStore });

  controller.state.byName['  Rose Gift  '] = { type: 'animation', value: 'rose-anim' };
  controller.state.byValue['1'] = { type: 'animation', value: 'single-anim' };
  controller.state.byValue['5'] = { type: 'animation', value: 'bundle-anim' };

  const byName = controller.getGiftAction('rose   gift', [1, 5]);
  assert.equal(byName.type, 'animation');
  assert.equal(byName.value, 'rose-anim');

  const byUnitValue = controller.getGiftAction('unknown', [1, 5]);
  assert.equal(byUnitValue.type, 'animation');
  assert.equal(byUnitValue.value, 'single-anim');

  const byTotalValue = controller.getGiftAction('unknown', [3, 5]);
  assert.equal(byTotalValue.type, 'animation');
  assert.equal(byTotalValue.value, 'bundle-anim');
});

test('gift mappings: default fallback animation is independent from value 1 mapping', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('gift-mappings.js', 'createGiftMappingsController');
  const controller = factory({ settingsStore });

  controller.state.byValue['1'] = { type: 'animation', value: 'value-one-anim' };
  controller.addDefaultAnimationTrigger('fallback-anim');

  const explicitValueOne = controller.getGiftAction('unknown', 1);
  assert.equal(explicitValueOne.type, 'animation');
  assert.equal(explicitValueOne.value, 'value-one-anim');

  const fallback = controller.getGiftAction('unknown', 999);
  assert.equal(fallback.type, 'animation');
  assert.equal(fallback.value, 'fallback-anim');

  controller.removeDefaultAnimationTrigger('fallback-anim');
  assert.equal(controller.isDefaultAnimationTrigger('fallback-anim'), false);
});

test('presence: tracks users, viewer count, and prunes stale entries', async () => {
  const { factory } = loadControllerFactory('presence.js', 'createPresenceController', {
    escapeAttribute: (value) => String(value ?? ''),
    escapeHtml: (value) => String(value ?? '')
  });

  const elements = {
    onlineYouTubeUsersEl: { innerHTML: '' },
    onlineYouTubeCountEl: { textContent: '', title: '' },
    onlineTikTokUsersEl: { innerHTML: '' },
    onlineTikTokCountEl: { textContent: '', title: '' }
  };

  const controller = factory({
    elements,
    ttlMsByPlatform: { youtube: 120000, tiktok: 45000 },
    initialTikTokTtlMs: 45000,
    resolveDisplayName: ({ displayName, username }) => displayName || username
  });

  const now = Date.now();
  controller.markUserOnline('yt-user', 'youtube', { displayName: 'YT User', lastSeen: now });
  controller.markUserOnline('tt-user', 'tiktok', { displayName: 'TT User', lastSeen: now });
  controller.setTikTokViewerCount(12);
  controller.render();

  assert.equal(elements.onlineYouTubeCountEl.textContent, '1');
  assert.equal(elements.onlineTikTokCountEl.textContent, '1');
  assert.match(elements.onlineTikTokCountEl.title, /Live viewer count: 12/);

  controller.onlineUsers.youtube.set('stale', { displayName: 'Stale', lastSeen: now - 999999 });
  controller.render();
  assert.equal(controller.onlineUsers.youtube.has('stale'), false);
});

test('sticker mappings: assignment uniqueness and trigger handling', async () => {
  const settingsStore = createSettingsStore();
  const chatEvents = [];
  const animationEvents = [];

  const { factory } = loadControllerFactory('sticker-mappings.js', 'createStickerMappingsController');
  const controller = factory({
    settingsStore,
    escapeAttribute: (value) => String(value ?? ''),
    escapeHtml: (value) => String(value ?? ''),
    addChatMessage: (...args) => chatEvents.push(args),
    triggerAnimation: (...args) => animationEvents.push(args)
  });

  controller.ensureStickerEntry('s1', { name: 'Sticker One', image: '/x.png' });
  controller.assignStickerToTrigger('s1', 'dance');
  assert.equal(controller.getStickerTriggerForKey('s1'), 'dance');

  controller.assignStickerToTrigger('s2', 'dance');
  assert.equal(controller.getStickerTriggerForKey('s1'), '');
  assert.equal(controller.getStickerTriggerForKey('s2'), 'dance');

  controller.handleStickerAnimation({ emoteId: 's2', emoteName: 'Second', author: 'alex' });
  assert.equal(animationEvents.length, 1);
  assert.deepEqual(animationEvents[0], ['dance', 'tiktok', 'alex']);

  const html = controller.buildStickerChatListHtml([{ emoteId: 's2', emoteName: 'Second', emoteImage: '/img.png' }]);
  assert.match(html, /chat-sticker-list/);
  assert.match(html, /chat-sticker-item/);
  assert.equal(chatEvents.length, 0);
});

test('animation mappings: sync removes stale, dedupes files, and auto-adds missing', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('animation-mappings.js', 'createAnimationMappingsController');
  const controller = factory({ settingsStore });

  controller.state.animationMappings.a = { file: 'a.mov', position: 'bottom-left', scale: 1 };
  controller.state.animationMappings.dup = { file: 'a.mov', position: 'bottom-left', scale: 1 };
  controller.state.animationMappings.stale = { file: 'stale.mov', position: 'bottom-left', scale: 1 };

  controller.state.availableAnimations.push(
    { name: 'A', filename: 'a.mov' },
    { name: 'B', filename: 'b.mov' }
  );

  const result = controller.syncFromFiles();
  assert.equal(result.changed, true);
  assert.equal(result.created, 1);
  assert.equal(result.removed, 1);
  assert.ok(result.deduped >= 1);

  const mappedFiles = Object.values(controller.state.animationMappings).map((entry) => entry.file).sort();
  assert.deepEqual(mappedFiles, ['a.mov', 'b.mov']);

  controller.saveMappings();
  const saved = settingsStore.getItem('animation_mappings');
  assert.ok(saved && saved.includes('a.mov') && saved.includes('b.mov'));
});

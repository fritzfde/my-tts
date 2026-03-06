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

test('voices: persists user voices and recent users', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('voices.js', 'createVoicesController');

  const controller = factory({ settingsStore });
  controller.setVoiceForUser('alex', 'youtube', 'system-1');
  controller.setVoiceForUser('zara', 'tiktok', 'cloned-zara');
  controller.addRecentUser('youtube:alex', 20);
  controller.addRecentUser('tiktok:zara', 20);
  controller.saveUserVoices();

  const savedVoices = JSON.parse(settingsStore.getItem('user_voices') || '{}');
  const savedRecent = JSON.parse(settingsStore.getItem('recent_users') || '[]');
  assert.equal(savedVoices['youtube:alex'], 'system-1');
  assert.equal(savedVoices['tiktok:zara'], 'cloned-zara');
  assert.deepEqual(savedRecent, ['tiktok:zara', 'youtube:alex']);

  const reloaded = factory({ settingsStore });
  reloaded.loadUserVoices();
  assert.equal(reloaded.getVoiceForUser('alex', 'youtube'), 'system-1');
  assert.equal(reloaded.getVoiceForUser('zara', 'tiktok'), 'cloned-zara');
  assert.deepEqual(Array.from(reloaded.state.recentUsers), ['tiktok:zara', 'youtube:alex']);
});

test('voices: hidden/show filtering persists and affects visible groups', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('voices.js', 'createVoicesController');

  const controller = factory({ settingsStore });
  controller.setSystemVoices([
    { name: 'Aaron', lang: 'en-US' },
    { name: 'Anna', lang: 'de-DE' },
    { name: 'Carlos', lang: 'es-ES' }
  ]);
  controller.setClonedVoices(['elon']);

  controller.hideVoice('system-0');
  controller.hideVoice('cloned-elon');
  controller.saveHiddenVoices();

  const visibleEntries = controller.getAllVoiceEntries({ includeHidden: false, ignoreLanguageFilters: true });
  assert.equal(visibleEntries.some((entry) => entry.id === 'system-0'), false);
  assert.equal(visibleEntries.some((entry) => entry.id === 'cloned-elon'), false);
  assert.equal(visibleEntries.some((entry) => entry.id === 'system-1'), true);

  const reloaded = factory({ settingsStore });
  reloaded.setSystemVoices([
    { name: 'Aaron', lang: 'en-US' },
    { name: 'Anna', lang: 'de-DE' },
    { name: 'Carlos', lang: 'es-ES' }
  ]);
  reloaded.setClonedVoices(['elon']);
  reloaded.loadHiddenVoices();

  assert.equal(reloaded.state.hiddenVoices.has('system-0'), true);
  assert.equal(reloaded.state.hiddenVoices.has('cloned-elon'), true);

  reloaded.showAllVoices();
  const visibleAfterShowAll = reloaded.getAllVoiceEntries({ includeHidden: false, ignoreLanguageFilters: true });
  assert.equal(visibleAfterShowAll.some((entry) => entry.id === 'system-0'), true);
  assert.equal(visibleAfterShowAll.some((entry) => entry.id === 'cloned-elon'), true);
});

test('voices: custom cloned voice languages persist and prune stale entries', async () => {
  const settingsStore = createSettingsStore({
    custom_voice_languages: JSON.stringify({
      elon: 'de',
      staleVoice: 'es',
      trump: 'xx'
    })
  });
  const { factory } = loadControllerFactory('voices.js', 'createVoicesController');

  const controller = factory({ settingsStore });
  controller.setClonedVoices(['elon', 'trump']);

  assert.equal(controller.getCustomVoiceLanguage('elon'), 'de');
  assert.equal(controller.getCustomVoiceLanguage('trump'), 'en');

  controller.setCustomVoiceLanguage('trump', 'fr');
  controller.setCustomVoiceLanguage('elon', 'en');
  controller.saveCustomVoiceLanguages();

  const saved = JSON.parse(settingsStore.getItem('custom_voice_languages') || '{}');
  assert.deepEqual(saved, { trump: 'fr' });

  const reloaded = factory({ settingsStore });
  reloaded.setClonedVoices(['elon', 'trump']);
  assert.equal(reloaded.getCustomVoiceLanguage('elon'), 'en');
  assert.equal(reloaded.getCustomVoiceLanguage('trump'), 'fr');
});

test('voices: auto-assign does not overwrite manual assignments', async () => {
  const settingsStore = createSettingsStore();
  const { factory } = loadControllerFactory('voices.js', 'createVoicesController');

  const controller = factory({ settingsStore });
  controller.setOllamaOnline(true);

  controller.setVoiceForUser('manualUser', 'youtube', 'system-9');
  controller.saveUserVoices();

  const skipped = await controller.autoAssignVoiceIfNeeded('manualUser', 'youtube', {
    autoEnabled: true,
    maleVoiceId: 'system-1',
    femaleVoiceId: 'system-2',
    detectGenderFn: async () => 'male'
  });

  assert.equal(skipped.assigned, false);
  assert.equal(skipped.reason, 'already_assigned');
  assert.equal(controller.getVoiceForUser('manualUser', 'youtube'), 'system-9');

  const assigned = await controller.autoAssignVoiceIfNeeded('newUser', 'youtube', {
    autoEnabled: true,
    maleVoiceId: 'system-1',
    femaleVoiceId: 'system-2',
    detectGenderFn: async () => 'female'
  });

  assert.equal(assigned.assigned, true);
  assert.equal(assigned.gender, 'female');
  assert.equal(controller.getVoiceForUser('newUser', 'youtube'), 'system-2');

  const savedVoices = JSON.parse(settingsStore.getItem('user_voices') || '{}');
  assert.equal(savedVoices['youtube:newUser'], 'system-2');
  assert.equal(savedVoices['youtube:manualUser'], 'system-9');
});

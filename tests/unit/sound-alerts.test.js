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
  return { factory };
}

test('sound alerts: resolves event rules with gift-name priority over any-gift', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const settingsStore = createSettingsStore();
  const controller = factory({ settingsStore });

  controller.state.rules = [
    {
      id: 'r-any',
      eventType: 'gift_any',
      eventValue: '',
      soundPath: '/sounds/any.wav',
      enabled: true
    },
    {
      id: 'r-rose',
      eventType: 'gift_name',
      eventValue: 'Rose',
      soundPath: '/sounds/rose.wav',
      enabled: true
    },
    {
      id: 'r-value',
      eventType: 'gift_value',
      eventValue: '25',
      soundPath: '/sounds/value-25.wav',
      enabled: true
    },
    {
      id: 'r-follow',
      eventType: 'follow',
      eventValue: '',
      soundPath: '/sounds/follow.wav',
      enabled: true
    },
    {
      id: 'r-join',
      eventType: 'join',
      eventValue: '',
      soundPath: '/sounds/join.wav',
      enabled: true
    },
    {
      id: 'r-leave',
      eventType: 'leave',
      eventValue: '',
      soundPath: '/sounds/leave.wav',
      enabled: true
    }
  ];

  assert.equal(
    controller.resolveSoundForEvent({ type: 'gift', giftName: 'Rose' }),
    '/sounds/rose.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'gift', giftName: 'Lion' }),
    '/sounds/any.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'gift', giftName: 'Lion', diamondCount: 25 }),
    '/sounds/value-25.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'gift', giftName: 'Lion', diamondUnitCount: 25, diamondCount: 125 }),
    '/sounds/value-25.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'follow' }),
    '/sounds/follow.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'share' }),
    ''
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'join' }),
    '/sounds/join.wav'
  );
  assert.equal(
    controller.resolveSoundForEvent({ type: 'leave' }),
    '/sounds/leave.wav'
  );
});

test('sound alerts: registerGiftName deduplicates and persists', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const settingsStore = createSettingsStore();
  const controller = factory({ settingsStore });

  const first = controller.registerGiftName('Rose');
  const second = controller.registerGiftName(' rose ');
  const third = controller.registerGiftName('Galaxy');

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(third, true);
  assert.equal(
    JSON.stringify(controller.getKnownGiftNames()),
    JSON.stringify(['Galaxy', 'Rose'])
  );

  const saved = JSON.parse(settingsStore.getItem('tiktok_known_gift_names'));
  assert.deepEqual(saved, ['Galaxy', 'Rose']);
});

test('sound alerts: playSound normalizes legacy custom prefix and volume', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const settingsStore = createSettingsStore();
  const played = [];

  class AudioMock {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      played.push(this);
    }

    play() {
      return Promise.resolve();
    }
  }

  const controller = factory({
    windowRef: { Audio: AudioMock },
    settingsStore,
    callbacks: {
      getVolume: () => 0.42
    }
  });

  const ok = controller.playSound('custom-/sounds/custom/alpha.wav');

  assert.equal(ok, true);
  assert.equal(played.length, 1);
  assert.equal(played[0].src, '/sounds/alpha.wav');
  assert.equal(played[0].volume, 0.42);
});

test('sound alerts: playSound stops active preview before starting a new one', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const settingsStore = createSettingsStore();
  const played = [];

  class AudioMock {
    constructor(src) {
      this.src = src;
      this.volume = 1;
      this.currentTime = 7;
      this.pauseCalls = 0;
      played.push(this);
    }

    play() {
      return Promise.resolve();
    }

    pause() {
      this.pauseCalls += 1;
    }
  }

  const controller = factory({
    windowRef: { Audio: AudioMock },
    settingsStore,
    callbacks: {
      getVolume: () => 0.75
    }
  });

  const first = controller.playSound('/sounds/one.wav');
  const second = controller.playSound('/sounds/two.wav');

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(played.length, 2);
  assert.equal(played[0].pauseCalls, 1);
  assert.equal(played[0].currentTime, 0);
  assert.equal(played[1].src, '/sounds/two.wav');
});

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

function createTimerHarness(startMs = 0) {
  let now = startMs;
  let nextId = 1;
  const timers = new Map();

  function flushDueTimers() {
    let ran = false;
    do {
      ran = false;
      const due = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      due.forEach(([id, timer]) => {
        timers.delete(id);
        timer.cb();
        ran = true;
      });
    } while (ran);
  }

  return {
    nowFn: () => now,
    setTimeoutFn(cb, ms) {
      const id = nextId++;
      timers.set(id, { cb, at: now + Number(ms || 0) });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += Number(ms || 0);
      flushDueTimers();
    },
    getTimerCount() {
      return timers.size;
    }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

test('sound alerts: sound card delete uses inline two-step confirmation', async () => {
  const ElementMock = class {};
  const listeners = new Map();
  const documentListeners = new Map();
  const soundLibraryCards = {
    innerHTML: '',
    addEventListener(type, cb) {
      listeners.set(type, cb);
    }
  };

  const documentRef = {
    addEventListener(type, cb) {
      documentListeners.set(type, cb);
    }
  };

  const deleteCalls = [];
  const { factory } = loadControllerFactory(
    'sound-alerts.js',
    'createSoundAlertsController',
    { Element: ElementMock }
  );

  const controller = factory({
    documentRef,
    settingsStore: createSettingsStore(),
    elements: {
      soundLibraryCards
    },
    fetchFn: async (url, options = {}) => {
      if (url === '/api/sounds/list') {
        return {
          json: async () => ({
            custom: [{ name: 'bluey_bluey!__cartoons.wav', path: '/sounds/bluey_bluey!__cartoons.wav' }]
          })
        };
      }

      deleteCalls.push({ url, method: options.method || 'GET' });
      return {
        ok: true,
        json: async () => ({ success: true })
      };
    }
  });

  await controller.loadCustomSounds();
  controller.init();

  const actionButton = Object.assign(new ElementMock(), {
    attributes: {
      'data-action': 'delete-card-sound',
      'data-sound-path': '/sounds/bluey_bluey!__cartoons.wav',
      title: 'Delete sound'
    },
    classList: {
      values: new Set(),
      add(value) {
        this.values.add(value);
      },
      remove(value) {
        this.values.delete(value);
      },
      contains(value) {
        return this.values.has(value);
      }
    },
    getAttribute(name) {
      return this.attributes[name] || '';
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    closest(selector) {
      if (selector === 'button[data-action]' || selector === '.sound-library-card-delete') {
        return this;
      }
      return null;
    }
  });

  const clickHandler = listeners.get('click');
  assert.equal(typeof clickHandler, 'function');

  clickHandler({ target: actionButton });
  assert.equal(deleteCalls.length, 0);
  assert.equal(actionButton.classList.contains('is-confirming'), true);
  assert.equal(actionButton.getAttribute('title'), 'Click again to delete');

  clickHandler({ target: actionButton });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].url, '/api/sounds/bluey_bluey!__cartoons.wav');
  assert.equal(deleteCalls[0].method, 'DELETE');
  assert.equal(actionButton.classList.contains('is-confirming'), false);
});

test('sound alerts: persists keyword edits and requires enable toggle before exposing entries', async () => {
  const ElementMock = class {};
  const { factory } = loadControllerFactory(
    'sound-alerts.js',
    'createSoundAlertsController',
    { Element: ElementMock }
  );

  const soundLibraryCards = {
    innerHTML: '',
    addEventListener() {}
  };
  const soundSettingsPopup = { style: { display: 'none' } };
  const soundSettingsName = { textContent: '' };
  const soundSettingsKeywords = { value: '' };
  const soundSettingsViewerKeywordEnabled = { checked: false };
  const soundSettingsVoiceKeywordEnabled = { checked: false };

  const settingsStore = createSettingsStore();
  const controller = factory({
    settingsStore,
    elements: {
      soundLibraryCards,
      soundSettingsPopup,
      soundSettingsName,
      soundSettingsKeywords,
      soundSettingsViewerKeywordEnabled,
      soundSettingsVoiceKeywordEnabled
    },
    fetchFn: async (url) => {
      if (url === '/api/sounds/list') {
        return {
          json: async () => ({
            custom: [{ name: 'horn.wav', path: '/sounds/horn.wav' }]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true })
      };
    }
  });

  controller.init();
  await controller.loadCustomSounds();

  controller.openSoundSettings('/sounds/horn.wav');
  assert.equal(soundSettingsPopup.style.display, 'flex');
  assert.equal(soundSettingsName.textContent, 'horn.wav');

  soundSettingsKeywords.value = 'horn, beep\nHorn';

  assert.equal(
    JSON.stringify(controller.getSoundKeywordEntries()),
    JSON.stringify([])
  );

  soundSettingsViewerKeywordEnabled.checked = true;
  soundSettingsVoiceKeywordEnabled.checked = true;
  controller.saveSoundSettings();

  assert.equal(
    JSON.stringify(controller.getSoundKeywordEntries()),
    JSON.stringify([{
      soundPath: '/sounds/horn.wav',
      keywords: ['horn', 'beep'],
      viewerEnabled: true,
      voiceEnabled: true
    }])
  );
  assert.equal(
    JSON.stringify(JSON.parse(settingsStore.getItem('sound_keyword_enabled_map'))),
    JSON.stringify({ '/sounds/horn.wav': true })
  );
  assert.equal(
    JSON.stringify(JSON.parse(settingsStore.getItem('sound_keyword_map'))),
    JSON.stringify({ '/sounds/horn.wav': ['horn', 'beep'] })
  );

  assert.equal(
    JSON.stringify(JSON.parse(settingsStore.getItem('sound_voice_keyword_enabled_map'))),
    JSON.stringify({ '/sounds/horn.wav': true })
  );
  assert.equal(soundSettingsPopup.style.display, 'none');
});

test('sound alerts: bulk keyword toggles manage viewer chat and voice separately', async () => {
  const ElementMock = class {};
  const viewerListeners = new Map();
  const voiceListeners = new Map();
  const settingsStore = createSettingsStore({
    sound_keyword_map: JSON.stringify({
      '/sounds/horn.wav': ['horn'],
      '/sounds/beep.wav': ['beep']
    }),
    sound_keyword_enabled_map: JSON.stringify({
      '/sounds/horn.wav': false,
      '/sounds/beep.wav': true
    }),
    sound_voice_keyword_enabled_map: JSON.stringify({
      '/sounds/horn.wav': true,
      '/sounds/beep.wav': false
    })
  });

  const soundLibraryCards = {
    innerHTML: '',
    addEventListener() {}
  };
  const soundLibraryViewerKeywordToggleBtn = {
    textContent: '',
    disabled: false,
    title: '',
    addEventListener(type, cb) {
      viewerListeners.set(type, cb);
    }
  };
  const soundLibraryVoiceKeywordToggleBtn = {
    textContent: '',
    disabled: false,
    title: '',
    addEventListener(type, cb) {
      voiceListeners.set(type, cb);
    }
  };

  const { factory } = loadControllerFactory(
    'sound-alerts.js',
    'createSoundAlertsController',
    { Element: ElementMock }
  );

  const controller = factory({
    settingsStore,
    elements: {
      soundLibraryCards,
      soundLibraryViewerKeywordToggleBtn,
      soundLibraryVoiceKeywordToggleBtn
    },
    fetchFn: async (url) => {
      if (url === '/api/sounds/list') {
        return {
          json: async () => ({
            custom: [
              { name: 'horn.wav', path: '/sounds/horn.wav' },
              { name: 'beep.wav', path: '/sounds/beep.wav' },
              { name: 'plain.wav', path: '/sounds/plain.wav' }
            ]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true })
      };
    }
  });

  controller.init();
  await controller.loadCustomSounds();

  assert.equal(soundLibraryViewerKeywordToggleBtn.textContent, 'Enable all viewer chat');
  assert.equal(soundLibraryViewerKeywordToggleBtn.disabled, false);
  assert.equal(soundLibraryVoiceKeywordToggleBtn.textContent, 'Enable all voice');
  assert.equal(soundLibraryVoiceKeywordToggleBtn.disabled, false);

  const viewerClickHandler = viewerListeners.get('click');
  const voiceClickHandler = voiceListeners.get('click');
  assert.equal(typeof viewerClickHandler, 'function');
  assert.equal(typeof voiceClickHandler, 'function');

  viewerClickHandler();
  assert.deepEqual(
    JSON.parse(settingsStore.getItem('sound_keyword_enabled_map')),
    {
      '/sounds/horn.wav': true,
      '/sounds/beep.wav': true
    }
  );
  assert.equal(soundLibraryViewerKeywordToggleBtn.textContent, 'Disable all viewer chat');

  voiceClickHandler();
  assert.deepEqual(
    JSON.parse(settingsStore.getItem('sound_voice_keyword_enabled_map')),
    {
      '/sounds/horn.wav': true,
      '/sounds/beep.wav': true
    }
  );
  assert.equal(soundLibraryVoiceKeywordToggleBtn.textContent, 'Disable all voice');

  viewerClickHandler();
  assert.deepEqual(
    JSON.parse(settingsStore.getItem('sound_keyword_enabled_map')),
    {
      '/sounds/horn.wav': false,
      '/sounds/beep.wav': false
    }
  );
  assert.equal(soundLibraryViewerKeywordToggleBtn.textContent, 'Enable all viewer chat');

  voiceClickHandler();
  assert.deepEqual(
    JSON.parse(settingsStore.getItem('sound_voice_keyword_enabled_map')),
    {
      '/sounds/horn.wav': false,
      '/sounds/beep.wav': false
    }
  );
  assert.equal(soundLibraryVoiceKeywordToggleBtn.textContent, 'Enable all voice');
});

test('sound alerts: lifecycle rules support recurring users and minimum stay', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const settingsStore = createSettingsStore();
  const timers = createTimerHarness();
  const playedSounds = [];
  const triggeredAnimations = [];

  class AudioMock {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
    }

    play() {
      playedSounds.push(this.src);
      return Promise.resolve();
    }

    pause() {}
  }

  const controller = factory({
    windowRef: { Audio: AudioMock },
    settingsStore,
    callbacks: {
      resolveAnimationForRule: (rule) => {
        if (rule?.eventType === 'join') return ['join-animation'];
        if (rule?.eventType === 'leave') return ['leave-animation'];
        return [];
      },
      triggerAnimation: (trigger, platform, username, type) => {
        triggeredAnimations.push({ trigger, platform, username, type });
      }
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    nowFn: timers.nowFn
  });

  controller.state.rules = [
    {
      id: 'join-disabled',
      eventType: 'join',
      soundPath: '/sounds/disabled.wav',
      enabled: false,
      recurringOnly: false,
      minStaySeconds: 0
    },
    {
      id: 'join-recurring',
      eventType: 'join',
      soundPath: '/sounds/return.wav',
      enabled: true,
      recurringOnly: true,
      minStaySeconds: 5
    },
    {
      id: 'leave-recurring',
      eventType: 'leave',
      soundPath: '/sounds/bye.wav',
      enabled: true,
      recurringOnly: true,
      minStaySeconds: 5
    }
  ];

  const firstJoin = controller.handleLifecycleEvent({
    type: 'join',
    platform: 'tiktok',
    username: 'alex'
  });
  assert.equal(firstJoin, false);
  assert.equal(timers.getTimerCount(), 0);
  assert.deepEqual(playedSounds, []);
  assert.deepEqual(triggeredAnimations, []);

  timers.advance(6000);
  controller.handleLifecycleEvent({
    type: 'leave',
    platform: 'tiktok',
    username: 'alex'
  });
  assert.deepEqual(playedSounds, []);
  assert.deepEqual(triggeredAnimations, []);

  controller.handleLifecycleEvent({
    type: 'join',
    platform: 'tiktok',
    username: 'alex'
  });
  assert.equal(timers.getTimerCount(), 1);
  assert.deepEqual(playedSounds, []);
  assert.deepEqual(triggeredAnimations, []);

  timers.advance(4000);
  assert.deepEqual(playedSounds, []);
  assert.deepEqual(triggeredAnimations, []);

  timers.advance(1000);
  assert.deepEqual(playedSounds, ['/sounds/return.wav']);
  assert.deepEqual(triggeredAnimations, [{
    trigger: 'join-animation',
    platform: 'tiktok',
    username: 'alex',
    type: 'join'
  }]);

  timers.advance(2000);
  controller.handleLifecycleEvent({
    type: 'leave',
    platform: 'tiktok',
    username: 'alex'
  });
  assert.deepEqual(playedSounds, ['/sounds/return.wav', '/sounds/bye.wav']);
  assert.deepEqual(triggeredAnimations, [
    {
      trigger: 'join-animation',
      platform: 'tiktok',
      username: 'alex',
      type: 'join'
    },
    {
      trigger: 'leave-animation',
      platform: 'tiktok',
      username: 'alex',
      type: 'leave'
    }
  ]);
});

test('sound alerts: clearing presence state cancels pending delayed join alerts', async () => {
  const { factory } = loadControllerFactory('sound-alerts.js', 'createSoundAlertsController');
  const timers = createTimerHarness();
  const playedSounds = [];

  class AudioMock {
    constructor(src) {
      this.src = src;
    }

    play() {
      playedSounds.push(this.src);
      return Promise.resolve();
    }

    pause() {}
  }

  const controller = factory({
    windowRef: { Audio: AudioMock },
    settingsStore: createSettingsStore({
      presence_visitor_history: JSON.stringify({
        'tiktok:alex': { visits: 1, lastSeen: 1 }
      })
    }),
    callbacks: {
      resolveAnimationForRule: () => ['join-animation'],
      triggerAnimation: () => {}
    },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    nowFn: timers.nowFn
  });

  controller.loadVisitorHistory();
  controller.state.rules = [{
    id: 'join-recurring',
    eventType: 'join',
    soundPath: '/sounds/return.wav',
    enabled: true,
    recurringOnly: true,
    minStaySeconds: 10
  }];

  controller.handleLifecycleEvent({
    type: 'join',
    platform: 'tiktok',
    username: 'alex'
  });
  assert.equal(timers.getTimerCount(), 1);

  controller.clearPresenceState('tiktok');
  assert.equal(timers.getTimerCount(), 0);

  timers.advance(15000);
  assert.deepEqual(playedSounds, []);
});

test('sound alerts: persisted keyword generation job resumes on init and updates button progress', async () => {
  const ElementMock = class {};
  const deferred = createDeferred();
  const soundLibraryCards = {
    innerHTML: '',
    addEventListener() {}
  };
  const soundLibraryGenerateBtn = {
    textContent: '',
    disabled: false,
    addEventListener() {}
  };

  const settingsStore = createSettingsStore({
    sound_keyword_generation_job: JSON.stringify({
      pendingItems: [
        { soundPath: '/sounds/a.wav' },
        { soundPath: '/sounds/b.wav' }
      ],
      total: 2
    })
  });

  const { factory } = loadControllerFactory(
    'sound-alerts.js',
    'createSoundAlertsController',
    { Element: ElementMock }
  );

  let generatePayload = null;
  const controller = factory({
    settingsStore,
    elements: {
      soundLibraryCards,
      soundLibraryGenerateBtn
    },
    fetchFn: async (url, options = {}) => {
      if (url === '/api/sounds/list') {
        return {
          json: async () => ({
            custom: [
              { name: 'a.wav', path: '/sounds/a.wav' },
              { name: 'b.wav', path: '/sounds/b.wav' }
            ]
          })
        };
      }

      if (url === '/api/media-keywords/generate') {
        generatePayload = JSON.parse(options.body || '{}');
        return deferred.promise;
      }

      return {
        ok: true,
        json: async () => ({ success: true })
      };
    }
  });

  controller.init();
  assert.equal(soundLibraryGenerateBtn.textContent, 'Resume 0/2');

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(soundLibraryGenerateBtn.textContent, 'Generating 0/2');
  assert.equal(soundLibraryGenerateBtn.disabled, true);
  assert.deepEqual(generatePayload, {
    items: [
      { kind: 'sound', soundPath: '/sounds/a.wav' },
      { kind: 'sound', soundPath: '/sounds/b.wav' }
    ]
  });

  deferred.resolve({
    ok: true,
    json: async () => ({
      success: true,
      results: [
        { soundPath: '/sounds/a.wav', keywords: ['alpha'] },
        { soundPath: '/sounds/b.wav', keywords: ['beta'] }
      ]
    })
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(soundLibraryGenerateBtn.textContent, '✨ Suggest Missing');
  assert.equal(soundLibraryGenerateBtn.disabled, false);
  assert.equal(settingsStore.getItem('sound_keyword_generation_job'), null);
  assert.deepEqual(
    JSON.parse(settingsStore.getItem('sound_keyword_map')),
    {
      '/sounds/a.wav': ['alpha'],
      '/sounds/b.wav': ['beta']
    }
  );
});

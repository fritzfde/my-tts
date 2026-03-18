const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function createFakeDocument(cards = []) {
  return {
    createElement() {
      const listeners = {};
      return {
        dataset: {},
        duration: NaN,
        preload: '',
        muted: false,
        playsInline: true,
        src: '',
        addEventListener(event, handler) {
          listeners[event] = handler;
        },
        removeEventListener(event) {
          delete listeners[event];
        },
        removeAttribute(name) {
          if (name === 'src') this.src = '';
        },
        load() {}
      };
    },
    querySelectorAll(selector) {
      if (selector === '.animation-mapping-card[data-animation-trigger]') {
        return cards;
      }
      return [];
    }
  };
}

function createFloatingPreviewElements() {
  const buttonListeners = new Map();
  const settingsListeners = new Map();
  const videoListeners = new Map();
  return {
    container: {
      hidden: true,
      dataset: {},
      classList: {
        add() {},
        remove() {}
      }
    },
    button: {
      disabled: true,
      dataset: {},
      title: '',
      addEventListener(event, handler) {
        buttonListeners.set(event, handler);
      },
      trigger(event) {
        const handler = buttonListeners.get(event);
        if (handler) {
          return handler({
            preventDefault() {}
          });
        }
        return undefined;
      }
    },
    settingsButton: {
      disabled: true,
      addEventListener(event, handler) {
        settingsListeners.set(event, handler);
      },
      trigger(event) {
        const handler = settingsListeners.get(event);
        if (handler) {
          return handler({
            preventDefault() {},
            stopPropagation() {}
          });
        }
        return undefined;
      }
    },
    video: {
      dataset: {},
      src: '',
      paused: true,
      muted: true,
      loop: true,
      addEventListener(event, handler) {
        videoListeners.set(event, handler);
      },
      trigger(event) {
        const handler = videoListeners.get(event);
        if (handler) handler();
      },
      setAttribute(name, value) {
        if (name === 'src') {
          this.src = value;
        }
      },
      load() {},
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      },
      currentTime: 0
    },
    label: {
      textContent: ''
    },
    name: {
      textContent: ''
    },
    countdown: {
      textContent: ''
    }
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console: {
      log() {},
      info() {},
      warn() {},
      error() {},
      debug() {}
    },
    window: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    alert: () => {}
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

test('animation playback: countdown formatting', async () => {
  const { factory } = loadControllerFactory('animation-playback.js', 'createAnimationPlaybackController');
  const stopButton = { disabled: true };
  const controller = factory({
    documentRef: createFakeDocument([]),
    fetchFn: async () => ({ ok: true, json: async () => ({}) }),
    getAnimationFileUrl: (name) => `/animations/${name}`,
    getAnimationMappingByTrigger: () => null,
    getAnimationFileFromMapping: () => '',
    isThumbnailInteractionActive: () => false,
    playAnimationThumbnail: () => {},
    stopAnimationThumbnail: () => {},
    stopButton,
    tickMs: 50
  });

  assert.equal(controller.formatAnimationPlaybackCountdown(9500), '9.5s');
  assert.equal(controller.formatAnimationPlaybackCountdown(12800), '13s');
  assert.equal(controller.formatAnimationPlaybackCountdown(65000), '1:05');
});

test('animation playback: mark/clear updates active state and stop button', async () => {
  const { factory } = loadControllerFactory('animation-playback.js', 'createAnimationPlaybackController');
  const stopButton = { disabled: true };

  const controller = factory({
    documentRef: createFakeDocument([]),
    fetchFn: async () => ({ ok: true, json: async () => ({ clients: 1, obsClients: 1 }) }),
    getAnimationFileUrl: (name) => `/animations/${name}`,
    getAnimationMappingByTrigger: (trigger) => (trigger === 'alpha' ? { file: 'a.mov' } : null),
    getAnimationFileFromMapping: (mapping) => mapping.file,
    isThumbnailInteractionActive: () => false,
    playAnimationThumbnail: () => {},
    stopAnimationThumbnail: () => {},
    stopButton,
    tickMs: 50
  });

  controller.cacheAnimationDuration('a.mov', 2);
  const token = controller.markAnimationCardPlaying('alpha');
  assert.ok(Number.isFinite(token));
  assert.equal(controller.state.activePlayback.size, 1);
  assert.equal(stopButton.disabled, false);

  controller.clearAnimationCardPlaybackIfMatches('alpha', token);
  assert.equal(controller.state.activePlayback.size, 0);
  assert.equal(stopButton.disabled, true);

  controller.setAnimationCardPlaybackState('alpha', 'a.mov', 2, Date.now());
  assert.equal(controller.state.activePlayback.size, 1);
  controller.clearAnimationCardPlaybackIfMatches('alpha');
  assert.equal(controller.state.activePlayback.size, 0);
  assert.equal(stopButton.disabled, true);
});

test('animation playback: floating preview mirrors active playback and stops on click', async () => {
  const { factory } = loadControllerFactory('animation-playback.js', 'createAnimationPlaybackController');
  const stopButton = { disabled: true };
  const floating = createFloatingPreviewElements();
  const openedSettings = [];

  const controller = factory({
    documentRef: createFakeDocument([]),
    fetchFn: async () => ({ ok: true, json: async () => ({ clients: 1, obsClients: 1 }) }),
    getAnimationFileUrl: (name) => `/animations/${name}`,
    getAnimationMappingByTrigger: (trigger) => (trigger === 'alpha' ? { file: 'a.mov' } : null),
    getAnimationFileFromMapping: (mapping) => mapping.file,
    isThumbnailInteractionActive: () => false,
    playAnimationThumbnail: () => {},
    stopAnimationThumbnail: () => {},
    stopButton,
    floatingPreviewContainer: floating.container,
    floatingPreviewButton: floating.button,
    floatingPreviewSettingsButton: floating.settingsButton,
    floatingPreviewVideo: floating.video,
    floatingPreviewLabel: floating.label,
    floatingPreviewName: floating.name,
    floatingPreviewCountdown: floating.countdown,
    onOpenFloatingSettings: (trigger, filename) => openedSettings.push({ trigger, filename }),
    tickMs: 50
  });

  controller.cacheAnimationDuration('a.mov', 2);
  controller.markAnimationCardPlaying('alpha');

  assert.equal(floating.container.hidden, false);
  assert.equal(floating.label.textContent, 'Playing now');
  assert.equal(floating.button.disabled, false);
  assert.equal(floating.settingsButton.disabled, false);
  assert.equal(floating.name.textContent, 'alpha');
  assert.equal(floating.video.src, '/animations/a.mov');
  assert.match(floating.countdown.textContent, /s$/);

  floating.settingsButton.trigger('click');
  assert.deepEqual(openedSettings, [{ trigger: 'alpha', filename: 'a.mov' }]);

  await floating.button.trigger('click');

  assert.equal(controller.state.activePlayback.size, 0);
  assert.equal(floating.container.hidden, true);
  assert.equal(stopButton.disabled, true);
  assert.equal(floating.settingsButton.disabled, true);
});

test('animation playback: shared floating preview plays locally and stops without live stop request', async () => {
  const { factory } = loadControllerFactory('animation-playback.js', 'createAnimationPlaybackController');
  const stopButton = { disabled: true };
  const floating = createFloatingPreviewElements();
  let stopEndpointCalls = 0;

  const controller = factory({
    documentRef: createFakeDocument([]),
    fetchFn: async () => {
      stopEndpointCalls += 1;
      return { ok: true, json: async () => ({ clients: 1, obsClients: 1 }) };
    },
    getAnimationFileUrl: (name) => `/animations/${name}`,
    getAnimationMappingByTrigger: (trigger) => (trigger === 'alpha' ? { file: 'a.mov' } : null),
    getAnimationFileFromMapping: (mapping) => mapping.file,
    isThumbnailInteractionActive: () => false,
    playAnimationThumbnail: () => {},
    stopAnimationThumbnail: () => {},
    stopButton,
    floatingPreviewContainer: floating.container,
    floatingPreviewButton: floating.button,
    floatingPreviewSettingsButton: floating.settingsButton,
    floatingPreviewVideo: floating.video,
    floatingPreviewLabel: floating.label,
    floatingPreviewName: floating.name,
    floatingPreviewCountdown: floating.countdown,
    tickMs: 50
  });

  controller.cacheAnimationDuration('a.mov', 3);
  const started = controller.startFloatingPreview('alpha', 'a.mov');

  assert.equal(started, true);
  assert.equal(floating.container.hidden, false);
  assert.equal(floating.label.textContent, 'Preview');
  assert.equal(floating.video.src, '/animations/a.mov');
  assert.equal(floating.video.muted, false);
  assert.equal(floating.video.loop, false);
  assert.match(floating.countdown.textContent, /s$/);

  await floating.button.trigger('click');

  assert.equal(controller.getCurrentPreviewPlayback(), null);
  assert.equal(floating.container.hidden, true);
  assert.equal(stopEndpointCalls, 0);
});

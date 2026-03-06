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

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
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

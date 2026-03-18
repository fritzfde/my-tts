const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

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
  return { factory };
}

function createDocumentStub() {
  const listeners = new Map();
  const appended = [];
  return {
    hidden: false,
    body: {
      appendChild(node) {
        appended.push(node);
      }
    },
    createElement() {
      return {
        style: {},
        textContent: '',
        removed: false,
        remove() {
          this.removed = true;
        }
      };
    },
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    },
    _appended() {
      return appended;
    }
  };
}

test('audio runtime: request/release wake lock and visibility reacquire', async () => {
  const { factory } = loadControllerFactory('audio-runtime.js', 'createAudioRuntimeController');
  const doc = createDocumentStub();

  let requestCount = 0;
  let released = false;
  const controller = factory({
    windowRef: {
      addEventListener: () => {},
      Audio: class {
        play() {
          return Promise.resolve();
        }
      }
    },
    documentRef: doc,
    navigatorRef: {
      wakeLock: {
        request: async () => {
          requestCount += 1;
          return {
            addEventListener: () => {},
            release: async () => {
              released = true;
            }
          };
        }
      }
    },
    getShouldRequestWakeLock: () => true
  });

  await controller.requestWakeLock();
  assert.equal(controller.hasWakeLock(), true);
  await controller.releaseWakeLock();
  assert.equal(released, true);
  assert.equal(controller.hasWakeLock(), false);

  controller.init();
  doc.hidden = false;
  doc.trigger('visibilitychange');
  assert.equal(requestCount, 2);
});

test('audio runtime: unlockAudio sets unlocked state and resumes audio context', async () => {
  const { factory } = loadControllerFactory('audio-runtime.js', 'createAudioRuntimeController');
  let resumeCount = 0;

  class AudioContextMock {
    constructor() {
      this.state = 'suspended';
    }
    resume() {
      resumeCount += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  }

  const windowRef = {
    AudioContext: AudioContextMock,
    Audio: class {
      constructor() {
        this.src = '';
        this.volume = 0;
      }
      play() {
        return Promise.resolve();
      }
    }
  };

  const controller = factory({
    windowRef,
    documentRef: createDocumentStub()
  });

  const unlocked = await controller.unlockAudio();
  assert.equal(unlocked, true);
  assert.equal(controller.isAudioUnlocked(), true);
  assert.equal(resumeCount, 1);
});

test('audio runtime: init does not show unlock notice on load, but manual prompt does', async () => {
  const { factory } = loadControllerFactory('audio-runtime.js', 'createAudioRuntimeController');
  const doc = createDocumentStub();
  const loadListeners = new Map();

  const controller = factory({
    windowRef: {
      addEventListener(event, handler) {
        loadListeners.set(event, handler);
      },
      Audio: class {
        play() {
          return Promise.reject(new Error('blocked'));
        }
      }
    },
    documentRef: doc,
    setTimeoutFn: (handler) => {
      handler();
      return 1;
    },
    clearTimeoutFn: () => {}
  });

  controller.init();
  loadListeners.get('load')?.();

  assert.equal(doc._appended().length, 0);

  controller.showUnlockNotice('Unlock audio');
  assert.equal(doc._appended().length, 1);
  assert.equal(doc._appended()[0].textContent, 'Unlock audio');
});

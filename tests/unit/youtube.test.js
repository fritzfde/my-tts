const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

function loadControllerFactory(fileName, factoryName, extraContext = {}) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: { settingsStore: { removeItem: () => {} } },
    setTimeout,
    clearTimeout,
    ...extraContext
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory, context };
}

function createController(fetchFn, {
  getApiKeyCount = () => 2,
  getNextApiKey = () => 'key-1',
  rotateToNextKey = () => true
} = {}) {
  const { factory } = loadControllerFactory('youtube.js', 'createYouTubeController', {
    fetch: fetchFn
  });

  return factory({
    elements: {
      streamUrlInput: { value: '' },
      channelUrlInput: { value: '' },
      apiKeyTextInput: { focus: () => {} },
      findStreamBtn: { addEventListener: () => {}, disabled: false, textContent: '' },
      connectYouTubeBtn: { addEventListener: () => {}, disabled: false },
      disconnectYouTubeBtn: { addEventListener: () => {}, disabled: true }
    },
    getNextApiKey,
    rotateToNextKey,
    getApiKeyCount,
    saveSettings: () => {},
    updateStatus: () => {},
    addChatMessage: () => {},
    clearOnlineUsers: () => {},
    requestWakeLock: () => {},
    releaseWakeLockIfIdle: () => {},
    getUserDisplayName: (username) => username,
    rememberUserProfile: () => {},
    onlineUsers: { youtube: new Map() },
    renderOnlineUsers: () => {},
    autoAssignVoiceIfNeeded: async () => {},
    speakText: () => {},
    youtubeOnlineUserTtlMs: 120000
  });
}

test('youtube: getLiveChatId rotates on keyInvalid and succeeds with next key', async () => {
  const urls = [];
  let currentKeyIndex = 0;
  const keys = ['key-1', 'key-2'];
  let rotateCalls = 0;

  const fetchFn = async (url) => {
    urls.push(String(url));

    if (urls.length === 1) {
      return {
        ok: false,
        status: 400,
        async json() {
          return {
            error: {
              message: 'API key not valid. Please pass a valid API key.',
              errors: [{ reason: 'keyInvalid' }]
            }
          };
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-abc' } }]
        };
      }
    };
  };

  const controller = createController(fetchFn, {
    getApiKeyCount: () => keys.length,
    getNextApiKey: () => keys[currentKeyIndex],
    rotateToNextKey: () => {
      rotateCalls += 1;
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;
      return true;
    }
  });

  const liveChatId = await controller.getLiveChatId('video-123', keys[0]);
  assert.equal(liveChatId, 'chat-abc');
  assert.equal(rotateCalls, 1);
  assert.match(urls[0], /key=key-1/);
  assert.match(urls[1], /key=key-2/);
});

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
    _dump() {
      return Object.fromEntries(store.entries());
    }
  };
}

function createInput(initial = '') {
  const listeners = new Map();
  return {
    value: initial,
    addEventListener(type, cb) {
      listeners.set(type, cb);
    },
    trigger(type) {
      const handler = listeners.get(type);
      if (handler) handler();
    }
  };
}

function loadControllerFactory(fileName, factoryName) {
  const source = fs.readFileSync(`${ROOT}/${fileName}`, 'utf8');
  const context = vm.createContext({
    console,
    window: {}
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

test('dashboard settings: loadSettings hydrates fields and api keys', async () => {
  const { factory } = loadControllerFactory('dashboard-settings.js', 'createDashboardSettingsController');
  const settingsStore = createSettingsStore({
    yt_tts_api_keys: '["k1","k2"]',
    yt_tts_channel_url: 'https://youtube.com/@abc',
    yt_tts_stream_url: 'https://youtube.com/watch?v=123',
    tiktok_username_cache: 'live_user',
    yt_tts_test_message: 'hello test',
    yt_tts_volume: '77',
    sound_alerts_volume: '33',
    yt_tts_startup_backlog_count: '5'
  });

  const channelUrlInput = createInput();
  const streamUrlInput = createInput();
  const tiktokUsernameInput = createInput();
  const testMessageInput = createInput();
  const voicePreviewTextInput = createInput();
  const volumeSlider = createInput('100');
  const volumeValue = { textContent: '' };
  const soundAlertsVolumeSlider = createInput('100');
  const soundAlertsVolumeValue = { textContent: '' };
  const youtubeStartupBacklogInput = createInput('0');
  const youtubeStartupBacklogLabel = { textContent: '' };
  const youtubeStartupBacklogDownBtn = createInput();
  const youtubeStartupBacklogUpBtn = createInput();

  let receivedApiKeys = [];
  let renderCount = 0;

  const controller = factory({
    settingsStore,
    elements: {
      channelUrlInput,
      streamUrlInput,
      tiktokUsernameInput,
      testMessageInput,
      voicePreviewTextInput,
      volumeSlider,
      volumeValue,
      soundAlertsVolumeSlider,
      soundAlertsVolumeValue,
      youtubeStartupBacklogInput,
      youtubeStartupBacklogLabel,
      youtubeStartupBacklogDownBtn,
      youtubeStartupBacklogUpBtn
    },
    defaults: {
      defaultApiKeys: ['fallback'],
      defaultChannelUrl: 'https://youtube.com/@fallback',
      defaultYouTubeStartupBacklog: '0',
      defaultTestMessage: 'fallback text',
      defaultVolume: '100',
      defaultSoundAlertsVolume: '100'
    },
    callbacks: {
      setApiKeys: (keys) => {
        receivedApiKeys = keys;
      },
      renderApiKeyTags: () => {
        renderCount += 1;
      }
    }
  });

  controller.loadSettings();
  assert.equal(JSON.stringify(receivedApiKeys), JSON.stringify(['k1', 'k2']));
  assert.equal(renderCount, 1);
  assert.equal(channelUrlInput.value, 'https://youtube.com/@abc');
  assert.equal(streamUrlInput.value, 'https://youtube.com/watch?v=123');
  assert.equal(tiktokUsernameInput.value, 'live_user');
  assert.equal(testMessageInput.value, 'hello test');
  assert.equal(voicePreviewTextInput.value, 'hello test');
  assert.equal(volumeSlider.value, '77');
  assert.equal(volumeValue.textContent, '77%');
  assert.equal(soundAlertsVolumeSlider.value, '33');
  assert.equal(soundAlertsVolumeValue.textContent, '33%');
  assert.equal(youtubeStartupBacklogInput.value, '5');
  assert.equal(youtubeStartupBacklogLabel.textContent, 'Play last 5 chat messages on reload (YouTube + TikTok)');
});

test('dashboard settings: init binds persistence for settings inputs', async () => {
  const { factory } = loadControllerFactory('dashboard-settings.js', 'createDashboardSettingsController');
  const settingsStore = createSettingsStore();

  const channelUrlInput = createInput('https://youtube.com/@new');
  const streamUrlInput = createInput('https://youtube.com/watch?v=xyz');
  const testMessageInput = createInput('new message');
  const voicePreviewTextInput = createInput('old preview');
  const volumeSlider = createInput('64');
  const volumeValue = { textContent: '' };
  const soundAlertsVolumeSlider = createInput('55');
  const soundAlertsVolumeValue = { textContent: '' };
  const youtubeStartupBacklogInput = createInput('42');
  const youtubeStartupBacklogLabel = { textContent: '' };
  const youtubeStartupBacklogDownBtn = createInput();
  const youtubeStartupBacklogUpBtn = createInput();

  const controller = factory({
    settingsStore,
    elements: {
      channelUrlInput,
      streamUrlInput,
      testMessageInput,
      voicePreviewTextInput,
      volumeSlider,
      volumeValue,
      soundAlertsVolumeSlider,
      soundAlertsVolumeValue,
      youtubeStartupBacklogInput,
      youtubeStartupBacklogLabel,
      youtubeStartupBacklogDownBtn,
      youtubeStartupBacklogUpBtn
    },
    callbacks: {
      getApiKeys: () => ['kA', 'kB']
    }
  });

  controller.init();
  channelUrlInput.trigger('change');
  streamUrlInput.trigger('change');
  volumeSlider.trigger('input');
  soundAlertsVolumeSlider.trigger('input');
  testMessageInput.trigger('input');
  youtubeStartupBacklogInput.trigger('input');
  youtubeStartupBacklogDownBtn.trigger('click');
  youtubeStartupBacklogUpBtn.trigger('click');

  const saved = settingsStore._dump();
  assert.equal(saved.yt_tts_api_keys, '["kA","kB"]');
  assert.equal(saved.yt_tts_channel_url, 'https://youtube.com/@new');
  assert.equal(saved.yt_tts_stream_url, 'https://youtube.com/watch?v=xyz');
  assert.equal(saved.yt_tts_volume, '64');
  assert.equal(saved.sound_alerts_volume, '55');
  assert.equal(saved.yt_tts_startup_backlog_count, '20');
  assert.equal(saved.yt_tts_test_message, 'new message');
  assert.equal(voicePreviewTextInput.value, 'new message');
  assert.equal(volumeValue.textContent, '64%');
  assert.equal(soundAlertsVolumeValue.textContent, '55%');
  assert.equal(youtubeStartupBacklogInput.value, '20');
  assert.equal(youtubeStartupBacklogLabel.textContent, 'Play last 20 chat messages on reload (YouTube + TikTok)');
});

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
    setInterval,
    clearInterval
  });

  vm.runInContext(source, context, { filename: fileName });
  const factory = context.window[factoryName];
  assert.equal(typeof factory, 'function', `${factoryName} should be exposed on window`);
  return { factory };
}

test('startup orchestrator: init loads data, schedules loops, and auto-connects', async () => {
  const { factory } = loadControllerFactory('startup-orchestrator.js', 'createStartupOrchestratorController');

  let loadSettingsCount = 0;
  let loadUserVoicesCount = 0;
  let renderOnlineUsersCount = 0;
  let refreshAudienceCount = 0;
  let ytAutoConnectCount = 0;
  let ttAutoConnectCount = 0;

  const intervals = [];
  let timeoutCallback = null;
  const clearedIntervals = [];

  const tiktokController = {
    async refreshAudience() {
      refreshAudienceCount += 1;
    },
    async autoConnectFromSaved() {
      ttAutoConnectCount += 1;
    }
  };
  const youtubeController = {
    async autoConnectFromSaved() {
      ytAutoConnectCount += 1;
    }
  };

  const controller = factory({
    callbacks: {
      loadSettings: () => {
        loadSettingsCount += 1;
      },
      loadUserVoices: () => {
        loadUserVoicesCount += 1;
      },
      renderOnlineUsers: () => {
        renderOnlineUsersCount += 1;
      },
      isTikTokConnected: () => true,
      getTikTokController: () => tiktokController,
      getYouTubeController: () => youtubeController
    },
    setIntervalFn: (cb, ms) => {
      const id = intervals.length + 1;
      intervals.push({ id, cb, ms });
      return id;
    },
    setTimeoutFn: (cb) => {
      timeoutCallback = cb;
      return 99;
    },
    clearIntervalFn: (id) => {
      clearedIntervals.push(id);
    },
    refreshOnlineUsersMs: 15000,
    refreshAudienceMs: 4000,
    autoConnectDelayMs: 1500
  });

  controller.init();

  assert.equal(loadSettingsCount, 1);
  assert.equal(loadUserVoicesCount, 1);
  assert.equal(renderOnlineUsersCount, 1);
  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].ms, 15000);
  assert.equal(intervals[1].ms, 4000);

  intervals[0].cb();
  intervals[1].cb();
  await Promise.resolve();

  assert.equal(renderOnlineUsersCount, 2);
  assert.equal(refreshAudienceCount, 1);

  await timeoutCallback();
  assert.equal(ytAutoConnectCount, 1);
  assert.equal(ttAutoConnectCount, 1);

  controller.dispose();
  assert.deepEqual(clearedIntervals, [1, 2]);
});


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

function createClassList() {
  const classes = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => classes.add(token)),
    remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
    has: (token) => classes.has(token)
  };
}

test('chat ui: updateStatus toggles status classes and message text', async () => {
  const { factory } = loadControllerFactory('chat-ui.js', 'createChatUiController');
  const statusText = { textContent: '' };
  const statusDiv = {
    classList: createClassList(),
    querySelector: (selector) => (selector === 'span' ? statusText : null)
  };

  const controller = factory({
    elements: {
      statusDiv,
      chatFeed: null
    }
  });

  controller.updateStatus('Connected', true, false);
  assert.equal(statusText.textContent, 'Connected');
  assert.equal(statusDiv.classList.has('active'), true);
  assert.equal(statusDiv.classList.has('error'), false);

  controller.updateStatus('Failed', false, true);
  assert.equal(statusText.textContent, 'Failed');
  assert.equal(statusDiv.classList.has('active'), false);
  assert.equal(statusDiv.classList.has('error'), true);
});

test('chat ui: addChatMessage renders user message and tracks presence', async () => {
  const { factory } = loadControllerFactory('chat-ui.js', 'createChatUiController');
  const removed = { called: false };
  const appended = [];
  const recentUsers = [];
  const presenceMarks = [];

  const chatFeed = {
    scrollTop: 0,
    scrollHeight: 111,
    querySelector: (selector) => (selector === '.empty-state' ? { remove: () => { removed.called = true; } } : null),
    appendChild: (node) => {
      appended.push(node);
    }
  };

  const documentRef = {
    createElement: () => ({
      className: '',
      innerHTML: '',
      classList: {
        remove: () => {}
      },
      querySelector: () => null
    })
  };

  const controller = factory({
    documentRef,
    elements: {
      statusDiv: null,
      chatFeed
    },
    callbacks: {
      getUserDisplayName: () => 'Alex Display',
      rememberUserDisplayName: () => {},
      getUserAvatar: () => '/avatar.png',
      addRecentUser: (userKey) => recentUsers.push(userKey),
      markUserOnline: (username, platform, payload) => presenceMarks.push({ username, platform, payload }),
      escapeAttribute: (value) => String(value ?? '')
    },
    setTimeoutFn: (cb) => {
      cb();
      return 1;
    }
  });

  controller.addChatMessage('alex', 'hello', 'youtube', true, '', false);

  assert.equal(removed.called, true);
  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /platform-badge youtube/);
  assert.match(appended[0].innerHTML, /Alex Display/);
  assert.match(appended[0].innerHTML, /chat-text/);
  assert.equal(chatFeed.scrollTop, 111);
  assert.deepEqual(recentUsers, ['youtube:alex']);
  assert.equal(presenceMarks.length, 1);
  assert.equal(presenceMarks[0].username, 'alex');
  assert.equal(presenceMarks[0].platform, 'youtube');
});

test('chat ui: replay button triggers callback with message payload', async () => {
  const { factory } = loadControllerFactory('chat-ui.js', 'createChatUiController');
  const appended = [];
  let replayHandler = null;
  const replayCalls = [];

  const replayButton = {
    addEventListener(type, cb) {
      if (type === 'click') replayHandler = cb;
    }
  };

  const chatFeed = {
    scrollTop: 0,
    scrollHeight: 55,
    querySelector: () => null,
    appendChild: (node) => appended.push(node)
  };

  const documentRef = {
    createElement: () => ({
      className: '',
      innerHTML: '',
      classList: {
        remove: () => {}
      },
      querySelector: (selector) => (selector === '.chat-replay-btn' ? replayButton : null)
    })
  };

  const controller = factory({
    documentRef,
    elements: {
      statusDiv: null,
      chatFeed
    },
    callbacks: {
      getUserDisplayName: () => 'Alex',
      rememberUserDisplayName: () => {},
      getUserAvatar: () => null,
      addRecentUser: () => {},
      markUserOnline: () => {},
      escapeAttribute: (value) => String(value ?? ''),
      replayMessage: (payload) => replayCalls.push(payload)
    }
  });

  controller.addChatMessage('alex', 'hello world', 'youtube', false, '', false);
  assert.equal(appended.length, 1);
  assert.match(appended[0].innerHTML, /chat-replay-btn/);
  assert.equal(typeof replayHandler, 'function');

  replayHandler({
    preventDefault: () => {},
    stopPropagation: () => {}
  });

  assert.equal(replayCalls.length, 1);
  assert.equal(replayCalls[0].author, 'alex');
  assert.equal(replayCalls[0].platform, 'youtube');
  assert.equal(replayCalls[0].text, 'hello world');
});

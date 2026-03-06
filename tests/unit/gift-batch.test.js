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
  return { factory, context };
}

test('gift batch: add + announce emits expected thank-you message', async () => {
  const { factory } = loadControllerFactory('gift-batch.js', 'createGiftBatchController');

  const chatEvents = [];
  const ttsEvents = [];
  const controller = factory({
    addChatMessage: (...args) => chatEvents.push(args),
    speakText: (...args) => ttsEvents.push(args)
  });

  controller.addGiftToBatch('Rose', 'alex');
  controller.announceGiftBatch();

  assert.equal(chatEvents.length, 1);
  assert.equal(chatEvents[0][1], 'Hey alex, thank you for the Rose!');
  assert.equal(ttsEvents.length, 1);
  assert.equal(ttsEvents[0][1], 'Hey alex, thank you for the Rose!');
  assert.equal(controller.state.giftBatch.size, 0);
});

test('gift batch: timer is reset on subsequent gifts and multi-user message is generated', async () => {
  const { factory } = loadControllerFactory('gift-batch.js', 'createGiftBatchController');

  let timerId = 0;
  const scheduled = [];
  const cleared = [];
  const chatEvents = [];

  const controller = factory({
    setTimeoutFn: (cb, ms) => {
      timerId += 1;
      scheduled.push({ id: timerId, cb, ms });
      return timerId;
    },
    clearTimeoutFn: (id) => {
      cleared.push(id);
    },
    addChatMessage: (...args) => chatEvents.push(args),
    speakText: () => {}
  });

  controller.addGiftToBatch('Rose', 'alex');
  controller.addGiftToBatch('Rose', 'maria');

  assert.equal(scheduled.length, 2);
  assert.deepEqual(cleared, [1]);

  // Trigger latest timer callback manually
  scheduled[1].cb();

  assert.equal(chatEvents.length, 1);
  assert.equal(chatEvents[0][1], 'Hey alex and maria, thank you for the Rose gifts!');
  assert.equal(controller.state.giftBatch.size, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = '/Users/alex/Projects/my-tts/apps/web/assets/js';

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

test('keyword triggers: parses keyword lists, respects enable flags, and round-robins matches', async () => {
  const { factory } = loadControllerFactory('keyword-triggers.js', 'createKeywordTriggersController');
  const triggered = [];
  const played = [];

  const controller = factory({
    callbacks: {
      getAnimationMappings: () => ({
        dance: { keywords: ['dance party', 'boogie'], keywordTriggerEnabled: true },
        zebra: { keywords: ['dance party'], keywordTriggerEnabled: true },
        hidden: { keywords: ['dance party'], keywordTriggerEnabled: false }
      }),
      getSoundKeywordEntries: () => ([
        { soundPath: '/sounds/horn.wav', keywords: ['horn', 'beep beep'], enabled: true },
        { soundPath: '/sounds/zhorn.wav', keywords: ['beep beep'], enabled: true }
      ]),
      canTriggerAnimation: () => true,
      triggerAnimation: (...args) => triggered.push(args),
      playSound: (path) => played.push(path)
    }
  });

  const parsed = controller.parseKeywordList('dance, boogie\nDance');
  assert.equal(JSON.stringify(parsed), JSON.stringify(['dance', 'boogie']));

  const exact = controller.handleMessage({
    author: 'alex',
    platform: 'youtube',
    text: 'this is a dance party tonight'
  });
  assert.equal(exact.animationMatch?.trigger, 'dance');
  assert.equal(played.length, 0);
  assert.equal(triggered.length, 1);

  const fuzzy = controller.handleMessage({
    author: 'alex',
    platform: 'youtube',
    text: 'can we do a dence partie now'
  });
  assert.equal(fuzzy.animationMatch?.trigger, 'zebra');
  assert.equal(triggered.length, 2);

  const sound = controller.handleMessage({
    author: 'alex',
    platform: 'tiktok',
    text: 'beep beap'
  });
  assert.equal(sound.soundMatch?.soundPath, '/sounds/horn.wav');
  const soundAgain = controller.handleMessage({
    author: 'alex',
    platform: 'tiktok',
    text: 'beep beap'
  });
  assert.equal(soundAgain.soundMatch?.soundPath, '/sounds/zhorn.wav');
  assert.deepEqual(played, ['/sounds/horn.wav', '/sounds/zhorn.wav']);
});

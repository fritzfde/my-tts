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
  let activeAnimations = false;
  let suppressedKeywords = [];

  const controller = factory({
    callbacks: {
      getAnimationMappings: () => ({
        dance: { keywords: ['dance party', 'boogie'], keywordTriggerEnabled: true, voiceKeywordTriggerEnabled: true },
        zebra: { keywords: ['dance party'], keywordTriggerEnabled: true, voiceKeywordTriggerEnabled: true },
        hidden: { keywords: ['secret phrase'], keywordTriggerEnabled: false, voiceKeywordTriggerEnabled: true },
        legacy: { keywords: ['very very low'], keywordTriggerEnabled: true },
        shortFragment: { keywords: ['these people'], keywordTriggerEnabled: true, voiceKeywordTriggerEnabled: true },
        betterPhrase: { keywords: ['whoa are these people'], keywordTriggerEnabled: true, voiceKeywordTriggerEnabled: true }
      }),
      normalizeAnimationMapping: (data) => ({
        keywords: Array.isArray(data?.keywords) ? data.keywords : [],
        keywordTriggerEnabled: data?.keywordTriggerEnabled === true,
        voiceKeywordTriggerEnabled: typeof data?.voiceKeywordTriggerEnabled === 'boolean'
          ? data.voiceKeywordTriggerEnabled
          : data?.keywordTriggerEnabled === true
      }),
      getSoundKeywordEntries: () => ([
        { soundPath: '/sounds/horn.wav', keywords: ['horn', 'beep beep'], viewerEnabled: true, voiceEnabled: true },
        { soundPath: '/sounds/zhorn.wav', keywords: ['beep beep'], viewerEnabled: true, voiceEnabled: true }
      ]),
      getAllSoundKeywordEntries: () => ([
        { soundPath: '/sounds/horn.wav', keywords: ['horn', 'beep beep'], viewerEnabled: true, voiceEnabled: true },
        { soundPath: '/sounds/zhorn.wav', keywords: ['beep beep'], viewerEnabled: true, voiceEnabled: true },
        { soundPath: '/sounds/secret.wav', keywords: ['secret phrase'], viewerEnabled: false, voiceEnabled: true }
      ]),
      getSuppressedKeywords: () => suppressedKeywords,
      canTriggerAnimation: () => true,
      hasActiveAnimations: () => activeAnimations,
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
  assert.equal(exact.playedKind, 'animation');

  const fuzzy = controller.handleMessage({
    author: 'alex',
    platform: 'youtube',
    text: 'can we do a dence partie now'
  });
  assert.equal(fuzzy.animationMatch?.trigger, 'zebra');
  assert.equal(triggered.length, 2);
  assert.equal(fuzzy.playedKind, 'animation');

  const micStrict = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'can we do a dence partie now',
    source: 'mic'
  });
  assert.equal(micStrict.animationMatch, null);
  assert.equal(micStrict.soundMatch, null);
  assert.equal(triggered.length, 2);

  const micPartial = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'saying something here',
    source: 'mic'
  });
  assert.equal(micPartial.animationMatch, null);
  assert.equal(micPartial.soundMatch, null);

  const micNearExact = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'boogi right now',
    source: 'mic'
  });
  assert.equal(micNearExact.animationMatch?.trigger, 'dance');
  assert.equal(triggered.length, 3);

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
  assert.equal(soundAgain.playedKind, 'sound');

  const mic = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'secret phrase right now',
    source: 'mic'
  });
  assert.equal(mic.animationMatch?.trigger, 'hidden');
  assert.equal(mic.soundMatch?.soundPath, '/sounds/secret.wav');
  assert.deepEqual(triggered[3], ['hidden', 'mic', 'host-mic', 'keyword']);
  assert.equal(mic.playedKind, 'animation');
  assert.deepEqual(played, ['/sounds/horn.wav', '/sounds/zhorn.wav']);

  activeAnimations = true;
  const blocked = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'horn right now',
    source: 'mic'
  });
  assert.equal(blocked.blockedByActiveAnimation, true);
  assert.equal(triggered.length, 4);
  assert.deepEqual(played, ['/sounds/horn.wav', '/sounds/zhorn.wav']);

  activeAnimations = false;
  suppressedKeywords = ['secret phrase'];
  const suppressed = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'secret phrase right now',
    source: 'mic'
  });
  assert.equal(suppressed.ignoredBySuppressedKeywords, true);
  assert.equal(triggered.length, 4);
  assert.deepEqual(played, ['/sounds/horn.wav', '/sounds/zhorn.wav']);

  const legacyMic = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'we flew very very low',
    source: 'mic'
  });
  assert.equal(legacyMic.animationMatch?.trigger, 'legacy');
  const prioritizeLongerMic = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'who are these people',
    source: 'mic'
  });
  assert.equal(prioritizeLongerMic.animationMatch?.trigger, 'betterPhrase');
  assert.equal(controller.hasExactMicKeywordMatch('we flew very very low tonight'), true);
  assert.equal(controller.hasExactMicKeywordMatch('say secert phraze now'), false);
});

test('keyword triggers: global viewer chat gates block chat without affecting mic', async () => {
  const { factory } = loadControllerFactory('keyword-triggers.js', 'createKeywordTriggersController');
  const triggered = [];
  const played = [];

  const controller = factory({
    callbacks: {
      getAnimationMappings: () => ({
        dance: { keywords: ['dance party'], keywordTriggerEnabled: true, voiceKeywordTriggerEnabled: true }
      }),
      normalizeAnimationMapping: (data) => ({
        keywords: Array.isArray(data?.keywords) ? data.keywords : [],
        keywordTriggerEnabled: data?.keywordTriggerEnabled === true,
        voiceKeywordTriggerEnabled: data?.voiceKeywordTriggerEnabled === true
      }),
      getSoundKeywordEntries: () => ([
        { soundPath: '/sounds/horn.wav', keywords: ['beep beep'], viewerEnabled: true, voiceEnabled: true }
      ]),
      getAllSoundKeywordEntries: () => ([
        { soundPath: '/sounds/horn.wav', keywords: ['beep beep'], viewerEnabled: true, voiceEnabled: true }
      ]),
      isViewerChatAnimationsEnabled: () => false,
      isViewerChatSoundsEnabled: () => false,
      getSuppressedKeywords: () => [],
      canTriggerAnimation: () => true,
      hasActiveAnimations: () => false,
      triggerAnimation: (...args) => triggered.push(args),
      playSound: (path) => played.push(path)
    }
  });

  const viewerChat = controller.handleMessage({
    author: 'viewer',
    platform: 'youtube',
    text: 'dance party and beep beep'
  });
  assert.equal(viewerChat.animationMatch, null);
  assert.equal(viewerChat.soundMatch, null);
  assert.deepEqual(triggered, []);
  assert.deepEqual(played, []);

  const mic = controller.handleMessage({
    author: 'host-mic',
    platform: 'mic',
    text: 'dance party and beep beep',
    source: 'mic'
  });
  assert.equal(mic.animationMatch?.trigger, 'dance');
  assert.equal(mic.soundMatch?.soundPath, '/sounds/horn.wav');
  assert.deepEqual(triggered, [['dance', 'mic', 'host-mic', 'keyword']]);
  assert.deepEqual(played, []);
});

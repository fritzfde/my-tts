const test = require('node:test');
const assert = require('node:assert/strict');

const { isSafeSoundFilename } = require('/Users/alex/Projects/my-tts/apps/web/lib/sound-filenames');

test('sound filenames: allows punctuation-heavy filenames with supported extensions', () => {
  assert.equal(isSafeSoundFilename('bluey_bluey!__cartoons.wav'), true);
  assert.equal(isSafeSoundFilename('Tesla Lock Sound (V2).mp3'), true);
  assert.equal(isSafeSoundFilename('meme #1.ogg'), true);
});

test('sound filenames: rejects path traversal and unsupported extensions', () => {
  assert.equal(isSafeSoundFilename('../secret.wav'), false);
  assert.equal(isSafeSoundFilename('nested/path.wav'), false);
  assert.equal(isSafeSoundFilename('nested\\\\path.wav'), false);
  assert.equal(isSafeSoundFilename('not-a-sound.txt'), false);
  assert.equal(isSafeSoundFilename(''), false);
});

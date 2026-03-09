const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractKeywordsFromFilename,
  extractKeywordsFromText,
  normalizeText
} = require('/Users/alex/Projects/my-tts/apps/web/lib/media-keywords');

test('media keywords: normalizes text and removes punctuation noise', () => {
  assert.equal(normalizeText('Dänce Party!!! 2026'), 'dance party 2026');
});

test('media keywords: extracts useful keywords from filenames', () => {
  assert.equal(
    JSON.stringify(extractKeywordsFromFilename('bluey_bluey!__cartoons.wav')),
    JSON.stringify(['bluey', 'cartoons'])
  );
});

test('media keywords: extracts phrases and words from transcript text', () => {
  const keywords = extractKeywordsFromText(
    'Thank you for the rose. Thank you for the galaxy. Dance party now.',
    { fallbackName: 'stream-party.mov', maxKeywords: 8 }
  );

  assert.equal(
    JSON.stringify(keywords),
    JSON.stringify(['thank you', 'dance party', 'galaxy', 'dance', 'party', 'rose', 'stream'])
  );
});

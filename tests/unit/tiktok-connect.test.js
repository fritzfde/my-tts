const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTikTokUsername,
  classifyTikTokConnectError
} = require('/Users/alex/Projects/my-tts/apps/web/lib/tiktok-connect');

test('tiktok connect: normalizes usernames from handles and full URLs', () => {
  assert.equal(normalizeTikTokUsername('@alex'), 'alex');
  assert.equal(normalizeTikTokUsername('https://www.tiktok.com/@alex'), 'alex');
  assert.equal(normalizeTikTokUsername('https://www.tiktok.com/@alex/live'), 'alex');
  assert.equal(normalizeTikTokUsername(' alex '), 'alex');
});

test('tiktok connect: classifies common expected connection failures', () => {
  assert.deepEqual(
    classifyTikTokConnectError(new Error("The requested user isn't online :(")),
    {
      expected: true,
      code: 'offline',
      message: 'That TikTok account is not live right now.'
    }
  );

  assert.deepEqual(
    classifyTikTokConnectError(new Error('Failed to retrieve room_id from page source. This streamer user might not exist, be set to private or the session might be outdated.')),
    {
      expected: true,
      code: 'not-found',
      message: 'TikTok account not found or not publicly accessible.'
    }
  );
});

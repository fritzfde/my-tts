function normalizeTikTokUsername(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';

  raw = raw.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '');
  raw = raw.replace(/^@/, '');
  raw = raw.split(/[/?#]/)[0] || '';
  raw = raw.trim();

  return raw.replace(/^@+/, '');
}

function classifyTikTokConnectError(error) {
  const message = String(error?.message || error || '').trim();
  const lower = message.toLowerCase();

  if (!message) {
    return {
      expected: false,
      code: 'unknown',
      message: 'TikTok connection failed'
    };
  }

  if (lower.includes("isn't online") || lower.includes('not online')) {
    return {
      expected: true,
      code: 'offline',
      message: 'That TikTok account is not live right now.'
    };
  }

  if (
    lower.includes('might not exist')
    || lower.includes('user_not_found')
    || lower.includes('failed to retrieve room_id')
    || lower.includes('private')
  ) {
    return {
      expected: true,
      code: 'not-found',
      message: 'TikTok account not found or not publicly accessible.'
    };
  }

  if (
    lower.includes('rate limit')
    || lower.includes('temporarily blocked')
    || lower.includes('captcha')
  ) {
    return {
      expected: true,
      code: 'blocked',
      message: 'TikTok temporarily blocked the connection. Try again in a moment.'
    };
  }

  return {
    expected: false,
    code: 'unknown',
    message
  };
}

module.exports = {
  normalizeTikTokUsername,
  classifyTikTokConnectError
};

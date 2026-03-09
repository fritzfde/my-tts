const path = require('path');

const ALLOWED_SOUND_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg']);

function isSafeSoundFilename(filename) {
  const raw = String(filename || '');
  if (!raw || raw.includes('\0')) return false;
  if (/[\\/]/.test(raw)) return false;
  if (raw === '.' || raw === '..') return false;
  if (path.basename(raw) !== raw) return false;

  const ext = path.extname(raw).toLowerCase();
  return ALLOWED_SOUND_EXTENSIONS.has(ext);
}

module.exports = {
  ALLOWED_SOUND_EXTENSIONS,
  isSafeSoundFilename
};

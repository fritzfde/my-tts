const DEFAULT_LEGACY_API_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_SETTINGS_SCOPE = 'local-dev';

export function getLegacyApiBaseUrl() {
  return String(process.env.NEXT_PUBLIC_LEGACY_API_BASE_URL || DEFAULT_LEGACY_API_BASE_URL).replace(/\/+$/, '');
}

export function getSettingsScope() {
  return String(process.env.NEXT_PUBLIC_SETTINGS_SCOPE || DEFAULT_SETTINGS_SCOPE).trim() || DEFAULT_SETTINGS_SCOPE;
}

export function legacyMediaUrl(pathname = '') {
  const normalized = String(pathname || '').trim();
  if (!normalized) return getLegacyApiBaseUrl();
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `${getLegacyApiBaseUrl()}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

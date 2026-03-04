// Server-backed settings store (SQLite via backend API)
const SETTINGS_SCOPE = new URLSearchParams(window.location.search).get('scope') || 'local-dev';
const SETTINGS_SYNC_DEBOUNCE_MS = 400;
let settingsSyncReady = false;
let settingsSyncTimer = null;
const settingsMap = new Map();

function getSettingsSnapshot() {
  const snapshot = {};
  settingsMap.forEach((value, key) => {
    snapshot[key] = value;
  });
  return snapshot;
}

function persistSettingsToServer() {
  const payload = {
    scope: SETTINGS_SCOPE,
    settings: getSettingsSnapshot()
  };

  return fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch((err) => {
    console.error('Failed to persist settings to server DB:', err);
  });
}

function scheduleSettingsSync() {
  if (!settingsSyncReady) return;
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer);
  settingsSyncTimer = setTimeout(() => {
    settingsSyncTimer = null;
    persistSettingsToServer();
  }, SETTINGS_SYNC_DEBOUNCE_MS);
}

function loadSettingsFromServerSync() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/api/settings?scope=${encodeURIComponent(SETTINGS_SCOPE)}`, false);
    xhr.send();

    if (xhr.status < 200 || xhr.status >= 300) {
      console.warn('Settings DB load failed:', xhr.status);
      return null;
    }

    const data = JSON.parse(xhr.responseText || '{}');
    if (!data.settings || typeof data.settings !== 'object') return {};
    return data.settings;
  } catch (err) {
    console.warn('Settings DB not available at startup, continuing with empty settings store:', err);
    return null;
  }
}

const settingsStore = {
  get length() {
    return settingsMap.size;
  },
  key(index) {
    return Array.from(settingsMap.keys())[index] || null;
  },
  getItem(key) {
    return settingsMap.has(key) ? settingsMap.get(key) : null;
  },
  setItem(key, value) {
    settingsMap.set(String(key), String(value));
    scheduleSettingsSync();
  },
  removeItem(key) {
    settingsMap.delete(String(key));
    scheduleSettingsSync();
  },
  clear() {
    settingsMap.clear();
    scheduleSettingsSync();
  }
};

function hydrateSettingsStoreFromServer() {
  const serverSettings = loadSettingsFromServerSync();
  if (!serverSettings) return;

  settingsMap.clear();
  Object.entries(serverSettings).forEach(([key, value]) => {
    settingsMap.set(key, String(value));
  });
  console.log(`✓ Loaded ${settingsMap.size} settings from server DB`);
}

hydrateSettingsStoreFromServer();
settingsSyncReady = true;

// TTS Configuration
const synth = window.speechSynthesis;
let voices = [];
let currentUtterance = null;
let messageQueue = [];
let isSpeaking = false;
let clonedVoices = [];

// Track hidden voices
let hiddenVoices = new Set();
const VOICE_GROUP_ORDER = ['custom', 'en', 'de', 'es', 'uk', 'ru'];
const VOICE_GROUP_LABELS = {
  custom: '🎙️ Custom Voices',
  en: '🇺🇸 English',
  de: '🇩🇪 German',
  es: '🇪🇸 Spanish',
  uk: '🇺🇦 Ukrainian',
  ru: '🇷🇺 Russian'
};
let enabledLanguages = new Set(VOICE_GROUP_ORDER.filter((code) => code !== 'custom'));

function getVoiceLanguageCode(lang) {
  const code = String(lang || '').toLowerCase().substring(0, 2);
  return VOICE_GROUP_ORDER.includes(code) ? code : null;
}

function buildVoiceGroups({ includeHidden = true, ignoreLanguageFilters = false } = {}) {
  const grouped = new Map();
  VOICE_GROUP_ORDER.forEach((groupKey) => grouped.set(groupKey, []));

  const sortedClonedVoices = [...clonedVoices].sort((a, b) => (
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  ));

  sortedClonedVoices.forEach((voiceName) => {
    const voiceId = `cloned-${voiceName}`;
    const isHidden = hiddenVoices.has(voiceId);
    if (!includeHidden && isHidden) return;
    grouped.get('custom').push({
      id: voiceId,
      name: voiceName,
      groupKey: 'custom',
      isCloned: true,
      isHidden
    });
  });

  voices.forEach((voice, index) => {
    const groupKey = getVoiceLanguageCode(voice.lang);
    if (!groupKey) return;
    if (!ignoreLanguageFilters && enabledLanguages.size > 0 && !enabledLanguages.has(groupKey)) return;

    const voiceId = `system-${index}`;
    const isHidden = hiddenVoices.has(voiceId);
    if (!includeHidden && isHidden) return;

    grouped.get(groupKey).push({
      id: voiceId,
      name: voice.name,
      groupKey,
      isCloned: false,
      isHidden
    });
  });

  grouped.forEach((groupVoices) => {
    groupVoices.sort((a, b) => (
      String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true })
    ));
  });

  return VOICE_GROUP_ORDER
    .map((groupKey) => ({
      key: groupKey,
      label: VOICE_GROUP_LABELS[groupKey],
      voices: grouped.get(groupKey) || []
    }))
    .filter((group) => group.voices.length > 0);
}

function getAllVoiceEntries(options = {}) {
  return buildVoiceGroups(options).flatMap((group) => group.voices);
}

function findVoiceEntryById(voiceId) {
  if (!voiceId) return null;
  return getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
    .find((entry) => entry.id === voiceId) || null;
}

function populateVoiceSelectElement(select, preferredVoiceId = '') {
  if (!select) return '';

  select.innerHTML = '';
  const groups = buildVoiceGroups({ includeHidden: false });

  groups.forEach((group) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;

    group.voices.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      optgroup.appendChild(option);
    });

    if (optgroup.children.length > 0) {
      select.appendChild(optgroup);
    }
  });

  const options = Array.from(select.querySelectorAll('option'));
  if (options.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'No voices available';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);
    return '';
  }

  const targetValue = preferredVoiceId && options.some((opt) => opt.value === preferredVoiceId)
    ? preferredVoiceId
    : options[0].value;
  select.value = targetValue;
  return targetValue;
}

function buildVoiceOptionsMarkup(selectedVoiceId = '') {
  const groups = buildVoiceGroups({ includeHidden: false });
  if (groups.length === 0) {
    return '<option value="" disabled selected>No voices available</option>';
  }

  return groups.map((group) => {
    const optionsMarkup = group.voices.map((entry) => (
      `<option value="${escapeAttribute(entry.id)}"${entry.id === selectedVoiceId ? ' selected' : ''}>${escapeHtml(entry.name)}</option>`
    )).join('');

    return `<optgroup label="${escapeAttribute(group.label)}">${optionsMarkup}</optgroup>`;
  }).join('');
}

// Keep audio playing in background tabs
let wakeLock = null;

// Animation trigger permissions
let globalAnimationTriggerEnabled = true; // Default: allow all users
let userAnimationPermissions = {}; // username → 'allow' | 'deny'

// Load permissions
function loadAnimationPermissions() {
  const saved = settingsStore.getItem('animation_permissions');
  if (saved) {
    try {
      const data = JSON.parse(saved);
      globalAnimationTriggerEnabled = data.global !== false;
      userAnimationPermissions = data.users || {};
    } catch (e) {
      console.error('Error loading animation permissions:', e);
    }
  }
}

// Save permissions
function saveAnimationPermissions() {
  settingsStore.setItem('animation_permissions', JSON.stringify({
    global: globalAnimationTriggerEnabled,
    users: userAnimationPermissions
  }));
}

// Check if user can trigger animations
function canUserTriggerAnimations(username, platform = 'tiktok') {
  const userKey = `${platform}:${username}`;
  
  // Check user-specific override first
  if (userAnimationPermissions[userKey] === 'allow') {
    console.log(`✅ User ${username} (${platform}) explicitly ALLOWED to trigger animations`);
    return true;
  }
  if (userAnimationPermissions[userKey] === 'deny') {
    console.log(`🚫 User ${username} (${platform}) explicitly DENIED from triggering animations`);
    return false;
  }
  
  // Fall back to global setting
  const allowed = globalAnimationTriggerEnabled;
  console.log(`⚙️ User ${username} (${platform}) using GLOBAL setting: ${allowed ? 'allowed' : 'denied'}`);
  return allowed;
}

// Initialize
loadAnimationPermissions();

// User avatar cache
if (!window.userAvatars) {
  window.userAvatars = new Map();
}

// Prevent browser from pausing audio when tab is inactive
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('🔒 Wake Lock activated - audio will play in background');

      wakeLock.addEventListener('release', () => {
        console.log('🔓 Wake Lock released');
      });
    }
  } catch (err) {
    console.log('Wake Lock not supported:', err);
  }
}

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('📱 Tab hidden - keeping audio active');
    // Don't pause TTS or audio playback
  } else {
    console.log('📱 Tab visible again');
    // Reacquire wake lock if needed
    if (youtubeConnected || tiktokConnected) {
      requestWakeLock();
    }
  }
});

// Prevent audio context from being suspended
let audioContext = null;
function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContext.state === 'suspended') {
    audioContext.resume().then(() => {
      console.log('🔊 Audio context resumed');
    });
  }

  return audioContext;
}

// Audio Autoplay Unlock (browsers block autoplay until user interaction)
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;

  // Create and play silent audio to unlock autoplay
  const silentAudio = new Audio();
  silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
  silentAudio.volume = 0.01;

  silentAudio.play().then(() => {
    audioUnlocked = true;
    console.log('✓ Audio autoplay unlocked');
  }).catch(err => {
    // Still locked, will retry on next interaction
    console.log('⏳ Waiting for user interaction to unlock audio...');
  });

  // Also resume AudioContext
  ensureAudioContext();
}

// Unlock on any user interaction (click or keypress)
document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);

// Platform-specific state
let youtubeConnected = false;
let tiktokConnected = false;
let youtubeLiveChatId = null;
let youtubeNextPageToken = null;
let youtubeSeenMessages = new Set();
let youtubeIsFirstPoll = true;
let tiktokPollInterval = null;
let tiktokSeenMessages = new Set();

// Track last message times for smart reconnect
let youtubeLastPollTime = null;
let tiktokLastPollTime = null;

// User voice assignments (now with platform prefix)
let userVoices = {};
let recentUsers = [];

// Voice select elements
let voiceSelectYouTube = null;
let voiceSelectTikTok = null;

// UI Elements
const channelUrlInput = document.getElementById('channelUrl');
const streamUrlInput = document.getElementById('streamUrl');
const findStreamBtn = document.getElementById('findStreamBtn');
const statusDiv = document.getElementById('status');
const chatFeed = document.getElementById('chatFeed');
const rateSelect = document.getElementById('rateSelect');
const pitchSelect = document.getElementById('pitchSelect');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const readUsernamesCheckbox = document.getElementById('readUsernames');
const readEmojisCheckbox = document.getElementById('readEmojis');
const readLinksCheckbox = document.getElementById('readLinks');
const testMessageInput = document.getElementById('testMessage');
const testVoiceYouTubeBtn = document.getElementById('testVoiceYouTubeBtn');
const testVoiceTikTokBtn = document.getElementById('testVoiceTikTokBtn');
const ollamaStatusEl = document.getElementById('ollamaStatus');
const onlineYouTubeCountEl = document.getElementById('onlineYouTubeCount');
const onlineTikTokCountEl = document.getElementById('onlineTikTokCount');
const onlineYouTubeUsersEl = document.getElementById('onlineYouTubeUsers');
const onlineTikTokUsersEl = document.getElementById('onlineTikTokUsers');
const stickerAssignModal = document.getElementById('stickerAssignModal');
const stickerAssignPreviewImage = document.getElementById('stickerAssignPreviewImage');
const stickerAssignName = document.getElementById('stickerAssignName');
const stickerAssignCurrent = document.getElementById('stickerAssignCurrent');
const stickerAssignAnimationSelect = document.getElementById('stickerAssignAnimationSelect');
const stickerAssignSaveBtn = document.getElementById('stickerAssignSaveBtn');
const stickerAssignCancelBtn = document.getElementById('stickerAssignCancelBtn');
const DEFAULT_TEST_MESSAGE = 'Are you already subscribe to my YouTube? Wait, what!? Bro!';

const ONLINE_USER_TTL_MS = 60000;
const onlineUsers = {
  youtube: new Map(),
  tiktok: new Map()
};
let tiktokLiveViewerCount = 0;
let activeStickerAssignKey = '';

// ─── API Key tag manager ────────────────────────────────────────────
let apiKeys = []; // source of truth
let currentKeyIndex = 0;

const apiKeyTagsContainer = document.getElementById('apiKeyTags');
const apiKeyTextInput      = document.getElementById('apiKeyInput');
const apiKeyCountLabel     = document.getElementById('apiKeyCount');

function renderApiKeyTags() {
  // Remove all existing tags (keep the text input)
  apiKeyTagsContainer.querySelectorAll('.api-key-tag').forEach(t => t.remove());

  // Insert tags before the text input
  apiKeys.forEach((key, i) => {
    const tag = document.createElement('div');
    tag.className = 'api-key-tag';
    tag.innerHTML = `
      <span class="key-text">${key.slice(0, 12)}…${key.slice(-4)}</span>
      <button class="key-remove" data-index="${i}" title="Remove">&times;</button>
    `;
    apiKeyTagsContainer.insertBefore(tag, apiKeyTextInput);
  });

  apiKeyCountLabel.textContent = `${apiKeys.length} key${apiKeys.length !== 1 ? 's' : ''} added`;
  saveSettings();
}

function addApiKey(key) {
  key = key.trim();
  if (!key) return;

  // Check for duplicates
  if (apiKeys.includes(key)) {
    // Find the existing tag and pulse it to show it's already there
    const existingIndex = apiKeys.indexOf(key);
    const tags = apiKeyTagsContainer.querySelectorAll('.api-key-tag');
    if (tags[existingIndex]) {
      tags[existingIndex].style.animation = 'none';
      setTimeout(() => {
        tags[existingIndex].style.animation = 'pulse-highlight 0.6s ease';
      }, 10);
    }

    // Show notification in status
    const masked = key.slice(0, 12) + '...' + key.slice(-4);
    updateStatus(`Key ${masked} is already in the list`, false, false);
    setTimeout(() => {
      if (!youtubeConnected && !tiktokConnected) {
        updateStatus('Ready to connect...', false, false);
      }
    }, 3000);
    return;
  }

  apiKeys.push(key);
  currentKeyIndex = 0; // reset rotation on change
  renderApiKeyTags();
}

function removeApiKey(index) {
  apiKeys.splice(index, 1);
  currentKeyIndex = 0;
  renderApiKeyTags();
}

// Enter or comma to add keys
apiKeyTextInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = apiKeyTextInput.value.replace(/,/g, '').trim();
    if (val) {
      addApiKey(val);
      apiKeyTextInput.value = '';
    }
  }
});

// Paste: read directly from clipboardData (always available in the paste event),
// then clear the input so nothing is left behind.
apiKeyTextInput.addEventListener('paste', (e) => {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData('text');
  if (!pasted) return;
  pasted.split(',').forEach(k => addApiKey(k));
  apiKeyTextInput.value = '';
});

// Clicking away after typing (without pressing Enter) still adds the key
apiKeyTextInput.addEventListener('blur', () => {
  const val = apiKeyTextInput.value.replace(/,/g, '').trim();
  if (val) {
    addApiKey(val);
    apiKeyTextInput.value = '';
  }
});

// Remove tag by click (event delegation)
apiKeyTagsContainer.addEventListener('click', (e) => {
  const btn = e.target.closest('.key-remove');
  if (btn) removeApiKey(Number(btn.dataset.index));
});


// Simple key rotation - no time-based logic
function getNextApiKey() {
  if (apiKeys.length === 0) return '';
  return apiKeys[currentKeyIndex];
}

// Force rotate to next key (called on quota errors)
function rotateToNextKey() {
  if (apiKeys.length <= 1) {
    console.warn('⚠️ Only 1 API key - cannot rotate');
    return false;
  }
  
  const oldIndex = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  console.log(`🔑 Rotated from key ${oldIndex + 1} to key ${currentKeyIndex + 1}/${apiKeys.length}`);
  return true;
}

// ─── end API key manager ────────────────────────────────────────────

// Load cloned voices from server
async function loadClonedVoices() {
  try {
    const response = await fetch('/api/voice-clone/voices');
    if (response.ok) {
      const data = await response.json();
      clonedVoices = data.voices || [];
      console.log('Loaded cloned voices:', clonedVoices);
    }
  } catch (error) {
    console.error('Error loading cloned voices:', error);
  }
}

// Load available voices into BOTH dropdowns
function loadVoices() {
  voices = synth.getVoices();
  const ytSelect = document.getElementById('voiceSelectYouTube');
  const ttSelect = document.getElementById('voiceSelectTikTok');

  if (!ytSelect || !ttSelect) return;

  voiceSelectYouTube = ytSelect;
  voiceSelectTikTok = ttSelect;

  const savedYTVoice = settingsStore.getItem('youtube_default_voice');
  const savedTTVoice = settingsStore.getItem('tiktok_default_voice');
  const selectedYT = populateVoiceSelectElement(ytSelect, savedYTVoice || ytSelect.value);
  const selectedTT = populateVoiceSelectElement(ttSelect, savedTTVoice || ttSelect.value);

  // Only persist defaults automatically when no saved value exists yet.
  // This avoids overwriting user's saved choice during early/partial voice loading.
  if (!savedYTVoice && selectedYT) {
    settingsStore.setItem('youtube_default_voice', selectedYT);
  }
  if (!savedTTVoice && selectedTT) {
    settingsStore.setItem('tiktok_default_voice', selectedTT);
  }

  console.log('Loaded voices for both platforms');

  // Also populate gender voice selects
  if (typeof populateGenderVoiceSelects === 'function') {
    populateGenderVoiceSelects();
  }
}

// Load voices on page load
loadClonedVoices().then(() => {
  loadVoices();
});

if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

// Save voice preferences when changed
document.addEventListener('DOMContentLoaded', () => {
  const ytSelect = document.getElementById('voiceSelectYouTube');
  const ttSelect = document.getElementById('voiceSelectTikTok');

  if (ytSelect) {
    ytSelect.addEventListener('change', () => {
      settingsStore.setItem('youtube_default_voice', ytSelect.value);
      console.log('Saved YouTube default voice:', ytSelect.value);
    });
  }

  if (ttSelect) {
    ttSelect.addEventListener('change', () => {
      settingsStore.setItem('tiktok_default_voice', ttSelect.value);
      console.log('Saved TikTok default voice:', ttSelect.value);
    });
  }
});

// Load user voice mappings
function loadUserVoices() {
  const saved = settingsStore.getItem('user_voices');
  if (saved) {
    try {
      userVoices = JSON.parse(saved);
    } catch (e) {
      userVoices = {};
    }
  }

  const savedRecentUsers = settingsStore.getItem('recent_users');
  if (savedRecentUsers) {
    try {
      recentUsers = JSON.parse(savedRecentUsers);
    } catch (e) {
      recentUsers = [];
    }
  }
}

// Save user voice mappings
function saveUserVoices() {
  settingsStore.setItem('user_voices', JSON.stringify(userVoices));
  settingsStore.setItem('recent_users', JSON.stringify(recentUsers));
}

// Get voice for specific user (with platform)
function getVoiceForUser(username, platform) {
  const userKey = `${platform}:${username}`;
  return userVoices[userKey];
}

// Set voice for specific user (with platform)
function setVoiceForUser(username, platform, voiceId) {
  const userKey = `${platform}:${username}`;
  userVoices[userKey] = voiceId;
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice for "${username}" (${platform}) set to: ${getVoiceName(voiceId)}`, 'SYSTEM', false);
}

// Get voice name from voice ID
function getVoiceName(voiceId) {
  // Check both dropdowns
  const ytSelect = document.getElementById('voiceSelectYouTube');
  const ttSelect = document.getElementById('voiceSelectTikTok');

  let option = ytSelect ? Array.from(ytSelect.options).find(opt => opt.value === voiceId) : null;
  if (!option && ttSelect) {
    option = Array.from(ttSelect.options).find(opt => opt.value === voiceId);
  }

  if (option) return option.textContent.trim();

  const entry = findVoiceEntryById(voiceId);
  if (entry) return entry.name;

  return voiceId;
}

// Add user to recent users list (with platform prefix)
function addRecentUser(userKey) {
  if (!recentUsers.includes(userKey) && !userKey.startsWith('SYSTEM:')) {
    recentUsers.unshift(userKey);
    if (recentUsers.length > 20) {
      recentUsers = recentUsers.slice(0, 20);
    }
    settingsStore.setItem('recent_users', JSON.stringify(recentUsers));
  }
}

function formatUserSeenAgo(lastSeenTs) {
  const seconds = Math.max(0, Math.floor((Date.now() - lastSeenTs) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function pruneOnlineUsers() {
  const cutoff = Date.now() - ONLINE_USER_TTL_MS;
  ['youtube', 'tiktok'].forEach((platform) => {
    onlineUsers[platform].forEach((value, username) => {
      if (!value || value.lastSeen < cutoff) {
        onlineUsers[platform].delete(username);
      }
    });
  });
}

function renderOnlineUsers() {
  pruneOnlineUsers();

  const renderPlatformList = (platform, listEl, countEl) => {
    if (!listEl || !countEl) return;

    const entries = Array.from(onlineUsers[platform].entries())
      .sort((a, b) => (b[1]?.lastSeen || 0) - (a[1]?.lastSeen || 0));

    if (platform === 'tiktok' && tiktokLiveViewerCount > 0) {
      countEl.textContent = String(tiktokLiveViewerCount);
      countEl.title = `Tracked active users: ${entries.length}`;
    } else {
      countEl.textContent = String(entries.length);
      countEl.title = '';
    }

    if (entries.length === 0) {
      listEl.innerHTML = '<div class="online-users-empty">No active users</div>';
      return;
    }

    listEl.innerHTML = entries.map(([username, data]) => {
      const displayName = data?.displayName || username;
      const avatar = data?.avatar || (window.userAvatars && window.userAvatars.get(`${platform}:${username}`));
      const avatarMarkup = avatar
        ? `<img src="${escapeAttribute(avatar)}" alt="${escapeAttribute(displayName)}" class="online-user-avatar">`
        : '<span class="online-user-avatar" style="display: inline-flex; align-items: center; justify-content: center; font-size: 0.65rem; background: rgba(255,255,255,0.14);">👤</span>';

      return `
        <div class="online-user-item" title="${escapeAttribute(displayName)}">
          ${avatarMarkup}
          <span class="online-user-name">${escapeHtml(displayName)}</span>
          <span class="online-user-time">${formatUserSeenAgo(data.lastSeen)}</span>
        </div>
      `;
    }).join('');
  };

  renderPlatformList('youtube', onlineYouTubeUsersEl, onlineYouTubeCountEl);
  renderPlatformList('tiktok', onlineTikTokUsersEl, onlineTikTokCountEl);
}

function markUserOnline(username, platform) {
  if (!username || !platform || !onlineUsers[platform]) return;
  const existing = onlineUsers[platform].get(username) || {};
  onlineUsers[platform].set(username, { ...existing, lastSeen: Date.now() });
  renderOnlineUsers();
}

function clearOnlineUsers(platform) {
  if (!onlineUsers[platform]) return;
  onlineUsers[platform].clear();
  if (platform === 'tiktok') {
    tiktokLiveViewerCount = 0;
  }
  renderOnlineUsers();
}

async function refreshTikTokAudience() {
  if (!tiktokConnected) {
    tiktokLiveViewerCount = 0;
    onlineUsers.tiktok.clear();
    renderOnlineUsers();
    return;
  }

  try {
    const response = await fetch('/api/tiktok/audience');
    if (!response.ok) return;

    const data = await response.json();
    const viewerCount = Number(data?.viewerCount || 0);
    tiktokLiveViewerCount = Number.isFinite(viewerCount) && viewerCount >= 0 ? viewerCount : 0;

    const candidates = [];
    if (Array.isArray(data?.activeUsers)) {
      candidates.push(...data.activeUsers);
    }
    if (Array.isArray(data?.topViewers)) {
      candidates.push(...data.topViewers);
    }

    const now = Date.now();
    const nextTikTokUsers = new Map();
    candidates.forEach((entry) => {
      const uniqueId = String(entry?.uniqueId || '').trim();
      if (!uniqueId) return;

      const displayName = String(entry?.nickname || uniqueId);
      const avatar = entry?.avatar || entry?.profilePictureUrl || null;
      if (avatar) {
        window.userAvatars.set(`tiktok:${uniqueId}`, avatar);
      }

      const lastSeenRaw = Number(entry?.lastSeen);
      const lastSeen = Number.isFinite(lastSeenRaw) ? lastSeenRaw : now;
      const existing = onlineUsers.tiktok.get(uniqueId) || {};
      nextTikTokUsers.set(uniqueId, {
        ...existing,
        displayName,
        avatar,
        lastSeen
      });
    });

    onlineUsers.tiktok = nextTikTokUsers;
    renderOnlineUsers();
  } catch (err) {
    console.warn('TikTok audience fetch failed:', err?.message || err);
  }
}

// Load saved settings
function loadSettings() {
  // API keys — stored as JSON array; fall back to legacy comma-separated string
  const savedKeys = settingsStore.getItem('yt_tts_api_keys');
  if (savedKeys) {
    try { apiKeys = JSON.parse(savedKeys); } catch(e) { apiKeys = []; }
  } else {
    // Legacy single-key fallback
    const legacy = settingsStore.getItem('yt_tts_api_key');
    if (legacy) {
      apiKeys = legacy.split(',').map(k => k.trim()).filter(k => k.length > 0);
    } else {
      apiKeys = ['AIzaSyAWVq4gtDP4rYaWKHH_2TvzBjxfRBr6kBE'];
    }
  }
  renderApiKeyTags();

  const savedChannelUrl = settingsStore.getItem('yt_tts_channel_url');
  channelUrlInput.value = savedChannelUrl || 'https://www.youtube.com/@TESLAbot-CODM';

  const savedStreamUrl = settingsStore.getItem('yt_tts_stream_url');
  if (savedStreamUrl) streamUrlInput.value = savedStreamUrl;

  const savedTikTokUsername = settingsStore.getItem('tiktok_username_cache');
  if (savedTikTokUsername) document.getElementById('tiktokUsername').value = savedTikTokUsername;

  const savedTestMessage = settingsStore.getItem('yt_tts_test_message');
  const unifiedTestMessage = savedTestMessage || DEFAULT_TEST_MESSAGE;
  testMessageInput.value = unifiedTestMessage;
  const voicePreviewMessageInput = document.getElementById('voicePreviewText');
  if (voicePreviewMessageInput) {
    voicePreviewMessageInput.value = unifiedTestMessage;
  }

  const savedVolume = settingsStore.getItem('yt_tts_volume');
  volumeSlider.value = savedVolume || '100';
  volumeValue.textContent = volumeSlider.value + '%';
}

// Save settings
function saveSettings() {
  settingsStore.setItem('yt_tts_api_keys', JSON.stringify(apiKeys));
  const channelUrl    = channelUrlInput.value.trim();
  const streamUrl     = streamUrlInput.value.trim();
  if (channelUrl)    settingsStore.setItem('yt_tts_channel_url', channelUrl);
  if (streamUrl)     settingsStore.setItem('yt_tts_stream_url', streamUrl);
}

// Auto-save when fields change
channelUrlInput.addEventListener('change', saveSettings);
streamUrlInput.addEventListener('change', saveSettings);

// Volume slider live update
volumeSlider.addEventListener('input', () => {
  volumeValue.textContent = volumeSlider.value + '%';
  settingsStore.setItem('yt_tts_volume', volumeSlider.value);
});

// Test message auto-save
testMessageInput.addEventListener('input', () => {
  settingsStore.setItem('yt_tts_test_message', testMessageInput.value);
  const voicePreviewMessageInput = document.getElementById('voicePreviewText');
  if (voicePreviewMessageInput && voicePreviewMessageInput.value !== testMessageInput.value) {
    voicePreviewMessageInput.value = testMessageInput.value;
  }
});

// Extract channel ID
function extractChannelId(url) {
  const patterns = [
    /@([^\/\?]+)/,
    /channel\/([^\/\?]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract video ID
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /youtube\.com\/live\/([^&\n?#]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Find live stream
async function findLiveStream(apiKey, input) {
  try {
    updateStatus('Searching for live streams...', true);

    let channelId = null;

    const channelIdMatch = input.match(/channel\/([^\/\?]+)/);
    const handleMatch = input.match(/@([^\/\?]+)/);

    if (channelIdMatch) {
      channelId = channelIdMatch[1];
      console.log('Using channel ID directly:', channelId);
    } else {
      let handle = handleMatch ? handleMatch[1] : input.replace(/^https?:\/\/(www\.)?youtube\.com\/?/i, '');
      handle = handle.replace(/^@/, '').trim();

      if (!handle) {
        throw new Error('Could not parse channel handle');
      }

      console.log('Looking up handle:', handle);

      // Try forHandle first
      let response = await fetch(
        `/api/youtube/channels?part=id&forHandle=${handle}&key=${apiKey}`
      );
      
      // CHECK FOR QUOTA ERROR - ROTATE KEY
      if (response.status === 403) {
        const errorData = await response.json();
        if (errorData.error?.message?.toLowerCase().includes('quota')) {
          console.warn('⚠️ Quota exhausted on forHandle, rotating key...');
          if (rotateToNextKey()) {
            // Retry with new key
            apiKey = getNextApiKey();
            response = await fetch(
              `/api/youtube/channels?part=id&forHandle=${handle}&key=${apiKey}`
            );
          }
        }
      }
      
      let data = response.ok ? await response.json() : null;

      // If forHandle failed, try forUsername
      if (!data || !data.items || data.items.length === 0) {
        console.log('forHandle returned nothing, trying forUsername...');
        response = await fetch(
          `/api/youtube/channels?part=id&forUsername=${handle}&key=${apiKey}`
        );
        
        // CHECK FOR QUOTA ERROR AGAIN
        if (response.status === 403) {
          const errorData = await response.json();
          if (errorData.error?.message?.toLowerCase().includes('quota')) {
            console.warn('⚠️ Quota exhausted on forUsername, rotating key...');
            if (rotateToNextKey()) {
              apiKey = getNextApiKey();
              response = await fetch(
                `/api/youtube/channels?part=id&forUsername=${handle}&key=${apiKey}`
              );
            }
          }
        }
        
        data = response.ok ? await response.json() : null;
      }

      if (!data || !data.items || data.items.length === 0) {
        throw new Error(`Channel "@${handle}" not found`);
      }

      channelId = data.items[0].id;
      console.log('Resolved channel ID:', channelId);
    }

    // Search for live videos
    const searchResponse = await fetch(
      `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
    );

    // CHECK FOR QUOTA ERROR ON SEARCH
    if (searchResponse.status === 403) {
      const errorData = await searchResponse.json();
      if (errorData.error?.message?.toLowerCase().includes('quota')) {
        console.warn('⚠️ Quota exhausted on search, rotating key...');
        if (rotateToNextKey()) {
          apiKey = getNextApiKey();
          const retryResponse = await fetch(
            `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
          );
          if (!retryResponse.ok) {
            throw new Error('Failed to search after key rotation');
          }
          const retryData = await retryResponse.json();
          if (!retryData.items || retryData.items.length === 0) {
            throw new Error('No live streams found on this channel');
          }
          const liveVideo = retryData.items[0];
          const videoId = liveVideo.id.videoId;
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          streamUrlInput.value = videoUrl;
          saveSettings();
          updateStatus(`✓ Found: ${liveVideo.snippet.title}`, false);
          return videoUrl;
        } else {
          throw new Error('All API keys exhausted');
        }
      }
    }

    if (!searchResponse.ok) {
      const err = await searchResponse.json();
      throw new Error(err.error?.message || 'Failed to search for live streams');
    }

    const searchData = await searchResponse.json();

    if (!searchData.items || searchData.items.length === 0) {
      throw new Error('No live streams found on this channel');
    }

    const liveVideo = searchData.items[0];
    const videoId = liveVideo.id.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    streamUrlInput.value = videoUrl;
    saveSettings();
    updateStatus(`✓ Found: ${liveVideo.snippet.title}`, false);

    return videoUrl;

  } catch (error) {
    console.error('Find stream error:', error);
    updateStatus(`${error.message}`, false, true);
    throw error;
  }
}

// Find stream button
findStreamBtn.addEventListener('click', async () => {
  const apiKey = getNextApiKey();
  const channelUrl = channelUrlInput.value.trim();

  if (!apiKey) {
    updateStatus('Enter API key first', false, true);
    return;
  }

  if (!channelUrl) {
    updateStatus('Enter channel URL first', false, true);
    return;
  }

  saveSettings();

  try {
    findStreamBtn.disabled = true;
    findStreamBtn.textContent = '🔄 Searching...';

    // Pass raw input — findLiveStream handles @handle, channel/ID, and bare handles
    await findLiveStream(apiKey, channelUrl);
    updateStatus('Stream found!', false);

  } catch (error) {
    streamUrlInput.value = '';
    saveSettings();
    updateStatus('No live stream found', false, true);
  } finally {
    findStreamBtn.disabled = false;
    findStreamBtn.textContent = '🔍 Find';
  }
});

// Filter message text
function filterMessage(text) {
  if (!text || typeof text !== 'string') return '';

  let filtered = text;

  if (!readEmojisCheckbox.checked) {
    filtered = filtered.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
    filtered = filtered.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
    filtered = filtered.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
    filtered = filtered.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '');
    filtered = filtered.replace(/[\u{2600}-\u{26FF}]/gu, '');
    filtered = filtered.replace(/[\u{2700}-\u{27BF}]/gu, '');
    filtered = filtered.replace(/[\u{1F900}-\u{1F9FF}]/gu, '');
    filtered = filtered.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '');
    filtered = filtered.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '');
  }

  if (!readLinksCheckbox.checked) {
    filtered = filtered.replace(/https?:\/\/[^\s]+/g, '');
    filtered = filtered.replace(/www\.[^\s]+/g, '');
  }

  filtered = filtered.replace(/\s+/g, ' ').trim();

  return filtered;
}

// Generate custom voice audio
async function speakWithCustomVoice(voiceType, text) {
  if (voiceType.startsWith('cloned-')) {
    const voiceName = voiceType.replace('cloned-', '');

    try {
      const response = await fetch('/api/voice-clone/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, voice_name: voiceName })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.volume = volumeSlider.value / 100;

        return { audio: audio, isCloned: true };
      } else {
        console.error('Cloned voice error:', await response.text());
      }
    } catch (error) {
      console.error('Cloned voice error:', error);
    }
  }

  // Fallback to system TTS
  const utterance = new SpeechSynthesisUtterance(text);
  return { utterance: utterance, isCloned: false };
}

// Add a watchdog timer to reset isSpeaking if stuck
let speakingWatchdog = null;

// Process message queue
function processQueue() {
  console.log(`🔊 processQueue called. isSpeaking: ${isSpeaking}, queue length: ${messageQueue.length}`);
  
  if (isSpeaking || messageQueue.length === 0) {
    console.log(`🔊 Exiting: isSpeaking=${isSpeaking}, queue empty=${messageQueue.length === 0}`);
    return;
  }

  isSpeaking = true;

  // Safety watchdog: if speech doesn't end in 30 seconds, force reset
  if (speakingWatchdog) clearTimeout(speakingWatchdog);
  speakingWatchdog = setTimeout(() => {
    console.warn('⚠️ Speech watchdog triggered - forcing reset');
    isSpeaking = false;
    processQueue();
  }, 30000); // 30 seconds

  // Ensure audio context is active
  ensureAudioContext();

  const { author, text, platform, display, voiceOverride } = messageQueue.shift();
  
  console.log(`🔊 Processing: "${text}" from ${author} (${platform})`);

  // Validate that text exists before filtering
  if (!text) {
    console.warn(`🔊 No text, skipping`);
    isSpeaking = false;
    processQueue();
    return;
  }

  const filteredText = filterMessage(text);

  if (!filteredText.trim()) {
    console.warn(`🔊 Text filtered to empty, skipping`);
    isSpeaking = false;
    processQueue();
    return;
  }

  // Determine platform default voice for comparison
  let platformDefaultVoice;
  if (platform === 'youtube') {
    platformDefaultVoice = voiceSelectYouTube ? voiceSelectYouTube.value : '';
  } else if (platform === 'tiktok') {
    platformDefaultVoice = voiceSelectTikTok ? voiceSelectTikTok.value : '';
  }

  // Only add "username says:" if:
  // 1. readUsernames is checked, AND
  // 2. user doesn't have a custom voice (voiceOverride === platform default)
  const userHasCustomVoice = voiceOverride && voiceOverride !== platformDefaultVoice;

  let speechText = filteredText;
  if (readUsernamesCheckbox.checked && !userHasCustomVoice) {
    speechText = `${author} says: ${filteredText}`;
  }

  const selectedVoice = voiceOverride;

  if (selectedVoice && selectedVoice.startsWith('cloned-')) {
    speakWithCustomVoice(selectedVoice, speechText).then(result => {
      if (display !== false) {
        addChatMessage(author, text, platform, true);
      }

      if (result.isCloned) {
        result.audio.onended = () => {
          console.log('🔊 Cloned audio ended');
          if (speakingWatchdog) clearTimeout(speakingWatchdog);
          isSpeaking = false;
          processQueue();
        };
        result.audio.onerror = () => {
          console.error('🔊 Cloned audio error');
          if (speakingWatchdog) clearTimeout(speakingWatchdog);
          isSpeaking = false;
          processQueue();
        };
        result.audio.play().catch(err => {
          console.warn('⏸️ Audio autoplay blocked. Click page to enable audio.');
          if (speakingWatchdog) clearTimeout(speakingWatchdog);
          isSpeaking = false;
          unlockAudio();
        });
      } else {
        const utterance = result.utterance;
        setupUtteranceHandlers(utterance);
        synth.speak(utterance);
        currentUtterance = utterance;
      }
    });
    return;
  } else {
    const utterance = new SpeechSynthesisUtterance(speechText);

    if (selectedVoice && selectedVoice.startsWith('system-')) {
      const voiceIndex = parseInt(selectedVoice.replace('system-', ''));
      if (voices[voiceIndex]) {
        utterance.voice = voices[voiceIndex];
      }
    }

    utterance.rate = parseFloat(rateSelect.value);
    utterance.pitch = parseFloat(pitchSelect.value);
    utterance.volume = volumeSlider.value / 100;

    setupUtteranceHandlers(utterance);

    if (display !== false) {
      addChatMessage(author, text, platform, true);
    }

    synth.speak(utterance);
    currentUtterance = utterance;
  }
}

function setupUtteranceHandlers(utterance) {
  utterance.onend = () => {
    console.log('🔊 Speech ended');
    isSpeaking = false;
    processQueue();
  };

  utterance.onerror = (event) => {
    console.error('🔊 Speech error:', event);
    isSpeaking = false;
    processQueue();
  };
}

// Update status
function updateStatus(message, isActive = false, isError = false) {
  const statusIcon = statusDiv.querySelector('.status-icon');
  const statusText = statusDiv.querySelector('span');

  statusText.textContent = message;

  statusDiv.classList.remove('active', 'error');
  if (isActive) {
    statusDiv.classList.add('active');
  } else if (isError) {
    statusDiv.classList.add('error');
  }
}

function addChatMessage(author, text, platform = 'SYSTEM', isSpeaking = false, extraClass = '', allowHtml = false) {
  // Remove the placeholder on first real message
  const empty = chatFeed.querySelector('.empty-state');
  if (empty) empty.remove();

  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message' + (isSpeaking ? ' speaking' : '') + (extraClass ? ' ' + extraClass : '');

  const timestamp = new Date().toLocaleTimeString();

  // Platform badge
  let badge = '';
  if (platform === 'youtube') {
    badge = '<span class="platform-badge youtube">YouTube</span> ';
  } else if (platform === 'tiktok') {
    badge = '<span class="platform-badge tiktok">TikTok</span> ';
  }

  // Author part with avatar (if available)
  let authorHtml;
  if (author !== 'SYSTEM') {
    const avatar = window.userAvatars && window.userAvatars.get(`${platform}:${author}`);
    const avatarHtml = avatar 
      ? `<img src="${avatar}" alt="${author}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 8px; vertical-align: middle;">` 
      : '';
    
    authorHtml = `<span class="chat-author clickable" onclick="openVoiceAssignment('${author.replace(/'/g, "\\'")}', '${platform}')">${avatarHtml}${badge}${escapeHtml(author)}:</span>`;
  } else {
    authorHtml = `<span class="chat-author">${badge}${escapeHtml(text)}</span>`;
  }

  // For SYSTEM messages we already put the text in the author span, so skip the text span
  if (author === 'SYSTEM') {
    messageDiv.innerHTML = `${authorHtml}<span class="timestamp">${timestamp}</span>`;
  } else {
    // Use raw HTML if allowed (for sticker images), otherwise escape
    const textContent = allowHtml ? text : escapeHtml(text);
    messageDiv.innerHTML = `${authorHtml}<span class="chat-text">${textContent}</span><span class="timestamp">${timestamp}</span>`;
  }

  chatFeed.appendChild(messageDiv);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  // Track recent users
  if (author !== 'SYSTEM') {
    addRecentUser(`${platform}:${author}`);
    markUserOnline(author, platform);
  }

  if (isSpeaking) {
    setTimeout(() => messageDiv.classList.remove('speaking'), 3000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Speak text with platform-specific voice
function speakText(author, text, platform, shouldDisplay = true) {
  // Get platform-specific default voice
  let defaultVoice;
  if (platform === 'youtube') {
    defaultVoice = voiceSelectYouTube ? voiceSelectYouTube.value : '';
  } else if (platform === 'tiktok') {
    defaultVoice = voiceSelectTikTok ? voiceSelectTikTok.value : '';
  }

  // Check for user-specific voice
  const userVoice = getVoiceForUser(author, platform);
  const voiceToUse = userVoice || defaultVoice;

  // Show immediately in UI when requested, and only queue speech (avoid double-insert)
  if (shouldDisplay) {
    try { addChatMessage(author, text, platform, false); } catch (e) { /* ignore UI errors */ }
    messageQueue.push({ author, text, platform, display: false, voiceOverride: voiceToUse });
  } else {
    messageQueue.push({ author, text, platform, display: false, voiceOverride: voiceToUse });
  }

  processQueue();
}

// Get live chat ID
async function getLiveChatId(videoId, apiKey) {
  try {
    const response = await fetch(
      `/api/youtube/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      throw new Error('Video not found or not a live stream');
    }

    const liveChatId = data.items[0].liveStreamingDetails?.activeLiveChatId;

    if (!liveChatId) {
      throw new Error('No active live chat found');
    }

    return liveChatId;
  } catch (error) {
    throw error;
  }
}

// Poll YouTube messages

// Poll TikTok messages (chat + gifts)
let tiktokIsFirstPoll = true;


// YouTube Connect
document.getElementById('connectYouTubeBtn').addEventListener('click', async () => {
  const url = streamUrlInput.value.trim();
  const apiKey = getNextApiKey(); // Use key rotation

  if (!url) {
    updateStatus('Enter YouTube stream URL', false, true);
    return;
  }
  
  if (!apiKey || apiKeys.length === 0) {
    updateStatus('Error: No API Keys added. Please type a key and press Enter.', false, true);
    apiKeyTextInput.focus();
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    updateStatus('Invalid YouTube URL', false, true);
    return;
  }

  const connectBtn = document.getElementById('connectYouTubeBtn');
  const disconnectBtn = document.getElementById('disconnectYouTubeBtn');

  connectBtn.disabled = true;
  updateStatus('Connecting to YouTube...', true);

  try {
    youtubeLiveChatId = await getLiveChatId(videoId, apiKey);

    const now = Date.now();
    const isReconnect = youtubeLastPollTime && (now - youtubeLastPollTime < 120000);

    if (!isReconnect) {
      youtubeSeenMessages.clear();
      youtubeIsFirstPoll = true;
    }

    youtubeNextPageToken = null;
    youtubeConnected = true;
    disconnectBtn.disabled = false;
    clearOnlineUsers('youtube');

    // Request wake lock to keep audio playing in background
    requestWakeLock();

    updateStatus('YouTube connected', true);
    addChatMessage('SYSTEM', 'Connected to YouTube stream', 'youtube', false);

    pollYouTubeMessages(isReconnect);

  } catch (error) {
    updateStatus(`YouTube error: ${error.message}`, false, true);
    connectBtn.disabled = false;
  }
});

// YouTube Disconnect
function disconnectYouTube() {
  youtubeConnected = false;
  youtubeLiveChatId = null;
  youtubeNextPageToken = null;
  youtubeLastPollTime = Date.now();
  clearOnlineUsers('youtube');

  // Release wake lock if both platforms are disconnected
  if (!tiktokConnected && wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }

  document.getElementById('connectYouTubeBtn').disabled = false;
  document.getElementById('disconnectYouTubeBtn').disabled = true;

  addChatMessage('SYSTEM', 'YouTube disconnected', 'youtube', false);
  updateStatus(tiktokConnected ? 'TikTok connected' : 'Ready to connect...');
}

document.getElementById('disconnectYouTubeBtn').addEventListener('click', disconnectYouTube);

// TikTok Connect
document.getElementById('connectTikTokBtn').addEventListener('click', async () => {
  const username = document.getElementById('tiktokUsername').value.trim();

  if (!username) {
    updateStatus('Enter TikTok username', false, true);
    return;
  }

  settingsStore.setItem('tiktok_username_cache', username);

  const connectBtn = document.getElementById('connectTikTokBtn');
  const disconnectBtn = document.getElementById('disconnectTikTokBtn');

  connectBtn.disabled = true;
  updateStatus('Connecting to TikTok...', true);

  try {
    const response = await fetch('/api/tiktok/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const data = await response.json();

    if (data.success) {
      // Drain any stale messages the server accumulated during the connect handshake
      // before we start polling — otherwise they show up as duplicates.
      await fetch('/api/tiktok/messages');

      tiktokConnected = true;
      tiktokIsFirstPoll = true;
      disconnectBtn.disabled = false;
      clearOnlineUsers('tiktok');
      await refreshTikTokAudience();

      // Request wake lock to keep audio playing in background
      requestWakeLock();

      updateStatus('TikTok connected', true);
      addChatMessage('SYSTEM', `Connected to @${username}`, 'tiktok', false);

      // Use a single timeout-based scheduler to avoid duplicate polling
      if (tiktokPollInterval) {
        try { clearTimeout(tiktokPollInterval); } catch (e) { /* ignore */ }
        tiktokPollInterval = null;
      }

      // Start polling loop (pollTikTokMessages will re-schedule itself)
      pollTikTokMessages();

    } else {
      throw new Error('Connection failed');
    }
  } catch (err) {
    updateStatus(`TikTok error: ${err.message}`, false, true);
    connectBtn.disabled = false;
  }
});

// TikTok Disconnect
function disconnectTikTok() {
  tiktokConnected = false;
  tiktokLastPollTime = Date.now();
  clearOnlineUsers('tiktok');

  if (tiktokPollInterval) {
    try { clearTimeout(tiktokPollInterval); } catch (e) { /* ignore */ }
    tiktokPollInterval = null;
  }

  // Release wake lock if both platforms are disconnected
  if (!youtubeConnected && wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }

  document.getElementById('connectTikTokBtn').disabled = false;
  document.getElementById('disconnectTikTokBtn').disabled = true;

  addChatMessage('SYSTEM', 'TikTok disconnected', 'tiktok', false);
  updateStatus(youtubeConnected ? 'YouTube connected' : 'Ready to connect...');
}

document.getElementById('disconnectTikTokBtn').addEventListener('click', disconnectTikTok);

function parseRecentUserKey(userKey) {
  const text = String(userKey || '');
  const separatorIndex = text.indexOf(':');
  if (separatorIndex < 0) {
    return { platform: 'youtube', username: text };
  }
  return {
    platform: text.slice(0, separatorIndex) || 'youtube',
    username: text.slice(separatorIndex + 1)
  };
}

function getVoiceGroupsForModal() {
  return buildVoiceGroups({ includeHidden: false });
}

function getVoiceGroupKeyForVoiceId(voiceId) {
  const entry = findVoiceEntryById(voiceId);
  if (entry?.groupKey) return entry.groupKey;
  const firstGroup = getVoiceGroupsForModal()[0];
  return firstGroup ? firstGroup.key : '';
}

function buildVoiceGroupOptionsMarkup(selectedGroupKey = '') {
  const groups = getVoiceGroupsForModal();
  if (groups.length === 0) {
    return { markup: '<option value="">No language groups</option>', selectedGroupKey: '' };
  }

  const resolvedGroupKey = groups.some((group) => group.key === selectedGroupKey)
    ? selectedGroupKey
    : groups[0].key;

  const markup = groups.map((group) => {
    const selectedAttr = group.key === resolvedGroupKey ? ' selected' : '';
    return `<option value="${escapeAttribute(group.key)}"${selectedAttr}>${escapeHtml(group.label)}</option>`;
  }).join('');

  return { markup, selectedGroupKey: resolvedGroupKey };
}

function buildVoiceOptionsMarkupForGroup(groupKey = '', selectedVoiceId = '') {
  const groups = getVoiceGroupsForModal();
  if (groups.length === 0) {
    return {
      markup: '<option value="">No voices available</option>',
      selectedVoiceId: '',
      resolvedGroupKey: ''
    };
  }

  const targetGroup = groups.find((group) => group.key === groupKey) || groups[0];
  const hasSelectedVoice = selectedVoiceId
    ? targetGroup.voices.some((entry) => entry.id === selectedVoiceId)
    : false;
  const resolvedVoiceId = hasSelectedVoice
    ? selectedVoiceId
    : (targetGroup.voices[0]?.id || '');

  const markup = targetGroup.voices.length > 0
    ? targetGroup.voices.map((entry) => {
      const selectedAttr = entry.id === resolvedVoiceId ? ' selected' : '';
      return `<option value="${escapeAttribute(entry.id)}"${selectedAttr}>${escapeHtml(entry.name)}</option>`;
    }).join('')
    : '<option value="">No voices in this group</option>';

  return {
    markup,
    selectedVoiceId: resolvedVoiceId,
    resolvedGroupKey: targetGroup.key
  };
}

function bindManageVoicesModalControls(container) {
  if (!container) return;

  container.querySelectorAll('.user-voice-group-select').forEach((groupSelect) => {
    groupSelect.addEventListener('change', () => {
      const card = groupSelect.closest('.user-voice-item');
      if (!card) return;

      const voiceSelect = card.querySelector('.user-voice-select');
      if (!voiceSelect) return;

      const username = card.dataset.username || '';
      const platform = card.dataset.platform || '';
      const previousVoice = voiceSelect.value || '';
      const nextGroup = groupSelect.value || '';
      const nextOptions = buildVoiceOptionsMarkupForGroup(nextGroup, previousVoice);
      const groupHint = card.querySelector('.user-voice-group-hint');

      voiceSelect.innerHTML = nextOptions.markup;
      if (nextOptions.selectedVoiceId) {
        voiceSelect.value = nextOptions.selectedVoiceId;
      }
      if (groupHint) {
        groupHint.textContent = VOICE_GROUP_LABELS[nextOptions.resolvedGroupKey] || 'Voices';
      }

      if (
        nextOptions.selectedVoiceId &&
        nextOptions.selectedVoiceId !== previousVoice &&
        username &&
        platform
      ) {
        setVoiceForUser(username, platform, nextOptions.selectedVoiceId);
      }
    });
  });

  container.querySelectorAll('.user-voice-select').forEach((voiceSelect) => {
    voiceSelect.addEventListener('change', () => {
      const card = voiceSelect.closest('.user-voice-item');
      if (!card) return;

      const username = card.dataset.username || '';
      const platform = card.dataset.platform || '';
      const selectedVoice = voiceSelect.value || '';
      if (!username || !platform || !selectedVoice) return;

      setVoiceForUser(username, platform, selectedVoice);
    });
  });

  container.querySelectorAll('.user-voice-remove-btn').forEach((removeBtn) => {
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const card = removeBtn.closest('.user-voice-item');
      if (!card) return;

      const username = card.dataset.username || '';
      const platform = card.dataset.platform || '';
      if (!username || !platform) return;
      removeUserVoice(username, platform);
    });
  });
}

function renderManageUserVoicesModal() {
  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');
  setVoiceModalWideLayout(true);
  setVoiceModalHeader(
    'Manage User Voices',
    'Assign voices by language group, then pick a specific voice.'
  );

  if (!list || !modal) return;
  list.classList.add('voice-grid-layout');

  if (recentUsers.length === 0) {
    list.innerHTML = '<p class="user-voice-empty" style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users yet.</p>';
    modal.style.display = 'flex';
    return;
  }

  const usersWithGroups = recentUsers.map((userKey) => {
    const { platform, username } = parseRecentUserKey(userKey);
    const currentVoice = getVoiceForUser(username, platform);
    const initialGroup = getVoiceGroupKeyForVoiceId(currentVoice);
    return { platform, username, currentVoice, initialGroup };
  }).sort((a, b) => {
    const aIndex = Math.max(0, VOICE_GROUP_ORDER.indexOf(a.initialGroup));
    const bIndex = Math.max(0, VOICE_GROUP_ORDER.indexOf(b.initialGroup));
    if (aIndex !== bIndex) return aIndex - bIndex;
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    return a.username.localeCompare(b.username, undefined, { sensitivity: 'base', numeric: true });
  });

  list.innerHTML = usersWithGroups.map(({ platform, username, currentVoice, initialGroup }) => {
    const groupOptions = buildVoiceGroupOptionsMarkup(initialGroup);
    const voiceOptions = buildVoiceOptionsMarkupForGroup(groupOptions.selectedGroupKey, currentVoice);
    const groupLabel = VOICE_GROUP_LABELS[groupOptions.selectedGroupKey] || 'Voices';

    const platformBadge = platform === 'youtube'
      ? '<span class="platform-badge youtube">YouTube</span>'
      : '<span class="platform-badge tiktok">TikTok</span>';

    return `
      <div class="user-voice-item voice-card" data-platform="${escapeAttribute(platform)}" data-username="${escapeAttribute(username)}">
        <div class="username">
          <span class="user-voice-name">
            ${platformBadge}
            <span class="user-voice-name-text">${escapeHtml(username)}</span>
          </span>
          <span class="user-voice-group-hint" title="Current language group">${escapeHtml(groupLabel)}</span>
        </div>
        <div class="user-voice-controls-grid">
          <select class="user-voice-group-select" title="Language group">
            ${groupOptions.markup}
          </select>
          <select class="user-voice-select" title="Voice">
            ${voiceOptions.markup}
          </select>
          <button class="user-voice-remove-btn" title="Remove custom voice">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  bindManageVoicesModalControls(list);
  modal.style.display = 'flex';
}

// Voice assignment modal
window.openVoiceAssignment = function(username, platform) {
  const currentVoice = getVoiceForUser(username, platform);
  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');
  setVoiceModalWideLayout(false);
  if (list) list.classList.remove('voice-grid-layout');

  const platformBadge = platform === 'youtube'
    ? '<span class="platform-badge youtube">YouTube</span>'
    : '<span class="platform-badge tiktok">TikTok</span>';
  const optionsMarkup = buildVoiceOptionsMarkup(currentVoice);

  list.innerHTML = `
    <div class="user-voice-item">
      <div class="username">${platformBadge}${username}</div>
      <select id="voiceSelectModal">
        ${optionsMarkup}
      </select>
      <button onclick="assignVoice('${username.replace(/'/g, "\\'")}', '${platform}')">Set Voice</button>
    </div>
  `;

  modal.style.display = 'flex';
};

window.assignVoice = function(username, platform) {
  const voiceId = document.getElementById('voiceSelectModal').value;
  setVoiceForUser(username, platform, voiceId);
  closeVoiceModal();
};

window.closeVoiceModal = function() {
  document.getElementById('voiceModal').style.display = 'none';
};

function setVoiceModalHeader(title, subtitle) {
  const titleEl = document.getElementById('voiceModalTitle');
  const subtitleEl = document.getElementById('voiceModalSubtitle');
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

function setVoiceModalWideLayout(enabled) {
  const modalPanel = document.querySelector('#voiceModal .modal');
  if (!modalPanel) return;
  modalPanel.classList.toggle('voice-modal-wide', Boolean(enabled));
}

// Manage voices button
document.getElementById('manageVoicesBtn').addEventListener('click', renderManageUserVoicesModal);

window.removeUserVoice = function(username, platform) {
  const userKey = `${platform}:${username}`;
  delete userVoices[userKey];
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice for "${username}" (${platform}) removed`, 'SYSTEM', false);
  renderManageUserVoicesModal();
};

// Close modal on overlay click
document.getElementById('voiceModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeVoiceModal();
  }
});

// Global animation trigger checkbox
const globalAnimationTriggerCheckbox = document.getElementById('globalAnimationTrigger');
if (globalAnimationTriggerCheckbox) {
  globalAnimationTriggerCheckbox.checked = globalAnimationTriggerEnabled;
  
  globalAnimationTriggerCheckbox.addEventListener('change', () => {
    globalAnimationTriggerEnabled = globalAnimationTriggerCheckbox.checked;
    saveAnimationPermissions();
    console.log('Global animation trigger:', globalAnimationTriggerEnabled ? 'enabled' : 'disabled');
  });
}

// Manage permissions button
document.getElementById('manageAnimationPermissionsBtn')?.addEventListener('click', () => {
  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');
  setVoiceModalWideLayout(false);
  if (list) list.classList.remove('voice-grid-layout');
  setVoiceModalHeader(
    'Per-User Animation Permissions',
    'Control which users can trigger animations with stickers.'
  );
  
  if (recentUsers.length === 0) {
    list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users yet.</p>';
  } else {
    list.innerHTML = `
      <div style="margin-bottom: 16px; padding: 10px; background: rgba(255, 107, 107, 0.08); border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary);">
        <strong>Default:</strong> Follow global setting (currently ${globalAnimationTriggerEnabled ? 'enabled' : 'disabled'})<br>
        <strong>Allow:</strong> Can trigger animations even if global is disabled<br>
        <strong>Deny:</strong> Cannot trigger animations even if global is enabled
      </div>
      ${recentUsers.map(userKey => {
        const [platform, username] = userKey.split(':');
        const permission = userAnimationPermissions[userKey] || 'default';
        
        const platformBadge = platform === 'youtube'
          ? '<span class="platform-badge youtube">YouTube</span>'
          : '<span class="platform-badge tiktok">TikTok</span>';
        
        return `
          <div class="user-voice-item">
            <div class="username">${platformBadge}${username}</div>
            <select onchange="setUserAnimationPermission('${userKey.replace(/'/g, "\\'")}', this.value)">
              <option value="default" ${permission === 'default' ? 'selected' : ''}>⚙️ Default</option>
              <option value="allow" ${permission === 'allow' ? 'selected' : ''}>✅ Allow</option>
              <option value="deny" ${permission === 'deny' ? 'selected' : ''}>🚫 Deny</option>
            </select>
          </div>
        `;
      }).join('')}
    `;
  }
  
  modal.style.display = 'flex';
});

// Set user permission
window.setUserAnimationPermission = function(userKey, permission) {
  if (permission === 'default') {
    delete userAnimationPermissions[userKey];
  } else {
    userAnimationPermissions[userKey] = permission;
  }
  saveAnimationPermissions();
  
  const [platform, username] = userKey.split(':');
  addChatMessage('SYSTEM', `Animation trigger for "${username}" (${platform}): ${permission}`, 'SYSTEM', false);
};


// Test voice buttons
testVoiceYouTubeBtn.addEventListener('click', () => {
  const testMsg = testMessageInput.value.trim() || DEFAULT_TEST_MESSAGE;
  const voiceId = voiceSelectYouTube.value;

  if (!voiceId) {
    addChatMessage('SYSTEM', 'No YouTube voice selected', 'SYSTEM', false);
    return;
  }

  // Bypass the queue — speak immediately
  if (voiceId.startsWith('cloned-')) {
    speakWithCustomVoice(voiceId, testMsg).then(result => {
      if (result.isCloned) {
        result.audio.play().catch(err => {
          console.warn('⏸️ Test voice blocked. Click page first.');
          unlockAudio();
        });
      } else {
        synth.speak(result.utterance);
      }
    });
  } else {
    const utterance = new SpeechSynthesisUtterance(testMsg);
    if (voiceId.startsWith('system-')) {
      const voiceIndex = parseInt(voiceId.replace('system-', ''));
      if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];
    }
    utterance.rate = parseFloat(rateSelect.value);
    utterance.pitch = parseFloat(pitchSelect.value);
    utterance.volume = volumeSlider.value / 100;
    synth.speak(utterance);
  }

  addChatMessage('SYSTEM', `Testing YouTube voice: ${getVoiceName(voiceId)}`, 'SYSTEM', false);
});

testVoiceTikTokBtn.addEventListener('click', () => {
  const testMsg = testMessageInput.value.trim() || DEFAULT_TEST_MESSAGE;
  const voiceId = voiceSelectTikTok.value;

  if (!voiceId) {
    addChatMessage('SYSTEM', 'No TikTok voice selected', 'SYSTEM', false);
    return;
  }

  // Bypass the queue — speak immediately
  if (voiceId.startsWith('cloned-')) {
    speakWithCustomVoice(voiceId, testMsg).then(result => {
      if (result.isCloned) {
        result.audio.play().catch(err => {
          console.warn('⏸️ Test voice blocked. Click page first.');
          unlockAudio();
        });
      } else {
        synth.speak(result.utterance);
      }
    });
  } else {
    const utterance = new SpeechSynthesisUtterance(testMsg);
    if (voiceId.startsWith('system-')) {
      const voiceIndex = parseInt(voiceId.replace('system-', ''));
      if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];
    }
    utterance.rate = parseFloat(rateSelect.value);
    utterance.pitch = parseFloat(pitchSelect.value);
    utterance.volume = volumeSlider.value / 100;
    synth.speak(utterance);
  }

  addChatMessage('SYSTEM', `Testing TikTok voice: ${getVoiceName(voiceId)}`, 'SYSTEM', false);
});

// Load settings and voices on page load
loadSettings();
loadUserVoices();
renderOnlineUsers();
setInterval(renderOnlineUsers, 15000);
setInterval(() => {
  if (tiktokConnected) {
    void refreshTikTokAudience();
  }
}, 4000);

// Auto-connect to both platforms on page load
setTimeout(async () => {
  const tiktokUsername = document.getElementById('tiktokUsername').value.trim();

  // Smart YouTube auto-connect
  const hasApiKey = apiKeys.length > 0;
  const streamUrl = streamUrlInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();

  if (hasApiKey) {
    if (streamUrl) {
      // Try the saved stream URL first
      console.log('Auto-connecting to YouTube with saved stream URL...');
      const videoId = extractVideoId(streamUrl);

      if (videoId) {
        try {
          const apiKey = getNextApiKey();
          const liveChatId = await getLiveChatId(videoId, apiKey);
          // Success — proceed with normal connection
          document.getElementById('connectYouTubeBtn').click();
        } catch (error) {
          console.log('Saved stream URL failed, clearing and trying auto-find...', error.message);
          streamUrlInput.value = '';
          saveSettings();

          // Fall back to auto-finding from channel URL
          if (channelUrl) {
            try {
              const apiKey = getNextApiKey();
              const foundUrl = await findLiveStream(apiKey, channelUrl);
              // findLiveStream already sets streamUrlInput.value and saves
              console.log('Auto-found stream, connecting...');
              setTimeout(() => document.getElementById('connectYouTubeBtn').click(), 500);
            } catch (findError) {
              console.log('Auto-find also failed:', findError.message);
              updateStatus('No live stream found for auto-connect', false, false);
            }
          }
        }
      } else {
        // Invalid stream URL format — clear it and try auto-find
        console.log('Invalid stream URL format, clearing...');
        streamUrlInput.value = '';
        saveSettings();

        if (channelUrl) {
          try {
            const apiKey = getNextApiKey();
            await findLiveStream(apiKey, channelUrl);
            setTimeout(() => document.getElementById('connectYouTubeBtn').click(), 500);
          } catch (error) {
            console.log('Auto-find failed:', error.message);
          }
        }
      }
    } else if (channelUrl) {
      // No stream URL saved — try auto-finding from channel
      console.log('No saved stream URL, trying to auto-find...');
      try {
        const apiKey = getNextApiKey();
        await findLiveStream(apiKey, channelUrl);
        setTimeout(() => document.getElementById('connectYouTubeBtn').click(), 500);
      } catch (error) {
        console.log('Auto-find failed:', error.message);
      }
    }
  }

  // Auto-connect TikTok if we have username
  if (tiktokUsername) {
    console.log('Auto-connecting to TikTok...');
    setTimeout(() => {
      document.getElementById('connectTikTokBtn').click();
    }, 1500);
  }
}, 1500);

// ─── Gift Sound Effects & Overlays ───────────────────────────────────

// Sound effects system
const giftSoundSelect = document.getElementById('giftSoundSelect');
const customSoundUpload = document.getElementById('customSoundUpload');
const uploadSoundBtn = document.getElementById('uploadSoundBtn');
const customSoundManageSelect = document.getElementById('customSoundManageSelect');
const deleteCustomSoundBtn = document.getElementById('deleteCustomSoundBtn');
const giftSoundSelectBaseMarkup = giftSoundSelect ? giftSoundSelect.innerHTML : '';
let customGiftSounds = [];

function populateCustomSoundManageSelect(selectedFilename = '') {
  if (!customSoundManageSelect) return;

  customSoundManageSelect.innerHTML = '<option value="">Custom sounds...</option>';
  customGiftSounds.forEach(sound => {
    const option = document.createElement('option');
    option.value = sound.filename;
    option.textContent = `🎵 ${sound.filename}`;
    if (selectedFilename && sound.filename === selectedFilename) {
      option.selected = true;
    }
    customSoundManageSelect.appendChild(option);
  });

  if (!selectedFilename && customGiftSounds.length === 0) {
    customSoundManageSelect.value = '';
  }
}

function rebuildGiftSoundSelect(selectedValue = '') {
  if (!giftSoundSelect) return;

  const preferredValue = selectedValue || settingsStore.getItem('gift_sound_preference') || giftSoundSelect.value || '';
  giftSoundSelect.innerHTML = giftSoundSelectBaseMarkup;

  customGiftSounds.forEach(sound => {
    const option = document.createElement('option');
    option.value = `custom-${sound.path}`;
    option.textContent = `🎵 ${sound.filename}`;
    giftSoundSelect.appendChild(option);
  });

  const hasPreferred = Array.from(giftSoundSelect.options).some(opt => opt.value === preferredValue);
  giftSoundSelect.value = hasPreferred ? preferredValue : '';
  settingsStore.setItem('gift_sound_preference', giftSoundSelect.value);

  populateCustomSoundManageSelect();
  renderGiftMappings();
}

// Play gift sound when gifts are received
function playGiftSound() {
  const selectedSound = giftSoundSelect ? giftSoundSelect.value : '';

  if (!selectedSound) return; // No sound selected

  if (selectedSound.startsWith('custom-')) {
    // Play custom uploaded sound
    const soundPath = selectedSound.replace('custom-', '');
    const audio = new Audio(soundPath);
    audio.volume = volumeSlider.value / 100;
    audio.play().catch(err => console.error('Sound play error:', err));
  } else {
    // Play built-in synthesized sound
    playBuiltInSound(selectedSound);
  }
}

function playBuiltInSound(type) {
  const ctx = ensureAudioContext();
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  const volume = (volumeSlider.value / 100) * 0.3; // Max 30% volume

  switch(type) {
    case 'ding':
      oscillator.frequency.setValueAtTime(800, now);
      gainNode.gain.setValueAtTime(volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
      break;

    case 'coin':
      oscillator.frequency.setValueAtTime(400, now);
      oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.1);
      gainNode.gain.setValueAtTime(volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      oscillator.start(now);
      oscillator.stop(now + 0.2);
      break;

    case 'chime':
      oscillator.frequency.setValueAtTime(523, now);
      oscillator.frequency.setValueAtTime(659, now + 0.15);
      gainNode.gain.setValueAtTime(volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      oscillator.start(now);
      oscillator.stop(now + 0.4);
      break;

    case 'applause':
      const bufferSize = ctx.sampleRate * 0.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.2));
      }

      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.connect(gainNode);
      gainNode.gain.setValueAtTime(volume * 0.5, now);
      noiseSource.start(now);
      break;

    // ── Anime Sounds ──
    case 'anime-sparkle':
      // Ascending sparkle sound
      oscillator.frequency.setValueAtTime(1200, now);
      oscillator.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
      gainNode.gain.setValueAtTime(volume * 0.8, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
      break;

    case 'anime-powerup':
      // Power-up sound (fast ascending)
      oscillator.frequency.setValueAtTime(220, now);
      oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08);
      oscillator.frequency.exponentialRampToValueAtTime(1760, now + 0.16);
      gainNode.gain.setValueAtTime(volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      oscillator.start(now);
      oscillator.stop(now + 0.25);
      break;

    case 'anime-notification':
      // Triple beep notification
      const beep1 = ctx.createOscillator();
      const beep2 = ctx.createOscillator();
      const beep3 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();
      const gain3 = ctx.createGain();

      [beep1, beep2, beep3].forEach((osc, i) => {
        const g = [gain1, gain2, gain3][i];
        osc.connect(g);
        g.connect(ctx.destination);
        osc.frequency.value = 1000;
        g.gain.setValueAtTime(volume * 0.6, now + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.1);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.1);
      });
      return; // Skip default oscillator cleanup

    case 'anime-coin':
      // Mario-style coin
      oscillator.frequency.setValueAtTime(988, now);     // B5
      oscillator.frequency.setValueAtTime(1319, now + 0.1); // E6
      gainNode.gain.setValueAtTime(volume, now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
      break;

    case 'anime-victory':
      // Victory jingle (do-mi-so-do)
      const v1 = ctx.createOscillator();
      const v2 = ctx.createOscillator();
      const v3 = ctx.createOscillator();
      const v4 = ctx.createOscillator();
      const vg1 = ctx.createGain();
      const vg2 = ctx.createGain();
      const vg3 = ctx.createGain();
      const vg4 = ctx.createGain();

      const notes = [
        { osc: v1, gain: vg1, freq: 523, start: 0 },    // C
        { osc: v2, gain: vg2, freq: 659, start: 0.1 },  // E
        { osc: v3, gain: vg3, freq: 784, start: 0.2 },  // G
        { osc: v4, gain: vg4, freq: 1047, start: 0.3 }  // C
      ];

      notes.forEach(({ osc, gain, freq, start }) => {
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume * 0.7, now + start);
        gain.gain.exponentialRampToValueAtTime(0.01, now + start + 0.2);
        osc.start(now + start);
        osc.stop(now + start + 0.2);
      });
      return; // Skip default oscillator cleanup
  }
}

// Upload custom sound
if (uploadSoundBtn) {
  uploadSoundBtn.addEventListener('click', async () => {
    const file = customSoundUpload?.files?.[0];

    if (!file) {
      updateStatus('Please select a sound file first', false, true);
      return;
    }

    const formData = new FormData();
    formData.append('sound', file);

    try {
      uploadSoundBtn.disabled = true;
      uploadSoundBtn.textContent = 'Uploading...';

      const response = await fetch('/api/sounds/upload', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        const uploadedSoundValue = `custom-${data.path}`;
        settingsStore.setItem('gift_sound_preference', uploadedSoundValue);
        await loadCustomSounds(uploadedSoundValue);

        updateStatus(`✓ Sound uploaded: ${data.filename}`, false);
        if (customSoundUpload) customSoundUpload.value = '';

      } else {
        throw new Error(data.error || 'Upload failed');
      }

    } catch (error) {
      console.error('Upload error:', error);
      updateStatus(`Upload failed: ${error.message}`, false, true);
    } finally {
      uploadSoundBtn.disabled = false;
      uploadSoundBtn.textContent = 'Upload';
    }
  });
}

// Load available custom sounds
async function loadCustomSounds(selectedSoundOverride = '') {
  try {
    const response = await fetch('/api/sounds/list');
    const data = await response.json();

    customGiftSounds = (data.custom || []).map(sound => ({
      filename: sound.name,
      path: sound.path
    }));

    rebuildGiftSoundSelect(selectedSoundOverride);

  } catch (error) {
    console.error('Error loading custom sounds:', error);
  }
}

// Save sound preference
if (giftSoundSelect) {
  giftSoundSelect.addEventListener('change', () => {
    settingsStore.setItem('gift_sound_preference', giftSoundSelect.value);
    renderGiftMappings();
  });
}

if (deleteCustomSoundBtn) {
  deleteCustomSoundBtn.addEventListener('click', async () => {
    const filename = customSoundManageSelect?.value || '';
    if (!filename) {
      updateStatus('Select a custom sound to delete', false, true);
      return;
    }

    const shouldDelete = confirm(`Delete custom sound "${filename}"?`);
    if (!shouldDelete) return;

    try {
      deleteCustomSoundBtn.disabled = true;
      deleteCustomSoundBtn.textContent = 'Deleting...';

      const response = await fetch(`/api/sounds/custom/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Delete failed');
      }

      const removedSoundValue = `custom-/sounds/custom/${filename}`;

      if (giftSoundSelect && giftSoundSelect.value === removedSoundValue) {
        settingsStore.setItem('gift_sound_preference', '');
      }

      if (typeof giftMappings === 'object' && giftMappings) {
        if (giftMappings.default?.type === 'sound' && giftMappings.default.value === removedSoundValue) {
          giftMappings.default.value = '';
        }
        Object.values(giftMappings.byName || {}).forEach(entry => {
          if (entry?.type === 'sound' && entry.value === removedSoundValue) {
            entry.value = '';
          }
        });
        Object.values(giftMappings.byValue || {}).forEach(entry => {
          if (entry?.type === 'sound' && entry.value === removedSoundValue) {
            entry.value = '';
          }
        });
        saveGiftMappings();
      }

      await loadCustomSounds();
      updateStatus(`✓ Sound deleted: ${filename}`, false);
    } catch (error) {
      console.error('Delete custom sound error:', error);
      updateStatus(`Delete failed: ${error.message}`, false, true);
    } finally {
      deleteCustomSoundBtn.disabled = false;
      deleteCustomSoundBtn.textContent = '🗑️ Delete';
    }
  });
}

// Copy overlay URL buttons
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);

    if (!input) return;

    input.select();
    input.setSelectionRange(0, 99999);

    navigator.clipboard.writeText(input.value).then(() => {
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = 'var(--success)';

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 2000);
    }).catch(err => {
      console.error('Copy failed:', err);
      updateStatus('Copy failed - please copy manually', false, true);
    });
  });
});

// Initialize
loadCustomSounds();

// Make playGiftSound available globally so pollTikTokMessages can call it
window.playGiftSound = playGiftSound;

// ─── AI-Powered Gender Detection & Voice Assignment ─────────────────

// UI Elements
const autoGenderDetectionCheckbox = document.getElementById('autoGenderDetection');
const maleVoiceSelect = document.getElementById('maleVoiceSelect');
const femaleVoiceSelect = document.getElementById('femaleVoiceSelect');

// Gender cache (persistent across sessions)
let genderCache = {};
let ollamaOnline = false;

// Load gender cache from settingsStore
function loadGenderCache() {
  try {
    const saved = settingsStore.getItem('gender_cache');
    if (saved) genderCache = JSON.parse(saved);
  } catch (e) {
    console.error('Error loading gender cache:', e);
    genderCache = {};
  }
}

// Save gender cache to settingsStore
function saveGenderCache() {
  try {
    settingsStore.setItem('gender_cache', JSON.stringify(genderCache));
  } catch (e) {
    console.error('Error saving gender cache:', e);
  }
}

function setOllamaStatus(online) {
  ollamaOnline = Boolean(online);
  if (!ollamaStatusEl) return;
  ollamaStatusEl.classList.remove('online', 'offline');
  if (online) {
    ollamaStatusEl.classList.add('online');
    ollamaStatusEl.textContent = 'Ollama: online (LLM detection active)';
  } else {
    ollamaStatusEl.classList.add('offline');
    ollamaStatusEl.textContent = 'Ollama: offline (start ollama serve to enable auto-detection)';
  }
}

async function refreshOllamaStatus() {
  if (!ollamaStatusEl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: controller.signal
    });
    setOllamaStatus(response.ok);
  } catch (error) {
    setOllamaStatus(false);
  } finally {
    clearTimeout(timeout);
  }
}

// Populate male/female voice selectors
function populateGenderVoiceSelects() {
  if (!maleVoiceSelect || !femaleVoiceSelect) return;

  const savedMale = settingsStore.getItem('default_male_voice');
  const savedFemale = settingsStore.getItem('default_female_voice');
  const currentMale = maleVoiceSelect.value;
  const currentFemale = femaleVoiceSelect.value;

  const selectedMale = populateVoiceSelectElement(maleVoiceSelect, savedMale || currentMale);
  const selectedFemale = populateVoiceSelectElement(femaleVoiceSelect, savedFemale || currentFemale);

  const visibleSystemVoices = getAllVoiceEntries({ includeHidden: false })
    .filter((entry) => !entry.isCloned);

  if (!savedMale && !currentMale) {
    const maleVoice = visibleSystemVoices.find((entry) => (
      /male|man|boy|david|mark|george|daniel|thomas/i.test(entry.name)
    ));
    if (maleVoice) maleVoiceSelect.value = maleVoice.id;
  }

  if (!savedFemale && !currentFemale) {
    const femaleVoice = visibleSystemVoices.find((entry) => (
      /female|woman|girl|samantha|victoria|zira|anna|karen|moira/i.test(entry.name)
    ));
    if (femaleVoice) femaleVoiceSelect.value = femaleVoice.id;
  }

  const finalMale = maleVoiceSelect.value || selectedMale;
  const finalFemale = femaleVoiceSelect.value || selectedFemale;
  if (!savedMale && finalMale) settingsStore.setItem('default_male_voice', finalMale);
  if (!savedFemale && finalFemale) settingsStore.setItem('default_female_voice', finalFemale);

  console.log('✓ Gender voice selects populated');
}

// Save preferences when changed
if (maleVoiceSelect) {
  maleVoiceSelect.addEventListener('change', () => {
    settingsStore.setItem('default_male_voice', maleVoiceSelect.value);
    console.log('Saved default male voice:', maleVoiceSelect.value);
  });
}

if (femaleVoiceSelect) {
  femaleVoiceSelect.addEventListener('change', () => {
    settingsStore.setItem('default_female_voice', femaleVoiceSelect.value);
    console.log('Saved default female voice:', femaleVoiceSelect.value);
  });
}

// Detect gender using LLM (Ollama)
async function detectGenderWithLLM(username) {
  if (!ollamaOnline) return null;

  const prompt = `Username: "${username}"

Task: Predict user's gender based on this username. Consider:
- Names hidden in leet speak (e.g., "3m1ly" = Emily, "D4N13L" = Daniel)
- Decorations like xX, _, numbers, special characters
- Keywords like "girl", "boy", "queen", "king", "princess", "lord"
- International names and unicode characters
- Gaming culture naming patterns

Respond with ONLY ONE WORD (lowercase):
male
female
neutral

Answer:`;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3:8b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1,  // Low temp for consistency
          num_predict: 5     // Only need 1 word
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    const answer = data.response.trim().toLowerCase();

    // Validate response
    if (['male', 'female', 'neutral'].includes(answer)) {
      console.log(`🤖 LLM detected: ${username} → ${answer}`);
      return answer;
    }

    console.warn(`⚠️ Invalid LLM response for ${username}: "${answer}"`);
    return null;

  } catch (error) {
    console.error('❌ LLM gender detection error:', error.message);
    return null;
  }
}

// Main gender detection (with caching)
async function detectGender(username) {
  const cacheKey = username.toLowerCase();

  // Check cache first
  if (genderCache[cacheKey]) {
    console.log(`💾 Cached gender for ${username}: ${genderCache[cacheKey]}`);
    return genderCache[cacheKey];
  }

  // Detect with LLM
  const gender = await detectGenderWithLLM(username);
  if (!gender) return null;

  // Cache result
  genderCache[cacheKey] = gender;
  saveGenderCache();

  return gender;
}

// Auto-assign voice based on detected gender
async function autoAssignVoiceIfNeeded(author, platform) {
  const userKey = `${platform}:${author}`;

  // Skip if already has assigned voice
  if (userVoices[userKey]) return;

  // Skip if auto-detection disabled
  if (!autoGenderDetectionCheckbox || !autoGenderDetectionCheckbox.checked) return;
  if (!ollamaOnline) return;

  // Skip if gender voice selects aren't populated yet
  if (!maleVoiceSelect || !femaleVoiceSelect) return;

  try {
    // Detect gender (cached if seen before)
    const gender = await detectGender(author);
    if (!gender) return;

    let assignedVoice = null;

    if (gender === 'male') {
      assignedVoice = maleVoiceSelect.value;
    } else if (gender === 'female') {
      assignedVoice = femaleVoiceSelect.value;
    }

    // Assign voice
    if (assignedVoice && gender !== 'neutral') {
      userVoices[userKey] = assignedVoice;
      saveUserVoices();

      const voiceName = getVoiceName(assignedVoice);
      console.log(`✨ Auto-assigned ${gender} voice to ${author}: ${voiceName}`);

      // Optional: Show notification in chat (can be disabled if too noisy)
      // addChatMessage('SYSTEM', `🤖 Auto-assigned ${gender} voice to ${author}`, 'SYSTEM', false);
    }

  } catch (error) {
    console.error('Auto-assign voice error:', error);
  }
}

// Play a specific sound by ID
function playSpecificSound(soundId) {
  if (!soundId) {
    // Empty = use default gift sound
    if (window.playGiftSound) window.playGiftSound();
    return;
  }
  
  if (soundId.startsWith('custom-')) {
    // Play custom uploaded sound
    const soundPath = soundId.replace('custom-', '');
    const audio = new Audio(soundPath);
    audio.volume = volumeSlider.value / 100;
    audio.play().catch(err => console.error('Sound play error:', err));
  } else {
    // Play built-in synthesized sound
    playBuiltInSound(soundId);
  }
}

async function pollTikTokMessages() {
  if (!tiktokConnected) return;

  try {
    const response = await fetch('/api/tiktok/messages');
    const messages = await response.json();

    tiktokLastPollTime = Date.now();

    if (!messages || messages.length === 0) return;

    // Helper function to generate unique message ID
    const getMessageId = (msg) => {
      if (msg.type === 'gift') {
        return `gift-${msg.author}-${msg.giftName}-${msg.repeatCount}-${msg.timestamp}`;
      } else if (msg.type === 'emote') {
        const emoteId = msg.primaryEmoteId || (msg.emotes && msg.emotes[0]?.emoteId) || msg.emoteId;
        return `emote-${msg.author}-${emoteId}-${msg.timestamp}`;
      } else if (msg.type === 'combined') {
        return `combined-${msg.author}-${msg.timestamp}`;
      } else {
        return `chat-${msg.author}-${msg.text || 'empty'}-${msg.timestamp}`;
      }
    };

    // Helper function to process a single message
    const processMessage = async (msg, shouldSpeak = true, isFirstPoll = false) => {
      // Cache avatar
      if (msg.authorAvatar) {
        window.userAvatars.set(`tiktok:${msg.author}`, msg.authorAvatar);
      }

      if (msg.type === 'gift') {
        // Handle gift
        const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
        console.log(`🎁 TikTok gift: ${msg.author} — ${msg.giftName} x${msg.repeatCount} (${msg.diamondCount}💎)`);
        console.log(`🎁 isFirstPoll: ${isFirstPoll}`); // ← ADD THIS
        addChatMessage(msg.author, giftText, 'tiktok', false, 'gift');
        
        if (!isFirstPoll) {
          console.log(`🎁 Processing gift action (not first poll)`); // ← ADD THIS
          // Get the action for this gift
          const action = getGiftAction(msg.giftName, msg.diamondCount);
          
          if (action && action.type === 'animation' && action.value) {
            // Trigger animation
            console.log(`🎬 Triggering animation for gift ${msg.giftName}: ${action.value}`);
            triggerAnimation(action.value, 'tiktok', msg.author);
            
          } else if (action && action.type === 'sound' && action.value) {
            // Play specific sound
            console.log(`🔊 Playing specific sound for gift ${msg.giftName}: ${action.value}`);
            playSpecificSound(action.value);
            
          } else {
            // Fall back to default gift sound
            if (window.playGiftSound) window.playGiftSound();
          }
        } else {
          console.log(`🎁 Skipping gift action (first poll)`); // ← ADD THIS
        }
      } else if (msg.type === 'combined') {
        // Handle text + stickers combined
        console.log(`💬🖼️ TikTok combined message from ${msg.author}:`, msg);

        const stickersHTML = buildStickerChatListHtml(msg.emotes || []);
        const combinedHTML = `${escapeHtml(msg.text)}${stickersHTML ? `<br>${stickersHTML}` : ''}`;
        
        addChatMessage(msg.author, combinedHTML, 'tiktok', false, 'combined', true);
        
        // Trigger animation ONCE for the first sticker only (SKIP on first poll)
        if (!isFirstPoll && msg.emotes.length > 0 && typeof handleStickerAnimation === 'function') {
          if (canUserTriggerAnimations(msg.author, 'tiktok')) {
            console.log(`🎬 Triggering animation for combined message from ${msg.author}`);
            handleStickerAnimation({
              type: 'emote',
              author: msg.author,
              authorName: msg.authorName,
              emoteId: msg.emotes[0].emoteId,
              emoteName: `sticker_${msg.emotes[0].emoteId}`,
              emoteImage: msg.emotes[0].emoteImage
            });
          } else {
            console.log(`🚫 Animation blocked for ${msg.author} (combined message)`);
          }
        }
        
      } else if (msg.type === 'emote') {
        // Handle stickers only (multiple stickers, no text)
        console.log(`🖼️ TikTok stickers from ${msg.author}:`, msg);

        const stickersHTML = buildStickerChatListHtml(msg.emotes || []);

        addChatMessage(msg.author, stickersHTML, 'tiktok', false, 'sticker', true);
        
        // Trigger animation ONCE for the first sticker only (SKIP on first poll)
        if (!isFirstPoll && typeof handleStickerAnimation === 'function') {
          if (canUserTriggerAnimations(msg.author, 'tiktok')) {
            console.log(`🎬 Triggering animation for sticker from ${msg.author}`);
            handleStickerAnimation({
              type: 'emote',
              author: msg.author,
              authorName: msg.authorName,
              emoteId: msg.primaryEmoteId || msg.emotes[0].emoteId,
              emoteName: `sticker_${msg.primaryEmoteId || msg.emotes[0].emoteId}`,
              emoteImage: msg.emotes[0].emoteImage
            });
          } else {
            console.log(`🚫 Animation blocked for ${msg.author} (sticker only)`);
          }
        }
      } else if (msg.text && msg.text.trim()) {
        // Handle regular text message
        console.log(`💬 Text message from ${msg.author}: "${msg.text}"`);
        
        await autoAssignVoiceIfNeeded(msg.author, 'tiktok');
        
        if (shouldSpeak) {
          console.log(`💬 Calling speakText for: "${msg.text}"`);
          speakText(msg.author, msg.text, 'tiktok', true);
        } else {
          addChatMessage(msg.author, msg.text, 'tiktok', false);
        }
      }
    };

    // First poll: mark everything as seen, only speak last message
    if (tiktokIsFirstPoll) {
      tiktokIsFirstPoll = false;
      
      // Mark all as seen
      messages.forEach(msg => {
        if (msg.authorAvatar) {
          window.userAvatars.set(`tiktok:${msg.author}`, msg.authorAvatar);
        }
        tiktokSeenMessages.add(getMessageId(msg));
      });

      // Find last text message index
      let lastTextIndex = -1;
      messages.forEach((msg, i) => { 
        if (msg.type === 'chat' && msg.text && msg.text.trim()) {
          lastTextIndex = i;
        }
      });

      // Process all messages (only speak the last text message, NO ANIMATIONS)
      for (let i = 0; i < messages.length; i++) {
        await processMessage(messages[i], i === lastTextIndex, true); // ← Pass true for isFirstPoll
      }
      
      return;
    }

    // Normal poll: only process NEW messages
    for (const msg of messages) {
      const msgId = getMessageId(msg);
      
      // Skip if already seen
      if (tiktokSeenMessages.has(msgId)) {
        continue;
      }
      
      // Mark as seen
      tiktokSeenMessages.add(msgId);

      // Process the message (animations ENABLED)
      await processMessage(msg, true, false); // ← Pass false for isFirstPoll
    }

    // Clean up old seen messages (keep last 1000)
    if (tiktokSeenMessages.size > 1000) {
      const items = Array.from(tiktokSeenMessages);
      tiktokSeenMessages = new Set(items.slice(-1000));
    }

  } catch (err) {
    console.error('TikTok polling error:', err);
  } finally {
    // Schedule next poll (2 seconds)
    if (tiktokConnected) {
      setTimeout(pollTikTokMessages, 2000);
    }
  }
}

function populateGiftSoundOptions(selectElement, selectedValue) {
  if (!selectElement) return;

  selectElement.innerHTML = '';
  const soundSelect = document.getElementById('giftSoundSelect');
  if (!soundSelect) return;

  Array.from(soundSelect.options).forEach(opt => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.textContent;
    option.selected = opt.value === selectedValue;
    selectElement.appendChild(option);
  });
}

function renderGiftMappings() {
  const defaultValue = document.getElementById('defaultGiftValue');
  giftMappings.default.type = 'sound';
  if (!defaultValue) return;
  populateGiftSoundOptions(defaultValue, giftMappings.default.value);
}




// ─── Gift Sound & Animation Mappings ────────────────────────────────

let giftMappings = {
  byName: {},      // giftName → { type: 'sound'|'animation', value: 'soundId' or 'animationTrigger' }
  byValue: {},     // diamondCount → { type: 'sound'|'animation', value: '...' }
  default: { type: 'sound', value: '' }  // Default behavior (empty = current gift sound setting)
};
const giftCycleState = {
  byName: {},
  byValue: {}
};

function toAnimationTriggerList(value) {
  if (Array.isArray(value)) {
    return value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function normalizeGiftAction(action) {
  if (!action || typeof action !== 'object') {
    return { type: 'sound', value: '' };
  }

  if (action.type === 'animation') {
    const unique = Array.from(new Set(toAnimationTriggerList(action.value)));
    if (unique.length > 1) {
      return { type: 'animation', value: unique };
    }
    return { type: 'animation', value: unique[0] || '' };
  }

  return {
    type: 'sound',
    value: typeof action.value === 'string' ? action.value : ''
  };
}

function normalizeGiftMappings(raw) {
  const byName = {};
  const byValue = {};
  const normalizedDefault = normalizeGiftAction(raw?.default || { type: 'sound', value: '' });
  const defaultSoundValue = normalizedDefault.type === 'sound' ? normalizedDefault.value : '';

  Object.entries(raw?.byName || {}).forEach(([giftName, action]) => {
    byName[giftName] = normalizeGiftAction(action);
  });

  Object.entries(raw?.byValue || {}).forEach(([diamondValue, action]) => {
    byValue[diamondValue] = normalizeGiftAction(action);
  });

  return {
    byName,
    byValue,
    default: { type: 'sound', value: defaultSoundValue }
  };
}

// Load gift mappings
function loadGiftMappings() {
  const saved = settingsStore.getItem('gift_mappings');
  if (saved) {
    try {
      giftMappings = normalizeGiftMappings(JSON.parse(saved));
      renderGiftMappings();
    } catch (e) {
      console.error('Error loading gift mappings:', e);
    }
  } else {
    giftMappings = normalizeGiftMappings(giftMappings);
  }
}

// Save gift mappings
function saveGiftMappings() {
  settingsStore.setItem('gift_mappings', JSON.stringify(giftMappings));
}

// Get action for a gift (returns { type, value } or null)
function getGiftAction(giftName, diamondCount) {
  function resolveGiftAction(entry, keyType, key) {
    const normalized = normalizeGiftAction(entry);
    if (normalized.type !== 'animation') {
      return normalized;
    }

    const triggers = toAnimationTriggerList(normalized.value);
    if (triggers.length === 0) {
      return { type: 'animation', value: '' };
    }

    if (triggers.length === 1) {
      return { type: 'animation', value: triggers[0] };
    }

    const cycleState = keyType === 'byName' ? giftCycleState.byName : giftCycleState.byValue;
    const currentIndex = Number.isInteger(cycleState[key]) ? cycleState[key] : 0;
    const index = currentIndex % triggers.length;
    cycleState[key] = (index + 1) % triggers.length;

    return { type: 'animation', value: triggers[index] };
  }

  // Priority 1: Specific gift name
  if (giftMappings.byName[giftName]) {
    const resolved = resolveGiftAction(giftMappings.byName[giftName], 'byName', giftName);
    console.log(`🎁 Using name-based mapping for ${giftName}:`, resolved);
    return resolved;
  }
  
  // Priority 2: Diamond value range
  if (giftMappings.byValue[diamondCount]) {
    const resolved = resolveGiftAction(giftMappings.byValue[diamondCount], 'byValue', String(diamondCount));
    console.log(`🎁 Using value-based mapping for ${diamondCount}💎:`, resolved);
    return resolved;
  }
  
  // Priority 3: Default
  console.log(`🎁 Using default mapping:`, giftMappings.default);
  return giftMappings.default;
}

// Initialize
loadGiftMappings();

// Render UI after a short delay to ensure DOM is ready
setTimeout(() => {
  renderGiftMappings();
}, 100);

// Default gift sound event listener
const defaultGiftValue = document.getElementById('defaultGiftValue');

if (defaultGiftValue) {
  giftMappings.default.type = 'sound';

  defaultGiftValue.addEventListener('change', () => {
    giftMappings.default.type = 'sound';
    giftMappings.default.value = defaultGiftValue.value;
    saveGiftMappings();
    console.log('✓ Default gift sound changed to:', defaultGiftValue.value);
  });

  populateGiftSoundOptions(defaultGiftValue, giftMappings.default.value);
}

// ─── TikTok Sticker to Animation Mappings ───────────────────────────

let stickerMappings = {}; // emoteId or emoteName → animation trigger

function normalizeStickerMappingEntry(key, data) {
  if (typeof data === 'object' && data !== null) {
    return {
      name: typeof data.name === 'string' && data.name.trim() ? data.name : key,
      image: typeof data.image === 'string' && data.image.trim() ? data.image : null,
      trigger: typeof data.trigger === 'string' ? data.trigger : ''
    };
  }
  return {
    name: key,
    image: null,
    trigger: typeof data === 'string' ? data : ''
  };
}

function getStickerEntries() {
  return Object.entries(stickerMappings).map(([key, data]) => {
    const normalized = normalizeStickerMappingEntry(key, data);
    return { key, ...normalized };
  });
}

function loadStickerMappings() {
  const saved = settingsStore.getItem('sticker_mappings');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    const normalized = {};
    Object.entries(parsed || {}).forEach(([key, data]) => {
      normalized[key] = normalizeStickerMappingEntry(key, data);
    });
    stickerMappings = normalized;
  } catch (e) {
    console.error('Error loading sticker mappings:', e);
  }
}

function saveStickerMappings() {
  settingsStore.setItem('sticker_mappings', JSON.stringify(stickerMappings));
}

function getAvailableStickerOptions() {
  return getStickerEntries()
    .sort((a, b) => String(a.name || a.key).localeCompare(String(b.name || b.key)));
}

function getStickerTriggerForKey(stickerKey) {
  const data = stickerMappings[stickerKey];
  if (!data) return '';
  return typeof data === 'string' ? data : (data.trigger || '');
}

function findStickerKeyForAnimationTrigger(trigger) {
  const match = getStickerEntries().find(entry => (entry.trigger || '') === trigger);
  return match ? match.key : '';
}

function findFirstStickerNameForAnimationTrigger(trigger) {
  const entry = findFirstStickerEntryForAnimationTrigger(trigger);
  return entry ? (entry.name || entry.key) : '';
}

function hasStickerForAnimationTrigger(trigger) {
  return Boolean(findStickerKeyForAnimationTrigger(trigger));
}

function findFirstStickerEntryForAnimationTrigger(trigger) {
  const key = findStickerKeyForAnimationTrigger(trigger);
  if (!key) return null;
  const data = normalizeStickerMappingEntry(key, stickerMappings[key]);
  return { key, ...data };
}

function moveStickerAnimationReferences(oldTrigger, newTrigger) {
  if (!oldTrigger || !newTrigger || oldTrigger === newTrigger) return;
  Object.entries(stickerMappings).forEach(([key, data]) => {
    const normalized = normalizeStickerMappingEntry(key, data);
    if (normalized.trigger === oldTrigger) {
      normalized.trigger = newTrigger;
      stickerMappings[key] = normalized;
    }
  });
}

function removeStickerAnimationReferences(trigger) {
  if (!trigger) return;
  Object.entries(stickerMappings).forEach(([key, data]) => {
    const normalized = normalizeStickerMappingEntry(key, data);
    if (normalized.trigger === trigger) {
      normalized.trigger = '';
      stickerMappings[key] = normalized;
    }
  });
}

function assignStickerToTrigger(stickerKey, trigger) {
  if (!stickerKey) return;

  const targetTrigger = typeof trigger === 'string' ? trigger : '';
  const current = normalizeStickerMappingEntry(stickerKey, stickerMappings[stickerKey]);

  Object.entries(stickerMappings).forEach(([key, data]) => {
    const normalized = normalizeStickerMappingEntry(key, data);
    if (key === stickerKey || (targetTrigger && normalized.trigger === targetTrigger)) {
      normalized.trigger = '';
      stickerMappings[key] = normalized;
    }
  });

  if (!targetTrigger) return;
  current.trigger = targetTrigger;
  stickerMappings[stickerKey] = current;
}

function setStickerForAnimationTrigger(trigger, stickerKey) {
  if (!trigger) return;
  if (!stickerKey) {
    removeStickerAnimationReferences(trigger);
    return;
  }
  assignStickerToTrigger(stickerKey, trigger);
}

function renderAnimationPopupStickerPicker(selectedKey = '') {
  if (!animationPopupStickerPicker) return;

  const currentTrigger = activeAnimationPopup?.trigger || '';
  const options = getAvailableStickerOptions();
  const noneSelected = !selectedKey;

  const noneCard = `
    <button type="button" class="secondary animation-sticker-option none${noneSelected ? ' active' : ''}" data-sticker-key="">
      <span class="animation-sticker-option-name">No sticker</span>
      <span class="animation-sticker-option-map">Unassigned</span>
    </button>
  `;

  const optionCards = options.map(entry => {
    const isSelected = selectedKey === entry.key;
    const image = entry.image
      ? `<img class="animation-sticker-option-image" src="${escapeAttribute(entry.image)}" alt="${escapeAttribute(entry.name || entry.key)}">`
      : `<span class="animation-sticker-option-image" style="display: inline-flex; align-items: center; justify-content: center; font-size: 1.15rem;">🎭</span>`;

    let mappedLabel = 'Unassigned';
    if (entry.trigger) {
      mappedLabel = entry.trigger === currentTrigger ? 'Mapped to this card' : `Mapped: ${entry.trigger}`;
    }

    return `
      <button type="button" class="secondary animation-sticker-option${isSelected ? ' active' : ''}" data-sticker-key="${escapeAttribute(entry.key)}" title="${escapeAttribute(entry.name || entry.key)}">
        ${image}
        <span class="animation-sticker-option-name">${escapeHtml(entry.name || entry.key)}</span>
        <span class="animation-sticker-option-map">${escapeHtml(mappedLabel)}</span>
      </button>
    `;
  }).join('');

  animationPopupStickerPicker.innerHTML = `${noneCard}${optionCards}`;

  animationPopupStickerPicker.querySelectorAll('.animation-sticker-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const stickerKey = btn.dataset.stickerKey || '';
      if (animationPopupSticker) {
        animationPopupSticker.value = stickerKey;
      }
      renderAnimationPopupStickerPicker(stickerKey);
    });
  });
}

function populateAnimationPopupStickerOptions(selectedKey = '') {
  if (!animationPopupSticker) return;
  const options = getAvailableStickerOptions();
  animationPopupSticker.innerHTML = '<option value="">No sticker assigned</option>';
  options.forEach(entry => {
    const option = document.createElement('option');
    option.value = entry.key;
    option.textContent = `${entry.name || entry.key}${entry.trigger ? ` (${entry.trigger})` : ''}`;
    if (selectedKey && selectedKey === entry.key) {
      option.selected = true;
    }
    animationPopupSticker.appendChild(option);
  });
  animationPopupSticker.value = selectedKey || '';
  renderAnimationPopupStickerPicker(animationPopupSticker.value);
}

function handleStickerAnimation(msg) {
  const emoteKey = msg.emoteId || msg.emoteName;
  if (!emoteKey) return;
  
  // Auto-capture new stickers
  if (!stickerMappings[emoteKey]) {
    console.log(`📚 Auto-captured new sticker: ${emoteKey}`);
    
    stickerMappings[emoteKey] = {
      name: msg.emoteName || `Sticker ${emoteKey}`,
      image: msg.emoteImage || null,
      trigger: '' // No animation by default
    };
    
    saveStickerMappings();
    
    addChatMessage('SYSTEM', `📚 New sticker captured: ${emoteKey.slice(0, 12)}... Assign an animation!`, 'SYSTEM', false);
  } else {
    const existing = normalizeStickerMappingEntry(emoteKey, stickerMappings[emoteKey]);
    let changed = false;
    if (msg.emoteName && existing.name !== msg.emoteName) {
      existing.name = msg.emoteName;
      changed = true;
    }
    if (msg.emoteImage && existing.image !== msg.emoteImage) {
      existing.image = msg.emoteImage;
      changed = true;
    }
    stickerMappings[emoteKey] = existing;
    if (changed) saveStickerMappings();
  }
  
  // Trigger animation if mapped
  const animTrigger = getStickerTriggerForKey(emoteKey);
  
  if (animTrigger) {
    console.log(`🎬 Sticker triggered animation: ${emoteKey} → ${animTrigger}`);
    triggerAnimation(animTrigger, 'tiktok', msg.author);
  }
}

function ensureStickerEntry(stickerKey, { name = '', image = null } = {}) {
  if (!stickerKey) return null;
  const existingRaw = stickerMappings[stickerKey];
  const existing = normalizeStickerMappingEntry(stickerKey, existingRaw);
  let changed = false;

  if (!existingRaw) {
    changed = true;
  }
  if (name && existing.name !== name) {
    existing.name = name;
    changed = true;
  }
  if (image && existing.image !== image) {
    existing.image = image;
    changed = true;
  }

  if (changed) {
    stickerMappings[stickerKey] = existing;
    saveStickerMappings();
  } else if (!existingRaw) {
    stickerMappings[stickerKey] = existing;
  }

  return existing;
}

function buildStickerChatItemHtml(emote, fallbackName = '') {
  const stickerKey = String(emote?.emoteId || emote?.emoteName || '').trim();
  if (!stickerKey) return '';

  const stickerName = String(emote?.emoteName || fallbackName || `Sticker ${stickerKey}`).trim();
  const stickerImage = emote?.emoteImage || emote?.emoteImageUrl || null;
  ensureStickerEntry(stickerKey, { name: stickerName, image: stickerImage });

  const assignedTrigger = getStickerTriggerForKey(stickerKey);
  const statusLabel = assignedTrigger ? `Mapped to: ${assignedTrigger}` : 'Unassigned';
  const actionLabel = 'Assign';
  const imageMarkup = stickerImage
    ? `<img src="${escapeAttribute(stickerImage)}" alt="${escapeAttribute(stickerName)}" class="chat-sticker-image">`
    : `<span class="chat-sticker-image" style="display: inline-flex; align-items: center; justify-content: center; font-size: 1.4rem;">🎭</span>`;
  const unassignButton = assignedTrigger
    ? `<button type="button" class="secondary chat-sticker-unassign-btn" data-sticker-key="${escapeAttribute(stickerKey)}" title="Unassign">×</button>`
    : '';

  return `
    <span class="chat-sticker-item${assignedTrigger ? ' is-mapped' : ''}" data-sticker-key="${escapeAttribute(stickerKey)}" data-sticker-name="${escapeAttribute(stickerName)}" title="${escapeAttribute(stickerName)} — ${escapeAttribute(statusLabel)}">
      ${imageMarkup}
      <span class="chat-sticker-controls">
        <button
          type="button"
          class="secondary chat-sticker-assign-btn"
          data-sticker-key="${escapeAttribute(stickerKey)}"
          data-sticker-name="${escapeAttribute(stickerName)}"
          data-sticker-image="${escapeAttribute(stickerImage || '')}"
          data-sticker-trigger="${escapeAttribute(assignedTrigger || '')}"
        >${actionLabel}</button>
        ${unassignButton}
      </span>
    </span>
  `;
}

function buildStickerChatListHtml(emotes = []) {
  const parts = emotes.map((emote) => buildStickerChatItemHtml(emote)).filter(Boolean);
  if (parts.length === 0) return '';
  return `<span class="chat-sticker-list">${parts.join('')}</span>`;
}

function buildStickerAssignAnimationOptions(selectedTrigger = '') {
  if (!stickerAssignAnimationSelect) return;
  const triggers = Object.keys(animationMappings || {}).sort((a, b) => a.localeCompare(b));
  stickerAssignAnimationSelect.innerHTML = '<option value="">No animation assigned</option>';
  triggers.forEach((trigger) => {
    const option = document.createElement('option');
    option.value = trigger;
    option.textContent = trigger;
    if (selectedTrigger && selectedTrigger === trigger) {
      option.selected = true;
    }
    stickerAssignAnimationSelect.appendChild(option);
  });
  if (!selectedTrigger) {
    stickerAssignAnimationSelect.value = '';
  }
}

function refreshChatStickerUiForKey(stickerKey) {
  if (!stickerKey) return;
  const assignedTrigger = getStickerTriggerForKey(stickerKey);
  const mapped = Boolean(assignedTrigger);

  document.querySelectorAll('.chat-sticker-item').forEach((item) => {
    if (!(item instanceof HTMLElement)) return;
    if (item.dataset.stickerKey !== stickerKey) return;

    item.classList.toggle('is-mapped', mapped);
    const stickerName = item.dataset.stickerName || stickerKey;
    item.title = mapped
      ? `${stickerName} — Mapped to: ${assignedTrigger}`
      : `${stickerName} — Unassigned`;

    const controls = item.querySelector('.chat-sticker-controls');
    if (!controls) return;

    const assignBtn = controls.querySelector('.chat-sticker-assign-btn');
    if (assignBtn) {
      assignBtn.textContent = 'Assign';
      assignBtn.dataset.stickerTrigger = assignedTrigger || '';
    }

    const existingUnassign = controls.querySelector('.chat-sticker-unassign-btn');
    if (mapped && !existingUnassign) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'secondary chat-sticker-unassign-btn';
      btn.dataset.stickerKey = stickerKey;
      btn.title = 'Unassign';
      btn.textContent = '×';
      controls.appendChild(btn);
    }
    if (!mapped && existingUnassign) {
      existingUnassign.remove();
    }
  });
}

window.closeStickerAssignModal = function closeStickerAssignModal() {
  if (!stickerAssignModal) return;
  stickerAssignModal.style.display = 'none';
  activeStickerAssignKey = '';
};

window.openStickerAssignFromChat = function openStickerAssignFromChat(stickerKey, stickerImage = '', stickerName = '') {
  if (!stickerAssignModal || !stickerAssignAnimationSelect) return;
  if (!stickerKey) return;

  const ensured = ensureStickerEntry(stickerKey, {
    name: stickerName || `Sticker ${stickerKey}`,
    image: stickerImage || null
  }) || normalizeStickerMappingEntry(stickerKey, stickerMappings[stickerKey]);

  activeStickerAssignKey = stickerKey;
  const currentTrigger = getStickerTriggerForKey(stickerKey);
  const displayName = ensured.name || stickerName || stickerKey;
  const displayImage = ensured.image || stickerImage || '';

  if (stickerAssignName) {
    stickerAssignName.textContent = displayName;
  }
  if (stickerAssignCurrent) {
    stickerAssignCurrent.textContent = currentTrigger
      ? `Currently mapped to: ${currentTrigger}`
      : 'Currently unassigned';
  }
  if (stickerAssignPreviewImage) {
    if (displayImage) {
      stickerAssignPreviewImage.src = displayImage;
      stickerAssignPreviewImage.style.display = 'block';
    } else {
      stickerAssignPreviewImage.removeAttribute('src');
      stickerAssignPreviewImage.style.display = 'none';
    }
  }

  buildStickerAssignAnimationOptions(currentTrigger);
  stickerAssignModal.style.display = 'flex';
};

if (chatFeed) {
  chatFeed.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const unassignButton = e.target.closest('.chat-sticker-unassign-btn');
    if (unassignButton) {
      e.preventDefault();
      const stickerKey = unassignButton.dataset.stickerKey || '';
      if (!stickerKey) return;

      assignStickerToTrigger(stickerKey, '');
      saveStickerMappings();
      renderAnimationMappings();
      refreshChatStickerUiForKey(stickerKey);

      if (activeAnimationPopup?.trigger) {
        const selectedKey = findStickerKeyForAnimationTrigger(activeAnimationPopup.trigger);
        populateAnimationPopupStickerOptions(selectedKey);
      }
      return;
    }

    const button = e.target.closest('.chat-sticker-assign-btn');
    if (!button) return;
    e.preventDefault();
    const stickerKey = button.dataset.stickerKey || '';
    const stickerName = button.dataset.stickerName || '';
    const stickerImage = button.dataset.stickerImage || '';
    window.openStickerAssignFromChat(stickerKey, stickerImage, stickerName);
  });
}

if (stickerAssignCancelBtn) {
  stickerAssignCancelBtn.addEventListener('click', () => {
    window.closeStickerAssignModal();
  });
}

if (stickerAssignModal) {
  stickerAssignModal.addEventListener('click', (e) => {
    if (e.target === stickerAssignModal) {
      window.closeStickerAssignModal();
    }
  });
}

if (stickerAssignSaveBtn) {
  stickerAssignSaveBtn.addEventListener('click', async () => {
    if (!activeStickerAssignKey) return;

    const nextTrigger = stickerAssignAnimationSelect ? stickerAssignAnimationSelect.value : '';
    assignStickerToTrigger(activeStickerAssignKey, nextTrigger);
    saveStickerMappings();
    renderAnimationMappings();
    refreshChatStickerUiForKey(activeStickerAssignKey);

    if (activeAnimationPopup?.trigger) {
      const selectedKey = findStickerKeyForAnimationTrigger(activeAnimationPopup.trigger);
      populateAnimationPopupStickerOptions(selectedKey);
    }

    window.closeStickerAssignModal();
  });
}


// Also hook into YouTube polling
const originalPollYouTube = pollYouTubeMessages;
async function pollYouTubeMessages(isReconnect = false) {
  if (!youtubeConnected || !youtubeLiveChatId) return;

  const apiKey = getNextApiKey();
  let url = `/api/youtube/liveChat/messages?liveChatId=${youtubeLiveChatId}&part=snippet,authorDetails&key=${apiKey}`;
  
  if (youtubeNextPageToken) {
    url += `&pageToken=${youtubeNextPageToken}`;
  }

  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json();
      // Handle Quota exhaustion by rotating keys
      if (response.status === 403 && errorData.error?.message?.includes('quota')) {
        if (rotateToNextKey()) {
          setTimeout(() => pollYouTubeMessages(isReconnect), 1000);
          return;
        }
      }
      throw new Error(errorData.error?.message || 'Error fetching messages');
    }

    const data = await response.json();
    youtubeNextPageToken = data.nextPageToken;
    youtubeLastPollTime = Date.now();

    const messages = data.items || [];

    // On the very first poll, we just "mark as read" everything currently in chat
    if (youtubeIsFirstPoll && !isReconnect) {
      messages.forEach(msg => youtubeSeenMessages.add(msg.id));
      youtubeIsFirstPoll = false;
      console.log(`Initial sync: Ignored ${messages.length} old YouTube messages.`);
      addChatMessage('SYSTEM', 'YouTube chat synced. Waiting for new messages...', 'youtube', false);
    } else {
      // Process only new messages
      for (const msg of messages) {
        if (!youtubeSeenMessages.has(msg.id)) {
          youtubeSeenMessages.add(msg.id);
          const author = msg.authorDetails.displayName;
          const text = msg.snippet.displayMessage;
          const avatarUrl = msg.authorDetails.profileImageUrl;
          if (avatarUrl) {
            window.userAvatars.set(`youtube:${author}`, avatarUrl);
          }
          await autoAssignVoiceIfNeeded(author, 'youtube');
          speakText(author, text, 'youtube');
        }
      }
    }

    // Poll again based on the interval YouTube suggests (usually 5 seconds)
    const interval = data.pollingIntervalMillis || 5000;
    setTimeout(() => pollYouTubeMessages(), interval);

  } catch (error) {
    console.error('YouTube Poll Error:', error);
    updateStatus(`YouTube Poll Error: ${error.message}`, false, true);
    // Retry after 10 seconds if there's an error
    setTimeout(() => pollYouTubeMessages(), 10000);
  }
}

// Initialize on page load
loadGenderCache();
loadHiddenVoices(); // Load hidden voices list
refreshOllamaStatus();
setInterval(refreshOllamaStatus, 30000);

// Populate gender voice selects after voices are loaded
if (speechSynthesis.onvoiceschanged !== undefined) {
  const originalVoicesChanged = speechSynthesis.onvoiceschanged;
  speechSynthesis.onvoiceschanged = () => {
    if (originalVoicesChanged) originalVoicesChanged();
    loadVoices();
    populateGenderVoiceSelects();
  };
} else {
  // Fallback: populate after a delay
  setTimeout(populateGenderVoiceSelects, 1000);
}

// Save auto-detection preference
if (autoGenderDetectionCheckbox) {
  // Load saved preference
  const savedPref = settingsStore.getItem('auto_gender_detection');
  if (savedPref === 'true') {
    autoGenderDetectionCheckbox.checked = true;
  }

  autoGenderDetectionCheckbox.addEventListener('change', () => {
    settingsStore.setItem('auto_gender_detection', autoGenderDetectionCheckbox.checked);
    console.log('Auto gender detection:', autoGenderDetectionCheckbox.checked ? 'enabled' : 'disabled');
    refreshOllamaStatus();
  });
}

// ─── Gift Thank You System with Batching ────────────────────────────

let giftBatch = new Map(); // giftName → { users: Set(), count: number }
let giftBatchTimer = null;

function addGiftToBatch(giftName, authorName) {
  if (!giftBatch.has(giftName)) {
    giftBatch.set(giftName, { users: new Set(), count: 0 });
  }

  const batch = giftBatch.get(giftName);
  batch.users.add(authorName);
  batch.count++;

  // Reset timer
  if (giftBatchTimer) clearTimeout(giftBatchTimer);

  // Wait 3 seconds for more gifts, then announce
  giftBatchTimer = setTimeout(() => {
    announceGiftBatch();
  }, 3000);
}

function announceGiftBatch() {
  if (giftBatch.size === 0) return;

  giftBatch.forEach((batch, giftName) => {
    const userList = Array.from(batch.users);
    let thankYouMessage = '';

    if (userList.length === 1) {
      // Single user
      if (batch.count === 1) {
        thankYouMessage = `Hey ${userList[0]}, thank you for the ${giftName}!`;
      } else {
        thankYouMessage = `Hey ${userList[0]}, thank you for ${batch.count} ${giftName} gifts!`;
      }
    } else if (userList.length === 2) {
      // Two users
      thankYouMessage = `Hey ${userList[0]} and ${userList[1]}, thank you for the ${giftName} gifts!`;
    } else {
      // Multiple users
      thankYouMessage = `Thank you ${userList[0]}, ${userList[1]} and ${userList.length - 2} others for ${batch.count} ${giftName} gifts!`;
    }

    // Speak the thank you message
    addChatMessage('SYSTEM', thankYouMessage, 'SYSTEM', false);
    speakText('System', thankYouMessage, 'tiktok', false);
  });

  // Clear batch
  giftBatch.clear();
}

// ─── Animation Overlay Settings ─────────────────────────────────────

let animationMappings = {}; // trigger → filename
let availableAnimations = []; // List of .MOV files
const animationVolumeSlider = document.getElementById('animationVolumeSlider');
const animationVolumeValue = document.getElementById('animationVolumeValue');
const animationSortSelect = document.getElementById('animationSortSelect');
const animationMapFilterSelect = document.getElementById('animationMapFilterSelect');
const animationStickerFilterSelect = document.getElementById('animationStickerFilterSelect');
let animationThumbnailObserver = null;
let animationPlaybackTicker = null;
const ANIMATION_PLAYBACK_FALLBACK_SECONDS = 4;
const ANIMATION_PLAYBACK_TICK_MS = 120;
const animationDurationSecondsCache = new Map(); // filename -> duration seconds
const animationDurationProbePromises = new Map(); // filename -> Promise<number|null>
const activeAnimationCardPlayback = new Map(); // trigger -> playback state

function getAnimationVolumePercent() {
  if (!animationVolumeSlider) return 100;
  const value = parseInt(animationVolumeSlider.value, 10);
  return Number.isFinite(value) ? value : 100;
}

function updateAnimationVolumeLabel() {
  if (!animationVolumeSlider || !animationVolumeValue) return;
  animationVolumeValue.textContent = `${animationVolumeSlider.value}%`;
}

function normalizeTriggerFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .trim()
    .toLowerCase();
}

function createDefaultAnimationMapping(filename) {
  return {
    file: filename,
    position: 'bottom-left',
    scale: 1.0
  };
}

function toAnimationMappingObject(data, fallbackFilename = '') {
  if (typeof data === 'object' && data !== null) {
    return {
      file: data.file || fallbackFilename,
      position: data.position || 'bottom-left',
      scale: Number.isFinite(Number(data.scale)) ? Number(data.scale) : 1.0
    };
  }

  return createDefaultAnimationMapping(typeof data === 'string' ? data : fallbackFilename);
}

function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getAnimationFileUrl(filename) {
  return `/animations/${encodeURIComponent(filename)}`;
}

function cacheAnimationDuration(filename, durationSeconds) {
  const numeric = Number(durationSeconds);
  if (!filename || !Number.isFinite(numeric) || numeric <= 0) return;
  animationDurationSecondsCache.set(filename, numeric);
}

function cacheAnimationDurationFromVideo(video) {
  if (!video) return;
  const filename = video.dataset.file || '';
  const duration = Number(video.duration);
  cacheAnimationDuration(filename, duration);
}

function bindAnimationThumbnailDurationListener(video) {
  if (!video || video.dataset.durationBound === '1') return;
  video.dataset.durationBound = '1';
  video.addEventListener('loadedmetadata', () => {
    cacheAnimationDurationFromVideo(video);
  });
}

function probeAnimationDurationSeconds(filename) {
  return new Promise((resolve) => {
    if (!filename) {
      resolve(null);
      return;
    }

    const probeVideo = document.createElement('video');
    const src = getAnimationFileUrl(filename);
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      probeVideo.removeEventListener('loadedmetadata', onLoadedMetadata);
      probeVideo.removeEventListener('error', onError);
      probeVideo.removeAttribute('src');
      probeVideo.load();
      resolve(value);
    };

    const onLoadedMetadata = () => {
      const duration = Number(probeVideo.duration);
      finish(Number.isFinite(duration) && duration > 0 ? duration : null);
    };

    const onError = () => finish(null);
    const timeoutId = setTimeout(() => finish(null), 4500);

    probeVideo.preload = 'metadata';
    probeVideo.muted = true;
    probeVideo.playsInline = true;
    probeVideo.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    probeVideo.addEventListener('error', onError, { once: true });
    probeVideo.src = src;
    probeVideo.load();
  });
}

function getAnimationDurationSeconds(filename) {
  if (!filename) return Promise.resolve(null);

  const cached = animationDurationSecondsCache.get(filename);
  if (Number.isFinite(cached) && cached > 0) {
    return Promise.resolve(cached);
  }

  const pending = animationDurationProbePromises.get(filename);
  if (pending) return pending;

  const probePromise = probeAnimationDurationSeconds(filename)
    .then((duration) => {
      if (Number.isFinite(duration) && duration > 0) {
        cacheAnimationDuration(filename, duration);
        return duration;
      }
      return null;
    })
    .finally(() => {
      animationDurationProbePromises.delete(filename);
    });

  animationDurationProbePromises.set(filename, probePromise);
  return probePromise;
}

function formatAnimationPlaybackCountdown(remainingMs) {
  const remainingSeconds = Math.max(0, remainingMs / 1000);
  if (remainingSeconds >= 60) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.ceil(remainingSeconds % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  if (remainingSeconds >= 10) {
    return `${Math.ceil(remainingSeconds)}s`;
  }
  return `${remainingSeconds.toFixed(1)}s`;
}

function setAnimationCardPlaybackState(trigger, filename, durationSeconds, startedAtMs = Date.now()) {
  const safeDuration = Number(durationSeconds);
  const finalDuration = Number.isFinite(safeDuration) && safeDuration > 0
    ? safeDuration
    : ANIMATION_PLAYBACK_FALLBACK_SECONDS;

  activeAnimationCardPlayback.set(trigger, {
    trigger,
    filename,
    startedAtMs,
    endAtMs: startedAtMs + (finalDuration * 1000),
    durationSeconds: finalDuration
  });

  if (!animationPlaybackTicker) {
    animationPlaybackTicker = setInterval(() => {
      updateAnimationPlaybackUi();
    }, ANIMATION_PLAYBACK_TICK_MS);
  }
  updateAnimationPlaybackUi();
}

function markAnimationCardPlaying(trigger) {
  if (!trigger || !animationMappings[trigger]) return;

  const data = animationMappings[trigger];
  const filename = getAnimationFileFromMapping(data);
  if (!filename) return;

  const startedAtMs = Date.now();
  const cachedDuration = animationDurationSecondsCache.get(filename);
  const initialDuration = Number.isFinite(cachedDuration) && cachedDuration > 0
    ? cachedDuration
    : ANIMATION_PLAYBACK_FALLBACK_SECONDS;

  // UI is single-active: keep only the latest triggered animation highlighted.
  activeAnimationCardPlayback.clear();
  setAnimationCardPlaybackState(trigger, filename, initialDuration, startedAtMs);

  getAnimationDurationSeconds(filename)
    .then((duration) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      const current = activeAnimationCardPlayback.get(trigger);
      if (!current) return;
      if (current.startedAtMs !== startedAtMs) return;
      setAnimationCardPlaybackState(trigger, filename, duration, startedAtMs);
    })
    .catch((err) => {
      console.debug('Animation duration probe failed:', err);
    });

  return startedAtMs;
}

function clearAnimationCardPlaybackIfMatches(trigger, startedAtMs) {
  const state = activeAnimationCardPlayback.get(trigger);
  if (!state) return;
  if (Number.isFinite(startedAtMs) && state.startedAtMs !== startedAtMs) return;
  activeAnimationCardPlayback.delete(trigger);
  updateAnimationPlaybackUi();
}

function updateAnimationPlaybackUi() {
  const now = Date.now();

  for (const [trigger, state] of activeAnimationCardPlayback.entries()) {
    if (!state || state.endAtMs <= now) {
      activeAnimationCardPlayback.delete(trigger);
    }
  }

  const cards = document.querySelectorAll('.animation-mapping-card[data-animation-trigger]');
  cards.forEach((card) => {
    const trigger = card.dataset.animationTrigger || '';
    const state = activeAnimationCardPlayback.get(trigger);
    const countdownEl = card.querySelector('.animation-playing-countdown');
    const button = card.querySelector('.preview-mapping-btn');
    const video = card.querySelector('.animation-thumb-video');

    if (!state) {
      card.classList.remove('playing');
      card.style.removeProperty('--play-progress');
      if (countdownEl) countdownEl.textContent = '';
      if (isThumbnailInteractionActive(button)) {
        playAnimationThumbnail(video);
      } else {
        stopAnimationThumbnail(video);
      }
      return;
    }

    const remainingMs = Math.max(0, state.endAtMs - now);
    const totalMs = Math.max(200, state.durationSeconds * 1000);
    const elapsedMs = Math.max(0, totalMs - remainingMs);
    const progress = Math.min(1, elapsedMs / totalMs);

    card.classList.add('playing');
    card.style.setProperty('--play-progress', progress.toFixed(4));
    if (countdownEl) countdownEl.textContent = formatAnimationPlaybackCountdown(remainingMs);
    playAnimationThumbnail(video);
  });

  if (activeAnimationCardPlayback.size === 0 && animationPlaybackTicker) {
    clearInterval(animationPlaybackTicker);
    animationPlaybackTicker = null;
  }
}

function getAnimationFileFromMapping(data) {
  if (typeof data === 'string') return data;
  if (typeof data === 'object' && data !== null) return data.file || '';
  return '';
}

function findAnimationMappingEntryByFile(filename, source = animationMappings) {
  for (const [trigger, data] of Object.entries(source)) {
    if (getAnimationFileFromMapping(data) === filename) {
      return { trigger, data: toAnimationMappingObject(data, filename) };
    }
  }
  return null;
}

function buildUniqueAnimationTrigger(base, source = animationMappings, ignoreTrigger = '') {
  const cleanBase = (base || 'animation').trim().toLowerCase();
  let candidate = cleanBase || 'animation';
  let index = 1;
  while (Object.prototype.hasOwnProperty.call(source, candidate) && candidate !== ignoreTrigger) {
    candidate = `${cleanBase}-${index}`;
    index += 1;
  }
  return candidate;
}

function isGiftAnimationMapping(entry, trigger) {
  if (!entry || entry.type !== 'animation') return false;
  const values = toAnimationTriggerList(entry.value);
  return values.includes(trigger);
}

function findFirstGiftNameForAnimationTrigger(trigger) {
  for (const [giftName, entry] of Object.entries(giftMappings.byName || {})) {
    if (isGiftAnimationMapping(entry, trigger)) return giftName;
  }
  return '';
}

function findFirstGiftValueForAnimationTrigger(trigger) {
  for (const [diamondValue, entry] of Object.entries(giftMappings.byValue || {})) {
    if (isGiftAnimationMapping(entry, trigger)) return String(diamondValue);
  }
  return '';
}

function findGiftNamesForAnimationTrigger(trigger) {
  const matches = [];
  Object.entries(giftMappings.byName || {}).forEach(([giftName, entry]) => {
    if (isGiftAnimationMapping(entry, trigger)) {
      matches.push(giftName);
    }
  });
  return matches;
}

function findGiftValuesForAnimationTrigger(trigger) {
  const matches = [];
  Object.entries(giftMappings.byValue || {}).forEach(([diamondValue, entry]) => {
    if (isGiftAnimationMapping(entry, trigger)) {
      matches.push(String(diamondValue));
    }
  });
  return matches.sort((a, b) => Number(a) - Number(b));
}

function trimBadgeLabel(value, maxLength = 16) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function renderAnimationVisibilityBadges(trigger) {
  const giftNames = findGiftNamesForAnimationTrigger(trigger);
  const giftValues = findGiftValuesForAnimationTrigger(trigger);
  const nonDefaultValues = giftValues.filter(value => value !== '1');
  const stickerEntry = findFirstStickerEntryForAnimationTrigger(trigger);
  const stickerName = stickerEntry ? (stickerEntry.name || stickerEntry.key) : '';
  const isDefaultGiftAnimation = isGiftAnimationMapping(giftMappings.byValue?.['1'], trigger);
  const badges = [];

  if (stickerName) {
    const thumb = stickerEntry?.image
      ? `<img src="${escapeAttribute(stickerEntry.image)}" alt="" class="animation-sticker-badge-thumb">`
      : '<span class="animation-sticker-badge-thumb animation-sticker-badge-fallback">🎭</span>';
    badges.push(`<span class="animation-visibility-badge sticker thumb-only" title="Sticker mapping: ${escapeAttribute(stickerName)}">${thumb}</span>`);
  }

  if (giftNames.length > 0) {
    const extraCount = giftNames.length - 1;
    const label = `🎁 ${trimBadgeLabel(giftNames[0])}${extraCount > 0 ? ` +${extraCount}` : ''}`;
    badges.push(`<span class="animation-visibility-badge gift-name" title="Gift name mappings: ${escapeAttribute(giftNames.join(', '))}">${escapeAttribute(label)}</span>`);
  }

  if (nonDefaultValues.length > 0) {
    const extraCount = nonDefaultValues.length - 1;
    const label = `💎 ${nonDefaultValues[0]}${extraCount > 0 ? ` +${extraCount}` : ''}`;
    badges.push(`<span class="animation-visibility-badge gift-value" title="Diamond value mappings: ${escapeAttribute(nonDefaultValues.join(', '))}">${escapeAttribute(label)}</span>`);
  }

  if (isDefaultGiftAnimation) {
    badges.push('<span class="animation-visibility-badge default-gift" title="Included in default gift animation rotation (diamond value 1)">Default</span>');
  }

  if (badges.length === 0) {
    badges.push('<span class="animation-visibility-badge unmapped" title="No gift or sticker mapping configured">Unmapped</span>');
  }

  return `<div class="animation-card-badges">${badges.join('')}</div>`;
}

function moveGiftAnimationReferences(oldTrigger, newTrigger) {
  if (!oldTrigger || !newTrigger || oldTrigger === newTrigger) return;

  Object.entries(giftMappings.byName || {}).forEach(([giftName, entry]) => {
    if (!isGiftAnimationMapping(entry, oldTrigger)) return;
    const values = toAnimationTriggerList(entry.value).map(v => (v === oldTrigger ? newTrigger : v));
    const unique = Array.from(new Set(values));
    giftMappings.byName[giftName].value = unique.length > 1 ? unique : (unique[0] || '');
  });

  Object.entries(giftMappings.byValue || {}).forEach(([diamondValue, entry]) => {
    if (!isGiftAnimationMapping(entry, oldTrigger)) return;
    const values = toAnimationTriggerList(entry.value).map(v => (v === oldTrigger ? newTrigger : v));
    const unique = Array.from(new Set(values));
    giftMappings.byValue[diamondValue].value = unique.length > 1 ? unique : (unique[0] || '');
  });
}

function removeGiftAnimationReferences(trigger) {
  if (!trigger) return;

  Object.entries(giftMappings.byName || {}).forEach(([giftName, entry]) => {
    if (!isGiftAnimationMapping(entry, trigger)) return;
    const nextValues = toAnimationTriggerList(entry.value).filter(v => v !== trigger);
    if (nextValues.length === 0) {
      delete giftMappings.byName[giftName];
      return;
    }
    giftMappings.byName[giftName].value = nextValues.length > 1 ? nextValues : nextValues[0];
  });

  Object.entries(giftMappings.byValue || {}).forEach(([diamondValue, entry]) => {
    if (!isGiftAnimationMapping(entry, trigger)) return;
    const nextValues = toAnimationTriggerList(entry.value).filter(v => v !== trigger);
    if (nextValues.length === 0) {
      delete giftMappings.byValue[diamondValue];
      return;
    }
    giftMappings.byValue[diamondValue].value = nextValues.length > 1 ? nextValues : nextValues[0];
  });
}

function addGiftAnimationReference(group, key, trigger) {
  if (!key || !trigger) return;

  const current = normalizeGiftAction(group[key] || { type: 'animation', value: '' });
  if (current.type !== 'animation') {
    group[key] = { type: 'animation', value: trigger };
    return;
  }

  const values = toAnimationTriggerList(current.value);
  if (!values.includes(trigger)) values.push(trigger);
  group[key] = {
    type: 'animation',
    value: values.length > 1 ? values : (values[0] || '')
  };
}

function removeGiftAnimationReferenceForKey(group, key, trigger) {
  if (!key || !group[key]) return;
  const entry = group[key];
  if (entry.type !== 'animation') return;

  const values = toAnimationTriggerList(entry.value).filter(v => v !== trigger);
  if (values.length === 0) {
    delete group[key];
    return;
  }

  group[key].value = values.length > 1 ? values : values[0];
}

async function syncAnimationMappingsFromFiles({ showAlert = false } = {}) {
  const fileSet = new Set(availableAnimations.map(anim => anim.filename));
  const nextMappings = {};
  const usedFiles = new Set();
  const triggerRenames = [];
  let created = 0;
  let removed = 0;
  let deduped = 0;

  Object.entries(animationMappings).forEach(([trigger, rawData]) => {
    const file = getAnimationFileFromMapping(rawData);
    if (!file || !fileSet.has(file)) {
      removed += 1;
      return;
    }
    if (usedFiles.has(file)) {
      deduped += 1;
      return;
    }

    const normalized = toAnimationMappingObject(rawData, file);
    const safeTrigger = buildUniqueAnimationTrigger(trigger, nextMappings);
    if (safeTrigger !== trigger) {
      deduped += 1;
      triggerRenames.push([trigger, safeTrigger]);
    }

    nextMappings[safeTrigger] = {
      file: file,
      position: normalized.position,
      scale: normalized.scale
    };
    usedFiles.add(file);
  });

  availableAnimations.forEach(anim => {
    if (usedFiles.has(anim.filename)) return;
    const baseTrigger = normalizeTriggerFromFilename(anim.filename) || 'animation';
    const uniqueTrigger = buildUniqueAnimationTrigger(baseTrigger, nextMappings);
    nextMappings[uniqueTrigger] = createDefaultAnimationMapping(anim.filename);
    usedFiles.add(anim.filename);
    created += 1;
  });

  const before = JSON.stringify(animationMappings);
  const after = JSON.stringify(nextMappings);
  const changed = before !== after;

  if (changed) {
    const removedTriggers = Object.keys(animationMappings).filter(trigger => !Object.prototype.hasOwnProperty.call(nextMappings, trigger));
    triggerRenames.forEach(([fromTrigger, toTrigger]) => {
      moveGiftAnimationReferences(fromTrigger, toTrigger);
      moveStickerAnimationReferences(fromTrigger, toTrigger);
    });
    removedTriggers.forEach(trigger => {
      removeGiftAnimationReferences(trigger);
      removeStickerAnimationReferences(trigger);
    });

    animationMappings = nextMappings;
    await saveAnimationMappings();
    saveGiftMappings();
    saveStickerMappings();
    renderGiftMappings();
  }

  if (showAlert) {
    alert(`Sync complete.\nAdded: ${created}\nRemoved stale mappings: ${removed}\nDeduplicated: ${deduped}`);
  }

  return { changed, created, removed, deduped };
}

// Load animation mappings from settingsStore
function loadAnimationMappings() {
  const saved = settingsStore.getItem('animation_mappings');
  if (saved) {
    try {
      animationMappings = JSON.parse(saved);
      const normalized = {};
      Object.entries(animationMappings).forEach(([trigger, data]) => {
        normalized[trigger] = toAnimationMappingObject(data, getAnimationFileFromMapping(data));
      });
      animationMappings = normalized;
      console.log('✓ Loaded animation mappings:', Object.keys(animationMappings).length);
      renderAnimationMappings();
    } catch (e) {
      console.error('Error loading animation mappings:', e);
    }
  }
}

// Save animation mappings to server AND settingsStore
async function saveAnimationMappings() {
  // Save to settingsStore (backup)
  settingsStore.setItem('animation_mappings', JSON.stringify(animationMappings));
  
  // Save to server
  try {
    const config = {
      enabled: document.getElementById('animationsEnabled')?.checked ?? true,
      mappings: animationMappings,
      globalPosition: document.getElementById('animationPosition')?.value || 'bottom-left',
      globalScale: 1.0,
      animationVolume: getAnimationVolumePercent(),
      chroma: {
        greenThreshold: parseInt(document.getElementById('greenThreshold')?.value || 70),
        tolerance: parseInt(document.getElementById('chromaTolerance')?.value || 60),
        spillReduction: 0.5
      }
    };
    
    const response = await fetch('/api/animations/config/default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    
    if (response.ok) {
      console.log('✓ Saved animation config to server');
    }
  } catch (err) {
    console.error('Failed to save config to server:', err);
  }
}

// Fetch available animation files from server
async function loadAvailableAnimations() {
  try {
    const response = await fetch('/api/animations/list');
    const data = await response.json();
    availableAnimations = (data.animations || []).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`✓ Loaded ${availableAnimations.length} animation files`);
    renderAnimationMappings();
    syncAnimationMappingsFromFiles()
      .then(({ changed }) => {
        if (changed) renderAnimationMappings();
      })
      .catch(err => {
        console.error('Animation sync error:', err);
      });
  } catch (e) {
    console.error('Error loading animations:', e);
    availableAnimations = [];
    renderAnimationMappings();
  }
}

function ensureAnimationVideoSource(video) {
  if (!video) return;
  bindAnimationThumbnailDurationListener(video);
  if (video.dataset.src && !video.getAttribute('src')) {
    video.setAttribute('src', video.dataset.src);
    video.load();
  }
}

function playAnimationThumbnail(video) {
  if (!video) return;
  ensureAnimationVideoSource(video);
  if (video.paused) {
    video.play().catch(() => {});
  }
}

function stopAnimationThumbnail(video) {
  if (!video) return;
  video.pause();
  try {
    video.currentTime = 0;
  } catch (err) {
    // Some browsers may block currentTime until metadata is available.
  }
}

function isThumbnailInteractionActive(button) {
  if (!button) return false;
  return (
    button.matches(':hover') ||
    button.matches(':focus') ||
    button.matches(':focus-visible')
  );
}

function wireThumbnailLazyLoading(container) {
  if (animationThumbnailObserver) {
    animationThumbnailObserver.disconnect();
    animationThumbnailObserver = null;
  }

  const videos = container.querySelectorAll('.animation-thumb-video');
  if (videos.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    videos.forEach(video => ensureAnimationVideoSource(video));
    return;
  }

  animationThumbnailObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      ensureAnimationVideoSource(entry.target);
      observer.unobserve(entry.target);
    });
  }, {
    root: container,
    rootMargin: '160px 0px',
    threshold: 0.01
  });

  videos.forEach(video => animationThumbnailObserver.observe(video));
}

function wireThumbnailHoverPlayback(container) {
  const cardButtons = container.querySelectorAll('.preview-mapping-btn');

  cardButtons.forEach(btn => {
    const video = btn.querySelector('.animation-thumb-video');
    if (!video) return;

    const play = () => {
      playAnimationThumbnail(video);
    };

    const stop = () => {
      const card = btn.closest('.animation-mapping-card');
      if (card?.classList.contains('playing')) return;
      stopAnimationThumbnail(video);
    };

    if (btn.closest('.animation-mapping-card')?.classList.contains('playing')) {
      play();
    } else {
      stop();
    }
    btn.addEventListener('mouseenter', play);
    btn.addEventListener('mouseleave', stop);
    btn.addEventListener('focus', play);
    btn.addEventListener('blur', stop);
  });
}

function getFilteredSortedAnimationCards() {
  const sortMode = animationSortSelect?.value || 'name';
  const mapFilter = animationMapFilterSelect?.value || 'all';
  const stickerFilter = animationStickerFilterSelect?.value || 'all';

  const cards = availableAnimations.map(anim => {
    const mapped = findAnimationMappingEntryByFile(anim.filename);
    const trigger = mapped ? mapped.trigger : normalizeTriggerFromFilename(anim.filename);
    const giftNames = findGiftNamesForAnimationTrigger(trigger);
    const giftValues = findGiftValuesForAnimationTrigger(trigger);
    const hasDefaultGift = isGiftAnimationMapping(giftMappings.byValue?.['1'], trigger);
    const numericGiftValues = giftValues
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0);
    if (hasDefaultGift && !numericGiftValues.includes(1)) {
      numericGiftValues.push(1);
    }
    const hasGiftMapping = giftNames.length > 0 || giftValues.length > 0 || hasDefaultGift;
    const hasStickerMapping = hasStickerForAnimationTrigger(trigger);
    const mappedAny = hasGiftMapping || hasStickerMapping;

    return {
      anim,
      trigger,
      giftSortKey: (giftNames[0] || '').toLowerCase(),
      valueSortKey: numericGiftValues.length > 0 ? Math.min(...numericGiftValues) : Number.POSITIVE_INFINITY,
      hasStickerMapping,
      mappedAny
    };
  });

  const filtered = cards.filter(card => {
    if (mapFilter === 'mapped' && !card.mappedAny) return false;
    if (mapFilter === 'unmapped' && card.mappedAny) return false;
    if (stickerFilter === 'with-sticker' && !card.hasStickerMapping) return false;
    if (stickerFilter === 'without-sticker' && card.hasStickerMapping) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sortMode === 'gift') {
      if (a.giftSortKey && !b.giftSortKey) return -1;
      if (!a.giftSortKey && b.giftSortKey) return 1;
      const byGift = a.giftSortKey.localeCompare(b.giftSortKey);
      if (byGift !== 0) return byGift;
    } else if (sortMode === 'value') {
      const byValue = a.valueSortKey - b.valueSortKey;
      if (byValue !== 0) return byValue;
    }
    return a.trigger.localeCompare(b.trigger);
  });

  return filtered;
}

// Render animation mappings list
function renderAnimationMappings() {
  const list = document.getElementById('animationMappingsList');
  if (!list) return;

  if (availableAnimations.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; grid-column: 1 / -1;">No animation files found in /animations folder. Upload one to get started.</div>';
    return;
  }

  const cards = getFilteredSortedAnimationCards();
  if (cards.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem; grid-column: 1 / -1;">No animations match current sort/filter.</div>';
    return;
  }

  list.innerHTML = cards.map(({ anim, trigger }) => {
    const safeTrigger = escapeAttribute(trigger);
    const safeFilename = escapeAttribute(anim.filename);
    const fileUrl = getAnimationFileUrl(anim.filename);
    const visibilityBadges = renderAnimationVisibilityBadges(trigger);
    const playbackState = activeAnimationCardPlayback.get(trigger);
    const now = Date.now();
    const isPlaying = Boolean(playbackState && playbackState.endAtMs > now);
    let playProgress = 0;
    let countdown = '';
    if (isPlaying) {
      const remainingMs = Math.max(0, playbackState.endAtMs - now);
      const totalMs = Math.max(200, playbackState.durationSeconds * 1000);
      const elapsedMs = Math.max(0, totalMs - remainingMs);
      playProgress = Math.min(1, elapsedMs / totalMs);
      countdown = formatAnimationPlaybackCountdown(remainingMs);
    }
    
    return `
    <div class="animation-mapping-card${isPlaying ? ' playing' : ''}" data-animation-trigger="${safeTrigger}" data-animation-file="${safeFilename}" style="--play-progress:${playProgress.toFixed(4)}" title="${safeTrigger}">
      <button class="secondary animation-thumb-btn preview-mapping-btn" data-trigger="${safeTrigger}" title="${safeTrigger}">
        <video class="animation-thumb-video" data-src="${fileUrl}" data-file="${safeFilename}" muted loop playsinline preload="none"></video>
        ${visibilityBadges}
        <span class="animation-thumb-overlay">▶ Play</span>
        <span class="animation-playing-state" aria-hidden="true">
          <span class="animation-playing-label">Playing</span>
          <span class="animation-playing-countdown">${countdown}</span>
          <span class="animation-playing-progress"><span class="animation-playing-progress-fill"></span></span>
        </span>
      </button>
      <button class="secondary animation-gear-btn open-animation-settings-btn" data-trigger="${safeTrigger}" data-file="${safeFilename}" title="Settings">⚙️</button>
    </div>
  `;
  }).join('');

  wireThumbnailLazyLoading(list);
  wireThumbnailHoverPlayback(list);

  // Thumbnail preview click handler (test trigger)
  list.querySelectorAll('.preview-mapping-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const trigger = e.currentTarget.dataset.trigger;
      const data = animationMappings[trigger];
      const filename = getAnimationFileFromMapping(data);
      
      console.log(`🎬 Testing: ${trigger} → ${filename}`);
      
      const success = await triggerAnimation(trigger, 'manual', 'Test', 'test');
      if (success) {
        console.log(`✅ Triggered: ${trigger}`);
      }
    });
  });

  list.querySelectorAll('.open-animation-settings-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openAnimationCardPopup(btn.dataset.trigger, btn.dataset.file);
    });
  });

  updateAnimationPlaybackUi();
}

const uploadAnimationBtn = document.getElementById('uploadAnimationBtn');
const uploadAnimationInput = document.getElementById('uploadAnimationInput');
if (uploadAnimationBtn && uploadAnimationInput) {
  uploadAnimationBtn.addEventListener('click', () => uploadAnimationInput.click());
  uploadAnimationInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const defaultName = normalizeTriggerFromFilename(file.name) || 'animation';
    const nameInput = prompt('Animation name:', defaultName);
    if (nameInput === null) {
      uploadAnimationInput.value = '';
      return;
    }

    const customName = nameInput.trim() || defaultName;
    const formData = new FormData();
    formData.append('animation', file);
    formData.append('name', customName);

    try {
      const response = await fetch('/api/animations/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }

      await loadAvailableAnimations();
      alert(`Uploaded animation: ${customName}`);
    } catch (err) {
      console.error('Animation upload error:', err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      uploadAnimationInput.value = '';
    }
  });
}

const syncAnimationsBtn = document.getElementById('syncAnimationsBtn');
if (syncAnimationsBtn) {
  syncAnimationsBtn.addEventListener('click', async () => {
    try {
      const response = await fetch('/api/animations/list');
      const data = await response.json();
      availableAnimations = (data.animations || []).sort((a, b) => a.name.localeCompare(b.name));
      await syncAnimationMappingsFromFiles({ showAlert: true });
      renderAnimationMappings();
    } catch (err) {
      console.error('Sync animations error:', err);
      alert('Failed to sync animations');
    }
  });
}

function initAnimationListControls() {
  const controls = [
    { element: animationSortSelect, key: 'animation_sort_mode', fallback: 'name' },
    { element: animationMapFilterSelect, key: 'animation_map_filter', fallback: 'all' },
    { element: animationStickerFilterSelect, key: 'animation_sticker_filter', fallback: 'all' }
  ];

  controls.forEach(({ element, key, fallback }) => {
    if (!element) return;
    const saved = settingsStore.getItem(key);
    if (saved && Array.from(element.options).some(opt => opt.value === saved)) {
      element.value = saved;
    } else {
      element.value = fallback;
    }
    element.addEventListener('change', () => {
      settingsStore.setItem(key, element.value);
      renderAnimationMappings();
    });
  });
}

initAnimationListControls();

const animationCardPopup = document.getElementById('animationCardPopup');
const animationPopupName = document.getElementById('animationPopupName');
const animationPopupPositionGrid = document.getElementById('animationPopupPositionGrid');
const animationPopupScale = document.getElementById('animationPopupScale');
const animationPopupGiftName = document.getElementById('animationPopupGiftName');
const animationPopupGiftValue = document.getElementById('animationPopupGiftValue');
const animationPopupSticker = document.getElementById('animationPopupSticker');
const animationPopupStickerPicker = document.getElementById('animationPopupStickerPicker');
const animationPopupMakeDefault = document.getElementById('animationPopupMakeDefault');
const animationPopupScaleUpBtn = document.getElementById('animationPopupScaleUpBtn');
const animationPopupScaleDownBtn = document.getElementById('animationPopupScaleDownBtn');
const animationPopupSaveBtn = document.getElementById('animationPopupSaveBtn');
const animationPopupDeleteBtn = document.getElementById('animationPopupDeleteBtn');
const animationPopupCancelBtn = document.getElementById('animationPopupCancelBtn');
const animationPopupBackdrop = animationCardPopup?.querySelector('.animation-card-popup-backdrop');
const openAnimationGeneralSettingsBtn = document.getElementById('openAnimationGeneralSettingsBtn');
const animationGeneralSettingsPopup = document.getElementById('animationGeneralSettingsPopup');
const animationGeneralSettingsCloseBtn = document.getElementById('animationGeneralSettingsCloseBtn');
const animationGeneralSettingsBackdrop = animationGeneralSettingsPopup?.querySelector('.animation-card-popup-backdrop');
let activeAnimationPopup = null;
let activeAnimationPopupPosition = 'bottom-left';

function clampAnimationScale(value) {
  const min = 0.5;
  const max = 3;
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(min, value));
}

function formatAnimationScale(value) {
  const rounded = Math.round(value * 100) / 100;
  const text = rounded.toFixed(2);
  return text.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function getAnimationPopupScaleValue() {
  if (!animationPopupScale) return 1;
  const raw = parseFloat(animationPopupScale.value);
  return clampAnimationScale(raw);
}

function setAnimationPopupScaleValue(value) {
  if (!animationPopupScale) return;
  animationPopupScale.value = formatAnimationScale(clampAnimationScale(value));
}

function setAnimationPopupPosition(position) {
  activeAnimationPopupPosition = position || 'bottom-left';
  if (!animationPopupPositionGrid) return;
  animationPopupPositionGrid.querySelectorAll('.animation-position-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.position === activeAnimationPopupPosition);
  });
}

function closeAnimationCardPopup() {
  if (!animationCardPopup) return;
  animationCardPopup.style.display = 'none';
  activeAnimationPopup = null;
}

function closeAnimationGeneralSettingsPopup() {
  if (!animationGeneralSettingsPopup) return;
  animationGeneralSettingsPopup.style.display = 'none';
}

function openAnimationGeneralSettingsPopupPanel() {
  if (!animationGeneralSettingsPopup) return;
  animationGeneralSettingsPopup.style.display = 'flex';
}

function openAnimationCardPopup(trigger, filename) {
  if (!animationCardPopup || !animationPopupName || !animationPopupScale) return;

  const currentData = toAnimationMappingObject(animationMappings[trigger], filename);
  const currentGiftName = findFirstGiftNameForAnimationTrigger(trigger);
  const currentGiftValue = findFirstGiftValueForAnimationTrigger(trigger);
  const currentStickerKey = findStickerKeyForAnimationTrigger(trigger);
  const isDefaultGiftAnimation = isGiftAnimationMapping(giftMappings.byValue?.['1'], trigger);
  activeAnimationPopup = { trigger, filename };

  animationPopupName.value = trigger;
  setAnimationPopupPosition(currentData.position || 'bottom-left');
  setAnimationPopupScaleValue(currentData.scale ?? 1.0);
  if (animationPopupGiftName) animationPopupGiftName.value = currentGiftName;
  if (animationPopupGiftValue) animationPopupGiftValue.value = currentGiftValue;
  populateAnimationPopupStickerOptions(currentStickerKey);
  if (animationPopupMakeDefault) animationPopupMakeDefault.checked = isDefaultGiftAnimation;
  animationCardPopup.style.display = 'flex';
  animationPopupName.focus();
}

if (animationPopupCancelBtn) {
  animationPopupCancelBtn.addEventListener('click', closeAnimationCardPopup);
}
if (animationPopupBackdrop) {
  animationPopupBackdrop.addEventListener('click', closeAnimationCardPopup);
}
if (openAnimationGeneralSettingsBtn) {
  openAnimationGeneralSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openAnimationGeneralSettingsPopupPanel();
  });
}
if (animationGeneralSettingsCloseBtn) {
  animationGeneralSettingsCloseBtn.addEventListener('click', closeAnimationGeneralSettingsPopup);
}
if (animationGeneralSettingsBackdrop) {
  animationGeneralSettingsBackdrop.addEventListener('click', closeAnimationGeneralSettingsPopup);
}
if (animationPopupPositionGrid) {
  animationPopupPositionGrid.querySelectorAll('.animation-position-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setAnimationPopupPosition(btn.dataset.position);
    });
  });
}
if (animationPopupScaleUpBtn) {
  animationPopupScaleUpBtn.addEventListener('click', () => {
    const nextValue = getAnimationPopupScaleValue() + 0.25;
    setAnimationPopupScaleValue(nextValue);
  });
}
if (animationPopupScaleDownBtn) {
  animationPopupScaleDownBtn.addEventListener('click', () => {
    const nextValue = getAnimationPopupScaleValue() - 0.25;
    setAnimationPopupScaleValue(nextValue);
  });
}
if (animationPopupSaveBtn) {
  animationPopupSaveBtn.addEventListener('click', async () => {
    if (!activeAnimationPopup) return;
    const oldTrigger = activeAnimationPopup.trigger;
    const filename = activeAnimationPopup.filename;

    const desiredTrigger = normalizeTriggerFromFilename(animationPopupName?.value || oldTrigger);
    if (!desiredTrigger) {
      alert('Name cannot be empty.');
      return;
    }

    const uniqueTrigger = buildUniqueAnimationTrigger(desiredTrigger, animationMappings, oldTrigger);
    if (uniqueTrigger !== desiredTrigger) {
      alert(`Name "${desiredTrigger}" already exists. Using "${uniqueTrigger}" instead.`);
    }
    const scaleValue = getAnimationPopupScaleValue();
    const nextGiftName = animationPopupGiftName ? animationPopupGiftName.value.trim() : '';
    const nextGiftValueRaw = animationPopupGiftValue ? animationPopupGiftValue.value.trim() : '';
    const hasGiftValueInput = nextGiftValueRaw.length > 0;
    const parsedGiftValue = Number(nextGiftValueRaw);
    if (hasGiftValueInput && (!Number.isFinite(parsedGiftValue) || parsedGiftValue <= 0)) {
      alert('Diamond value must be a positive number.');
      return;
    }
    const makeDefaultGiftAnimation = Boolean(animationPopupMakeDefault?.checked);
    const nextGiftValue = hasGiftValueInput ? String(Math.floor(parsedGiftValue)) : '';
    const nextStickerKey = animationPopupSticker ? animationPopupSticker.value : '';
    const currentData = toAnimationMappingObject(animationMappings[oldTrigger], filename);
    const prevGiftName = findFirstGiftNameForAnimationTrigger(oldTrigger);
    const prevGiftValue = findFirstGiftValueForAnimationTrigger(oldTrigger);
    const updatedData = {
      file: filename,
      position: activeAnimationPopupPosition || currentData.position || 'bottom-left',
      scale: Number.isFinite(scaleValue) ? scaleValue : currentData.scale
    };

    moveGiftAnimationReferences(oldTrigger, uniqueTrigger);
    moveStickerAnimationReferences(oldTrigger, uniqueTrigger);

    if (oldTrigger !== uniqueTrigger) {
      delete animationMappings[oldTrigger];
    }
    animationMappings[uniqueTrigger] = updatedData;

    if (prevGiftName && prevGiftName !== nextGiftName) {
      removeGiftAnimationReferenceForKey(giftMappings.byName, prevGiftName, uniqueTrigger);
    }
    if (nextGiftName) {
      addGiftAnimationReference(giftMappings.byName, nextGiftName, uniqueTrigger);
    }

    if (prevGiftValue && prevGiftValue !== nextGiftValue) {
      removeGiftAnimationReferenceForKey(giftMappings.byValue, prevGiftValue, uniqueTrigger);
    }
    if (nextGiftValue) {
      addGiftAnimationReference(giftMappings.byValue, nextGiftValue, uniqueTrigger);
    }

    if (makeDefaultGiftAnimation) {
      addGiftAnimationReference(giftMappings.byValue, '1', uniqueTrigger);
    } else if (nextGiftValue !== '1') {
      removeGiftAnimationReferenceForKey(giftMappings.byValue, '1', uniqueTrigger);
    }

    setStickerForAnimationTrigger(uniqueTrigger, nextStickerKey);

    await saveAnimationMappings();
    saveGiftMappings();
    saveStickerMappings();
    renderGiftMappings();
    renderAnimationMappings();
    closeAnimationCardPopup();
  });
}
if (animationPopupDeleteBtn) {
  animationPopupDeleteBtn.addEventListener('click', async () => {
    if (!activeAnimationPopup) return;
    const { filename } = activeAnimationPopup;
    const shouldDelete = confirm(`Delete file "${filename}" from /animations?`);
    if (!shouldDelete) return;

    try {
      const response = await fetch(`/api/animations/file/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }

      Object.keys(animationMappings).forEach(trigger => {
        if (getAnimationFileFromMapping(animationMappings[trigger]) === filename) {
          removeGiftAnimationReferences(trigger);
          removeStickerAnimationReferences(trigger);
          delete animationMappings[trigger];
        }
      });

      await saveAnimationMappings();
      saveGiftMappings();
      saveStickerMappings();
      renderGiftMappings();
      await loadAvailableAnimations();
      closeAnimationCardPopup();
    } catch (err) {
      console.error('Animation delete error:', err);
      alert(`Failed to delete animation: ${err.message}`);
    }
  });
}

// Animations enabled checkbox
const animationsEnabledCheckbox = document.getElementById('animationsEnabled');
if (animationsEnabledCheckbox) {
  // Load saved state
  const saved = settingsStore.getItem('animations_enabled');
  if (saved !== null) {
    animationsEnabledCheckbox.checked = saved === 'true';
  }

  animationsEnabledCheckbox.addEventListener('change', () => {
    settingsStore.setItem('animations_enabled', animationsEnabledCheckbox.checked);
    console.log('Animations:', animationsEnabledCheckbox.checked ? 'enabled ✅' : 'disabled ❌');
  });
}

if (animationVolumeSlider) {
  const savedAnimationVolume = settingsStore.getItem('animation_volume');
  if (savedAnimationVolume !== null) {
    animationVolumeSlider.value = savedAnimationVolume;
  }
  updateAnimationVolumeLabel();

  animationVolumeSlider.addEventListener('input', () => {
    settingsStore.setItem('animation_volume', animationVolumeSlider.value);
    updateAnimationVolumeLabel();
    saveAnimationMappings();
  });
}

// Chroma key sliders
const greenThresholdSlider = document.getElementById('greenThreshold');
const chromaToleranceSlider = document.getElementById('chromaTolerance');

if (greenThresholdSlider && chromaToleranceSlider) {
  // Load saved values
  const savedChroma = settingsStore.getItem('chroma_key_settings');
  if (savedChroma) {
    try {
      const settings = JSON.parse(savedChroma);
      greenThresholdSlider.value = settings.greenThreshold || 100;
      chromaToleranceSlider.value = settings.tolerance || 50;
      document.getElementById('greenThresholdValue').textContent = greenThresholdSlider.value;
      document.getElementById('chromaToleranceValue').textContent = chromaToleranceSlider.value;
    } catch (e) {
      console.error('Error loading chroma settings:', e);
    }
  }

  // Update value displays
  greenThresholdSlider.addEventListener('input', () => {
    document.getElementById('greenThresholdValue').textContent = greenThresholdSlider.value;
    saveAnimationMappings();
  });

  chromaToleranceSlider.addEventListener('input', () => {
    document.getElementById('chromaToleranceValue').textContent = chromaToleranceSlider.value;
    saveAnimationMappings();
  });

  // Save on change
  function saveChromaSettings() {
    const settings = {
      greenThreshold: parseInt(greenThresholdSlider.value),
      tolerance: parseInt(chromaToleranceSlider.value),
      spillReduction: 0.5
    };
    settingsStore.setItem('chroma_key_settings', JSON.stringify(settings));
    console.log('✓ Chroma key settings saved:', settings);
  }

  greenThresholdSlider.addEventListener('change', saveChromaSettings);
  chromaToleranceSlider.addEventListener('change', saveChromaSettings);
}

async function triggerAnimation(trigger, platform, author, type = 'gift') {
  console.log(`🎯 triggerAnimation called: trigger="${trigger}", platform="${platform}", author="${author}"`);
  console.log(`Available mappings:`, Object.keys(animationMappings));

  // Check if we have a mapping for this trigger
  if (!animationMappings[trigger]) {
    console.warn(`❌ No animation mapped for trigger: "${trigger}"`);
    console.log(`Available triggers:`, Object.keys(animationMappings).join(', '));
    return false;
  }

  const data = animationMappings[trigger];
  const filename = typeof data === 'string' ? data : data.file;
  console.log(`✅ Found mapping: ${trigger} → ${filename}`);
  const playbackToken = markAnimationCardPlaying(trigger);

  // Send to server to broadcast to overlay
  console.log(`📡 Sending to server: POST /api/animations/trigger`);
  try {
    const response = await fetch('/api/animations/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        trigger: trigger,
        platform: platform,
        author: author
      })
    });

    if (response.ok) {
      console.log(`✅ Animation trigger sent successfully: ${trigger}`);
      return true;
    } else {
      console.error(`❌ Server returned error:`, response.status);
      clearAnimationCardPlaybackIfMatches(trigger, playbackToken);
      return false;
    }
  } catch (err) {
    console.error('❌ Animation trigger error:', err);
    clearAnimationCardPlaybackIfMatches(trigger, playbackToken);
    return false;
  }
}

// Initialize animation system
loadStickerMappings();
loadAnimationMappings();
loadAvailableAnimations();

console.log('🎬 Animation system initialized');

// ─── Individual Voice Management System ─────────────────────────────

const toggleVoiceFilterBtn = document.getElementById('toggleVoiceFilter');
const voiceFilterPanel = document.getElementById('voiceFilterPanel');
const voiceFilterIcon = document.getElementById('voiceFilterIcon');
const voicePreviewList = document.getElementById('voicePreviewList');
const voicePreviewText = document.getElementById('voicePreviewText');
const hideAllVoicesBtn = document.getElementById('hideAllVoicesBtn');
const showAllVoicesBtn = document.getElementById('showAllVoicesBtn');
const hiddenVoicesContainer = document.getElementById('hiddenVoicesContainer');
const hiddenVoicesList = document.getElementById('hiddenVoicesList');

// Load hidden voices from settingsStore
function loadHiddenVoices() {
  const saved = settingsStore.getItem('hidden_voices');
  if (saved) {
    try {
      hiddenVoices = new Set(JSON.parse(saved));
      console.log(`✓ Loaded ${hiddenVoices.size} hidden voices`);
    } catch (e) {
      console.error('Error loading hidden voices:', e);
    }
  }
}

// Save hidden voices to settingsStore
function saveHiddenVoices() {
  settingsStore.setItem('hidden_voices', JSON.stringify(Array.from(hiddenVoices)));
  console.log(`✓ Saved ${hiddenVoices.size} hidden voices`);
}

// Toggle voice filter panel
if (toggleVoiceFilterBtn && voiceFilterPanel) {
  toggleVoiceFilterBtn.addEventListener('click', () => {
    const isOpen = voiceFilterPanel.style.display !== 'none';
    voiceFilterPanel.style.display = isOpen ? 'none' : 'block';
    if (voiceFilterIcon) {
      voiceFilterIcon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    }

    if (!isOpen) {
      populateVoicePreviewList();
      populateHiddenVoicesList();
    }
  });
}

// Show all voices button
if (showAllVoicesBtn) {
  showAllVoicesBtn.addEventListener('click', () => {
    hiddenVoices.clear();
    saveHiddenVoices();
    loadVoices();
    populateVoicePreviewList();
    populateHiddenVoicesList();
  });
}

if (hideAllVoicesBtn) {
  hideAllVoicesBtn.addEventListener('click', () => {
    getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
      .forEach((entry) => hiddenVoices.add(entry.id));
    saveHiddenVoices();
    loadVoices();
    populateVoicePreviewList();
    populateHiddenVoicesList();
  });
}

// Populate visible voices list
function populateVoicePreviewList() {
  if (!voicePreviewList) return;
  voicePreviewList.style.removeProperty('column-count');

  const groups = buildVoiceGroups({ includeHidden: true });
  if (groups.length === 0) {
    voicePreviewList.innerHTML = '<div class="voice-list-empty">No voices available</div>';
    return;
  }

  voicePreviewList.innerHTML = groups.map((group) => {
    const visibleCount = group.voices.filter((entry) => !entry.isHidden).length;
    const allHidden = visibleCount === 0;

    const voicesMarkup = group.voices.map((entry) => `
      <div class="voice-preview-item${entry.isHidden ? ' is-hidden' : ''}">
        <span class="voice-preview-name" title="${escapeAttribute(entry.name)}">${escapeHtml(entry.name)}</span>
        <div class="voice-preview-actions">
          <button class="secondary preview-voice-btn" data-voice="${escapeAttribute(entry.id)}">Preview</button>
          <button class="secondary voice-visibility-btn" data-voice="${escapeAttribute(entry.id)}">${entry.isHidden ? 'Show' : 'Hide'}</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="voice-filter-group">
        <div class="voice-filter-group-header">
          <span class="voice-filter-group-title">${escapeHtml(group.label)}</span>
          <div class="voice-filter-group-actions">
            <span class="voice-filter-group-count">${visibleCount}/${group.voices.length} shown</span>
            <button class="secondary voice-group-toggle-btn" data-group="${escapeAttribute(group.key)}" data-action="${allHidden ? 'show' : 'hide'}">
              ${allHidden ? 'Show group' : 'Hide group'}
            </button>
          </div>
        </div>
        <div class="voice-filter-group-list">${voicesMarkup}</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.preview-voice-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const voiceId = btn.dataset.voice;
      if (!voiceId) return;
      previewVoice(voiceId);
    });
  });

  document.querySelectorAll('.voice-visibility-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const voiceId = btn.dataset.voice;
      if (!voiceId) return;

      if (hiddenVoices.has(voiceId)) {
        hiddenVoices.delete(voiceId);
      } else {
        hiddenVoices.add(voiceId);
      }

      saveHiddenVoices();
      loadVoices();
      populateVoicePreviewList();
      populateHiddenVoicesList();
    });
  });

  document.querySelectorAll('.voice-group-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const groupKey = btn.dataset.group;
      const action = btn.dataset.action;
      if (!groupKey || !action) return;

      const targetGroup = buildVoiceGroups({ includeHidden: true })
        .find((group) => group.key === groupKey);
      if (!targetGroup) return;

      targetGroup.voices.forEach((entry) => {
        if (action === 'hide') {
          hiddenVoices.add(entry.id);
        } else {
          hiddenVoices.delete(entry.id);
        }
      });

      saveHiddenVoices();
      loadVoices();
      populateVoicePreviewList();
      populateHiddenVoicesList();
    });
  });

}

// Preview a voice
function previewVoice(voiceId) {
  const testMsg = (voicePreviewText && voicePreviewText.value) || (testMessageInput && testMessageInput.value) || DEFAULT_TEST_MESSAGE;

  if (voiceId.startsWith('cloned-')) {
    // Preview cloned voice
    speakWithCustomVoice(voiceId, testMsg).then(result => {
      if (result.isCloned) {
        result.audio.play().catch(err => {
          console.warn('Audio preview blocked:', err);
          unlockAudio();
        });
      } else {
        synth.speak(result.utterance);
      }
    });
  } else if (voiceId.startsWith('system-')) {
    // Preview system voice
    const voiceIndex = parseInt(voiceId.replace('system-', ''));
    const utterance = new SpeechSynthesisUtterance(testMsg);

    if (voices[voiceIndex]) {
      utterance.voice = voices[voiceIndex];
    }

    utterance.rate = parseFloat(rateSelect.value);
    utterance.pitch = parseFloat(pitchSelect.value);
    utterance.volume = volumeSlider.value / 100;

    synth.speak(utterance);
  }
}

if (voicePreviewText) {
  voicePreviewText.addEventListener('input', () => {
    if (testMessageInput && testMessageInput.value !== voicePreviewText.value) {
      testMessageInput.value = voicePreviewText.value;
      settingsStore.setItem('yt_tts_test_message', voicePreviewText.value);
    }
  });
}

console.log('✓ Voice filter & preview system initialized');

// ─── Language Filter Checkboxes ─────────────────────────────────────

// Language filter checkboxes
document.querySelectorAll('.lang-filter').forEach(checkbox => {
  checkbox.addEventListener('change', (e) => {
    const lang = e.target.dataset.lang;

    if (e.target.checked) {
      enabledLanguages.add(lang);
    } else {
      enabledLanguages.delete(lang);
    }

    // Save to settingsStore
    settingsStore.setItem('enabled_languages', JSON.stringify(Array.from(enabledLanguages)));

    console.log(`✓ Language filter updated: ${lang} ${e.target.checked ? 'enabled' : 'disabled'}`);

    // Refresh all voice dropdowns
    loadVoices();
    populateVoicePreviewList();
    populateHiddenVoicesList();
  });
});

// Load saved language filters
function loadLanguageFilters() {
  const saved = settingsStore.getItem('enabled_languages');
  if (saved) {
    try {
      const langs = JSON.parse(saved);
      const allowedLangs = VOICE_GROUP_ORDER.filter((code) => code !== 'custom');
      enabledLanguages = new Set(
        Array.isArray(langs) ? langs.filter((code) => allowedLangs.includes(code)) : []
      );
      if (enabledLanguages.size === 0) {
        enabledLanguages = new Set(allowedLangs);
      }

      // Update checkboxes to match saved state
      document.querySelectorAll('.lang-filter').forEach(checkbox => {
        checkbox.checked = enabledLanguages.has(checkbox.dataset.lang);
      });

      console.log('✓ Loaded language filters:', Array.from(enabledLanguages));
    } catch (e) {
      console.error('Error loading language filters:', e);
      enabledLanguages = new Set(VOICE_GROUP_ORDER.filter((code) => code !== 'custom'));
    }
  }
}

// Populate hidden voices list
function populateHiddenVoicesList() {
  if (!hiddenVoicesList || !hiddenVoicesContainer) return;

  const hiddenEntries = getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
    .filter((entry) => hiddenVoices.has(entry.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }));

  if (hiddenEntries.length === 0) {
    hiddenVoicesList.style.display = 'none';
    hiddenVoicesContainer.innerHTML = '';
    return;
  }

  hiddenVoicesList.style.display = 'block';

  hiddenVoicesContainer.innerHTML = hiddenEntries.map((entry) => {
    return `
      <div class="hidden-voice-item">
        <span class="hidden-voice-name" title="${escapeAttribute(entry.name)}">${escapeHtml(entry.name)}</span>
        <button class="secondary unhide-voice-btn" data-voice="${escapeAttribute(entry.id)}">
          Restore
        </button>
      </div>
    `;
  }).join('');

  // Add unhide button handlers
  document.querySelectorAll('.unhide-voice-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const voiceId = btn.dataset.voice;
      if (!voiceId) return;
      hiddenVoices.delete(voiceId);
      saveHiddenVoices();
      loadVoices();
      populateVoicePreviewList();
      populateHiddenVoicesList();
    });
  });
}

// Load filters on startup
loadLanguageFilters();

console.log('✓ Language filter system initialized');

// ─── OBS URL Generator ──────────────────────────────────────────────

// Position selector
const animationPositionSelect = document.getElementById('animationPosition');
if (animationPositionSelect) {
  // Load saved position
  const savedPosition = settingsStore.getItem('animation_position');
  if (savedPosition) {
    animationPositionSelect.value = savedPosition;
  }

  // Save on change
  animationPositionSelect.addEventListener('change', () => {
    settingsStore.setItem('animation_position', animationPositionSelect.value);
    console.log('✓ Animation position saved:', animationPositionSelect.value);
  });
}

console.log('✓ OBS URL generator initialized');

// Auto-unlock audio on page load with a silent click simulation
window.addEventListener('load', () => {
  setTimeout(() => {
    // Try to unlock audio automatically
    unlockAudio();
    
    // If that doesn't work, show a prominent message
    if (!audioUnlocked) {
      const notice = document.createElement('div');
      notice.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff4444;
        color: white;
        padding: 15px 30px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
      `;
      notice.textContent = '🔊 Click anywhere to enable TTS audio';
      document.body.appendChild(notice);
      
      // Remove notice after first interaction
      const removeNotice = () => {
        notice.remove();
        document.removeEventListener('click', removeNotice);
        document.removeEventListener('keydown', removeNotice);
      };
      document.addEventListener('click', removeNotice);
      document.addEventListener('keydown', removeNotice);
    }
  }, 1000);
});

// Add this function anywhere in app.js
async function testAllKeys() {
  console.log('🔑 Testing all API keys...');
  for (let i = 0; i < apiKeys.length; i++) {
    const key = apiKeys[i];
    try {
      const response = await fetch(`/api/youtube/channels?part=id&forHandle=youtube&key=${key}`);
      if (response.ok) {
        console.log(`✅ Key ${i + 1}: WORKING`);
      } else {
        const error = await response.json();
        console.log(`❌ Key ${i + 1}: ${error.error?.message || 'FAILED'}`);
      }
    } catch (err) {
      console.log(`❌ Key ${i + 1}: ${err.message}`);
    }
  }
}
// Run this in console to test all keys
// testAllKeys()

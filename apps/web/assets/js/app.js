const settingsStore = window.settingsStore;
const collapsibleSectionsController = window.createCollapsibleSectionsController({
  windowRef: window,
  documentRef: document,
  settingsStore
});
collapsibleSectionsController.init();

// TTS Configuration
const synth = window.speechSynthesis;
const voicesController = window.createVoicesController({ settingsStore });
const voices = voicesController.state.voices;
const clonedVoices = voicesController.state.clonedVoices;
const hiddenVoices = voicesController.state.hiddenVoices;
const enabledLanguages = voicesController.state.enabledLanguages;
const userVoices = voicesController.state.userVoices;
const recentUsers = voicesController.state.recentUsers;
const VOICE_GROUP_ORDER = voicesController.constants.VOICE_GROUP_ORDER;
const VOICE_GROUP_LABELS = voicesController.constants.VOICE_GROUP_LABELS;
const CLONED_VOICE_LANGUAGE_OPTIONS = voicesController.constants.CLONED_VOICE_LANGUAGE_OPTIONS;
let ollamaGenderController = null;

function getVoiceLanguageCode(lang) {
  return voicesController.getVoiceLanguageCode(lang);
}

function buildVoiceGroups(options = {}) {
  return voicesController.buildVoiceGroups(options);
}

function getAllVoiceEntries(options = {}) {
  return voicesController.getAllVoiceEntries(options);
}

function findVoiceEntryById(voiceId) {
  return voicesController.findVoiceEntryById(voiceId);
}

function populateVoiceSelectElement(select, preferredVoiceId = '') {
  return voicesController.populateVoiceSelectElement(select, preferredVoiceId);
}

function buildVoiceOptionsMarkup(selectedVoiceId = '') {
  return voicesController.buildVoiceOptionsMarkup(selectedVoiceId, {
    escapeAttribute,
    escapeHtml
  });
}

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

let audioRuntimeController = null;
let soundAlertsController = null;
let keywordTriggersController = null;
let animationPermissionsUiController = null;
let dashboardSettingsController = null;
let chatUiController = null;
let voiceTestControlsController = null;
let startupOrchestratorController = null;

function requestWakeLock() {
  return audioRuntimeController?.requestWakeLock();
}

function releaseWakeLock() {
  return audioRuntimeController?.releaseWakeLock();
}

function ensureAudioContext() {
  return audioRuntimeController?.ensureAudioContext();
}

function unlockAudio() {
  return audioRuntimeController?.unlockAudio();
}

// Platform-specific state
let youtubeController = null;
let tiktokController = null;

function isYouTubeConnected() {
  return !!(youtubeController && youtubeController.isConnected());
}

function isTikTokConnected() {
  return !!(tiktokController && tiktokController.isConnected());
}

audioRuntimeController = window.createAudioRuntimeController({
  windowRef: window,
  documentRef: document,
  navigatorRef: navigator,
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: (id) => clearTimeout(id),
  getShouldRequestWakeLock: () => isYouTubeConnected() || isTikTokConnected(),
  unlockNoticeDelayMs: 1000
});

// User profile state
const userDisplayNames = new Map(); // platform:username -> preferred display name

function getUserProfileKey(platform, username) {
  return `${platform}:${String(username || '').trim()}`;
}

function normalizeUserDisplayName(displayName, username) {
  const fallback = String(username || '').trim();
  const candidate = String(displayName || '').trim();
  return candidate || fallback;
}

function rememberUserDisplayName(username, platform, displayName = '') {
  const normalizedUsername = String(username || '').trim();
  const normalizedPlatform = String(platform || '').trim();
  if (!normalizedUsername || !normalizedPlatform) return normalizedUsername;

  const resolved = normalizeUserDisplayName(displayName, normalizedUsername);
  const key = getUserProfileKey(normalizedPlatform, normalizedUsername);
  const previous = userDisplayNames.get(key);
  if (previous !== resolved) {
    userDisplayNames.set(key, resolved);
    settingsStore.setItem('user_display_names', JSON.stringify(Object.fromEntries(userDisplayNames.entries())));
  }
  return resolved;
}

function rememberUserProfile({ username, platform, displayName = '', avatar = null } = {}) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPlatform = String(platform || '').trim();
  if (!normalizedUsername || !normalizedPlatform || normalizedPlatform === 'SYSTEM') return;

  rememberUserDisplayName(normalizedUsername, normalizedPlatform, displayName);
  if (avatar) {
    window.userAvatars.set(`${normalizedPlatform}:${normalizedUsername}`, avatar);
  }
}

function getUserDisplayName(username, platform) {
  const normalizedUsername = String(username || '').trim();
  const normalizedPlatform = String(platform || '').trim();
  if (!normalizedUsername || !normalizedPlatform) return normalizedUsername;

  const key = getUserProfileKey(normalizedPlatform, normalizedUsername);
  const cached = userDisplayNames.get(key);
  if (cached) return cached;

  return normalizedUsername;
}

// Voice select elements
let voiceSelectYouTube = null;
let voiceSelectTikTok = null;

// UI Elements
const channelUrlInput = document.getElementById('channelUrl');
const streamUrlInput = document.getElementById('streamUrl');
const findStreamBtn = document.getElementById('findStreamBtn');
const statusDiv = document.getElementById('status');
const chatFeed = document.getElementById('chatFeed');
const chatLayout = document.getElementById('chatLayout');
const chatOnlineSplitter = document.getElementById('chatOnlineSplitter');
const rateSelect = document.getElementById('rateSelect');
const pitchSelect = document.getElementById('pitchSelect');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const soundAlertsVolumeSlider = document.getElementById('soundAlertsVolumeSlider');
const soundAlertsVolumeValue = document.getElementById('soundAlertsVolumeValue');
const readUsernamesCheckbox = document.getElementById('readUsernames');
const readEmojisCheckbox = document.getElementById('readEmojis');
const readLinksCheckbox = document.getElementById('readLinks');
const youtubeStartupBacklogInput = document.getElementById('youtubeStartupBacklogCount');
const youtubeStartupBacklogLabel = document.getElementById('youtubeStartupBacklogLabel');
const youtubeStartupBacklogDownBtn = document.getElementById('youtubeStartupBacklogDownBtn');
const youtubeStartupBacklogUpBtn = document.getElementById('youtubeStartupBacklogUpBtn');
const testMessageInput = document.getElementById('testMessage');
const testVoiceYouTubeBtn = document.getElementById('testVoiceYouTubeBtn');
const testVoiceTikTokBtn = document.getElementById('testVoiceTikTokBtn');
const ollamaStatusEl = document.getElementById('ollamaStatus');
const ollamaBaseUrlInput = document.getElementById('ollamaBaseUrlInput');
const onlineUsersPanel = document.getElementById('onlineUsersPanel');
const onlineUsersGrid = document.getElementById('onlineUsersGrid');
const onlineUsersSplitter = document.getElementById('onlineUsersSplitter');
const onlineYouTubeCountEl = document.getElementById('onlineYouTubeCount');
const onlineTikTokCountEl = document.getElementById('onlineTikTokCount');
const onlineYouTubeUsersEl = document.getElementById('onlineYouTubeUsers');
const onlineTikTokUsersEl = document.getElementById('onlineTikTokUsers');
const onlineYouTubeIndicatorEl = document.getElementById('onlineYouTubeIndicator');
const onlineTikTokIndicatorEl = document.getElementById('onlineTikTokIndicator');
const stickerAssignModal = document.getElementById('stickerAssignModal');
const stickerAssignPreviewImage = document.getElementById('stickerAssignPreviewImage');
const stickerAssignName = document.getElementById('stickerAssignName');
const stickerAssignCurrent = document.getElementById('stickerAssignCurrent');
const stickerAssignAnimationSelect = document.getElementById('stickerAssignAnimationSelect');
const stickerAssignSaveBtn = document.getElementById('stickerAssignSaveBtn');
const stickerAssignCancelBtn = document.getElementById('stickerAssignCancelBtn');
const DEFAULT_TEST_MESSAGE = 'Are you already subscribe to my YouTube? Wait, what!? Bro!';
const MUTE_VOICE_ID = 'mute-user';
const CHAT_LAYOUT_WIDTH_KEY = 'chat_online_panel_width';
const CHAT_LAYOUT_MIN_WIDTH = 260;
const CHAT_LAYOUT_MAX_WIDTH = 760;
const ONLINE_USERS_TOP_HEIGHT_KEY = 'online_users_youtube_height';
const ONLINE_USERS_TOP_MIN_HEIGHT = 120;
const ANIMATION_KEYWORD_JOB_KEY = 'animation_keyword_generation_job';
let animationKeywordJob = null;
let animationKeywordGenerationPromise = null;

function getStartupBacklogCount() {
  const fallback = window.settingsStore?.getItem?.('yt_tts_startup_backlog_count') ?? '0';
  const raw = Number(youtubeStartupBacklogInput ? youtubeStartupBacklogInput.value : fallback);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(20, Math.floor(raw)));
}

function normalizeAnimationKeywordJob(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const pendingItems = Array.isArray(raw.pendingItems)
    ? raw.pendingItems
      .map((entry) => ({ kind: 'animation', filename: String(entry?.filename || entry || '').trim() }))
      .filter((entry) => entry.filename)
    : [];
  const total = Number(raw.total);
  return {
    pendingItems,
    total: Number.isFinite(total) && total >= pendingItems.length
      ? Math.floor(total)
      : pendingItems.length
  };
}

function loadAnimationKeywordJob() {
  const raw = settingsStore.getItem(ANIMATION_KEYWORD_JOB_KEY);
  if (!raw) {
    animationKeywordJob = null;
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const job = normalizeAnimationKeywordJob(parsed);
    animationKeywordJob = job.pendingItems.length > 0 ? job : null;
  } catch (err) {
    console.error('Failed to parse animation keyword job:', err);
    animationKeywordJob = null;
  }
}

function saveAnimationKeywordJob() {
  if (!animationKeywordJob || !Array.isArray(animationKeywordJob.pendingItems) || animationKeywordJob.pendingItems.length === 0) {
    settingsStore.removeItem(ANIMATION_KEYWORD_JOB_KEY);
    animationKeywordJob = null;
    return;
  }

  settingsStore.setItem(ANIMATION_KEYWORD_JOB_KEY, JSON.stringify({
    pendingItems: animationKeywordJob.pendingItems,
    total: animationKeywordJob.total
  }));
}

function getAnimationKeywordJobProgress() {
  const total = Number(animationKeywordJob?.total || 0);
  const remaining = Array.isArray(animationKeywordJob?.pendingItems) ? animationKeywordJob.pendingItems.length : 0;
  return {
    total,
    remaining,
    completed: Math.max(0, total - remaining)
  };
}

function updateAnimationKeywordGenerateButton() {
  if (!generateAnimationKeywordsBtn) return;
  const { total, completed } = getAnimationKeywordJobProgress();
  generateAnimationKeywordsBtn.disabled = Boolean(animationKeywordGenerationPromise);
  if (total > 0) {
    generateAnimationKeywordsBtn.textContent = animationKeywordGenerationPromise
      ? `Generating ${completed}/${total}`
      : `Resume ${completed}/${total}`;
    updateAnimationKeywordToggleButton();
    return;
  }
  generateAnimationKeywordsBtn.textContent = '✨ Suggest Missing';
  updateAnimationKeywordToggleButton();
}

function getAnimationKeywordToggleState() {
  const eligibleEntries = Object.entries(animationMappings)
    .map(([trigger, rawData]) => {
      const file = getAnimationFileFromMapping(rawData);
      const normalized = toAnimationMappingObject(rawData, file);
      const keywords = Array.isArray(normalized.keywords) ? normalized.keywords : [];
      if (keywords.length === 0) return null;
      return {
        trigger,
        enabled: normalized.keywordTriggerEnabled === true
      };
    })
    .filter(Boolean);
  const enabledCount = eligibleEntries.filter((entry) => entry.enabled).length;
  return {
    total: eligibleEntries.length,
    enabledCount,
    allEnabled: eligibleEntries.length > 0 && enabledCount === eligibleEntries.length
  };
}

function updateAnimationKeywordToggleButton() {
  if (!animationKeywordToggleBtn) return;
  const { total, allEnabled } = getAnimationKeywordToggleState();
  animationKeywordToggleBtn.disabled = Boolean(animationKeywordGenerationPromise) || total === 0;
  animationKeywordToggleBtn.textContent = allEnabled ? 'Disable all' : 'Enable all';
  animationKeywordToggleBtn.title = total > 0
    ? `${allEnabled ? 'Disable' : 'Enable'} keyword triggers for all ${total} animation(s) that already have keywords`
    : 'Generate or enter keywords first, then you can enable them all here';
}

async function setAllAnimationKeywordTriggers(enabled = false) {
  const normalizedEnabled = enabled === true;
  let changedCount = 0;

  Object.entries(animationMappings).forEach(([trigger, rawData]) => {
    const file = getAnimationFileFromMapping(rawData);
    const normalized = toAnimationMappingObject(rawData, file);
    const keywords = Array.isArray(normalized.keywords) ? normalized.keywords : [];
    if (keywords.length === 0) return;
    if (normalized.keywordTriggerEnabled === normalizedEnabled) return;

    animationMappings[trigger] = {
      file: normalized.file || file,
      position: normalized.position || 'bottom-left',
      scale: Number.isFinite(Number(normalized.scale)) ? Number(normalized.scale) : 1,
      keywords,
      keywordTriggerEnabled: normalizedEnabled
    };
    changedCount += 1;
  });

  if (changedCount === 0) {
    updateAnimationKeywordToggleButton();
    return;
  }

  await saveAnimationMappings();
  renderAnimationMappings();
  updateStatus(
    `✓ ${normalizedEnabled ? 'Enabled' : 'Disabled'} keyword triggers for ${changedCount} animation(s).`,
    false
  );
}

const ttsEngineController = window.createTtsEngineController({
  synth,
  ensureAudioContext,
  unlockAudio,
  getReadOptions: () => ({
    readUsernames: Boolean(readUsernamesCheckbox && readUsernamesCheckbox.checked),
    readEmojis: Boolean(readEmojisCheckbox && readEmojisCheckbox.checked),
    readLinks: Boolean(readLinksCheckbox && readLinksCheckbox.checked)
  }),
  getPlatformDefaultVoice: (platform) => {
    if (platform === 'youtube') return voiceSelectYouTube ? voiceSelectYouTube.value : '';
    if (platform === 'tiktok') return voiceSelectTikTok ? voiceSelectTikTok.value : '';
    return '';
  },
  getUserVoice: (author, platform) => voicesController.getVoiceForUser(author, platform),
  isMutedVoiceId: (voiceId) => voiceId === MUTE_VOICE_ID,
  resolveSystemVoice: (voiceId) => {
    if (typeof voiceId !== 'string' || !voiceId.startsWith('system-')) return null;
    const voiceIndex = parseInt(voiceId.replace('system-', ''), 10);
    if (!Number.isFinite(voiceIndex)) return null;
    return voices[voiceIndex] || null;
  },
  getSpeechSettings: () => ({
    rate: parseFloat(rateSelect.value),
    pitch: parseFloat(pitchSelect.value),
    volume: volumeSlider.value / 100
  }),
  addChatMessage: (...args) => addChatMessage(...args),
  fetchFn: (...args) => fetch(...args),
  getCloneTtsUrl: () => '/api/voice-clone/tts',
  getCloneVoiceLanguage: (voiceName) => voicesController.getCustomVoiceLanguage(voiceName),
  watchdogMs: 30000
});

if (typeof ttsEngineController.stopAllSpeech === 'function') {
  ttsEngineController.stopAllSpeech();
  window.addEventListener('beforeunload', () => {
    ttsEngineController.stopAllSpeech();
  });
}

const layoutResizeController = window.createLayoutResizeController({
  windowRef: window,
  documentRef: document,
  settingsStore,
  elements: {
    chatLayout,
    chatOnlineSplitter,
    onlineUsersPanel,
    onlineUsersGrid,
    onlineUsersSplitter
  },
  keys: {
    chatWidthKey: CHAT_LAYOUT_WIDTH_KEY,
    onlineUsersTopHeightKey: ONLINE_USERS_TOP_HEIGHT_KEY
  },
  limits: {
    chatMinWidth: CHAT_LAYOUT_MIN_WIDTH,
    chatMaxWidth: CHAT_LAYOUT_MAX_WIDTH,
    onlineUsersTopMinHeight: ONLINE_USERS_TOP_MIN_HEIGHT
  }
});

function getChatOnlinePanelBounds() {
  return layoutResizeController.getChatOnlinePanelBounds();
}

function setChatOnlinePanelWidth(widthPx, { persist = true } = {}) {
  layoutResizeController.setChatOnlinePanelWidth(widthPx, { persist });
}

function initChatOnlinePanelResize() {
  layoutResizeController.initChatOnlinePanelResize();
}

function getOnlineUsersTopPaneBounds() {
  return layoutResizeController.getOnlineUsersTopPaneBounds();
}

function setOnlineUsersTopPaneHeight(heightPx, { persist = true } = {}) {
  layoutResizeController.setOnlineUsersTopPaneHeight(heightPx, { persist });
}

function initOnlineUsersPlatformResize() {
  layoutResizeController.initOnlineUsersPlatformResize();
}

layoutResizeController.init();

const ONLINE_USER_TTL_BY_PLATFORM_MS = {
  youtube: 120000,
  tiktok: 45000
};

function handlePresenceLifecycleAlert(eventType, payload = {}) {
  const normalizedEventType = String(eventType || '').trim().toLowerCase();
  if (normalizedEventType !== 'join' && normalizedEventType !== 'leave') return;

  const username = String(payload.username || '').trim();
  const platform = String(payload.platform || '').trim().toLowerCase();
  if (!username || !platform) return;
  soundAlertsController?.handleLifecycleEvent({
    type: normalizedEventType,
    platform,
    username,
    displayName: payload.displayName || '',
    avatar: payload.avatar || null
  });
}

const presenceController = window.createPresenceController({
  elements: {
    onlineYouTubeUsersEl,
    onlineYouTubeCountEl,
    onlineTikTokUsersEl,
    onlineTikTokCountEl
  },
  ttlMsByPlatform: ONLINE_USER_TTL_BY_PLATFORM_MS,
  initialTikTokTtlMs: ONLINE_USER_TTL_BY_PLATFORM_MS.tiktok,
  resolveDisplayName: ({ username, platform, displayName = '' }) => {
    const resolved = normalizeUserDisplayName(
      displayName || getUserDisplayName(username, platform),
      username
    );
    rememberUserDisplayName(username, platform, resolved);
    return resolved;
  },
  onUserJoined: (payload) => handlePresenceLifecycleAlert('join', payload),
  onUserLeft: (payload) => handlePresenceLifecycleAlert('leave', payload)
});
const onlineUsers = presenceController.onlineUsers;

function setPlatformConnectionIndicator(indicatorEl, platformLabel, { connected = false, activeUsers = 0 } = {}) {
  if (!indicatorEl) return;

  const safeActiveUsers = Number.isFinite(Number(activeUsers)) ? Math.max(0, Number(activeUsers)) : 0;
  const stateClass = !connected
    ? 'is-offline'
    : (safeActiveUsers > 0 ? 'is-online' : 'is-idle');
  const title = !connected
    ? `${platformLabel} disconnected`
    : (safeActiveUsers > 0
      ? `${platformLabel} connected (${safeActiveUsers} active user${safeActiveUsers === 1 ? '' : 's'})`
      : `${platformLabel} connected (no active users yet)`);

  indicatorEl.classList.remove('is-offline', 'is-idle', 'is-online');
  indicatorEl.classList.add(stateClass);
  indicatorEl.title = title;
  indicatorEl.setAttribute('aria-label', title);
}

function updateOnlinePlatformIndicators() {
  setPlatformConnectionIndicator(onlineYouTubeIndicatorEl, 'YouTube', {
    connected: isYouTubeConnected(),
    activeUsers: onlineUsers.youtube.size
  });
  setPlatformConnectionIndicator(onlineTikTokIndicatorEl, 'TikTok', {
    connected: isTikTokConnected(),
    activeUsers: onlineUsers.tiktok.size
  });
}

function renderOnlineUsers() {
  presenceController.render();
  updateOnlinePlatformIndicators();
}

function markUserOnline(username, platform, payload = {}) {
  presenceController.markUserOnline(username, platform, payload);
}

function clearOnlineUsers(platform) {
  soundAlertsController?.clearPresenceState(platform);
  presenceController.clearPlatform(platform);
}

// ─── API Key tag manager ────────────────────────────────────────────
const apiKeyTagsContainer = document.getElementById('apiKeyTags');
const apiKeyTextInput      = document.getElementById('apiKeyInput');
const apiKeyCountLabel     = document.getElementById('apiKeyCount');
const apiKeyManagerController = window.createApiKeyManagerController({
  elements: {
    apiKeyTagsContainer,
    apiKeyTextInput,
    apiKeyCountLabel
  },
  onSave: () => saveSettings(),
  onDuplicate: (key) => {
    const masked = key.slice(0, 12) + '...' + key.slice(-4);
    updateStatus(`Key ${masked} is already in the list`, false, false);
    setTimeout(() => {
      if (!isYouTubeConnected() && !isTikTokConnected()) {
        updateStatus('Ready to connect...', false, false);
      }
    }, 3000);
  },
  getConnectivityState: () => ({
    youtubeConnected: isYouTubeConnected(),
    tiktokConnected: isTikTokConnected()
  })
});
const apiKeys = apiKeyManagerController.state.apiKeys; // source of truth

function renderApiKeyTags() {
  apiKeyManagerController.renderApiKeyTags();
}

function addApiKey(key) {
  apiKeyManagerController.addApiKey(key);
}

function removeApiKey(index) {
  apiKeyManagerController.removeApiKey(index);
}
apiKeyManagerController.attachInputHandlers();

// Simple key rotation - no time-based logic
function getNextApiKey() {
  return apiKeyManagerController.getNextApiKey();
}

// Force rotate to next key (called on quota errors)
function rotateToNextKey() {
  return apiKeyManagerController.rotateToNextKey();
}

// ─── end API key manager ────────────────────────────────────────────

dashboardSettingsController = window.createDashboardSettingsController({
  settingsStore,
  elements: {
    channelUrlInput,
    streamUrlInput,
    tiktokUsernameInput: document.getElementById('tiktokUsername'),
    youtubeStartupBacklogInput,
    youtubeStartupBacklogLabel,
    youtubeStartupBacklogDownBtn,
    youtubeStartupBacklogUpBtn,
    testMessageInput,
    voicePreviewTextInput: document.getElementById('voicePreviewText'),
    volumeSlider,
    volumeValue,
    soundAlertsVolumeSlider,
    soundAlertsVolumeValue
  },
  defaults: {
    defaultApiKeys: ['AIzaSyAWVq4gtDP4rYaWKHH_2TvzBjxfRBr6kBE'],
    defaultChannelUrl: 'https://www.youtube.com/@TESLAbot-CODM',
    defaultStartupBacklog: '0',
    defaultYouTubeStartupBacklog: '0',
    defaultTestMessage: DEFAULT_TEST_MESSAGE,
    defaultVolume: '100',
    defaultSoundAlertsVolume: '100'
  },
  callbacks: {
    setApiKeys: (keys) => apiKeyManagerController.setKeys(keys, { resetIndex: true }),
    getApiKeys: () => apiKeys,
    renderApiKeyTags: () => renderApiKeyTags()
  }
});
dashboardSettingsController.init();

// Load cloned voices from server
async function loadClonedVoices() {
  try {
    const response = await fetch('/api/voice-clone/voices');
    if (response.ok) {
      const data = await response.json();
      voicesController.setClonedVoices(data.voices || []);
      console.log('Loaded cloned voices:', clonedVoices);
    }
  } catch (error) {
    console.error('Error loading cloned voices:', error);
  }
}

// Load available voices into BOTH dropdowns
function loadVoices() {
  voicesController.setSystemVoices(synth.getVoices());
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
  voicesController.loadUserVoices();

  const savedDisplayNames = settingsStore.getItem('user_display_names');
  if (savedDisplayNames) {
    try {
      const parsed = JSON.parse(savedDisplayNames);
      Object.entries(parsed || {}).forEach(([userKey, displayName]) => {
        const normalizedKey = String(userKey || '').trim();
        const normalizedDisplayName = String(displayName || '').trim();
        if (!normalizedKey || !normalizedDisplayName) return;
        userDisplayNames.set(normalizedKey, normalizedDisplayName);
      });
    } catch (e) {
      console.warn('Failed to load cached user display names:', e);
    }
  }
}

// Save user voice mappings
function saveUserVoices() {
  voicesController.saveUserVoices();
  settingsStore.setItem('user_display_names', JSON.stringify(Object.fromEntries(userDisplayNames.entries())));
}

// Get voice for specific user (with platform)
function getVoiceForUser(username, platform) {
  return voicesController.getVoiceForUser(username, platform);
}

// Set voice for specific user (with platform)
function setVoiceForUser(username, platform, voiceId) {
  const displayName = getUserDisplayName(username, platform) || username;

  if (!voiceId) {
    voicesController.removeVoiceForUser(username, platform);
    saveUserVoices();
    addChatMessage('SYSTEM', `Voice for "${displayName}" (@${username}, ${platform}) reset to platform default`, 'SYSTEM', false);
    return;
  }

  voicesController.setVoiceForUser(username, platform, voiceId);
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice for "${displayName}" (@${username}, ${platform}) set to: ${getVoiceName(voiceId)}`, 'SYSTEM', false);
}

// Get voice name from voice ID
function getVoiceName(voiceId) {
  if (voiceId === MUTE_VOICE_ID) return 'Muted 🔇';

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
    voicesController.addRecentUser(userKey, 20);
    settingsStore.setItem('recent_users', JSON.stringify(recentUsers));
  }
}

// Load saved settings
function loadSettings() {
  dashboardSettingsController?.loadSettings();
}

// Save settings
function saveSettings() {
  dashboardSettingsController?.saveSettings();
}

// Filter message text
function filterMessage(text) {
  return ttsEngineController.filterMessage(text);
}

// Generate custom voice audio
async function speakWithCustomVoice(voiceType, text) {
  return ttsEngineController.speakWithCustomVoice(voiceType, text);
}

// Process message queue
function processQueue() {
  ttsEngineController.processQueue();
}

function setupUtteranceHandlers(utterance) {
  ttsEngineController.setupUtteranceHandlers(utterance);
}

chatUiController = window.createChatUiController({
  windowRef: window,
  documentRef: document,
  elements: {
    statusDiv,
    chatFeed
  },
  callbacks: {
    getUserDisplayName: (username, platform) => getUserDisplayName(username, platform),
    rememberUserDisplayName: (username, platform, displayName) => rememberUserDisplayName(username, platform, displayName),
    getUserAvatar: (platform, username) => (window.userAvatars ? window.userAvatars.get(`${platform}:${username}`) : null),
    addRecentUser: (userKey) => addRecentUser(userKey),
    markUserOnline: (username, platform, payload) => markUserOnline(username, platform, payload),
    replayMessage: ({ author, text, platform }) => speakText(author, text, platform, false),
    escapeAttribute
  },
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms)
});

function updateStatus(message, isActive = false, isError = false) {
  chatUiController?.updateStatus(message, isActive, isError);
}

function normalizeOverlayChatText(text, { allowHtml = false, replayText = undefined, extraClass = '' } = {}) {
  let candidate = '';

  if (replayText === null) {
    candidate = '';
  } else if (replayText !== undefined) {
    candidate = String(replayText ?? '');
  } else if (allowHtml) {
    candidate = String(text ?? '').replace(/<[^>]+>/g, ' ');
  } else {
    candidate = String(text ?? '');
  }

  candidate = candidate.replace(/\s+/g, ' ').trim();
  if (!candidate && String(extraClass || '').includes('sticker')) {
    return '[Sticker]';
  }
  return candidate;
}

function broadcastChatMessageToOverlay(author, text, platform, {
  allowHtml = false,
  replayText = undefined,
  extraClass = ''
} = {}) {
  const normalizedPlatform = String(platform || '').toLowerCase();
  if (normalizedPlatform !== 'youtube' && normalizedPlatform !== 'tiktok') return;

  const normalizedAuthor = String(author || '').trim();
  if (!normalizedAuthor) return;

  const normalizedText = normalizeOverlayChatText(text, { allowHtml, replayText, extraClass });
  if (!normalizedText) return;

  const displayName = getUserDisplayName(normalizedAuthor, normalizedPlatform) || normalizedAuthor;
  const avatar = window.userAvatars?.get?.(`${normalizedPlatform}:${normalizedAuthor}`) || null;

  fetch('/api/overlay/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: normalizedPlatform,
      author: normalizedAuthor,
      displayName,
      avatar,
      text: normalizedText,
      timestamp: Date.now()
    })
  }).catch((err) => {
    console.debug('Chat overlay broadcast skipped:', err?.message || err);
  });
}

function addChatMessage(author, text, platform = 'SYSTEM', isSpeaking = false, extraClass = '', allowHtml = false, replayText = undefined) {
  chatUiController?.addChatMessage(author, text, platform, isSpeaking, extraClass, allowHtml, replayText);
  if (author !== 'SYSTEM') {
    broadcastChatMessageToOverlay(author, text, platform, { allowHtml, replayText, extraClass });
  }
}

function escapeHtml(text) {
  return chatUiController?.escapeHtml(text) || String(text ?? '');
}

// Speak text with platform-specific voice
function speakText(author, text, platform, shouldDisplay = true, options = {}) {
  ttsEngineController.speakText(author, text, platform, shouldDisplay, options);
}

function setPlatformSpeechSuppressed(platform, suppressed) {
  ttsEngineController?.setPlatformSpeechSuppressed?.(platform, suppressed);
}

function handleKeywordTriggers(author, text, platform) {
  return keywordTriggersController?.handleMessage({
    author,
    text,
    platform
  });
}

youtubeController = window.createYouTubeController({
  elements: {
    channelUrlInput,
    streamUrlInput,
    findStreamBtn,
    connectYouTubeBtn: document.getElementById('connectYouTubeBtn'),
    disconnectYouTubeBtn: document.getElementById('disconnectYouTubeBtn'),
    apiKeyTextInput
  },
  getNextApiKey,
  rotateToNextKey,
  getApiKeyCount: () => apiKeys.length,
  saveSettings,
  updateStatus,
  addChatMessage,
  clearOnlineUsers,
  requestWakeLock,
  releaseWakeLockIfIdle: () => {
    if (!isTikTokConnected()) {
      releaseWakeLock();
    }
  },
  getUserDisplayName,
  rememberUserProfile,
  onlineUsers,
  renderOnlineUsers,
  autoAssignVoiceIfNeeded,
  speakText,
  setPlatformSpeechSuppressed,
  handleKeywordTriggers,
  getStartupBacklogCount: () => getStartupBacklogCount(),
  youtubeOnlineUserTtlMs: ONLINE_USER_TTL_BY_PLATFORM_MS.youtube,
  onConnectionStateChange: () => updateOnlinePlatformIndicators()
});
youtubeController.attachUiHandlers();

tiktokController = window.createTikTokController({
  elements: {
    tiktokUsernameInput: document.getElementById('tiktokUsername'),
    connectTikTokBtn: document.getElementById('connectTikTokBtn'),
    disconnectTikTokBtn: document.getElementById('disconnectTikTokBtn')
  },
  settingsStore,
  updateStatus,
  addChatMessage,
  clearOnlineUsers,
  requestWakeLock,
  releaseWakeLockIfIdle: () => {
    if (!isYouTubeConnected()) {
      releaseWakeLock();
    }
  },
  getYouTubeConnected: isYouTubeConnected,
  rememberUserProfile,
  getUserDisplayName,
  onlineUsers,
  renderOnlineUsers,
  setPlatformUsers: (platform, usersMap) => presenceController.setPlatformUsers(platform, usersMap),
  setTikTokLiveViewerCount: (value) => presenceController.setTikTokViewerCount(value),
  setTikTokOnlineUserTtlMs: (value) => presenceController.setTikTokTtlMs(value),
  autoAssignVoiceIfNeeded,
  speakText,
  setPlatformSpeechSuppressed,
  handleKeywordTriggers,
  getGiftAction,
  triggerAnimation,
  getEventAnimationTrigger,
  resolveSoundAlert,
  playAlertSound,
  registerKnownGiftName,
  playSpecificSound,
  getStartupBacklogCount: () => getStartupBacklogCount(),
  buildStickerChatListHtml,
  handleStickerAnimation,
  canUserTriggerAnimations,
  escapeHtml,
  onConnectionStateChange: () => updateOnlinePlatformIndicators()
});
tiktokController.attachUiHandlers();

updateOnlinePlatformIndicators();

const voiceUiController = window.createVoiceUiController({
  windowRef: window,
  documentRef: document,
  voicesController,
  voiceGroupOrder: VOICE_GROUP_ORDER,
  voiceGroupLabels: VOICE_GROUP_LABELS,
  defaultTestMessage: DEFAULT_TEST_MESSAGE,
  hiddenVoices,
  enabledLanguages,
  getRecentUsers: () => recentUsers,
  getVoiceForUser: (username, platform) => getVoiceForUser(username, platform),
  setVoiceForUser: (username, platform, voiceId) => setVoiceForUser(username, platform, voiceId),
  removeVoiceForUser: (username, platform) => voicesController.removeVoiceForUser(username, platform),
  saveUserVoices: () => saveUserVoices(),
  getUserDisplayName: (username, platform) => getUserDisplayName(username, platform),
  getVoiceName: (voiceId) => getVoiceName(voiceId),
  buildVoiceGroups: (options) => buildVoiceGroups(options),
  findVoiceEntryById: (voiceId) => findVoiceEntryById(voiceId),
  buildVoiceOptionsMarkup: (selectedVoiceId) => buildVoiceOptionsMarkup(selectedVoiceId),
  getAllVoiceEntries: (options) => getAllVoiceEntries(options),
  clonedVoiceLanguageOptions: CLONED_VOICE_LANGUAGE_OPTIONS,
  getCustomVoiceLanguage: (voiceName) => voicesController.getCustomVoiceLanguage(voiceName),
  setCustomVoiceLanguage: (voiceName, language) => voicesController.setCustomVoiceLanguage(voiceName, language),
  saveCustomVoiceLanguages: () => voicesController.saveCustomVoiceLanguages(),
  loadVoices: () => loadVoices(),
  speakWithCustomVoice: (voiceId, text) => speakWithCustomVoice(voiceId, text),
  unlockAudio: () => unlockAudio(),
  synth,
  resolveSystemVoice: (voiceId) => {
    if (!voiceId || !voiceId.startsWith('system-')) return null;
    const voiceIndex = parseInt(voiceId.replace('system-', ''), 10);
    return voices[voiceIndex] || null;
  },
  getPlatformDefaultVoice: (platform) => {
    if (platform === 'youtube') return voiceSelectYouTube ? voiceSelectYouTube.value : '';
    if (platform === 'tiktok') return voiceSelectTikTok ? voiceSelectTikTok.value : '';
    return '';
  },
  getSpeechSettings: () => ({
    rate: parseFloat(rateSelect.value),
    pitch: parseFloat(pitchSelect.value),
    volume: volumeSlider.value / 100
  }),
  getTestMessage: () => testMessageInput ? testMessageInput.value : '',
  getVoicePreviewText: () => {
    const voicePreviewInput = document.getElementById('voicePreviewText');
    return voicePreviewInput ? voicePreviewInput.value : '';
  },
  setVoicePreviewText: (value) => {
    if (testMessageInput) {
      testMessageInput.value = value;
    }
  },
  persistTestMessage: (value) => settingsStore.setItem('yt_tts_test_message', value),
  escapeAttribute,
  escapeHtml,
  addChatMessage: (...args) => addChatMessage(...args)
});

function parseRecentUserKey(userKey) {
  return voiceUiController.parseRecentUserKey(userKey);
}

function getVoiceGroupsForModal() {
  return voiceUiController.getVoiceGroupsForModal();
}

function getVoiceGroupKeyForVoiceId(voiceId) {
  return voiceUiController.getVoiceGroupKeyForVoiceId(voiceId);
}

function buildVoiceGroupOptionsMarkup(selectedGroupKey = '') {
  return voiceUiController.buildVoiceGroupOptionsMarkup(selectedGroupKey);
}

function buildVoiceOptionsMarkupForGroup(groupKey = '', selectedVoiceId = '') {
  return voiceUiController.buildVoiceOptionsMarkupForGroup(groupKey, selectedVoiceId);
}

function renderManageUserVoicesModal() {
  voiceUiController.renderManageUserVoicesModal();
}

function setVoiceModalHeader(title, subtitle) {
  voiceUiController.setVoiceModalHeader(title, subtitle);
}

function setVoiceModalWideLayout(enabled) {
  voiceUiController.setVoiceModalWideLayout(enabled);
}

animationPermissionsUiController = window.createAnimationPermissionsUiController({
  windowRef: window,
  documentRef: document,
  stateAccessors: {
    getRecentUsers: () => recentUsers,
    getGlobalEnabled: () => globalAnimationTriggerEnabled,
    setGlobalEnabled: (enabled) => {
      globalAnimationTriggerEnabled = Boolean(enabled);
    },
    getPermissionsMap: () => userAnimationPermissions,
    setPermission: (userKey, permission) => {
      userAnimationPermissions[userKey] = permission;
    },
    deletePermission: (userKey) => {
      delete userAnimationPermissions[userKey];
    }
  },
  callbacks: {
    saveAnimationPermissions: () => saveAnimationPermissions(),
    setVoiceModalWideLayout: (enabled) => setVoiceModalWideLayout(enabled),
    setVoiceModalHeader: (title, subtitle) => setVoiceModalHeader(title, subtitle),
    getUserDisplayName: (username, platform) => getUserDisplayName(username, platform),
    escapeAttribute,
    escapeHtml,
    addChatMessage: (...args) => addChatMessage(...args)
  }
});
animationPermissionsUiController.init();

voiceTestControlsController = window.createVoiceTestControlsController({
  windowRef: window,
  synthRef: synth,
  elements: {
    testVoiceYouTubeBtn,
    testVoiceTikTokBtn,
    testMessageInput,
    rateSelect,
    pitchSelect,
    volumeSlider
  },
  callbacks: {
    getSelectedVoiceId: (platform) => (platform === 'youtube' ? (voiceSelectYouTube?.value || '') : (voiceSelectTikTok?.value || '')),
    resolveSystemVoice: (voiceId) => {
      if (!voiceId || !voiceId.startsWith('system-')) return null;
      const voiceIndex = parseInt(voiceId.replace('system-', ''), 10);
      return voices[voiceIndex] || null;
    },
    speakWithCustomVoice: (voiceId, text) => speakWithCustomVoice(voiceId, text),
    unlockAudio: () => unlockAudio(),
    addChatMessage: (...args) => addChatMessage(...args),
    getVoiceName: (voiceId) => getVoiceName(voiceId)
  },
  defaultTestMessage: DEFAULT_TEST_MESSAGE
});
voiceTestControlsController.attachHandlers();

startupOrchestratorController = window.createStartupOrchestratorController({
  callbacks: {
    loadSettings: () => loadSettings(),
    loadUserVoices: () => loadUserVoices(),
    renderOnlineUsers: () => renderOnlineUsers(),
    isTikTokConnected: () => isTikTokConnected(),
    getTikTokController: () => tiktokController,
    getYouTubeController: () => youtubeController
  },
  setIntervalFn: (cb, ms) => setInterval(cb, ms),
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearIntervalFn: (id) => clearInterval(id),
  refreshOnlineUsersMs: 15000,
  refreshAudienceMs: 4000,
  autoConnectDelayMs: 1500
});
startupOrchestratorController.init();

// ─── Sound Alerts (module) ───────────────────────────────────────────

// ─── AI-Powered Gender Detection & Voice Assignment ─────────────────

// UI Elements
const autoGenderDetectionCheckbox = document.getElementById('autoGenderDetection');
const maleVoiceSelect = document.getElementById('maleVoiceSelect');
const femaleVoiceSelect = document.getElementById('femaleVoiceSelect');
ollamaGenderController = window.createOllamaGenderController({
  windowRef: window,
  speechSynthesisRef: speechSynthesis,
  settingsStore,
  voicesController,
  elements: {
    ollamaStatusEl,
    ollamaBaseUrlInput,
    autoGenderDetectionCheckbox,
    maleVoiceSelect,
    femaleVoiceSelect
  },
  callbacks: {
    populateVoiceSelectElement,
    getAllVoiceEntries,
    getVoiceName,
    loadVoices
  },
  fetchFn: (...args) => fetch(...args),
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  setIntervalFn: (cb, ms) => setInterval(cb, ms),
  clearIntervalFn: (id) => clearInterval(id)
});

function loadGenderCache() {
  ollamaGenderController?.loadGenderCache();
}

function saveGenderCache() {
  ollamaGenderController?.saveGenderCache();
}

function setOllamaStatus(online) {
  ollamaGenderController?.setOllamaStatus(online);
}

async function refreshOllamaStatus() {
  return ollamaGenderController?.refreshOllamaStatus();
}

function populateGenderVoiceSelects() {
  ollamaGenderController?.populateGenderVoiceSelects();
}

async function detectGenderWithLLM(username) {
  return ollamaGenderController?.detectGenderWithLLM(username);
}

async function detectGender(username) {
  return ollamaGenderController?.detectGender(username);
}

async function autoAssignVoiceIfNeeded(author, platform) {
  return ollamaGenderController?.autoAssignVoiceIfNeeded(author, platform);
}

function playSpecificSound(soundId) {
  return soundAlertsController?.playSound(soundId);
}

function renderGiftMappings() {
  soundAlertsController?.renderRules();
}




// ─── Gift Sound & Animation Mappings ────────────────────────────────

const giftMappingsController = window.createGiftMappingsController({ settingsStore });
const giftMappings = giftMappingsController.state;
const eventAnimationMappings = {
  follow: '',
  share: '',
  join: '',
  leave: ''
};

function normalizeEventAnimationMappings(raw) {
  const next = (raw && typeof raw === 'object') ? raw : {};
  return {
    follow: String(next.follow || '').trim(),
    share: String(next.share || '').trim(),
    join: String(next.join || '').trim(),
    leave: String(next.leave || '').trim()
  };
}

function loadEventAnimationMappings() {
  const saved = settingsStore.getItem('event_animation_mappings');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    const normalized = normalizeEventAnimationMappings(parsed);
    eventAnimationMappings.follow = normalized.follow;
    eventAnimationMappings.share = normalized.share;
  } catch (err) {
    console.error('Error loading event animation mappings:', err);
  }
}

function saveEventAnimationMappings() {
  settingsStore.setItem('event_animation_mappings', JSON.stringify(eventAnimationMappings));
}

function getEventAnimationTrigger(eventType) {
  const key = String(eventType || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(eventAnimationMappings, key)) return '';
  return String(eventAnimationMappings[key] || '').trim();
}

function setEventAnimationTrigger(eventType, trigger) {
  const key = String(eventType || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(eventAnimationMappings, key)) return;
  eventAnimationMappings[key] = String(trigger || '').trim();
}

function moveEventAnimationReferences(oldTrigger, newTrigger) {
  if (!oldTrigger || !newTrigger || oldTrigger === newTrigger) return;
  Object.keys(eventAnimationMappings).forEach((eventType) => {
    if (eventAnimationMappings[eventType] === oldTrigger) {
      eventAnimationMappings[eventType] = newTrigger;
    }
  });
}

function removeEventAnimationReferences(trigger) {
  if (!trigger) return;
  Object.keys(eventAnimationMappings).forEach((eventType) => {
    if (eventAnimationMappings[eventType] === trigger) {
      eventAnimationMappings[eventType] = '';
    }
  });
}

function resolveAnimationForSoundRule(rule) {
  if (!rule) return '';

  const normalizeRuleGiftName = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const normalizeRuleGiftValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(Math.floor(parsed));
  };

  if (rule.eventType === 'gift_any') {
    const defaultAction = giftMappingsController.getDefaultAnimationAction();
    return toAnimationTriggerList(defaultAction?.value);
  }

  if (rule.eventType === 'gift_name') {
    const target = normalizeRuleGiftName(rule.eventValue);
    if (!target) return [];
    for (const [giftName, action] of Object.entries(giftMappings.byName || {})) {
      if (normalizeRuleGiftName(giftName) !== target) continue;
      const normalized = normalizeGiftAction(action);
      if (normalized.type !== 'animation') return [];
      return toAnimationTriggerList(normalized.value);
    }
    return [];
  }

  if (rule.eventType === 'gift_value') {
    const targetValue = normalizeRuleGiftValue(rule.eventValue);
    if (!targetValue) return [];
    const action = giftMappings.byValue?.[targetValue];
    const normalized = normalizeGiftAction(action);
    if (normalized.type !== 'animation') return [];
    return toAnimationTriggerList(normalized.value);
  }

  if (rule.eventType === 'follow' || rule.eventType === 'share' || rule.eventType === 'join' || rule.eventType === 'leave') {
    const trigger = getEventAnimationTrigger(rule.eventType);
    return trigger ? [trigger] : [];
  }

  return [];
}

function getSoundAlertAnimationTriggerOptions() {
  try {
    return Object.keys(animationMappings || {}).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    // Sound alerts can initialize before animation mappings are declared.
    return [];
  }
}

function assignAnimationToSoundRule(rule, trigger) {
  if (!rule) return { ok: false, message: 'Rule not found' };
  const normalizedTrigger = String(trigger || '').trim();
  if (!normalizedTrigger) return { ok: false, message: 'Select animation first' };

  const normalizeRuleGiftValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(Math.floor(parsed));
  };

  if (rule.eventType === 'gift_any') {
    giftMappingsController.setDefaultAnimationAction({ type: 'animation', value: normalizedTrigger });
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'gift_name') {
    const key = String(rule.eventValue || '').trim();
    if (!key) return { ok: false, message: 'Set gift name first' };
    giftMappings.byName[key] = { type: 'animation', value: normalizedTrigger };
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'gift_value') {
    const key = normalizeRuleGiftValue(rule.eventValue);
    if (!key) return { ok: false, message: 'Set gift diamond value first' };
    giftMappings.byValue[key] = { type: 'animation', value: normalizedTrigger };
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'follow' || rule.eventType === 'share' || rule.eventType === 'join' || rule.eventType === 'leave') {
    setEventAnimationTrigger(rule.eventType, normalizedTrigger);
    saveEventAnimationMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  return { ok: false, message: 'Unsupported event type' };
}

function clearAnimationForSoundRule(rule) {
  if (!rule) return { ok: false, message: 'Rule not found' };

  const normalizeRuleGiftValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(Math.floor(parsed));
  };

  if (rule.eventType === 'gift_any') {
    giftMappingsController.setDefaultAnimationAction({ type: 'animation', value: '' });
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'gift_name') {
    const key = String(rule.eventValue || '').trim();
    if (!key) return { ok: false, message: 'Set gift name first' };
    delete giftMappings.byName[key];
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'gift_value') {
    const key = normalizeRuleGiftValue(rule.eventValue);
    if (!key) return { ok: false, message: 'Set gift diamond value first' };
    delete giftMappings.byValue[key];
    saveGiftMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  if (rule.eventType === 'follow' || rule.eventType === 'share' || rule.eventType === 'join' || rule.eventType === 'leave') {
    setEventAnimationTrigger(rule.eventType, '');
    saveEventAnimationMappings();
    renderAnimationMappings();
    return { ok: true };
  }

  return { ok: false, message: 'Unsupported event type' };
}

soundAlertsController = window.createSoundAlertsController({
  windowRef: window,
  documentRef: document,
  settingsStore,
  elements: {
    soundLibraryUploadInput: document.getElementById('soundLibraryUploadInput'),
    soundLibraryUploadBtn: document.getElementById('soundLibraryUploadBtn'),
    soundLibraryGenerateBtn: document.getElementById('soundLibraryGenerateBtn'),
    soundLibraryKeywordToggleBtn: document.getElementById('soundLibraryKeywordToggleBtn'),
    soundLibraryCards: document.getElementById('soundLibraryCards'),
    addSoundAlertRuleBtn: document.getElementById('addSoundAlertRuleBtn'),
    refreshTikTokGiftsBtn: document.getElementById('refreshTikTokGiftsBtn'),
    soundAlertRulesBody: document.getElementById('soundAlertRulesBody'),
    soundAlertGiftNamesDatalist: document.getElementById('soundAlertGiftNamesDatalist')
  },
  callbacks: {
    updateStatus: (...args) => updateStatus(...args),
    getVolume: () => Number(soundAlertsVolumeSlider?.value || 100) / 100,
    resolveAnimationForRule: (rule) => resolveAnimationForSoundRule(rule),
    getAnimationTriggerOptions: () => getSoundAlertAnimationTriggerOptions(),
    assignAnimationForRule: (rule, trigger) => assignAnimationToSoundRule(rule, trigger),
    clearAnimationForRule: (rule) => clearAnimationForSoundRule(rule),
    triggerAnimation: (trigger, platform, username, type) => triggerAnimation(trigger, platform, username, type),
    canTriggerAnimation: (username, platform) => canUserTriggerAnimations(username, platform),
    fetchKnownGiftNames: async () => {
      try {
        const response = await fetch('/api/tiktok/gifts');
        if (!response.ok) return [];
        const data = await response.json();
        const gifts = Array.isArray(data?.gifts) ? data.gifts : [];
        return gifts
          .map((gift) => String(gift?.name || '').trim())
          .filter(Boolean);
      } catch (err) {
        console.warn('Failed to fetch known TikTok gifts:', err);
        return [];
      }
    }
  },
  fetchFn: (...args) => fetch(...args),
  confirmFn: (message) => window.confirm(message),
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: (id) => clearTimeout(id),
  nowFn: () => Date.now()
});
soundAlertsController.init();

keywordTriggersController = window.createKeywordTriggersController({
  windowRef: window,
  callbacks: {
    getAnimationMappings: () => animationMappings,
    getSoundKeywordEntries: () => soundAlertsController?.getSoundKeywordEntries?.() || [],
    canTriggerAnimation: (username, platform) => canUserTriggerAnimations(username, platform),
    triggerAnimation: (trigger, platform, author, type) => triggerAnimation(trigger, platform, author, type),
    playSound: (soundPath) => playAlertSound(soundPath)
  }
});

function toAnimationTriggerList(value) {
  return giftMappingsController.toAnimationTriggerList(value);
}

function normalizeGiftAction(action) {
  return giftMappingsController.normalizeGiftAction(action);
}

function loadGiftMappings() {
  giftMappingsController.load();
  loadEventAnimationMappings();
  renderGiftMappings();
}

function saveGiftMappings() {
  giftMappingsController.save();
}

function getGiftAction(giftName, diamondCount) {
  return giftMappingsController.getGiftAction(giftName, diamondCount);
}

function resolveSoundAlert(event) {
  return soundAlertsController?.resolveSoundForEvent(event) || '';
}

function playAlertSound(soundPath) {
  return soundAlertsController?.playSound(soundPath);
}

function registerKnownGiftName(giftName) {
  soundAlertsController?.registerGiftName(giftName);
}

// Initialize
loadGiftMappings();

// Render UI after a short delay to ensure DOM is ready
setTimeout(() => {
  renderGiftMappings();
}, 100);

// ─── TikTok Sticker to Animation Mappings ───────────────────────────

const stickerMappingsController = window.createStickerMappingsController({
  settingsStore,
  escapeAttribute,
  escapeHtml,
  addChatMessage,
  triggerAnimation
});
const stickerMappings = stickerMappingsController.state;

function normalizeStickerMappingEntry(key, data) {
  return stickerMappingsController.normalizeStickerMappingEntry(key, data);
}

function getStickerEntries() {
  return stickerMappingsController.getEntries();
}

function loadStickerMappings() {
  stickerMappingsController.load();
}

function saveStickerMappings() {
  stickerMappingsController.save();
}

function getAvailableStickerOptions() {
  return stickerMappingsController.getAvailableStickerOptions();
}

function getStickerTriggerForKey(stickerKey) {
  return stickerMappingsController.getStickerTriggerForKey(stickerKey);
}

function findStickerKeyForAnimationTrigger(trigger) {
  return stickerMappingsController.findStickerKeyForAnimationTrigger(trigger);
}

function findFirstStickerNameForAnimationTrigger(trigger) {
  const entry = findFirstStickerEntryForAnimationTrigger(trigger);
  return entry ? (entry.name || entry.key) : '';
}

function hasStickerForAnimationTrigger(trigger) {
  return stickerMappingsController.hasStickerForAnimationTrigger(trigger);
}

function findFirstStickerEntryForAnimationTrigger(trigger) {
  return stickerMappingsController.findFirstStickerEntryForAnimationTrigger(trigger);
}

function moveStickerAnimationReferences(oldTrigger, newTrigger) {
  stickerMappingsController.moveStickerAnimationReferences(oldTrigger, newTrigger);
}

function removeStickerAnimationReferences(trigger) {
  stickerMappingsController.removeStickerAnimationReferences(trigger);
}

function assignStickerToTrigger(stickerKey, trigger) {
  stickerMappingsController.assignStickerToTrigger(stickerKey, trigger);
}

function setStickerForAnimationTrigger(trigger, stickerKey) {
  stickerMappingsController.setStickerForAnimationTrigger(trigger, stickerKey);
}

let animationPopupStickersController = null;

function renderAnimationPopupStickerPicker(selectedKey = '') {
  animationPopupStickersController?.renderAnimationPopupStickerPicker(selectedKey);
}

function populateAnimationPopupStickerOptions(selectedKey = '') {
  animationPopupStickersController?.populateAnimationPopupStickerOptions(selectedKey);
}

function handleStickerAnimation(msg) {
  return stickerMappingsController.handleStickerAnimation(msg);
}

function ensureStickerEntry(stickerKey, payload = {}) {
  return stickerMappingsController.ensureStickerEntry(stickerKey, payload);
}

function buildStickerChatItemHtml(emote, fallbackName = '') {
  return stickerMappingsController.buildStickerChatItemHtml(emote, fallbackName);
}

function buildStickerChatListHtml(emotes = []) {
  return stickerMappingsController.buildStickerChatListHtml(emotes);
}

const stickerUiController = window.createStickerUiController({
  windowRef: window,
  documentRef: document,
  elements: {
    chatFeed,
    stickerAssignModal,
    stickerAssignPreviewImage,
    stickerAssignName,
    stickerAssignCurrent,
    stickerAssignAnimationSelect,
    stickerAssignSaveBtn,
    stickerAssignCancelBtn
  },
  state: {
    stickerMappings
  },
  helpers: {
    normalizeStickerMappingEntry
  },
  callbacks: {
    getAnimationTriggers: () => Object.keys(animationMappings || {}).sort((a, b) => a.localeCompare(b)),
    getStickerTriggerForKey,
    ensureStickerEntry,
    assignStickerToTrigger,
    saveStickerMappings,
    renderAnimationMappings,
    getActiveAnimationPopup,
    findStickerKeyForAnimationTrigger,
    populateAnimationPopupStickerOptions
  }
});

function buildStickerAssignAnimationOptions(selectedTrigger = '') {
  stickerUiController.buildStickerAssignAnimationOptions(selectedTrigger);
}

function refreshChatStickerUiForKey(stickerKey) {
  stickerUiController.refreshChatStickerUiForKey(stickerKey);
}

window.closeStickerAssignModal = function closeStickerAssignModal() {
  stickerUiController.closeStickerAssignModal();
};

window.openStickerAssignFromChat = function openStickerAssignFromChat(stickerKey, stickerImage = '', stickerName = '') {
  stickerUiController.openStickerAssignFromChat(stickerKey, stickerImage, stickerName);
};
stickerUiController.init();

// ─── Gift Thank You System with Batching ────────────────────────────

const giftBatchController = window.createGiftBatchController({
  setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn: (timer) => clearTimeout(timer),
  addChatMessage,
  speakText,
  batchWindowMs: 3000
});

function addGiftToBatch(giftName, authorName) {
  giftBatchController.addGiftToBatch(giftName, authorName);
}

function announceGiftBatch() {
  giftBatchController.announceGiftBatch();
}

// ─── Animation Overlay Settings ─────────────────────────────────────

const animationMappingsController = window.createAnimationMappingsController({ settingsStore });
const animationMappings = animationMappingsController.state.animationMappings;
const availableAnimations = animationMappingsController.state.availableAnimations;
const animationVolumeSlider = document.getElementById('animationVolumeSlider');
const animationVolumeValue = document.getElementById('animationVolumeValue');
const animationMappingsList = document.getElementById('animationMappingsList');
const animationSortSelect = document.getElementById('animationSortSelect');
const animationMapFilterSelect = document.getElementById('animationMapFilterSelect');
const animationStickerFilterSelect = document.getElementById('animationStickerFilterSelect');
const animationSortChipButtons = Array.from(document.querySelectorAll('#animationSortChips .animation-sort-chip'));
const animationMapFilterBtn = document.getElementById('animationMapFilterBtn');
const animationStickerFilterBtn = document.getElementById('animationStickerFilterBtn');
const uploadAnimationBtn = document.getElementById('uploadAnimationBtn');
const generateAnimationKeywordsBtn = document.getElementById('generateAnimationKeywordsBtn');
const animationKeywordToggleBtn = document.getElementById('animationKeywordToggleBtn');
const uploadAnimationInput = document.getElementById('uploadAnimationInput');
const resetAnimationsBtn = document.getElementById('resetAnimationsBtn');
const stopAnimationBtn = document.getElementById('stopAnimationBtn');
const animationResetPopup = document.getElementById('animationResetPopup');
const animationResetSorting = document.getElementById('animationResetSorting');
const animationResetNames = document.getElementById('animationResetNames');
const animationResetScale = document.getElementById('animationResetScale');
const animationResetPosition = document.getElementById('animationResetPosition');
const animationResetGifts = document.getElementById('animationResetGifts');
const animationResetStickers = document.getElementById('animationResetStickers');
const animationResetEvents = document.getElementById('animationResetEvents');
const animationResetConfirmBtn = document.getElementById('animationResetConfirmBtn');
const animationResetCancelBtn = document.getElementById('animationResetCancelBtn');
const animationPlaybackController = window.createAnimationPlaybackController({
  documentRef: document,
  fetchFn: (...args) => fetch(...args),
  getAnimationFileUrl: (filename) => getAnimationFileUrl(filename),
  getAnimationMappingByTrigger: (trigger) => animationMappings[trigger],
  getAnimationFileFromMapping: (data) => getAnimationFileFromMapping(data),
  isThumbnailInteractionActive: (button) => isThumbnailInteractionActive(button),
  playAnimationThumbnail: (video) => playAnimationThumbnail(video),
  stopAnimationThumbnail: (video) => stopAnimationThumbnail(video),
  stopButton: stopAnimationBtn,
  fallbackSeconds: 4,
  tickMs: 120
});
const activeAnimationCardPlayback = animationPlaybackController.state.activePlayback; // trigger -> playback state
loadAnimationKeywordJob();
updateAnimationKeywordGenerateButton();
updateAnimationKeywordToggleButton();
const animationUiController = window.createAnimationUiController({
  windowRef: window,
  documentRef: document,
  IntersectionObserverRef: window.IntersectionObserver,
  promptFn: (...args) => prompt(...args),
  alertFn: (...args) => alert(...args),
  fetchFn: (...args) => fetch(...args),
  settingsStore,
  elements: {
    animationMappingsList,
    animationSortSelect,
    animationMapFilterSelect,
    animationStickerFilterSelect,
    animationSortChipButtons,
    animationMapFilterBtn,
    animationStickerFilterBtn,
    uploadAnimationBtn,
    generateAnimationKeywordsBtn,
    uploadAnimationInput,
    resetAnimationsBtn,
    stopAnimationBtn,
    animationResetPopup,
    animationResetSorting,
    animationResetNames,
    animationResetScale,
    animationResetPosition,
    animationResetGifts,
    animationResetStickers,
    animationResetEvents,
    animationResetConfirmBtn,
    animationResetCancelBtn
  },
  state: {
    animationMappings,
    availableAnimations,
    activeAnimationCardPlayback
  },
  helpers: {
    escapeAttribute,
    getAnimationFileUrl,
    getAnimationFileFromMapping,
    normalizeTriggerFromFilename,
    findAnimationMappingEntryByFile,
    findGiftNamesForAnimationTrigger,
    findGiftValuesForAnimationTrigger,
    hasStickerForAnimationTrigger,
    renderAnimationVisibilityBadges,
    isDefaultGiftAnimationTrigger,
    formatAnimationPlaybackCountdown
  },
  callbacks: {
    bindAnimationThumbnailDurationListener,
    updateStopAnimationButtonState,
    updateAnimationPlaybackUi,
    triggerAnimation,
    openAnimationCardPopup,
    loadAvailableAnimations,
    generateMissingAnimationKeywords,
    applyAnimationReset,
    stopAllActiveAnimations
  }
});

function getAnimationVolumePercent() {
  if (!animationSettingsController) {
    if (!animationVolumeSlider) return 100;
    const value = parseInt(animationVolumeSlider.value, 10);
    return Number.isFinite(value) ? value : 100;
  }
  return animationSettingsController.getAnimationVolumePercent();
}

function updateAnimationVolumeLabel() {
  if (!animationSettingsController) {
    if (!animationVolumeSlider || !animationVolumeValue) return;
    animationVolumeValue.textContent = `${animationVolumeSlider.value}%`;
    return;
  }
  animationSettingsController.updateAnimationVolumeLabel();
}

function normalizeTriggerFromFilename(filename) {
  return animationMappingsController.normalizeTriggerFromFilename(filename);
}

function createDefaultAnimationMapping(filename) {
  return animationMappingsController.createDefaultAnimationMapping(filename);
}

function toAnimationMappingObject(data, fallbackFilename = '') {
  return animationMappingsController.toAnimationMappingObject(data, fallbackFilename);
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
  animationPlaybackController.cacheAnimationDuration(filename, durationSeconds);
}

function cacheAnimationDurationFromVideo(video) {
  animationPlaybackController.cacheAnimationDurationFromVideo(video);
}

function bindAnimationThumbnailDurationListener(video) {
  animationPlaybackController.bindAnimationThumbnailDurationListener(video);
}

function probeAnimationDurationSeconds(filename) {
  return animationPlaybackController.probeAnimationDurationSeconds(filename);
}

function getAnimationDurationSeconds(filename) {
  return animationPlaybackController.getAnimationDurationSeconds(filename);
}

function formatAnimationPlaybackCountdown(remainingMs) {
  return animationPlaybackController.formatAnimationPlaybackCountdown(remainingMs);
}

function setAnimationCardPlaybackState(trigger, filename, durationSeconds, startedAtMs = Date.now()) {
  animationPlaybackController.setAnimationCardPlaybackState(trigger, filename, durationSeconds, startedAtMs);
}

function updateStopAnimationButtonState() {
  animationPlaybackController.updateStopAnimationButtonState();
}

function markAnimationCardPlaying(trigger) {
  return animationPlaybackController.markAnimationCardPlaying(trigger);
}

function clearAnimationCardPlaybackIfMatches(trigger, startedAtMs) {
  animationPlaybackController.clearAnimationCardPlaybackIfMatches(trigger, startedAtMs);
}

async function stopAllActiveAnimations() {
  return animationPlaybackController.stopAllActiveAnimations();
}

function updateAnimationPlaybackUi() {
  animationPlaybackController.updateAnimationPlaybackUi();
}

function getAnimationFileFromMapping(data) {
  return animationMappingsController.getAnimationFileFromMapping(data);
}

function findAnimationMappingEntryByFile(filename, source = animationMappings) {
  return animationMappingsController.findAnimationMappingEntryByFile(filename, source);
}

function buildUniqueAnimationTrigger(base, source = animationMappings, ignoreTrigger = '') {
  return animationMappingsController.buildUniqueAnimationTrigger(base, source, ignoreTrigger);
}

function isGiftAnimationMapping(entry, trigger) {
  if (!entry || entry.type !== 'animation') return false;
  const values = toAnimationTriggerList(entry.value);
  return values.includes(trigger);
}

function isDefaultGiftAnimationTrigger(trigger) {
  return giftMappingsController.isDefaultAnimationTrigger(trigger);
}

function addDefaultGiftAnimationReference(trigger) {
  giftMappingsController.addDefaultAnimationTrigger(trigger);
}

function removeDefaultGiftAnimationReference(trigger) {
  giftMappingsController.removeDefaultAnimationTrigger(trigger);
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
  const stickerEntry = findFirstStickerEntryForAnimationTrigger(trigger);
  const stickerName = stickerEntry ? (stickerEntry.name || stickerEntry.key) : '';
  const isDefaultGiftAnimation = isDefaultGiftAnimationTrigger(trigger);
  const isFollowAnimation = getEventAnimationTrigger('follow') === trigger;
  const isShareAnimation = getEventAnimationTrigger('share') === trigger;
  const isJoinAnimation = getEventAnimationTrigger('join') === trigger;
  const isLeaveAnimation = getEventAnimationTrigger('leave') === trigger;
  const badges = [];
  let stickerCorner = '';

  if (stickerName) {
    const thumb = stickerEntry?.image
      ? `<img src="${escapeAttribute(stickerEntry.image)}" alt="" class="animation-sticker-badge-thumb">`
      : '<span class="animation-sticker-badge-thumb animation-sticker-badge-fallback">🎭</span>';
    stickerCorner = `<span class="animation-card-sticker-corner" title="Sticker mapping: ${escapeAttribute(stickerName)}">${thumb}</span>`;
  }

  if (giftNames.length > 0) {
    const extraCount = giftNames.length - 1;
    const label = `🎁 ${trimBadgeLabel(giftNames[0])}${extraCount > 0 ? ` +${extraCount}` : ''}`;
    badges.push(`<span class="animation-visibility-badge gift-name" title="Gift name mappings: ${escapeAttribute(giftNames.join(', '))}">${escapeAttribute(label)}</span>`);
  }

  if (giftValues.length > 0) {
    const extraCount = giftValues.length - 1;
    const label = `💎 ${giftValues[0]}${extraCount > 0 ? ` +${extraCount}` : ''}`;
    badges.push(`<span class="animation-visibility-badge gift-value" title="Diamond value mappings: ${escapeAttribute(giftValues.join(', '))}">${escapeAttribute(label)}</span>`);
  }

  if (isDefaultGiftAnimation) {
    badges.push('<span class="animation-visibility-badge default-gift" title="Included in default gift animation rotation (fallback when no name/value match)">Default</span>');
  }

  if (isFollowAnimation) {
    badges.push('<span class="animation-visibility-badge gift-name" title="Triggered when a new follower/subscriber event arrives">👤 Follow</span>');
  }

  if (isShareAnimation) {
    badges.push('<span class="animation-visibility-badge gift-value" title="Triggered when someone shares the stream">📤 Share</span>');
  }

  if (isJoinAnimation) {
    badges.push('<span class="animation-visibility-badge gift-name" title="Triggered when a viewer joins the stream">🟢 Join</span>');
  }

  if (isLeaveAnimation) {
    badges.push('<span class="animation-visibility-badge default-gift" title="Triggered when a viewer leaves the stream">🔴 Leave</span>');
  }

  if (badges.length === 0 && !stickerName) {
    badges.push('<span class="animation-visibility-badge unmapped" title="No gift or sticker mapping configured">Unmapped</span>');
  }

  return `<div class="animation-card-badges">${badges.join('')}</div>${stickerCorner}`;
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

  if (isDefaultGiftAnimationTrigger(oldTrigger)) {
    removeDefaultGiftAnimationReference(oldTrigger);
    addDefaultGiftAnimationReference(newTrigger);
  }
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

  removeDefaultGiftAnimationReference(trigger);
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
  const {
    changed,
    created,
    removed,
    deduped,
    triggerRenames,
    removedTriggers
  } = animationMappingsController.syncFromFiles();

  if (changed) {
    triggerRenames.forEach(([fromTrigger, toTrigger]) => {
      moveGiftAnimationReferences(fromTrigger, toTrigger);
      moveEventAnimationReferences(fromTrigger, toTrigger);
      moveStickerAnimationReferences(fromTrigger, toTrigger);
    });
    removedTriggers.forEach((trigger) => {
      removeGiftAnimationReferences(trigger);
      removeEventAnimationReferences(trigger);
      removeStickerAnimationReferences(trigger);
    });

    await saveAnimationMappings();
    saveGiftMappings();
    saveEventAnimationMappings();
    saveStickerMappings();
    renderGiftMappings();
  }

  if (showAlert) {
    alert(`Sync complete.\nAdded: ${created}\nRemoved stale mappings: ${removed}\nDeduplicated: ${deduped}`);
  }

  return { changed, created, removed, deduped };
}

function clearGiftAnimationAssignments() {
  Object.entries(giftMappings.byName || {}).forEach(([giftName, entry]) => {
    if (normalizeGiftAction(entry).type !== 'animation') return;
    delete giftMappings.byName[giftName];
  });
  Object.entries(giftMappings.byValue || {}).forEach(([diamondValue, entry]) => {
    if (normalizeGiftAction(entry).type !== 'animation') return;
    delete giftMappings.byValue[diamondValue];
  });
  giftMappingsController.setDefaultAnimationAction({ type: 'animation', value: '' });
}

function clearStickerAnimationAssignments() {
  Object.entries(stickerMappings || {}).forEach(([stickerKey, data]) => {
    const normalized = normalizeStickerMappingEntry(stickerKey, data);
    if (!normalized.trigger) return;
    normalized.trigger = '';
    stickerMappings[stickerKey] = normalized;
  });
}

function clearEventAnimationAssignments() {
  Object.keys(eventAnimationMappings).forEach((eventType) => {
    eventAnimationMappings[eventType] = '';
  });
}

function resetAnimationMappingNamesByFilename() {
  const nextMappings = {};
  const triggerRenames = [];

  Object.entries(animationMappings).forEach(([trigger, rawData]) => {
    const file = getAnimationFileFromMapping(rawData);
    const normalized = animationMappingsController.toAnimationMappingObject(rawData, file);
    const baseTrigger = normalizeTriggerFromFilename(file || trigger) || 'animation';
    const uniqueTrigger = buildUniqueAnimationTrigger(baseTrigger, nextMappings);
    if (uniqueTrigger !== trigger) {
      triggerRenames.push([trigger, uniqueTrigger]);
    }
    nextMappings[uniqueTrigger] = {
      file: normalized.file || file,
      position: normalized.position || 'bottom-left',
      scale: Number.isFinite(Number(normalized.scale)) ? Number(normalized.scale) : 1,
      keywords: Array.isArray(normalized.keywords) ? normalized.keywords : [],
      keywordTriggerEnabled: normalized.keywordTriggerEnabled === true
    };
  });

  Object.keys(animationMappings).forEach((key) => delete animationMappings[key]);
  Object.entries(nextMappings).forEach(([key, value]) => {
    animationMappings[key] = value;
  });

  triggerRenames.forEach(([fromTrigger, toTrigger]) => {
    moveGiftAnimationReferences(fromTrigger, toTrigger);
    moveEventAnimationReferences(fromTrigger, toTrigger);
    moveStickerAnimationReferences(fromTrigger, toTrigger);
  });
}

function resetAnimationScaleForAll() {
  Object.entries(animationMappings).forEach(([trigger, rawData]) => {
    const file = getAnimationFileFromMapping(rawData);
    const normalized = animationMappingsController.toAnimationMappingObject(rawData, file);
    animationMappings[trigger] = {
      file: normalized.file || file,
      position: normalized.position || 'bottom-left',
      scale: 1,
      keywords: Array.isArray(normalized.keywords) ? normalized.keywords : [],
      keywordTriggerEnabled: normalized.keywordTriggerEnabled === true
    };
  });
}

function resetAnimationPositionForAll() {
  Object.entries(animationMappings).forEach(([trigger, rawData]) => {
    const file = getAnimationFileFromMapping(rawData);
    const normalized = animationMappingsController.toAnimationMappingObject(rawData, file);
    animationMappings[trigger] = {
      file: normalized.file || file,
      position: 'bottom-left',
      scale: Number.isFinite(Number(normalized.scale)) ? Number(normalized.scale) : 1,
      keywords: Array.isArray(normalized.keywords) ? normalized.keywords : [],
      keywordTriggerEnabled: normalized.keywordTriggerEnabled === true
    };
  });
}

async function applyAnimationReset({
  sorting = false,
  names = false,
  scale = false,
  position = false,
  gifts = false,
  stickers = false,
  events = false
} = {}) {
  const shouldResetMappings = Boolean(names || scale || position);
  const shouldResetRefs = Boolean(gifts || stickers || events || names);
  let renamedMappings = false;

  if (shouldResetMappings) {
    if (names) {
      resetAnimationMappingNamesByFilename();
      renamedMappings = true;
    }
    if (scale) resetAnimationScaleForAll();
    if (position) resetAnimationPositionForAll();
    settingsStore.removeItem('animation_custom_order');
    await saveAnimationMappings();
  }

  if (gifts) {
    clearGiftAnimationAssignments();
    saveGiftMappings();
  }

  if (stickers) {
    clearStickerAnimationAssignments();
    saveStickerMappings();
  }

  if (events) {
    clearEventAnimationAssignments();
    saveEventAnimationMappings();
  }

  if (renamedMappings) {
    if (!gifts) saveGiftMappings();
    if (!stickers) saveStickerMappings();
    if (!events) saveEventAnimationMappings();
  }

  if (sorting) {
    settingsStore.removeItem('animation_sort_mode');
    settingsStore.removeItem('animation_sort_direction');
    settingsStore.removeItem('animation_map_filter');
    settingsStore.removeItem('animation_sticker_filter');
    settingsStore.removeItem('animation_custom_order');
    if (animationUiController && typeof animationUiController.resetAnimationListControlsToDefaults === 'function') {
      animationUiController.resetAnimationListControlsToDefaults({ rerender: false });
    }
  }

  if (shouldResetRefs) {
    renderGiftMappings();
  }

  renderAnimationMappings();
}

// Load animation mappings from settingsStore
function loadAnimationMappings() {
  animationMappingsController.loadMappings();
  console.log('✓ Loaded animation mappings:', Object.keys(animationMappings).length);
  renderAnimationMappings();
}

// Save animation mappings to server AND settingsStore
async function saveAnimationMappings() {
  // Save to settingsStore (backup)
  animationMappingsController.saveMappings();
  
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
    await animationMappingsController.loadAvailableAnimations();
    console.log(`✓ Loaded ${availableAnimations.length} animation files`);
    renderAnimationMappings();
    syncAnimationMappingsFromFiles()
      .then(({ changed }) => {
        if (changed) renderAnimationMappings();
      })
      .catch(err => {
        console.error('Animation sync error:', err);
      });
    updateAnimationKeywordGenerateButton();
    void generateMissingAnimationKeywords({ resumeOnly: true });
  } catch (e) {
    console.error('Error loading animations:', e);
    availableAnimations.splice(0, availableAnimations.length);
    renderAnimationMappings();
    updateAnimationKeywordGenerateButton();
  }
}

async function generateMissingAnimationKeywords({ resumeOnly = false } = {}) {
  if (animationKeywordGenerationPromise) return animationKeywordGenerationPromise;
  await syncAnimationMappingsFromFiles();

  const missingItems = animationKeywordJob && animationKeywordJob.pendingItems.length > 0
    ? animationKeywordJob.pendingItems
    : (resumeOnly
      ? []
      : availableAnimations
        .map((anim) => {
          const mappingEntry = findAnimationMappingEntryByFile(anim.filename);
          const mapping = mappingEntry?.data || animationMappingsController.toAnimationMappingObject(null, anim.filename);
          const keywords = Array.isArray(mapping.keywords) ? mapping.keywords : [];
          if (keywords.length > 0) return null;
          return {
            kind: 'animation',
            filename: anim.filename
          };
        })
        .filter(Boolean));

  if (missingItems.length === 0) {
    if (!resumeOnly) {
      updateStatus('No animations need keyword suggestions.', false);
    }
    updateAnimationKeywordGenerateButton();
    return;
  }

  animationKeywordJob = normalizeAnimationKeywordJob(
    animationKeywordJob && animationKeywordJob.pendingItems.length > 0
      ? animationKeywordJob
      : { pendingItems: missingItems, total: missingItems.length }
  );
  saveAnimationKeywordJob();
  updateAnimationKeywordGenerateButton();

  const runner = (async () => {
    let updatedCount = 0;
    let warningCount = 0;

    updateStatus(`Generating keyword suggestions for ${animationKeywordJob.total} animation file(s)...`, false);
    const batchSize = 25;
    while (animationKeywordJob && animationKeywordJob.pendingItems.length > 0) {
      updateAnimationKeywordGenerateButton();
      const chunk = animationKeywordJob.pendingItems.slice(0, batchSize);
      const response = await fetch('/api/media-keywords/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: chunk })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Keyword generation failed');
      }
      (Array.isArray(data.results) ? data.results : []).forEach((entry) => {
        const filename = String(entry?.filename || '').trim();
        if (!filename) return;
        const mappingEntry = findAnimationMappingEntryByFile(filename);
        if (!mappingEntry) return;
        const current = animationMappingsController.toAnimationMappingObject(mappingEntry.data, filename);
        const keywords = keywordTriggersController?.parseKeywordList
          ? keywordTriggersController.parseKeywordList(entry?.keywords)
          : (Array.isArray(entry?.keywords) ? entry.keywords : []);
        if (keywords.length === 0) {
          if (entry?.warning) warningCount += 1;
          return;
        }
        animationMappings[mappingEntry.trigger] = {
          file: current.file,
          position: current.position,
          scale: current.scale,
          keywords,
          keywordTriggerEnabled: typeof current.keywordTriggerEnabled === 'boolean'
            ? current.keywordTriggerEnabled
            : false
        };
        updatedCount += 1;
        if (entry?.warning) warningCount += 1;
      });

      animationKeywordJob.pendingItems = animationKeywordJob.pendingItems.slice(chunk.length);
      saveAnimationKeywordJob();
      await saveAnimationMappings();
    }

    renderAnimationMappings();
    updateStatus(
      updatedCount > 0
        ? `✓ Suggested keywords for ${updatedCount} animation file(s)${warningCount ? ` (${warningCount} used filename fallback)` : ''}`
        : 'No animation keywords could be suggested.',
      false,
      updatedCount === 0
    );
  })().catch((err) => {
    console.error('Generate animation keywords failed:', err);
    updateStatus(`Keyword generation failed: ${err.message}`, false, true);
  }).finally(() => {
    animationKeywordGenerationPromise = null;
    updateAnimationKeywordGenerateButton();
  });

  animationKeywordGenerationPromise = runner;
  updateAnimationKeywordGenerateButton();
  return runner;
}

function ensureAnimationVideoSource(video) {
  animationUiController.ensureAnimationVideoSource(video);
}

function playAnimationThumbnail(video) {
  animationUiController.playAnimationThumbnail(video);
}

function stopAnimationThumbnail(video) {
  animationUiController.stopAnimationThumbnail(video);
}

function isThumbnailInteractionActive(button) {
  return animationUiController.isThumbnailInteractionActive(button);
}

function wireThumbnailLazyLoading(container) {
  animationUiController.wireThumbnailLazyLoading(container);
}

function wireThumbnailHoverPlayback(container) {
  animationUiController.wireThumbnailHoverPlayback(container);
}

function getFilteredSortedAnimationCards() {
  return animationUiController.getFilteredSortedAnimationCards();
}

// Render animation mappings list
function renderAnimationMappings() {
  animationUiController.renderAnimationMappings();
  updateAnimationKeywordToggleButton();
}

function initAnimationListControls() {
  animationUiController.initAnimationListControls();
}

animationUiController.init();

if (animationKeywordToggleBtn) {
  animationKeywordToggleBtn.addEventListener('click', async () => {
    if (animationKeywordToggleBtn.disabled) return;
    const { allEnabled } = getAnimationKeywordToggleState();
    await setAllAnimationKeywordTriggers(!allEnabled);
  });
}

const animationCardPopup = document.getElementById('animationCardPopup');
const animationPopupName = document.getElementById('animationPopupName');
const animationPopupPositionGrid = document.getElementById('animationPopupPositionGrid');
const animationPopupScale = document.getElementById('animationPopupScale');
const animationPopupGiftName = document.getElementById('animationPopupGiftName');
const animationPopupGiftValue = document.getElementById('animationPopupGiftValue');
const animationPopupKeywords = document.getElementById('animationPopupKeywords');
const animationPopupKeywordEnabled = document.getElementById('animationPopupKeywordEnabled');
const animationPopupSticker = document.getElementById('animationPopupSticker');
const animationPopupStickerPicker = document.getElementById('animationPopupStickerPicker');
const animationPopupMapFollow = document.getElementById('animationPopupMapFollow');
const animationPopupMapShare = document.getElementById('animationPopupMapShare');
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
animationPopupStickersController = window.createAnimationPopupStickersController({
  documentRef: document,
  elements: {
    animationPopupSticker,
    animationPopupStickerPicker
  },
  helpers: {
    escapeAttribute,
    escapeHtml,
    getAvailableStickerOptions,
    getCurrentPopupTrigger: () => getActiveAnimationPopup()?.trigger || ''
  }
});
const animationsEnabledCheckbox = document.getElementById('animationsEnabled');
const greenThresholdSlider = document.getElementById('greenThreshold');
const chromaToleranceSlider = document.getElementById('chromaTolerance');
const greenThresholdValue = document.getElementById('greenThresholdValue');
const chromaToleranceValue = document.getElementById('chromaToleranceValue');
const animationPositionSelect = document.getElementById('animationPosition');
const animationPopupController = window.createAnimationPopupController({
  windowRef: window,
  alertFn: (...args) => alert(...args),
  confirmFn: (...args) => confirm(...args),
  fetchFn: (...args) => fetch(...args),
  elements: {
    animationCardPopup,
    animationPopupName,
    animationPopupPositionGrid,
    animationPopupScale,
    animationPopupGiftName,
    animationPopupGiftValue,
    animationPopupKeywords,
    animationPopupKeywordEnabled,
    animationPopupSticker,
    animationPopupMapFollow,
    animationPopupMapShare,
    animationPopupMakeDefault,
    animationPopupScaleUpBtn,
    animationPopupScaleDownBtn,
    animationPopupSaveBtn,
    animationPopupDeleteBtn,
    animationPopupCancelBtn,
    animationPopupBackdrop,
    openAnimationGeneralSettingsBtn,
    animationGeneralSettingsPopup,
    animationGeneralSettingsCloseBtn,
    animationGeneralSettingsBackdrop
  },
  state: {
    animationMappings,
    giftMappings
  },
  helpers: {
    normalizeTriggerFromFilename,
    buildUniqueAnimationTrigger,
    toAnimationMappingObject,
    findFirstGiftNameForAnimationTrigger,
    findFirstGiftValueForAnimationTrigger,
    findStickerKeyForAnimationTrigger,
    isDefaultGiftAnimationTrigger,
    getEventAnimationTrigger,
    getAnimationFileFromMapping
  },
  callbacks: {
    populateAnimationPopupStickerOptions,
    moveGiftAnimationReferences,
    moveEventAnimationReferences,
    moveStickerAnimationReferences,
    removeGiftAnimationReferenceForKey,
    addGiftAnimationReference,
    addDefaultGiftAnimationReference,
    removeDefaultGiftAnimationReference,
    setEventAnimationTrigger,
    setStickerForAnimationTrigger,
    saveAnimationMappings,
    saveGiftMappings,
    saveEventAnimationMappings,
    saveStickerMappings,
    renderGiftMappings,
    renderAnimationMappings,
    removeGiftAnimationReferences,
    removeEventAnimationReferences,
    removeStickerAnimationReferences,
    loadAvailableAnimations
  }
});

function getActiveAnimationPopup() {
  return animationPopupController.getActivePopup();
}

function clampAnimationScale(value) {
  return animationPopupController.clampAnimationScale(value);
}

function formatAnimationScale(value) {
  return animationPopupController.formatAnimationScale(value);
}

function getAnimationPopupScaleValue() {
  return animationPopupController.getAnimationPopupScaleValue();
}

function setAnimationPopupScaleValue(value) {
  animationPopupController.setAnimationPopupScaleValue(value);
}

function setAnimationPopupPosition(position) {
  animationPopupController.setAnimationPopupPosition(position);
}

function closeAnimationCardPopup() {
  animationPopupController.closeAnimationCardPopup();
}

function closeAnimationGeneralSettingsPopup() {
  animationPopupController.closeAnimationGeneralSettingsPopup();
}

function openAnimationGeneralSettingsPopupPanel() {
  animationPopupController.openAnimationGeneralSettingsPopupPanel();
}

function openAnimationCardPopup(trigger, filename) {
  animationPopupController.openAnimationCardPopup(trigger, filename);
}

animationPopupController.attachEvents();
const animationSettingsController = window.createAnimationSettingsController({
  settingsStore,
  elements: {
    animationsEnabledCheckbox,
    animationVolumeSlider,
    animationVolumeValue,
    greenThresholdSlider,
    chromaToleranceSlider,
    greenThresholdValue,
    chromaToleranceValue,
    animationPositionSelect
  },
  callbacks: {
    onAnimationVolumeInput: () => saveAnimationMappings(),
    onChromaInput: () => saveAnimationMappings()
  }
});

animationSettingsController.init();

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

function loadHiddenVoices() {
  voiceUiController.loadHiddenVoices();
}

function saveHiddenVoices() {
  voiceUiController.saveHiddenVoices();
}

function populateVoicePreviewList() {
  voiceUiController.populateVoicePreviewList();
}

function previewVoice(voiceId) {
  voiceUiController.previewVoice(voiceId);
}

// ─── Language Filter Checkboxes ─────────────────────────────────────

function loadLanguageFilters() {
  voiceUiController.loadLanguageFilters();
}

function populateHiddenVoicesList() {
  voiceUiController.populateHiddenVoicesList();
}

const appBootstrapController = window.createAppBootstrapController({
  callbacks: {
    loadHiddenVoices,
    initVoiceUi: () => voiceUiController.attachEvents(),
    afterVoiceUi: () => {
      console.log('✓ Voice filter & preview system initialized');
    },
    initLanguageFilters: () => loadLanguageFilters(),
    afterLanguageFilters: () => {
      console.log('✓ Language filter system initialized');
    },
    initOllamaGender: () => ollamaGenderController.init(),
    initAudioRuntime: () => audioRuntimeController.init(),
    afterInit: () => {
      console.log('✓ OBS URL generator initialized');
    }
  }
});

appBootstrapController.init();

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

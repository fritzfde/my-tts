// TTS Configuration
const synth = window.speechSynthesis;
let voices = [];
let currentUtterance = null;
let messageQueue = [];
let isSpeaking = false;
let clonedVoices = [];

// Keep audio playing in background tabs
let wakeLock = null;

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

// Time-based key rotation (stick with one key until quota exhausted)
let keyStartTime = Date.now();
const KEY_ROTATION_INTERVAL = 3 * 60 * 60 * 1000; // 3 hours per key

function getNextApiKey() {
  if (apiKeys.length === 0) return '';

  // Auto-rotate key every 3 hours (before quota exhaustion)
  const now = Date.now();
  if (now - keyStartTime > KEY_ROTATION_INTERVAL) {
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    keyStartTime = now;
    console.log(`⏰ Auto-rotating to key ${currentKeyIndex + 1}/${apiKeys.length} after 3 hours`);
  }

  return apiKeys[currentKeyIndex];
}

// Force rotate to next key (called on quota errors)
function rotateToNextKey() {
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  keyStartTime = Date.now(); // Reset timer
  console.log(`🔑 Forced rotation to key ${currentKeyIndex + 1}/${apiKeys.length}`);
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

  ytSelect.innerHTML = '';
  ttSelect.innerHTML = '';

  const allowedLanguages = ['en', 'de', 'es', 'uk', 'ru'];

  const filteredVoices = voices.filter(voice => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    return allowedLanguages.includes(lang);
  });

  const voicesByLang = { 'en': [], 'de': [], 'es': [], 'uk': [], 'ru': [] };

  filteredVoices.forEach(voice => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    if (voicesByLang[lang]) {
      voicesByLang[lang].push({ voice, index: voices.indexOf(voice) });
    }
  });

  const langNames = {
    'en': '🇺🇸 English',
    'de': '🇩🇪 German',
    'es': '🇪🇸 Spanish',
    'uk': '🇺🇦 Ukrainian',
    'ru': '🇷🇺 Russian'
  };

  [ytSelect, ttSelect].forEach(select => {
    // ── 1. Custom (cloned) voices first ──
    if (clonedVoices.length > 0) {
      const header = document.createElement('option');
      header.disabled = true;
      header.textContent = '── 🎙️ Custom Voices ──';
      select.appendChild(header);

      clonedVoices.forEach(voiceName => {
        const option = document.createElement('option');
        option.value = `cloned-${voiceName}`;
        option.textContent = `  ${voiceName}`;
        select.appendChild(option);
      });
    }

    // ── 2. System voices grouped by language ──
    const hasSomethingAbove = clonedVoices.length > 0;
    allowedLanguages.forEach((langCode, idx) => {
      const langVoices = voicesByLang[langCode];
      if (!langVoices || langVoices.length === 0) return;

      // Separator before first system group if custom voices are above
      if (idx === 0 && hasSomethingAbove) {
        const sep = document.createElement('option');
        sep.disabled = true;
        sep.textContent = '──────────────';
        select.appendChild(sep);
      }

      const header = document.createElement('option');
      header.disabled = true;
      header.textContent = `── ${langNames[langCode]} ──`;
      select.appendChild(header);

      langVoices.forEach(({ voice, index }) => {
        const voiceId = `system-${index}`;
        // Skip hidden voices
        if (hiddenVoices && hiddenVoices.has(voiceId)) return;

        const option = document.createElement('option');
        option.value = voiceId;
        option.textContent = `  ${voice.name}`;
        select.appendChild(option);
      });
    });

    // ── 3. ElevenLabs ──
    // Only add this section if an ElevenLabs key is configured and voices have been fetched.
    // For now the section is intentionally omitted — system + custom voices are sufficient.
  });

  // Restore saved preferences
  const savedYTVoice = localStorage.getItem('youtube_default_voice');
  const savedTTVoice = localStorage.getItem('tiktok_default_voice');

  if (savedYTVoice && Array.from(ytSelect.options).some(opt => opt.value === savedYTVoice)) {
    ytSelect.value = savedYTVoice;
  } else {
    // Default to first custom voice if available, otherwise first system voice
    const firstSelectable = Array.from(ytSelect.options).find(opt => !opt.disabled);
    if (firstSelectable) ytSelect.value = firstSelectable.value;
  }

  if (savedTTVoice && Array.from(ttSelect.options).some(opt => opt.value === savedTTVoice)) {
    ttSelect.value = savedTTVoice;
  } else {
    const firstSelectable = Array.from(ttSelect.options).find(opt => !opt.disabled);
    if (firstSelectable) ttSelect.value = firstSelectable.value;
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
      localStorage.setItem('youtube_default_voice', ytSelect.value);
      console.log('Saved YouTube default voice:', ytSelect.value);
    });
  }

  if (ttSelect) {
    ttSelect.addEventListener('change', () => {
      localStorage.setItem('tiktok_default_voice', ttSelect.value);
      console.log('Saved TikTok default voice:', ttSelect.value);
    });
  }
});

// Load user voice mappings
function loadUserVoices() {
  const saved = localStorage.getItem('user_voices');
  if (saved) {
    try {
      userVoices = JSON.parse(saved);
    } catch (e) {
      userVoices = {};
    }
  }

  const savedRecentUsers = localStorage.getItem('recent_users');
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
  localStorage.setItem('user_voices', JSON.stringify(userVoices));
  localStorage.setItem('recent_users', JSON.stringify(recentUsers));
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

  return option ? option.textContent.trim() : voiceId;
}

// Add user to recent users list (with platform prefix)
function addRecentUser(userKey) {
  if (!recentUsers.includes(userKey) && !userKey.startsWith('SYSTEM:')) {
    recentUsers.unshift(userKey);
    if (recentUsers.length > 20) {
      recentUsers = recentUsers.slice(0, 20);
    }
    localStorage.setItem('recent_users', JSON.stringify(recentUsers));
  }
}

// Load saved settings
function loadSettings() {
  // API keys — stored as JSON array; fall back to legacy comma-separated string
  const savedKeys = localStorage.getItem('yt_tts_api_keys');
  if (savedKeys) {
    try { apiKeys = JSON.parse(savedKeys); } catch(e) { apiKeys = []; }
  } else {
    // Legacy single-key fallback
    const legacy = localStorage.getItem('yt_tts_api_key');
    if (legacy) {
      apiKeys = legacy.split(',').map(k => k.trim()).filter(k => k.length > 0);
    } else {
      apiKeys = ['AIzaSyAWVq4gtDP4rYaWKHH_2TvzBjxfRBr6kBE'];
    }
  }
  renderApiKeyTags();

  const savedChannelUrl = localStorage.getItem('yt_tts_channel_url');
  channelUrlInput.value = savedChannelUrl || 'https://www.youtube.com/@TESLAbot-CODM';

  const savedStreamUrl = localStorage.getItem('yt_tts_stream_url');
  if (savedStreamUrl) streamUrlInput.value = savedStreamUrl;

  const savedTikTokUsername = localStorage.getItem('tiktok_username_cache');
  if (savedTikTokUsername) document.getElementById('tiktokUsername').value = savedTikTokUsername;

  const savedTestMessage = localStorage.getItem('yt_tts_test_message');
  testMessageInput.value = savedTestMessage || 'Hello! This is a test of the text-to-speech voice.';

  const savedVolume = localStorage.getItem('yt_tts_volume');
  volumeSlider.value = savedVolume || '100';
  volumeValue.textContent = volumeSlider.value + '%';
}

// Save settings
function saveSettings() {
  localStorage.setItem('yt_tts_api_keys', JSON.stringify(apiKeys));
  const channelUrl    = channelUrlInput.value.trim();
  const streamUrl     = streamUrlInput.value.trim();
  if (channelUrl)    localStorage.setItem('yt_tts_channel_url', channelUrl);
  if (streamUrl)     localStorage.setItem('yt_tts_stream_url', streamUrl);
}

// Auto-save when fields change
channelUrlInput.addEventListener('change', saveSettings);
streamUrlInput.addEventListener('change', saveSettings);

// Volume slider live update
volumeSlider.addEventListener('input', () => {
  volumeValue.textContent = volumeSlider.value + '%';
  localStorage.setItem('yt_tts_volume', volumeSlider.value);
});

// Test message auto-save
testMessageInput.addEventListener('change', () => {
  localStorage.setItem('yt_tts_test_message', testMessageInput.value);
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

    // Figure out what the user actually typed and normalise it
    // Cases: "@TESLAbot-CODM", "TESLAbot-CODM",
    //        "https://youtube.com/@TESLAbot-CODM", "https://youtube.com/channel/UCxxx"

    const channelIdMatch = input.match(/channel\/([^\/\?]+)/);
    const handleMatch = input.match(/@([^\/\?]+)/);

    if (channelIdMatch) {
      // Full channel ID already — use directly, no API call needed
      channelId = channelIdMatch[1];
      console.log('Using channel ID directly:', channelId);
    } else {
      // It's a handle — extract it whether or not there's an @
      let handle = handleMatch ? handleMatch[1] : input.replace(/^https?:\/\/(www\.)?youtube\.com\/?/i, '');
      handle = handle.replace(/^@/, '').trim();

      if (!handle) {
        throw new Error('Could not parse channel handle');
      }

      console.log('Looking up handle:', handle);

      // Try forHandle first (works for modern @handles)
      let response = await fetch(
        `/api/youtube/channels?part=id&forHandle=${handle}&key=${apiKey}`
      );
      let data = response.ok ? await response.json() : null;

      // If forHandle returned nothing, try forUsername (legacy usernames)
      if (!data || !data.items || data.items.length === 0) {
        console.log('forHandle returned nothing, trying forUsername...');
        response = await fetch(
          `/api/youtube/channels?part=id&forUsername=${handle}&key=${apiKey}`
        );
        data = response.ok ? await response.json() : null;
      }

      if (!data || !data.items || data.items.length === 0) {
        throw new Error(`Channel "@${handle}" not found`);
      }

      channelId = data.items[0].id;
      console.log('Resolved channel ID:', channelId);
    }

    // Now search for live videos on that channel
    const searchResponse = await fetch(
      `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
    );

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

// Process message queue
function processQueue() {
  if (isSpeaking || messageQueue.length === 0) return;

  isSpeaking = true;

  // Ensure audio context is active (prevents pausing in background tabs)
  ensureAudioContext();

  const { author, text, platform, display, voiceOverride } = messageQueue.shift();

  const filteredText = filterMessage(text);

  if (!filteredText.trim()) {
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
          isSpeaking = false;
          processQueue();
        };
        result.audio.onerror = () => {
          isSpeaking = false;
          processQueue();
        };
        result.audio.play().catch(err => {
          console.warn('⏸️ Audio autoplay blocked. Click page to enable audio.');
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
    isSpeaking = false;
    processQueue();
  };

  utterance.onerror = () => {
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

// Add chat message with platform badge
function addChatMessage(author, text, platform = 'SYSTEM', isSpeaking = false, extraClass = '') {
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

  // Author part — clickable for real users
  let authorHtml;
  if (author !== 'SYSTEM') {
    authorHtml = `<span class="chat-author clickable" onclick="openVoiceAssignment('${author.replace(/'/g, "\\'")}', '${platform}')">${badge}${escapeHtml(author)}:</span>`;
  } else {
    authorHtml = `<span class="chat-author">${badge}${escapeHtml(text)}</span>`;
  }

  // For SYSTEM messages we already put the text in the author span, so skip the text span
  if (author === 'SYSTEM') {
    messageDiv.innerHTML = `${authorHtml}<span class="timestamp">${timestamp}</span>`;
  } else {
    messageDiv.innerHTML = `${authorHtml}<span class="chat-text">${escapeHtml(text)}</span><span class="timestamp">${timestamp}</span>`;
  }

  chatFeed.appendChild(messageDiv);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  // Track recent users
  if (author !== 'SYSTEM') {
    addRecentUser(`${platform}:${author}`);
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

  if (shouldDisplay) {
    messageQueue.push({ author, text, platform, display: true, voiceOverride: voiceToUse });
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

  if (!apiKey) {
    updateStatus('Enter YouTube API key', false, true);
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

  localStorage.setItem('tiktok_username_cache', username);

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

      // Request wake lock to keep audio playing in background
      requestWakeLock();

      updateStatus('TikTok connected', true);
      addChatMessage('SYSTEM', `Connected to @${username}`, 'tiktok', false);

      if (tiktokPollInterval) clearInterval(tiktokPollInterval);
      tiktokPollInterval = setInterval(() => pollTikTokMessages(), 2000);

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

  if (tiktokPollInterval) {
    clearInterval(tiktokPollInterval);
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

// Voice assignment modal
window.openVoiceAssignment = function(username, platform) {
  const currentVoice = getVoiceForUser(username, platform);
  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');

  const platformBadge = platform === 'youtube'
    ? '<span class="platform-badge youtube">YouTube</span>'
    : '<span class="platform-badge tiktok">TikTok</span>';

  // Get appropriate voice select based on platform
  const sourceSelect = platform === 'youtube' ? voiceSelectYouTube : voiceSelectTikTok;

  list.innerHTML = `
    <div class="user-voice-item">
      <div class="username">${platformBadge}${username}</div>
      <select id="voiceSelectModal">
        ${Array.from(sourceSelect.options).map(opt =>
          `<option value="${opt.value}" ${opt.value === currentVoice ? 'selected' : ''}>${opt.textContent}</option>`
        ).join('')}
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

// Manage voices button
document.getElementById('manageVoicesBtn').addEventListener('click', function() {
  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');

  if (recentUsers.length === 0) {
    list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users yet.</p>';
  } else {
    list.innerHTML = recentUsers.map(userKey => {
      const [platform, username] = userKey.split(':');
      const currentVoice = getVoiceForUser(username, platform);

      const platformBadge = platform === 'youtube'
        ? '<span class="platform-badge youtube">YouTube</span>'
        : '<span class="platform-badge tiktok">TikTok</span>';

      const sourceSelect = platform === 'youtube' ? voiceSelectYouTube : voiceSelectTikTok;

      return `
        <div class="user-voice-item">
          <div class="username">${platformBadge}${username}</div>
          <select onchange="setVoiceForUser('${username.replace(/'/g, "\\'")}', '${platform}', this.value)">
            ${Array.from(sourceSelect.options).map(opt =>
              `<option value="${opt.value}" ${opt.value === currentVoice ? 'selected' : ''}>${opt.textContent}</option>`
            ).join('')}
          </select>
          <button onclick="removeUserVoice('${username.replace(/'/g, "\\'")}', '${platform}')">Remove</button>
        </div>
      `;
    }).join('');
  }

  modal.style.display = 'flex';
});

window.removeUserVoice = function(username, platform) {
  const userKey = `${platform}:${username}`;
  delete userVoices[userKey];
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice for "${username}" (${platform}) removed`, 'SYSTEM', false);
  document.getElementById('manageVoicesBtn').click();
};

// Close modal on overlay click
document.getElementById('voiceModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeVoiceModal();
  }
});

// Test voice buttons
testVoiceYouTubeBtn.addEventListener('click', () => {
  const testMsg = testMessageInput.value.trim() || 'Hello! This is a test.';
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
  const testMsg = testMessageInput.value.trim() || 'Hello! This is a test.';
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
    const file = customSoundUpload.files[0];

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
        const option = document.createElement('option');
        option.value = `custom-${data.path}`;
        option.textContent = `🎵 ${data.filename}`;
        giftSoundSelect.appendChild(option);
        giftSoundSelect.value = option.value;

        localStorage.setItem('gift_sound_preference', option.value);

        updateStatus(`✓ Sound uploaded: ${data.filename}`, false);
        customSoundUpload.value = '';

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
async function loadCustomSounds() {
  try {
    const response = await fetch('/api/sounds/list');
    const data = await response.json();

    if (giftSoundSelect && data.custom && data.custom.length > 0) {
      data.custom.forEach(sound => {
        const option = document.createElement('option');
        option.value = `custom-${sound.path}`;
        option.textContent = `🎵 ${sound.name}`;
        giftSoundSelect.appendChild(option);
      });
    }

    const savedSound = localStorage.getItem('gift_sound_preference');
    if (giftSoundSelect && savedSound) {
      const hasOption = Array.from(giftSoundSelect.options).some(opt => opt.value === savedSound);
      if (hasOption) giftSoundSelect.value = savedSound;
    }

  } catch (error) {
    console.error('Error loading custom sounds:', error);
  }
}

// Save sound preference
if (giftSoundSelect) {
  giftSoundSelect.addEventListener('change', () => {
    localStorage.setItem('gift_sound_preference', giftSoundSelect.value);
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

// Load gender cache from localStorage
function loadGenderCache() {
  try {
    const saved = localStorage.getItem('gender_cache');
    if (saved) genderCache = JSON.parse(saved);
  } catch (e) {
    console.error('Error loading gender cache:', e);
    genderCache = {};
  }
}

// Save gender cache to localStorage
function saveGenderCache() {
  try {
    localStorage.setItem('gender_cache', JSON.stringify(genderCache));
  } catch (e) {
    console.error('Error saving gender cache:', e);
  }
}

// Populate male/female voice selectors
function populateGenderVoiceSelects() {
  if (!maleVoiceSelect || !femaleVoiceSelect) return;

  // Clear existing options
  maleVoiceSelect.innerHTML = '';
  femaleVoiceSelect.innerHTML = '';

  // Get all system voices
  const systemVoices = voices.map((voice, index) => ({
    value: `system-${index}`,
    name: voice.name,
    lang: voice.lang,
    voice: voice
  }));

  // Add cloned voices
  const allVoices = [
    ...clonedVoices.map(name => ({
      value: `cloned-${name}`,
      name: name,
      lang: 'custom',
      isCloned: true
    })),
    ...systemVoices
  ];

  // Populate both selects
  [maleVoiceSelect, femaleVoiceSelect].forEach(select => {
    allVoices.forEach(v => {
      const option = document.createElement('option');
      option.value = v.value;
      option.textContent = v.isCloned ? `🎙️ ${v.name}` : v.name;
      select.appendChild(option);
    });
  });

  // Try to auto-select appropriate voices
  const maleVoice = systemVoices.find(v =>
    /male|man|boy|david|mark|george|daniel|thomas/i.test(v.name)
  );
  const femaleVoice = systemVoices.find(v =>
    /female|woman|girl|samantha|victoria|zira|anna|karen|moira/i.test(v.name)
  );

  // Restore saved preferences or use auto-detected
  const savedMale = localStorage.getItem('default_male_voice');
  const savedFemale = localStorage.getItem('default_female_voice');

  if (savedMale && Array.from(maleVoiceSelect.options).some(opt => opt.value === savedMale)) {
    maleVoiceSelect.value = savedMale;
  } else if (maleVoice) {
    maleVoiceSelect.value = maleVoice.value;
  }

  if (savedFemale && Array.from(femaleVoiceSelect.options).some(opt => opt.value === savedFemale)) {
    femaleVoiceSelect.value = savedFemale;
  } else if (femaleVoice) {
    femaleVoiceSelect.value = femaleVoice.value;
  }

  console.log('✓ Gender voice selects populated');
}

// Save preferences when changed
if (maleVoiceSelect) {
  maleVoiceSelect.addEventListener('change', () => {
    localStorage.setItem('default_male_voice', maleVoiceSelect.value);
    console.log('Saved default male voice:', maleVoiceSelect.value);
  });
}

if (femaleVoiceSelect) {
  femaleVoiceSelect.addEventListener('change', () => {
    localStorage.setItem('default_female_voice', femaleVoiceSelect.value);
    console.log('Saved default female voice:', femaleVoiceSelect.value);
  });
}

// Detect gender using LLM (Ollama)
async function detectGenderWithLLM(username) {
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
    return 'neutral';

  } catch (error) {
    console.error('❌ LLM gender detection error:', error.message);
    // Fallback to pattern matching
    return quickPatternCheck(username);
  }
}

// Quick pattern check (fallback when LLM is offline)
function quickPatternCheck(username) {
  const lower = username.toLowerCase().replace(/[^a-z]/g, '');

  // Very obvious female patterns
  if (/girl|queen|princess|lady|miss|goddess|waifu/.test(lower)) return 'female';

  // Very obvious male patterns
  if (/boy|king|lord|dude|bro|master|emperor/.test(lower)) return 'male';

  return 'neutral';
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

  // Skip if gender voice selects aren't populated yet
  if (!maleVoiceSelect || !femaleVoiceSelect) return;

  try {
    // Detect gender (cached if seen before)
    const gender = await detectGender(author);

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

// Hook into existing polling functions
// We'll override the existing pollTikTokMessages to add auto-assignment

const originalPollTikTok = pollTikTokMessages;

async function pollTikTokMessages() {
  if (!tiktokConnected) return;

  try {
    const response = await fetch('/api/tiktok/messages');
    const messages = await response.json();

    tiktokLastPollTime = Date.now();

    if (!messages || messages.length === 0) return;

    if (tiktokIsFirstPoll) {
      tiktokIsFirstPoll = false;
      let lastChatIndex = -1;
      messages.forEach((msg, i) => { if (msg.type !== 'gift') lastChatIndex = i; });

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.type === 'gift') {
          const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
          console.log(`🎁 TikTok gift: ${msg.author} — ${msg.giftName} x${msg.repeatCount} (${msg.diamondCount}💎)`);
          addChatMessage(msg.author, giftText, 'tiktok', false, 'gift');
          if (window.playGiftSound) window.playGiftSound();
        } else {
          // Auto-assign voice before speaking
          await autoAssignVoiceIfNeeded(msg.author, 'tiktok');

          if (i === lastChatIndex) {
            speakText(msg.author, msg.text, 'tiktok', true);
          } else {
            addChatMessage(msg.author, msg.text, 'tiktok', false);
          }
        }
      }
      return;
    }

    // Normal poll
    for (const msg of messages) {
      if (msg.type === 'gift') {
        const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
        console.log(`🎁 TikTok gift: ${msg.author} — ${msg.giftName} x${msg.repeatCount} (${msg.diamondCount}💎)`);
        addChatMessage(msg.author, giftText, 'tiktok', false, 'gift');
        if (window.playGiftSound) window.playGiftSound();
      } else {
        // Auto-assign voice before speaking
        await autoAssignVoiceIfNeeded(msg.author, 'tiktok');
        speakText(msg.author, msg.text, 'tiktok', true);
      }
    }

  } catch (err) {
    console.error('TikTok polling error:', err);
  } finally {
    // CRITICAL: Schedule next poll (2 seconds)
    if (tiktokConnected) {
      setTimeout(pollTikTokMessages, 2000);
    }
  }
}

// Also hook into YouTube polling
const originalPollYouTube = pollYouTubeMessages;

async function pollYouTubeMessages(isReconnect = false) {
  if (!youtubeConnected || !youtubeLiveChatId) return;

  const apiKey = getNextApiKey();

  try {
    let url = `/api/youtube/liveChat/messages?liveChatId=${youtubeLiveChatId}&part=snippet,authorDetails&key=${apiKey}`;

    if (youtubeNextPageToken) {
      url += `&pageToken=${youtubeNextPageToken}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json();
      const message = errorData.error?.message || '';

      if (response.status === 403 && message.toLowerCase().includes('quota')) {
        console.warn(`⚠️ Quota hit on key ${currentKeyIndex + 1}, rotating… (${apiKeys.length} keys available)`);
        rotateToNextKey(); // Force rotate to next key
        const backoff = apiKeys.length > 1 ? 5000 : 30000;
        setTimeout(() => pollYouTubeMessages(false), backoff);
        return;
      }

      throw new Error(message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    youtubeNextPageToken = data.nextPageToken;
    youtubeLastPollTime = Date.now();

    if (data.items) {
      if (youtubeIsFirstPoll) {
        const items = data.items;
        const twoMinAgo = Date.now() - 120000;

        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          youtubeSeenMessages.add(item.id);

          // Auto-assign voice
          await autoAssignVoiceIfNeeded(item.authorDetails.displayName, 'youtube');

          if (idx === items.length - 1) {
            const publishedAt = new Date(item.snippet.publishedAt).getTime();
            if (publishedAt >= twoMinAgo) {
              speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);
            } else {
              addChatMessage(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', false);
            }
          } else {
            addChatMessage(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', false);
          }
        }

        youtubeIsFirstPoll = false;
      } else {
        for (const item of data.items) {
          if (!youtubeSeenMessages.has(item.id)) {
            youtubeSeenMessages.add(item.id);

            // Auto-assign voice
            await autoAssignVoiceIfNeeded(item.authorDetails.displayName, 'youtube');

            speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);

            // Check for animation triggers
            analyzeMessageForAnimation(item.snippet.displayMessage, item.authorDetails.displayName, 'youtube');
          }
        }
      }
    }

    const pollInterval = data.pollingIntervalMillis || 5000;
    setTimeout(() => pollYouTubeMessages(false), pollInterval);

  } catch (error) {
    console.error('YouTube polling error:', error);
    updateStatus(`YouTube error: ${error.message}`, false, true);
    disconnectYouTube();
  }
}

// Initialize on page load
loadGenderCache();
loadHiddenVoices(); // Load hidden voices list

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
  const savedPref = localStorage.getItem('auto_gender_detection');
  if (savedPref === 'true') {
    autoGenderDetectionCheckbox.checked = true;
  }

  autoGenderDetectionCheckbox.addEventListener('change', () => {
    localStorage.setItem('auto_gender_detection', autoGenderDetectionCheckbox.checked);
    console.log('Auto gender detection:', autoGenderDetectionCheckbox.checked ? 'enabled' : 'disabled');
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

// Load animation mappings from localStorage
function loadAnimationMappings() {
  const saved = localStorage.getItem('animation_mappings');
  if (saved) {
    try {
      animationMappings = JSON.parse(saved);
      console.log('✓ Loaded animation mappings:', Object.keys(animationMappings).length);
      renderAnimationMappings();
    } catch (e) {
      console.error('Error loading animation mappings:', e);
    }
  }
}

// Save animation mappings to localStorage
function saveAnimationMappings() {
  localStorage.setItem('animation_mappings', JSON.stringify(animationMappings));
  console.log('✓ Saved animation mappings');

  // Settings will auto-reload when overlay gains focus (no need for postMessage)
}

// Fetch available animation files from server
async function loadAvailableAnimations() {
  try {
    const response = await fetch('/api/animations/list');
    const data = await response.json();
    availableAnimations = data.animations;
    console.log(`✓ Loaded ${availableAnimations.length} animation files`);
    renderAnimationMappings();
  } catch (e) {
    console.error('Error loading animations:', e);
    availableAnimations = [];
  }
}

// Render animation mappings list
function renderAnimationMappings() {
  const list = document.getElementById('animationMappingsList');
  if (!list) return;

  if (availableAnimations.length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem;">No .MOV files found in /animations folder. Add some animation files first!</div>';
    return;
  }

  if (Object.keys(animationMappings).length === 0) {
    list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 0.875rem;">No mappings yet. Click "+ Add Mapping" to create one.</div>';
    return;
  }

  list.innerHTML = Object.entries(animationMappings).map(([trigger, filename]) => `
    <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px;">
      <input type="text" value="${trigger}" data-trigger="${trigger}" class="mapping-trigger" placeholder="Trigger (e.g., laugh, fire)" style="font-size: 0.875rem; padding: 8px;">
      <select data-trigger="${trigger}" class="mapping-file" style="font-size: 0.875rem; padding: 8px;">
        ${availableAnimations.map(anim =>
          `<option value="${anim.filename}" ${anim.filename === filename ? 'selected' : ''}>${anim.name}</option>`
        ).join('')}
      </select>
      <button class="secondary remove-mapping-btn" data-trigger="${trigger}" style="padding: 8px 16px; font-size: 0.75rem;">🗑️</button>
    </div>
  `).join('');

  // Add event listeners
  list.querySelectorAll('.mapping-trigger').forEach(input => {
    input.addEventListener('change', (e) => {
      const oldTrigger = e.target.dataset.trigger;
      const newTrigger = e.target.value.trim().toLowerCase();

      if (newTrigger && newTrigger !== oldTrigger) {
        const filename = animationMappings[oldTrigger];
        delete animationMappings[oldTrigger];
        animationMappings[newTrigger] = filename;
        saveAnimationMappings();
        renderAnimationMappings();
      }
    });
  });

  list.querySelectorAll('.mapping-file').forEach(select => {
    select.addEventListener('change', (e) => {
      const trigger = e.target.dataset.trigger;
      animationMappings[trigger] = e.target.value;
      saveAnimationMappings();
      populateTestAnimationDropdown(); // Update test dropdown
      console.log(`✓ Updated mapping: ${trigger} → ${e.target.value}`);
    });
  });

  list.querySelectorAll('.remove-mapping-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const trigger = e.target.dataset.trigger;
      delete animationMappings[trigger];
      saveAnimationMappings();
      renderAnimationMappings();
    });
  });

  // Update test animation dropdown
  populateTestAnimationDropdown();
}

// Populate test animation dropdown
function populateTestAnimationDropdown() {
  const select = document.getElementById('testAnimationSelect');
  if (!select) return;

  // Remember current selection
  const currentSelection = select.value;

  select.innerHTML = '<option value="">Select animation to test...</option>';

  Object.entries(animationMappings).forEach(([trigger, filename]) => {
    const option = document.createElement('option');
    option.value = trigger;
    // Show only trigger in dropdown, filename in gray
    const fileShort = filename.length > 30 ? filename.substring(0, 27) + '...' : filename;
    option.textContent = trigger;
    option.setAttribute('data-file', fileShort); // Store for later if needed
    select.appendChild(option);
  });

  // Restore selection if it still exists
  if (currentSelection && animationMappings[currentSelection]) {
    select.value = currentSelection;
  }
}

// Add new mapping button
const addAnimationMappingBtn = document.getElementById('addAnimationMappingBtn');
if (addAnimationMappingBtn) {
  addAnimationMappingBtn.addEventListener('click', () => {
    if (availableAnimations.length === 0) {
      alert('No animation files found!\n\nPlease add .MOV files to the /animations folder first.');
      return;
    }

    const trigger = prompt('Enter trigger word (e.g., laugh, fire, wow, heart):');
    if (trigger && trigger.trim()) {
      const triggerLower = trigger.trim().toLowerCase();
      animationMappings[triggerLower] = availableAnimations[0].filename;
      saveAnimationMappings();
      renderAnimationMappings();
    }
  });
}

// Animations enabled checkbox
const animationsEnabledCheckbox = document.getElementById('animationsEnabled');
if (animationsEnabledCheckbox) {
  // Load saved state
  const saved = localStorage.getItem('animations_enabled');
  if (saved !== null) {
    animationsEnabledCheckbox.checked = saved === 'true';
  }

  animationsEnabledCheckbox.addEventListener('change', () => {
    localStorage.setItem('animations_enabled', animationsEnabledCheckbox.checked);
    console.log('Animations:', animationsEnabledCheckbox.checked ? 'enabled ✅' : 'disabled ❌');
  });
}

// Chroma key sliders
const greenThresholdSlider = document.getElementById('greenThreshold');
const chromaToleranceSlider = document.getElementById('chromaTolerance');

if (greenThresholdSlider && chromaToleranceSlider) {
  // Load saved values
  const savedChroma = localStorage.getItem('chroma_key_settings');
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
  });

  chromaToleranceSlider.addEventListener('input', () => {
    document.getElementById('chromaToleranceValue').textContent = chromaToleranceSlider.value;
  });

  // Save on change
  function saveChromaSettings() {
    const settings = {
      greenThreshold: parseInt(greenThresholdSlider.value),
      tolerance: parseInt(chromaToleranceSlider.value),
      spillReduction: 0.5
    };
    localStorage.setItem('chroma_key_settings', JSON.stringify(settings));
    console.log('✓ Chroma key settings saved:', settings);
  }

  greenThresholdSlider.addEventListener('change', saveChromaSettings);
  chromaToleranceSlider.addEventListener('change', saveChromaSettings);
}

// Test animation button
const testAnimationBtn = document.getElementById('testAnimationBtn');
const testAnimationSelect = document.getElementById('testAnimationSelect');

if (testAnimationBtn && testAnimationSelect) {
  testAnimationBtn.addEventListener('click', async () => {
    const selectedTrigger = testAnimationSelect.value;

    if (!selectedTrigger) {
      alert('⚠️ Please select an animation from the dropdown first!');
      return;
    }

    const filename = animationMappings[selectedTrigger];
    console.log(`🎬 Testing animation: ${selectedTrigger} → ${filename}`);

    try {
      const response = await fetch('/api/animations/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'test',
          trigger: selectedTrigger,
          platform: 'manual'
        })
      });

      if (response.ok) {
        console.log(`✅ Triggered: ${selectedTrigger} → ${filename}`);
        // Don't show alert, just log it
      } else {
        alert('❌ Failed to trigger animation. Check console for errors.');
      }
    } catch (err) {
      console.error('Test animation error:', err);
      alert('❌ Error: ' + err.message);
    }
  });
}

// YouTube Chat Emotion Detection with LLM
async function analyzeMessageForAnimation(message, author, platform) {
  console.log(`🎬 [ANIMATION] Analyzing message: "${message}" from ${author} on ${platform}`);

  // Skip if animations disabled
  const animationsEnabledCheckbox = document.getElementById('animationsEnabled');
  if (!animationsEnabledCheckbox) {
    console.error('❌ [ANIMATION] animationsEnabled checkbox not found in DOM!');
    return;
  }

  if (!animationsEnabledCheckbox.checked) {
    console.log('⏸️ [ANIMATION] Animations disabled (checkbox unchecked)');
    return;
  }

  console.log('✅ [ANIMATION] Animations enabled!');

  // Skip if no mappings configured
  const mappingCount = Object.keys(animationMappings).length;
  if (mappingCount === 0) {
    console.log('⏸️ [ANIMATION] No animation mappings configured');
    return;
  }

  console.log(`✅ [ANIMATION] ${mappingCount} mappings available:`, Object.keys(animationMappings));

  // Cache common phrases - map to ACTUAL trigger words you configured
  const phraseCache = {
    'lol': 'lol',
    'lmao': 'lol',
    'haha': 'lol',
    'lmfao': 'lol',
    'omg': 'wow',
    'wtf': 'wow',
    'wow': 'wow',
    'no way': 'wow',
    'lets go': 'hype',
    "let's go": 'hype',
    'fire': 'fire',
    'sick': 'fire',
    '❤️': 'heart',
    '💖': 'heart',
    '🔥': 'fire',
    '😂': 'laugh',
    '🤣': 'laugh',
    '😮': 'wow',
    '😱': 'wow'
  };

  const lowerMsg = message.toLowerCase();
  console.log(`🔍 [ANIMATION] Searching in: "${lowerMsg}"`);

  // Quick emoji/phrase match
  for (const [phrase, emotion] of Object.entries(phraseCache)) {
    if (lowerMsg.includes(phrase)) {
      console.log(`✅ [ANIMATION] Phrase match: "${phrase}" → ${emotion}`);

      // Check if we have a mapping for this emotion
      if (animationMappings[emotion]) {
        console.log(`✅ [ANIMATION] Mapping found: ${emotion} → ${animationMappings[emotion]}`);
        triggerAnimation(emotion, platform, author);
        return;
      } else {
        console.warn(`⚠️ [ANIMATION] No mapping for emotion: ${emotion}`);
        console.log(`Available mappings:`, Object.keys(animationMappings));
      }
    }
  }

  console.log(`ℹ️ [ANIMATION] No phrase match found in cache`);

  // Use LLM for complex messages (optional)
  // Skipping LLM if no cache match to avoid spam
}

function triggerAnimation(trigger, platform, author) {
  console.log(`🎯 triggerAnimation called: trigger="${trigger}", platform="${platform}", author="${author}"`);
  console.log(`Available mappings:`, Object.keys(animationMappings));

  // Check if we have a mapping for this trigger
  if (!animationMappings[trigger]) {
    console.warn(`❌ No animation mapped for trigger: "${trigger}"`);
    console.log(`Available triggers:`, Object.keys(animationMappings).join(', '));
    return;
  }

  const filename = animationMappings[trigger];
  console.log(`✅ Found mapping: ${trigger} → ${filename}`);

  // Send to server to broadcast to overlay
  console.log(`📡 Sending to server: POST /api/animations/trigger`);
  fetch('/api/animations/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'emotion',
      trigger: trigger,
      platform: platform,
      author: author
    })
  })
  .then(response => {
    if (response.ok) {
      console.log(`✅ Animation trigger sent successfully: ${trigger}`);
    } else {
      console.error(`❌ Server returned error:`, response.status);
    }
  })
  .catch(err => console.error('❌ Animation trigger error:', err));
}

// Initialize animation system
loadAvailableAnimations();
loadAnimationMappings();

console.log('🎬 Animation system initialized');

// ─── Individual Voice Management System ─────────────────────────────

const toggleVoiceFilterBtn = document.getElementById('toggleVoiceFilter');
const voiceFilterPanel = document.getElementById('voiceFilterPanel');
const voiceFilterIcon = document.getElementById('voiceFilterIcon');
const voicePreviewList = document.getElementById('voicePreviewList');
const voicePreviewText = document.getElementById('voicePreviewText');
const showAllVoicesBtn = document.getElementById('showAllVoicesBtn');
const hiddenVoicesContainer = document.getElementById('hiddenVoicesContainer');
const hiddenVoicesList = document.getElementById('hiddenVoicesList');

// Track hidden voices
let hiddenVoices = new Set();

// Load hidden voices from localStorage
function loadHiddenVoices() {
  const saved = localStorage.getItem('hidden_voices');
  if (saved) {
    try {
      hiddenVoices = new Set(JSON.parse(saved));
      console.log(`✓ Loaded ${hiddenVoices.size} hidden voices`);
    } catch (e) {
      console.error('Error loading hidden voices:', e);
    }
  }
}

// Save hidden voices to localStorage
function saveHiddenVoices() {
  localStorage.setItem('hidden_voices', JSON.stringify(Array.from(hiddenVoices)));
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
    loadVoices(); // Refresh all dropdowns
    populateVoicePreviewList();
    populateHiddenVoicesList();
  });
}

// Populate visible voices list
function populateVoicePreviewList() {
  if (!voicePreviewList) return;

  const allVoices = [];

  // Add cloned voices (never hidden)
  clonedVoices.forEach(name => {
    allVoices.push({
      value: `cloned-${name}`,
      name: name,
      lang: 'custom',
      isCloned: true
    });
  });

  // Add system voices (check if hidden)
  voices.forEach((voice, index) => {
    const voiceId = `system-${index}`;
    if (!hiddenVoices.has(voiceId)) {
      allVoices.push({
        value: voiceId,
        name: voice.name,
        lang: voice.lang,
        voice: voice
      });
    }
  });

  if (allVoices.length === 0) {
    voicePreviewList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">All voices hidden</div>';
    return;
  }

  // Generate HTML
  voicePreviewList.innerHTML = allVoices.map(v => {
    const langFlag = {
      'en': '🇺🇸',
      'de': '🇩🇪',
      'es': '🇪🇸',
      'uk': '🇺🇦',
      'ru': '🇷🇺',
      'custom': '🎙️'
    }[v.lang.substring(0, 2)] || '🌐';

    const hideBtn = v.isCloned ? '' : `<button class="secondary hide-voice-btn" data-voice="${v.value}" style="padding: 4px 12px; font-size: 0.75rem;">❌ Hide</button>`;

    return `
      <div style="display: flex; align-items: center; gap: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 6px;">
        <span style="font-size: 1.2rem;">${langFlag}</span>
        <span style="flex: 1; color: var(--text-primary); font-size: 0.875rem;">${v.name}</span>
        <button class="secondary preview-voice-btn" data-voice="${v.value}" style="padding: 4px 12px; font-size: 0.75rem;">
          🔊 Preview
        </button>
      </div>
    `;
  }).join('');

  // Add preview button handlers
  document.querySelectorAll('.preview-voice-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const voiceId = btn.dataset.voice;
      previewVoice(voiceId);
    });
  });
}

// Preview a voice
function previewVoice(voiceId) {
  const testMsg = (voicePreviewText && voicePreviewText.value) || 'Hello! This is a test of the voice.';

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

    // Save to localStorage
    localStorage.setItem('enabled_languages', JSON.stringify(Array.from(enabledLanguages)));

    console.log(`✓ Language filter updated: ${lang} ${e.target.checked ? 'enabled' : 'disabled'}`);

    // Refresh all voice dropdowns
    loadVoices();
  });
});

// Load saved language filters
function loadLanguageFilters() {
  const saved = localStorage.getItem('enabled_languages');
  if (saved) {
    try {
      const langs = JSON.parse(saved);
      enabledLanguages = new Set(langs);

      // Update checkboxes to match saved state
      document.querySelectorAll('.lang-filter').forEach(checkbox => {
        checkbox.checked = enabledLanguages.has(checkbox.dataset.lang);
      });

      console.log('✓ Loaded language filters:', Array.from(enabledLanguages));
    } catch (e) {
      console.error('Error loading language filters:', e);
    }
  }
}

// Load filters on startup
loadLanguageFilters();

console.log('✓ Language filter system initialized');

// ─── OBS URL Generator ──────────────────────────────────────────────

// Position selector
const animationPositionSelect = document.getElementById('animationPosition');
if (animationPositionSelect) {
  // Load saved position
  const savedPosition = localStorage.getItem('animation_position');
  if (savedPosition) {
    animationPositionSelect.value = savedPosition;
  }

  // Save on change
  animationPositionSelect.addEventListener('change', () => {
    localStorage.setItem('animation_position', animationPositionSelect.value);
    generateOBSUrl();
    console.log('✓ Animation position saved:', animationPositionSelect.value);
  });
}

// Generate OBS URL with parameters
function generateOBSUrl() {
  const baseUrl = 'http://localhost:3000/overlay/animations';
  const params = new URLSearchParams();

  // Enabled state
  const enabled = document.getElementById('animationsEnabled');
  if (enabled) {
    params.set('enabled', enabled.checked);
  }

  // Position
  if (animationPositionSelect) {
    params.set('position', animationPositionSelect.value);
  }

  // Chroma key settings
  const threshold = document.getElementById('greenThreshold');
  const tolerance = document.getElementById('chromaTolerance');
  if (threshold) params.set('threshold', threshold.value);
  if (tolerance) params.set('tolerance', tolerance.value);

  // Animation mappings
  Object.entries(animationMappings).forEach(([trigger, filename]) => {
    params.set(trigger, filename);
  });

  const fullUrl = `${baseUrl}?${params.toString()}`;

  // Update the URL input field
  const urlInput = document.getElementById('animationOverlayUrl');
  if (urlInput) {
    urlInput.value = fullUrl;
  }

  return fullUrl;
}

// Regenerate URL whenever mappings change
const originalSaveAnimationMappings = saveAnimationMappings;
saveAnimationMappings = function() {
  originalSaveAnimationMappings();
  generateOBSUrl();
};

// Regenerate URL when chroma settings change
if (greenThresholdSlider) {
  greenThresholdSlider.addEventListener('change', generateOBSUrl);
}
if (chromaToleranceSlider) {
  chromaToleranceSlider.addEventListener('change', generateOBSUrl);
}

// Regenerate URL when enabled checkbox changes
if (animationsEnabledCheckbox) {
  const originalListener = animationsEnabledCheckbox.onchange;
  animationsEnabledCheckbox.addEventListener('change', () => {
    generateOBSUrl();
  });
}

// Generate initial URL on load
setTimeout(() => {
  generateOBSUrl();
  console.log('✓ OBS URL generated');
}, 1000);

console.log('✓ OBS URL generator initialized');

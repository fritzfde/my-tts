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
const elevenLabsKeyInput = document.getElementById('elevenLabsKey');
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

// Round-robin through keys
function getNextApiKey() {
  if (apiKeys.length === 0) return '';
  const key = apiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  return key;
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
        const option = document.createElement('option');
        option.value = `system-${index}`;
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

  const savedElevenLabsKey = localStorage.getItem('yt_tts_elevenlabs_key');
  elevenLabsKeyInput.value = savedElevenLabsKey || 'sk_b8531bb9517d1ae50c7f038df6107677f0a945003a99696d';

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
  const elevenLabsKey = elevenLabsKeyInput.value.trim();
  const channelUrl    = channelUrlInput.value.trim();
  const streamUrl     = streamUrlInput.value.trim();
  if (elevenLabsKey) localStorage.setItem('yt_tts_elevenlabs_key', elevenLabsKey);
  if (channelUrl)    localStorage.setItem('yt_tts_channel_url', channelUrl);
  if (streamUrl)     localStorage.setItem('yt_tts_stream_url', streamUrl);
}

// Auto-save when fields change
elevenLabsKeyInput.addEventListener('change', saveSettings);
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
        result.audio.play();
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
async function pollYouTubeMessages(isReconnect = false) {
  if (!youtubeConnected || !youtubeLiveChatId) return;

  const apiKey = getNextApiKey(); // rotate every poll

  try {
    let url = `/api/youtube/liveChat/messages?liveChatId=${youtubeLiveChatId}&part=snippet,authorDetails&key=${apiKey}`;

    if (youtubeNextPageToken) {
      url += `&pageToken=${youtubeNextPageToken}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json();
      const message = errorData.error?.message || '';

      // Quota exceeded — back off and retry with next key, don't disconnect
      if (response.status === 403 && message.toLowerCase().includes('quota')) {
        console.warn(`⚠️ Quota hit on key, rotating… (${apiKeys.length} keys available)`);
        // Back off longer when quota is hit
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
        // First poll after connect/reconnect.
        // Show all messages silently. Speak only the very last one,
        // and only if it arrived within the last 2 minutes.
        const items = data.items;
        const twoMinAgo = Date.now() - 120000;

        items.forEach((item, idx) => {
          youtubeSeenMessages.add(item.id);

          if (idx === items.length - 1) {
            // Last message — speak it only if recent
            const publishedAt = new Date(item.snippet.publishedAt).getTime();
            if (publishedAt >= twoMinAgo) {
              speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);
            } else {
              addChatMessage(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', false);
            }
          } else {
            addChatMessage(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', false);
          }
        });

        youtubeIsFirstPoll = false;
      } else {
        // Normal poll — speak everything new
        data.items.forEach(item => {
          if (!youtubeSeenMessages.has(item.id)) {
            youtubeSeenMessages.add(item.id);
            speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);
          }
        });
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

// Poll TikTok messages (chat + gifts)
let tiktokIsFirstPoll = true;

async function pollTikTokMessages() {
  if (!tiktokConnected) return;

  try {
    const response = await fetch('/api/tiktok/messages');
    const messages = await response.json();

    tiktokLastPollTime = Date.now();

    if (!messages || messages.length === 0) return;

    if (tiktokIsFirstPoll) {
      // First poll after connect — show everything silently,
      // speak only the very last chat message and only if recent.
      tiktokIsFirstPoll = false;
      const twoMinAgo = Date.now() - 120000;
      // Server doesn't send timestamps, so we only have "now".
      // On a fresh connect the queue was just cleared by the server,
      // so anything in it arrived in the last ~2s poll window — it IS recent.
      // Show all silently except the last chat message which we speak.
      let lastChatIndex = -1;
      messages.forEach((msg, i) => { if (msg.type !== 'gift') lastChatIndex = i; });

      messages.forEach((msg, i) => {
        if (msg.type === 'gift') {
          const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
          console.log(`🎁 TikTok gift: ${msg.author} — ${msg.giftName} x${msg.repeatCount} (${msg.diamondCount}💎)`);
          addChatMessage(msg.author, giftText, 'tiktok', false, 'gift');
        } else if (i === lastChatIndex) {
          // Last chat message — speak it
          speakText(msg.author, msg.text, 'tiktok', true);
        } else {
          // Older chat — display only
          addChatMessage(msg.author, msg.text, 'tiktok', false);
        }
      });
      return;
    }

    // Normal poll — speak everything
    messages.forEach(msg => {
      if (msg.type === 'gift') {
        const giftText = `🎁 sent ${msg.giftName}${msg.repeatCount > 1 ? ' x' + msg.repeatCount : ''} (${msg.diamondCount} diamonds)`;
        console.log(`🎁 TikTok gift: ${msg.author} — ${msg.giftName} x${msg.repeatCount} (${msg.diamondCount}💎)`);
        addChatMessage(msg.author, giftText, 'tiktok', false, 'gift');
      } else {
        speakText(msg.author, msg.text, 'tiktok', true);
      }
    });
  } catch (err) {
    console.error('TikTok polling error:', err);
  }
}

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
        result.audio.play();
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
        result.audio.play();
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
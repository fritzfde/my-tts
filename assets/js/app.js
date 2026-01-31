// TTS Configuration
const synth = window.speechSynthesis;
let voices = [];
let currentUtterance = null;
let messageQueue = [];
let isSpeaking = false;
let clonedVoices = [];

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
const apiKeyInput = document.getElementById('apiKey');
const elevenLabsKeyInput = document.getElementById('elevenLabsKey');
const channelUrlInput = document.getElementById('channelUrl');
const streamUrlInput = document.getElementById('streamUrl');
const findStreamBtn = document.getElementById('findStreamBtn');
const statusDiv = document.getElementById('status');
const chatFeed = document.getElementById('chatFeed');
const rateSelect = document.getElementById('rateSelect');
const pitchSelect = document.getElementById('pitchSelect');
const volumeSelect = document.getElementById('volumeSelect');
const readUsernamesCheckbox = document.getElementById('readUsernames');
const readEmojisCheckbox = document.getElementById('readEmojis');
const readLinksCheckbox = document.getElementById('readLinks');

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
  
  // Clear both
  ytSelect.innerHTML = '';
  ttSelect.innerHTML = '';
  
  // Allowed languages
  const allowedLanguages = ['en', 'de', 'es', 'uk', 'ru'];
  
  // Filter voices by allowed languages
  const filteredVoices = voices.filter(voice => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    return allowedLanguages.includes(lang);
  });
  
  // Group voices by language
  const voicesByLang = {
    'en': [],
    'de': [],
    'es': [],
    'uk': [],
    'ru': []
  };
  
  filteredVoices.forEach(voice => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    if (voicesByLang[lang]) {
      const globalIndex = voices.indexOf(voice);
      voicesByLang[lang].push({ voice, index: globalIndex });
    }
  });
  
  const langNames = {
    'en': '🇺🇸 English',
    'de': '🇩🇪 German',
    'es': '🇪🇸 Spanish',
    'uk': '🇺🇦 Ukrainian',
    'ru': '🇷🇺 Russian'
  };
  
  // Add voices to BOTH dropdowns
  [ytSelect, ttSelect].forEach(select => {
    // Add system voices first
    allowedLanguages.forEach(langCode => {
      const langVoices = voicesByLang[langCode];
      if (langVoices && langVoices.length > 0) {
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
      }
    });
    
    // Add custom cloned voices at end
    if (clonedVoices.length > 0) {
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '──────────────';
      select.appendChild(separator);
      
      const customHeader = document.createElement('option');
      customHeader.disabled = true;
      customHeader.textContent = '── 🎙️ Custom Voices ──';
      select.appendChild(customHeader);
      
      clonedVoices.forEach(voiceName => {
        const option = document.createElement('option');
        option.value = `cloned-${voiceName}`;
        option.textContent = `  ${voiceName}`;
        select.appendChild(option);
      });
    }
  });
  
  // Load saved voice preferences
  const savedYTVoice = localStorage.getItem('youtube_default_voice');
  const savedTTVoice = localStorage.getItem('tiktok_default_voice');
  
  if (savedYTVoice && Array.from(ytSelect.options).some(opt => opt.value === savedYTVoice)) {
    ytSelect.value = savedYTVoice;
  } else {
    // Set first English voice as default
    const firstEnglish = Array.from(ytSelect.options).find(opt => opt.value.startsWith('system-'));
    if (firstEnglish) ytSelect.value = firstEnglish.value;
  }
  
  if (savedTTVoice && Array.from(ttSelect.options).some(opt => opt.value === savedTTVoice)) {
    ttSelect.value = savedTTVoice;
  } else {
    // Set first English voice as default
    const firstEnglish = Array.from(ttSelect.options).find(opt => opt.value.startsWith('system-'));
    if (firstEnglish) ttSelect.value = firstEnglish.value;
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
  const saved = localStorage.getItem('recent_users');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Only keep valid entries
      recentUsers = Array.isArray(parsed)
        ? parsed.filter(key => typeof key === 'string' && key.includes(':') && key.split(':').length === 2)
        : [];
    } catch (e) {
      recentUsers = [];
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
  if (!userKey || typeof userKey !== 'string' || !userKey.includes(':')) {
    console.warn("Invalid userKey attempted to be added:", userKey);
    return;
  }
  if (!recentUsers.includes(userKey) && !userKey.startsWith('SYSTEM:')) {
    recentUsers.unshift(userKey);
    if (recentUsers.length > 20) recentUsers = recentUsers.slice(0, 20);
    localStorage.setItem('recent_users', JSON.stringify(recentUsers));
  }
}

// Load saved settings
function loadSettings() {
  const savedApiKey = localStorage.getItem('yt_tts_api_key');
  const savedElevenLabsKey = localStorage.getItem('yt_tts_elevenlabs_key');
  const savedChannelUrl = localStorage.getItem('yt_tts_channel_url');
  const savedStreamUrl = localStorage.getItem('yt_tts_stream_url');
  const savedTikTokUsername = localStorage.getItem('tiktok_username_cache');
  
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
  } else {
    apiKeyInput.value = 'AIzaSyAWVq4gtDP4rYaWKHH_2TvzBjxfRBr6kBE';
  }
  
  if (savedElevenLabsKey) {
    elevenLabsKeyInput.value = savedElevenLabsKey;
  } else {
    elevenLabsKeyInput.value = 'sk_b8531bb9517d1ae50c7f038df6107677f0a945003a99696d';
  }
  
  if (savedChannelUrl) {
    channelUrlInput.value = savedChannelUrl;
  } else {
    channelUrlInput.value = 'https://www.youtube.com/@TESLAbot-CODM';
  }
  
  if (savedStreamUrl) {
    streamUrlInput.value = savedStreamUrl;
  }
  
  if (savedTikTokUsername) {
    document.getElementById('tiktokUsername').value = savedTikTokUsername;
  }
  
  saveSettings();
}

// Save settings
function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const elevenLabsKey = elevenLabsKeyInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();
  const streamUrl = streamUrlInput.value.trim();
  
  if (apiKey) localStorage.setItem('yt_tts_api_key', apiKey);
  if (elevenLabsKey) localStorage.setItem('yt_tts_elevenlabs_key', elevenLabsKey);
  if (channelUrl) localStorage.setItem('yt_tts_channel_url', channelUrl);
  if (streamUrl) localStorage.setItem('yt_tts_stream_url', streamUrl);
}

// Auto-save when fields change
apiKeyInput.addEventListener('change', saveSettings);
elevenLabsKeyInput.addEventListener('change', saveSettings);
channelUrlInput.addEventListener('change', saveSettings);
streamUrlInput.addEventListener('change', saveSettings);

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
async function findLiveStream(apiKey, channelIdentifier) {
  try {
    updateStatus('Searching for live streams...', true);
    
    let channelId = channelIdentifier;
    
    if (channelIdentifier.startsWith('@')) {
      const username = channelIdentifier.substring(1);
      
      let response = await fetch(
        `/api/youtube/channels?part=id&forHandle=${username}&key=${apiKey}`
      );
      
      if (!response.ok) {
        response = await fetch(
          `/api/youtube/channels?part=id&forUsername=${username}&key=${apiKey}`
        );
      }
      
      if (!response.ok) {
        throw new Error('Failed to find channel');
      }
      
      const data = await response.json();
      if (!data.items || data.items.length === 0) {
        throw new Error('Channel not found');
      }
      
      channelId = data.items[0].id;
    }
    
    const searchResponse = await fetch(
      `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
    );
    
    if (!searchResponse.ok) {
      throw new Error('Failed to search for live streams');
    }
    
    const searchData = await searchResponse.json();
    
    if (!searchData.items || searchData.items.length === 0) {
      throw new Error('No live streams found');
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
  const apiKey = apiKeyInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();
  
  if (!apiKey) {
    updateStatus('Enter API key first', false, true);
    return;
  }
  
  if (!channelUrl) {
    updateStatus('Enter channel URL first', false, true);
    return;
  }
  
  const channelId = extractChannelId(channelUrl);
  if (!channelId) {
    updateStatus('Invalid channel URL', false, true);
    return;
  }
  
  saveSettings();
  
  try {
    findStreamBtn.disabled = true;
    findStreamBtn.textContent = '🔄 Searching...';
    
    await findLiveStream(apiKey, channelId);
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
        audio.volume = parseFloat(volumeSelect.value);
        
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
  const { author, text, platform, display, voiceOverride } = messageQueue.shift();
  
  const filteredText = filterMessage(text);
  
  if (!filteredText.trim()) {
    isSpeaking = false;
    processQueue();
    return;
  }
  
  let speechText = filteredText;
  if (readUsernamesCheckbox.checked) {
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
    utterance.volume = parseFloat(volumeSelect.value);
    
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
function addChatMessage(author, text, platform = 'SYSTEM', isSpeaking = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message' + (isSpeaking ? ' speaking' : '');
  
  const timestamp = new Date().toLocaleTimeString();
  
  // Platform badge
  let badge = '';
  if (platform === 'youtube') {
    badge = '<span class="platform-badge youtube">YouTube</span>';
  } else if (platform === 'tiktok') {
    badge = '<span class="platform-badge tiktok">TikTok</span>';
  }
  
  // Make username clickable for non-system messages
  const authorClass = author !== 'SYSTEM' ? 'chat-author clickable' : 'chat-author';
  const authorClick = author !== 'SYSTEM' ? `onclick="openVoiceAssignment('${author.replace(/'/g, "\\'")}', '${platform}')"` : '';
  
  messageDiv.innerHTML = `
    <div class="${authorClass}" ${authorClick}>
      ${badge}${author}<span class="timestamp">${timestamp}</span>
    </div>
    <div class="chat-text">${escapeHtml(text)}</div>
  `;
  
  chatFeed.appendChild(messageDiv);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  
  // Add to recent users with platform prefix
  if (author !== 'SYSTEM') {
    const userKey = `${platform}:${author}`;
    addRecentUser(userKey);
  }
  
  if (isSpeaking) {
    setTimeout(() => {
      messageDiv.classList.remove('speaking');
    }, 3000);
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
async function pollYouTubeMessages(apiKey, isReconnect = false) {
  if (!youtubeConnected || !youtubeLiveChatId) return;
  
  try {
    let url = `/api/youtube/liveChat/messages?liveChatId=${youtubeLiveChatId}&part=snippet,authorDetails&key=${apiKey}`;
    
    if (youtubeNextPageToken) {
      url += `&pageToken=${youtubeNextPageToken}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }
    
    const data = await response.json();
    youtubeNextPageToken = data.nextPageToken;
    youtubeLastPollTime = Date.now();
    
    if (data.items) {
      if (youtubeIsFirstPoll) {
        // First poll: show all, speak last 2 (or 1 if reconnect)
        const messagesToSpeak = isReconnect ? data.items.slice(-1) : data.items.slice(-2);
        const messagesToDisplay = isReconnect ? data.items.slice(0, -1) : data.items.slice(0, -2);
        
        messagesToDisplay.forEach(item => {
          youtubeSeenMessages.add(item.id);
          addChatMessage(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', false);
        });
        
        messagesToSpeak.forEach(item => {
          if (!youtubeSeenMessages.has(item.id)) {
            youtubeSeenMessages.add(item.id);
            speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);
          }
        });
        
        youtubeIsFirstPoll = false;
        
        if (messagesToDisplay.length > 0) {
          addChatMessage('SYSTEM', `Loaded ${messagesToDisplay.length} previous messages`, 'youtube', false);
        }
      } else {
        // Normal: speak all new
        data.items.forEach(item => {
          if (!youtubeSeenMessages.has(item.id)) {
            youtubeSeenMessages.add(item.id);
            speakText(item.authorDetails.displayName, item.snippet.displayMessage, 'youtube', true);
          }
        });
      }
    }
    
    const pollInterval = data.pollingIntervalMillis || 5000;
    setTimeout(() => pollYouTubeMessages(apiKey, false), pollInterval);
    
  } catch (error) {
    console.error('YouTube polling error:', error);
    updateStatus(`YouTube error: ${error.message}`, false, true);
    disconnectYouTube();
  }
}

// Poll TikTok messages
async function pollTikTokMessages(isReconnect = false) {
  if (!tiktokConnected) return;
  
  try {
    const response = await fetch('/api/tiktok/messages');
    const messages = await response.json();
    
    tiktokLastPollTime = Date.now();
    
    if (messages && messages.length > 0) {
      messages.forEach(msg => {
        const msgId = `${msg.author}-${msg.text}-${Date.now()}`;
        if (!tiktokSeenMessages.has(msgId)) {
          tiktokSeenMessages.add(msgId);
          speakText(msg.author, msg.text, 'tiktok', true);
        }
      });
    }
  } catch (err) {
    console.error('TikTok polling error:', err);
  }
}

// YouTube Connect
document.getElementById('connectYouTubeBtn').addEventListener('click', async () => {
  const url = streamUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  
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
    
    updateStatus('YouTube connected', true);
    addChatMessage('SYSTEM', 'Connected to YouTube stream', 'youtube');
    
    pollYouTubeMessages(apiKey, isReconnect);
    
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
  
  document.getElementById('connectYouTubeBtn').disabled = false;
  document.getElementById('disconnectYouTubeBtn').disabled = true;
  
  addChatMessage('SYSTEM', 'YouTube disconnected', 'youtube');
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
      const now = Date.now();
      const isReconnect = tiktokLastPollTime && (now - tiktokLastPollTime < 120000);
      
      if (!isReconnect) {
        tiktokSeenMessages.clear();
      }
      
      tiktokConnected = true;
      disconnectBtn.disabled = false;
      
      updateStatus('TikTok connected', true);
      addChatMessage('SYSTEM', `Connected to @${username}`, 'tiktok');
      
      if (tiktokPollInterval) clearInterval(tiktokPollInterval);
      tiktokPollInterval = setInterval(() => pollTikTokMessages(isReconnect), 2000);
      
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
  
  document.getElementById('connectTikTokBtn').disabled = false;
  document.getElementById('disconnectTikTokBtn').disabled = true;
  
  addChatMessage('SYSTEM', 'TikTok disconnected', 'tiktok');
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

// Load settings and voices on page load
loadSettings();
loadUserVoices();

// Auto-connect to both platforms on page load
setTimeout(async () => {
  const apiKey = apiKeyInput.value.trim();
  const streamUrl = streamUrlInput.value.trim();
  const tiktokUsername = document.getElementById('tiktokUsername').value.trim();
  
  // Auto-connect YouTube if we have URL
  if (apiKey && streamUrl) {
    console.log('Auto-connecting to YouTube...');
    document.getElementById('connectYouTubeBtn').click();
  }
  
  // Auto-connect TikTok if we have username
  if (tiktokUsername) {
    console.log('Auto-connecting to TikTok...');
    setTimeout(() => {
      document.getElementById('connectTikTokBtn').click();
    }, 1500);
  }
}, 1500);
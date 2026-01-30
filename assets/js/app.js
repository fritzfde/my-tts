// TTS Configuration
const synth = window.speechSynthesis;
let voices = [];
let isMonitoring = false;
let currentUtterance = null;
let messageQueue = [];
let isSpeaking = false;
let clonedVoices = []; // Store cloned voice names

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

// ElevenLabs API configuration (optional - for real AI voices)
const ELEVENLABS_API_KEY = null; // User can add their own key here
const ELEVENLABS_VOICES = {
  'elon': 'pMsXgVXv3BLzUgSXRplE', // Example voice ID
  'trump': 'TxGEqnHWrfWFTfGW9XjX'  // Example voice ID
};

// Load available voices
function loadVoices() {
  voices = synth.getVoices();
  const voiceSelect = document.getElementById('voiceSelect');
  voiceSelect.innerHTML = '';
  
  // Allowed languages
  const allowedLanguages = ['en', 'de', 'es', 'uk', 'ru'];
  
  // Filter voices by allowed languages
  const filteredVoices = voices.filter(voice => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    return allowedLanguages.includes(lang);
  });

  // Add cloned voices first (if any)
  if (clonedVoices.length > 0) {
    clonedVoices.forEach(voiceName => {
      const option = document.createElement('option');
      option.value = `cloned-${voiceName}`;
      option.textContent = `🎙️ ${voiceName} (Cloned Voice)`;
      voiceSelect.appendChild(option);
    });

    // Add separator
    const separator1 = document.createElement('option');
    separator1.disabled = true;
    separator1.textContent = '──────────────';
    voiceSelect.appendChild(separator1);
  }

  // Add custom AI voices
  const customVoices = [
    { name: '🎭 Elon Musk (AI)', value: 'custom-elon', type: 'custom' },
    { name: '🎭 Donald Trump (AI)', value: 'custom-trump', type: 'custom' }
  ];

  customVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.value;
    const elevenLabsInput = document.getElementById('elevenLabsKey');
    const hasKey = elevenLabsInput && elevenLabsInput.value.trim();
    option.textContent = voice.name + (hasKey ? '' : ' [Simulated]');
    voiceSelect.appendChild(option);
  });

  // Add separator
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = '──────────────';
  voiceSelect.appendChild(separator);

  // Group voices by language
  const voicesByLang = {
    'en': [],
    'de': [],
    'es': [],
    'uk': [],
    'ru': []
  };

  filteredVoices.forEach((voice, originalIndex) => {
    const lang = voice.lang.toLowerCase().substring(0, 2);
    if (voicesByLang[lang]) {
      // Store with original index from voices array
      const globalIndex = voices.indexOf(voice);
      voicesByLang[lang].push({ voice, index: globalIndex });
    }
  });

  // Add voices grouped by language
  const langNames = {
    'en': '🇺🇸 English',
    'de': '🇩🇪 German',
    'es': '🇪🇸 Spanish',
    'uk': '🇺🇦 Ukrainian',
    'ru': '🇷🇺 Russian'
  };

  allowedLanguages.forEach(langCode => {
    const langVoices = voicesByLang[langCode];
    if (langVoices && langVoices.length > 0) {
      // Add language header
      const header = document.createElement('option');
      header.disabled = true;
      header.textContent = `── ${langNames[langCode]} ──`;
      voiceSelect.appendChild(header);

      // Add voices for this language
      langVoices.forEach(({ voice, index }) => {
        const option = document.createElement('option');
        option.value = `system-${index}`;
        option.textContent = `  ${voice.name}`;
        voiceSelect.appendChild(option);
      });
    }
  });

  console.log('Loaded voices:', voiceSelect.options.length, 'including', clonedVoices.length, 'cloned voices');
}

// Load voices on page load and when they change
loadClonedVoices().then(() => {
  loadVoices();
});

if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices;
}

// UI Elements
const streamUrlInput = document.getElementById('streamUrl');
const apiKeyInput = document.getElementById('apiKey');
const elevenLabsKeyInput = document.getElementById('elevenLabsKey');
const channelUrlInput = document.getElementById('channelUrl');
const findStreamBtn = document.getElementById('findStreamBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const chatFeed = document.getElementById('chatFeed');
const voiceSelect = document.getElementById('voiceSelect');
const rateSelect = document.getElementById('rateSelect');
const pitchSelect = document.getElementById('pitchSelect');
const volumeSelect = document.getElementById('volumeSelect');
const readUsernamesCheckbox = document.getElementById('readUsernames');
const readEmojisCheckbox = document.getElementById('readEmojis');
const readLinksCheckbox = document.getElementById('readLinks');

let pollingInterval = null;
let liveChatId = null;
let nextPageToken = null;
let seenMessageIds = new Set();
let isFirstPoll = true; // Track if this is the first poll
let userVoices = {}; // User-specific voice assignments
let recentUsers = []; // Track recent users for quick assignment



const useYouTubeBtn = document.getElementById('useYouTube');
const useTikTokBtn = document.getElementById('useTikTok');
const tiktokGroup = document.getElementById('tiktokInputGroup');
const youtubeGroup = document.querySelector('.card > div:nth-child(2)'); // YouTube row

let activePlatform = 'youtube';

useTikTokBtn.addEventListener('click', () => {
    activePlatform = 'tiktok';
    tiktokGroup.style.display = 'block';
    youtubeGroup.style.display = 'none';
    useTikTokBtn.classList.add('active');
    useYouTubeBtn.classList.remove('active');
});

useYouTubeBtn.addEventListener('click', () => {
    activePlatform = 'youtube';
    tiktokGroup.style.display = 'none';
    youtubeGroup.style.display = 'grid';
    useYouTubeBtn.classList.add('active');
    useTikTokBtn.classList.remove('active');
});

// Update your Start Button logic
startBtn.addEventListener('click', () => {
    if (activePlatform === 'tiktok') {
        const username = document.getElementById('tiktokUsername').value;
        connectTikTok(username);
    } else {
        // ... existing YouTube start logic
    }
});



let tiktokPollInterval = null;

async function connectTikTok(username) {
    if (!username) return;

    const statusEl = document.getElementById('status');
    statusEl.innerHTML = "<span>🔄 Connecting to TikTok...</span>";

    try {
        const response = await fetch('/api/tiktok/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        if (data.success) {
            statusEl.innerHTML = `<span>🟢 Connected: @${username}</span>`;
            statusEl.className = "status connected";

            // CRITICAL: Set these so the app knows to process messages
            isMonitoring = true;
            startBtn.disabled = true;
            stopBtn.disabled = false;

            // Start polling for messages
            if (tiktokPollInterval) clearInterval(tiktokPollInterval);
            tiktokPollInterval = setInterval(pollTikTokMessages, 2000);

            addChatMessage('SYSTEM', `Connected to @${username} TikTok chat!`, false);
        } else {
            statusEl.innerHTML = `<span>❌ Offline: @${username}</span>`;
            statusEl.className = "status error";
        }
    } catch (err) {
        console.error("TikTok Connection Error:", err);
        statusEl.innerHTML = `<span>⚠️ TikTok Server Error</span>`;
    }
}

async function pollTikTokMessages() {
    // Only fetch if we are actually monitoring
    if (!isMonitoring) return;

    try {
        const response = await fetch('/api/tiktok/messages');
        const messages = await response.json();

        if (messages && messages.length > 0) {
            messages.forEach(msg => {
                console.log("UI received message:", msg.author, msg.text);
                // speakText handles both the Speech and adding it to the Chat Box
                speakText(msg.author, msg.text, true);
            });
        }
    } catch (err) {
        console.error("Error fetching TikTok messages:", err);
    }
}

// Change this logic in your DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    loadUserVoices();
    loadSettings();

    const ttInput = document.getElementById('tiktokUsername');
    const savedName = localStorage.getItem('tiktok_username_cache') || localStorage.getItem('saved_tiktok_handle');

    if (savedName && ttInput) {
        ttInput.value = savedName;

        // Switch UI to TikTok mode if we have a saved name
        activePlatform = 'tiktok';
        tiktokGroup.style.display = 'block';
        youtubeGroup.style.display = 'none';
        useTikTokBtn.classList.add('active');
        useYouTubeBtn.classList.remove('active');

        setTimeout(() => {
            console.log("🚀 Attempting auto-connect to:", savedName);
            connectTikTok(savedName);
        }, 1000);
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

  // Load recent users
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

// Get voice for specific user
function getVoiceForUser(username) {
  return userVoices[username] || voiceSelect.value;
}

// Set voice for specific user
function setVoiceForUser(username, voiceId) {
  userVoices[username] = voiceId;
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice for "${username}" set to: ${getVoiceName(voiceId)}`, false);
}

// Get voice name from voice ID
function getVoiceName(voiceId) {
  const option = Array.from(voiceSelect.options).find(opt => opt.value === voiceId);
  return option ? option.textContent : voiceId;
}

// Add user to recent users list
function addRecentUser(username) {
  if (!recentUsers.includes(username) && username !== 'SYSTEM') {
    recentUsers.unshift(username);
    if (recentUsers.length > 20) {
      recentUsers = recentUsers.slice(0, 20);
    }
    // Save recent users
    localStorage.setItem('recent_users', JSON.stringify(recentUsers));
  }
}

// Load saved settings from localStorage
function loadSettings() {
  const savedApiKey = localStorage.getItem('yt_tts_api_key');
  const savedElevenLabsKey = localStorage.getItem('yt_tts_elevenlabs_key');
  const savedChannelUrl = localStorage.getItem('yt_tts_channel_url');
  const savedStreamUrl = localStorage.getItem('yt_tts_stream_url');

  // Pre-fill YouTube API key
  if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
  } else {
    // Default API key
    apiKeyInput.value = 'AIzaSyAWVq4gtDP4rYaWKHH_2TvzBjxfRBr6kBE';
  }

  // Pre-fill ElevenLabs API key
  if (savedElevenLabsKey) {
    elevenLabsKeyInput.value = savedElevenLabsKey;
  } else {
    // Default ElevenLabs key
    elevenLabsKeyInput.value = 'sk_b8531bb9517d1ae50c7f038df6107677f0a945003a99696d';
  }

  // Pre-fill Channel URL
  if (savedChannelUrl) {
    channelUrlInput.value = savedChannelUrl;
  } else {
    // Default channel URL
    channelUrlInput.value = 'https://www.youtube.com/@TESLAbot-CODM';
  }

  // Pre-fill Stream URL if available
  if (savedStreamUrl) {
    streamUrlInput.value = savedStreamUrl;
  }

  // Save these defaults
  saveSettings();
}

// Save settings to localStorage
function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const elevenLabsKey = elevenLabsKeyInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();
  const streamUrl = streamUrlInput.value.trim();

  if (apiKey) {
    localStorage.setItem('yt_tts_api_key', apiKey);
  }

  if (elevenLabsKey) {
    localStorage.setItem('yt_tts_elevenlabs_key', elevenLabsKey);
  }

  if (channelUrl) {
    localStorage.setItem('yt_tts_channel_url', channelUrl);
  }

  if (streamUrl) {
    localStorage.setItem('yt_tts_stream_url', streamUrl);
  }
}

// Auto-save when fields change
apiKeyInput.addEventListener('change', saveSettings);
elevenLabsKeyInput.addEventListener('change', saveSettings);
channelUrlInput.addEventListener('change', saveSettings);
streamUrlInput.addEventListener('change', saveSettings); // Save stream URL when changed

// Extract channel ID from URL
function extractChannelId(url) {
  const patterns = [
    /@([^\/\?]+)/,  // @username
    /channel\/([^\/\?]+)/  // channel/ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Extract video ID from YouTube URL
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

// Find current live stream for a channel
async function findLiveStream(apiKey, channelIdentifier) {
  try {
    updateStatus('Searching for live streams...', true);

    // First, get the channel ID if we have a username
    let channelId = channelIdentifier;

    if (channelIdentifier.startsWith('@')) {
      const username = channelIdentifier.substring(1);

      // Try forHandle parameter (newer API)
      let response = await fetch(
        `/api/youtube/channels?part=id&forHandle=${username}&key=${apiKey}`
      );

      // If that doesn't work, try forUsername (older API)
      if (!response.ok) {
        response = await fetch(
          `/api/youtube/channels?part=id&forUsername=${username}&key=${apiKey}`
        );
      }

      if (!response.ok) {
        throw new Error('Failed to find channel. Check your channel URL.');
      }

      const data = await response.json();
      if (!data.items || data.items.length === 0) {
        throw new Error('Channel not found. Make sure the URL is correct.');
      }

      channelId = data.items[0].id;
      console.log('Found channel ID:', channelId);
    }

    // Search for live streams
    const searchResponse = await fetch(
      `/api/youtube/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`
    );

    if (!searchResponse.ok) {
      throw new Error('Failed to search for live streams');
    }

    const searchData = await searchResponse.json();

    if (!searchData.items || searchData.items.length === 0) {
      throw new Error('No live streams found for this channel. Make sure you are currently live.');
    }

    // Get the first live stream
    const liveVideo = searchData.items[0];
    const videoId = liveVideo.id.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    streamUrlInput.value = videoUrl;
    saveSettings(); // Save the stream URL immediately
    updateStatus(`✓ Found: ${liveVideo.snippet.title}`, false);

    console.log('Found live stream:', videoUrl);

    return videoUrl;

  } catch (error) {
    console.error('Find stream error:', error);
    updateStatus(`${error.message}`, false, true);
    throw error;
  }
}

// Find stream button handler
findStreamBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();

  if (!apiKey) {
    updateStatus('Please enter your API key first', false, true);
    return;
  }

  if (!channelUrl) {
    updateStatus('Please enter your channel URL first', false, true);
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
    updateStatus('Looking for live stream...', true);

    await findLiveStream(apiKey, channelId);

    // Auto-start after finding!
    updateStatus('✓ Stream found! Starting automatically...', false);
    setTimeout(() => {
      startBtn.click();
    }, 1000);

  } catch (error) {
    console.error('Error finding stream:', error);
    streamUrlInput.value = ''; // Clear invalid URL
    saveSettings();
    updateStatus('This channel is not live yet. Go live or paste stream URL manually.', false, true);
  } finally {
    findStreamBtn.disabled = false;
    findStreamBtn.textContent = '🔍 Find Livestream';
  }
});

// Filter message text based on settings
function filterMessage(text) {
  let filtered = text;

  // Remove emojis if checkbox is unchecked
  if (!readEmojisCheckbox.checked) {
    // Remove emoji characters (basic Unicode ranges)
    filtered = filtered.replace(/[\u{1F600}-\u{1F64F}]/gu, ''); // Emoticons
    filtered = filtered.replace(/[\u{1F300}-\u{1F5FF}]/gu, ''); // Misc Symbols and Pictographs
    filtered = filtered.replace(/[\u{1F680}-\u{1F6FF}]/gu, ''); // Transport and Map
    filtered = filtered.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Flags
    filtered = filtered.replace(/[\u{2600}-\u{26FF}]/gu, '');   // Misc symbols
    filtered = filtered.replace(/[\u{2700}-\u{27BF}]/gu, '');   // Dingbats
    filtered = filtered.replace(/[\u{1F900}-\u{1F9FF}]/gu, ''); // Supplemental Symbols and Pictographs
    filtered = filtered.replace(/[\u{1FA00}-\u{1FA6F}]/gu, ''); // Chess Symbols
    filtered = filtered.replace(/[\u{1FA70}-\u{1FAFF}]/gu, ''); // Symbols and Pictographs Extended-A
  }

  // Remove links if checkbox is unchecked
  if (!readLinksCheckbox.checked) {
    // Remove URLs
    filtered = filtered.replace(/https?:\/\/[^\s]+/g, '');
    filtered = filtered.replace(/www\.[^\s]+/g, '');
  }

  // Clean up extra spaces
  filtered = filtered.replace(/\s+/g, ' ').trim();

  return filtered;
}

// Generate custom voice audio using ElevenLabs API, cloned voice, or simulated
async function speakWithCustomVoice(voiceType, text) {
  // Check if it's a cloned voice
  if (voiceType.startsWith('cloned-')) {
    const voiceName = voiceType.replace('cloned-', '');

    try {
      console.log('Using cloned voice:', voiceName);
      const response = await fetch('/api/voice-clone/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          voice_name: voiceName
        })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.volume = parseFloat(volumeSelect.value);

        return {
          audio: audio,
          isCloned: true
        };
      } else {
        console.error('Cloned voice error:', await response.text());
      }
    } catch (error) {
      console.error('Cloned voice error, falling back to system TTS:', error);
    }
  }

  const elevenLabsKey = elevenLabsKeyInput.value.trim();

  // If ElevenLabs key is available, use real AI voices
  if (elevenLabsKey && !voiceType.startsWith('cloned-')) {
    try {
      // Get voice IDs from config file (if available)
      const voiceIds = typeof ELEVENLABS_CONFIG !== 'undefined'
        ? {
            'custom-elon': ELEVENLABS_CONFIG.voices.elon,
            'custom-trump': ELEVENLABS_CONFIG.voices.trump
          }
        : {
            // Fallback to default voice IDs if config not loaded
            'custom-elon': 'pNInz6obpgDQGcFmaJgB',
            'custom-trump': 'VR6AewLTigWG4xSOukaG'
          };

      const voiceId = voiceIds[voiceType];

      const response = await fetch('/api/elevenlabs/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: text,
          voice_id: voiceId,
          api_key: elevenLabsKey
        })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.volume = parseFloat(volumeSelect.value);

        return {
          audio: audio,
          isElevenLabs: true
        };
      }
    } catch (error) {
      console.error('ElevenLabs error, falling back to system TTS:', error);
    }
  }

  // Fallback to system TTS with modified parameters
  const utterance = new SpeechSynthesisUtterance(text);

  if (voiceType === 'custom-elon') {
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    utterance.volume = parseFloat(volumeSelect.value);

    const preferredVoices = voices.filter(v =>
      v.lang.includes('en-US') &&
      (v.name.includes('Male') || v.name.includes('Daniel') || v.name.includes('David'))
    );
    if (preferredVoices.length > 0) {
      utterance.voice = preferredVoices[0];
    }
  } else if (voiceType === 'custom-trump') {
    utterance.rate = 0.9;
    utterance.pitch = 0.85;
    utterance.volume = parseFloat(volumeSelect.value);

    const preferredVoices = voices.filter(v =>
      v.lang.includes('en-US') &&
      (v.name.includes('Male') || v.name.includes('Fred') || v.name.includes('Alex'))
    );
    if (preferredVoices.length > 0) {
      utterance.voice = preferredVoices[0];
    }
  }

  return {
    utterance: utterance,
    isElevenLabs: false,
    isCloned: false
  };
}

function processQueue() {
  if (isSpeaking || messageQueue.length === 0) return;

  isSpeaking = true;
  const { author, text, display, voiceOverride } = messageQueue.shift();

  // Filter the message text
  const filteredText = filterMessage(text);

  // Skip if filtered text is empty
  if (!filteredText.trim()) {
    isSpeaking = false;
    processQueue();
    return;
  }

  // Build the speech text
  let speechText = filteredText;
  if (readUsernamesCheckbox.checked) {
    speechText = `${author} says: ${filteredText}`;
  }

  // Get voice to use (user-specific or default)
  const selectedVoice = voiceOverride || voiceSelect.value;

  // Check if it's a custom voice
  if (selectedVoice.startsWith('custom-') || selectedVoice.startsWith('cloned-')) {
    speakWithCustomVoice(selectedVoice, speechText).then(result => {
      if (display !== false) {
        addChatMessage(author, text, true);
      }

      if (result.isElevenLabs || result.isCloned) {
        // Handle ElevenLabs or cloned audio
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
        // Handle system TTS
        const utterance = result.utterance;
        setupUtteranceHandlers(utterance, author, text);
        synth.speak(utterance);
        currentUtterance = utterance;
      }
    });
    return;
  } else {
    // Use system voice
    const utterance = new SpeechSynthesisUtterance(speechText);

    // Apply settings
    if (selectedVoice.startsWith('system-')) {
      const voiceIndex = parseInt(selectedVoice.replace('system-', ''));
      if (voices[voiceIndex]) {
        utterance.voice = voices[voiceIndex];
      }
    }

    utterance.rate = parseFloat(rateSelect.value);
    utterance.pitch = parseFloat(pitchSelect.value);
    utterance.volume = parseFloat(volumeSelect.value);

    setupUtteranceHandlers(utterance, author, text);
    if (display !== false) {
      addChatMessage(author, text, true);
    }
    synth.speak(utterance);
    currentUtterance = utterance;
  }
}

function setupUtteranceHandlers(utterance, author, text) {
  utterance.onend = () => {
    isSpeaking = false;
    processQueue();
  };

  utterance.onerror = () => {
    isSpeaking = false;
    processQueue();
  };
}
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

// Update status message
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

// Add chat message to feed
function addChatMessage(author, text, isSpeaking = false) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message' + (isSpeaking ? ' speaking' : '');

  const timestamp = new Date().toLocaleTimeString();

  // Make username clickable for non-system messages
  const authorClass = author !== 'SYSTEM' ? 'chat-author clickable' : 'chat-author';
  const authorClick = author !== 'SYSTEM' ? `onclick="openVoiceAssignment('${author.replace(/'/g, "\\'")}')"` : '';

  messageDiv.innerHTML = `
    <div class="chat-author ${authorClass}" ${authorClick}>
      ${author}<span class="timestamp">${timestamp}</span>
    </div>
    <div class="chat-text">${escapeHtml(text)}</div>
  `;

  chatFeed.appendChild(messageDiv);
  chatFeed.scrollTop = chatFeed.scrollHeight;

  // Add to recent users
  addRecentUser(author);

  // Remove speaking class after a delay
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

// Speak text using Web Speech API
function speakText(author, text, shouldDisplay = true) {
  // Get user-specific voice or default voice
  const userVoice = getVoiceForUser(author);

  if (shouldDisplay) {
    messageQueue.push({ author, text, display: true, voiceOverride: userVoice });
  } else {
    messageQueue.push({ author, text, display: false, voiceOverride: userVoice });
  }
  processQueue();
}

// Extract video ID from YouTube URL

// Get live chat ID from video
async function getLiveChatId(videoId, apiKey) {
  try {
    const response = await fetch(
      `/api/youtube/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      throw new Error('Video not found or not a live stream');
    }

    const liveChatId = data.items[0].liveStreamingDetails?.activeLiveChatId;

    if (!liveChatId) {
      throw new Error('No active live chat found. Make sure the stream is currently live.');
    }

    return liveChatId;
  } catch (error) {
    throw error;
  }
}

// Poll for new chat messages
async function pollChatMessages(apiKey) {
  if (!isMonitoring || !liveChatId) return;

  try {
    let url = `/api/youtube/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKey}`;

    if (nextPageToken) {
      url += `&pageToken=${nextPageToken}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();

    // Update next page token
    nextPageToken = data.nextPageToken;

    // Process new messages
    if (data.items) {
      // If this is the first poll, display all but only speak last 2
      if (isFirstPoll) {
        const totalMessages = data.items.length;
        const messagesToRead = data.items.slice(-2); // Only last 2 messages to SPEAK
        const messagesToDisplay = data.items.slice(0, -2); // Others just DISPLAY

        // Display all old messages without speaking
        messagesToDisplay.forEach(item => {
          seenMessageIds.add(item.id);
          const author = item.authorDetails.displayName;
          const text = item.snippet.displayMessage;
          addChatMessage(author, text, false); // Display but don't speak
        });

        // Display AND speak the last 2 messages
        for (const item of messagesToRead) {
          const messageId = item.id;

          if (seenMessageIds.has(messageId)) continue;

          seenMessageIds.add(messageId);

          const author = item.authorDetails.displayName;
          const text = item.snippet.displayMessage;

          speakText(author, text, true); // Speak and display
        }

        isFirstPoll = false;

        if (messagesToDisplay.length > 0) {
          addChatMessage('SYSTEM', `Loaded ${messagesToDisplay.length} previous messages. Reading last 2...`, false);
        }
      } else {
        // Normal operation: display AND speak all new messages
        for (const item of data.items) {
          const messageId = item.id;

          // Skip if we've already seen this message
          if (seenMessageIds.has(messageId)) continue;

          seenMessageIds.add(messageId);

          const author = item.authorDetails.displayName;
          const text = item.snippet.displayMessage;

          // Speak and display the message
          speakText(author, text, true);
        }
      }
    }

    // Schedule next poll based on pollingIntervalMillis
    const pollInterval = data.pollingIntervalMillis || 10000;
    setTimeout(() => pollChatMessages(apiKey), pollInterval);

  } catch (error) {
    console.error('Error polling chat:', error);
    updateStatus(`ERROR: ${error.message}`, false, true);
    stopMonitoring();
  }
}

// Start monitoring
startBtn.addEventListener('click', async () => {
  const url = streamUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!url) {
    updateStatus('ERROR: PLEASE ENTER A STREAM URL', false, true);
    return;
  }

  if (!apiKey) {
    updateStatus('ERROR: PLEASE ENTER YOUR YOUTUBE API KEY', false, true);
    return;
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    updateStatus('ERROR: INVALID YOUTUBE URL', false, true);
    return;
  }

  // Disable controls
  startBtn.disabled = true;
  streamUrlInput.disabled = true;
  apiKeyInput.disabled = true;

  updateStatus('CONNECTING TO LIVE STREAM...', true);
  chatFeed.innerHTML = '';

  try {
    // Get live chat ID
    liveChatId = await getLiveChatId(videoId, apiKey);

    // Reset tracking
    nextPageToken = null;
    seenMessageIds.clear();
    isFirstPoll = true; // Reset first poll flag

    // Start monitoring
    isMonitoring = true;
    stopBtn.disabled = false;

    updateStatus(`MONITORING LIVE CHAT: ${videoId}`, true);
    addChatMessage('SYSTEM', 'Connected to live stream. Reading chat messages...');

    // Start polling
    pollChatMessages(apiKey);

  } catch (error) {
    updateStatus(`ERROR: ${error.message}`, false, true);
    startBtn.disabled = false;
    streamUrlInput.disabled = false;
    apiKeyInput.disabled = false;
  }
});

// Stop monitoring
function stopMonitoring() {
  isMonitoring = false;
  liveChatId = null;
  nextPageToken = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  streamUrlInput.disabled = false;
  apiKeyInput.disabled = false;

  // Stop current speech
  synth.cancel();
  messageQueue = [];
  isSpeaking = false;

  updateStatus('MONITORING STOPPED');
}

stopBtn.addEventListener('click', stopMonitoring);

// Load saved settings on page load
loadSettings();
loadUserVoices(); // Load user voice mappings

// Voice assignment modal functions
window.openVoiceAssignment = function(username) {
  const currentVoice = getVoiceForUser(username);

  const modal = document.getElementById('voiceModal');
  const list = document.getElementById('userVoiceList');

  // Create voice selection for this user
  list.innerHTML = `
    <div class="user-voice-item">
      <div class="username">${username}</div>
      <select id="voiceSelectModal">
        ${Array.from(voiceSelect.options).map(opt =>
          `<option value="${opt.value}" ${opt.value === currentVoice ? 'selected' : ''}>${opt.textContent}</option>`
        ).join('')}
      </select>
      <button onclick="assignVoice('${username.replace(/'/g, "\\'")}')">Set Voice</button>
    </div>
  `;

  modal.style.display = 'flex';
};

window.assignVoice = function(username) {
  const voiceId = document.getElementById('voiceSelectModal').value;
  setVoiceForUser(username, voiceId);
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
    list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users. Users will appear here as they chat.</p>';
  } else {
    list.innerHTML = recentUsers.map(username => {
      const currentVoice = getVoiceForUser(username);
      const voiceName = getVoiceName(currentVoice);

      return `
        <div class="user-voice-item">
          <div class="username">${username}</div>
          <select onchange="setVoiceForUser('${username.replace(/'/g, "\\'")}', this.value)">
            ${Array.from(voiceSelect.options).map(opt =>
              `<option value="${opt.value}" ${opt.value === currentVoice ? 'selected' : ''}>${opt.textContent}</option>`
            ).join('')}
          </select>
          <button onclick="removeUserVoice('${username.replace(/'/g, "\\'")}')">Remove</button>
        </div>
      `;
    }).join('');
  }

  modal.style.display = 'flex';
});

window.removeUserVoice = function(username) {
  delete userVoices[username];
  saveUserVoices();
  addChatMessage('SYSTEM', `Voice assignment for "${username}" removed`, false);
  document.getElementById('manageVoicesBtn').click(); // Refresh modal
};

// Close modal on overlay click
document.getElementById('voiceModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeVoiceModal();
  }
});

// Auto-detect stream on page load (with smart fallback)
setTimeout(async () => {
  const apiKey = apiKeyInput.value.trim();
  const channelUrl = channelUrlInput.value.trim();
  const streamUrl = streamUrlInput.value.trim();

  console.log('Auto-detect starting...', { apiKey: !!apiKey, channelUrl, streamUrl });

  if (!apiKey) {
    updateStatus('Enter your API key to get started');
    return;
  }

  let streamIsValid = false;

  // If we have a saved stream URL, try to verify it's still valid
  if (streamUrl) {
    updateStatus('Checking saved stream...', true);
    console.log('Checking saved stream:', streamUrl);

    try {
      const videoId = extractVideoId(streamUrl);
      console.log('Extracted video ID:', videoId);

      if (videoId) {
        // Try to get the live chat ID to verify the stream is still live
        const response = await fetch(
          `/api/youtube/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
        );

        console.log('Stream check response:', response.ok);

        if (response.ok) {
          const data = await response.json();
          console.log('Stream data:', data);

          if (data.items && data.items.length > 0 && data.items[0].liveStreamingDetails?.activeLiveChatId) {
            updateStatus('✓ Stream is live! Starting automatically...', false);
            console.log('✓ Saved stream is still valid');
            streamIsValid = true;

            // Auto-start monitoring!
            setTimeout(() => {
              startBtn.click();
            }, 1000);
            return;
          } else {
            // Stream is not live anymore, clear it
            console.log('Stream is not live anymore, clearing...');
            streamUrlInput.value = '';
            saveSettings();
            updateStatus('Saved stream is no longer live. Searching for new stream...', false, false);
          }
        }
      }
    } catch (error) {
      console.log('❌ Saved stream check error:', error);
      streamUrlInput.value = '';
      saveSettings();
    }
  }

  // If saved stream didn't work or doesn't exist, try to auto-detect
  if (channelUrl && !streamIsValid) {
    const channelId = extractChannelId(channelUrl);
    console.log('Extracted channel ID:', channelId);

    if (channelId) {
      updateStatus('Looking for live stream...', true);
      try {
        console.log('Starting auto-detect for channel:', channelId);
        await findLiveStream(apiKey, channelId);
        console.log('✓ Auto-detect successful, auto-starting...');

        // Auto-start monitoring after finding stream!
        setTimeout(() => {
          startBtn.click();
        }, 1000);

      } catch (error) {
        console.log('❌ Auto-detect error:', error);
        updateStatus('Looks like this channel is not live yet. Go live or paste stream URL manually.', false, true);
        streamUrlInput.value = ''; // Clear the field
        saveSettings();
      }
    } else {
      console.log('❌ Could not extract channel ID from URL');
      updateStatus('Ready to connect');
    }
  } else if (!channelUrl) {
    updateStatus('Enter your channel URL to get started');
  }
}, 500);


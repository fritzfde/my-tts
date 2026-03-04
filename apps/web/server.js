const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createStorage } = require('./storage');

const app = express();
const PORT = 3000;

function loadRootEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

loadRootEnv();

const TTS_SERVER_URL = (process.env.TTS_SERVER_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
const TTS_TIMEOUT_MS = 60000;
const DEFAULT_SETTINGS_SCOPE = process.env.SETTINGS_SCOPE || 'local-dev';
const DB_DRIVER = process.env.DB_DRIVER || 'sqlite';
const storage = createStorage({
  driver: DB_DRIVER,
  baseDir: __dirname,
  sqlite: {
    dbFile: path.join(__dirname, 'data', 'app-settings.sqlite'),
    legacyAnimationConfigFile: path.join(__dirname, 'animation-config.json')
  }
});

const { WebcastPushConnection } = require('tiktok-live-connector');

app.use(cors());
app.use(express.json());
app.use(express.static('.'));
try {
  storage.init();
  console.log(`✓ Settings storage initialized (${DB_DRIVER})`);
} catch (err) {
  console.error('Failed to initialize settings storage:', err);
  process.exit(1);
}

app.get('/api/settings', (req, res) => {
  try {
    const scope = String(req.query.scope || DEFAULT_SETTINGS_SCOPE);
    const settings = storage.getSettings(scope);
    res.json({ scope, settings });
  } catch (err) {
    console.error('Settings load error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const scope = String(req.body.scope || req.query.scope || DEFAULT_SETTINGS_SCOPE);
    const settings = req.body.settings;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings must be an object' });
    }

    storage.saveSettings(scope, settings);
    res.json({ success: true, scope, count: Object.keys(settings).length });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Proxy endpoint for YouTube API
app.get('/api/youtube/*', async (req, res) => {
  try {
    const apiPath = req.params[0];
    const queryString = new URLSearchParams(req.query).toString();
    const url = `https://www.googleapis.com/youtube/v3/${apiPath}?${queryString}`;

    console.log('Fetching:', url);

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Local voice cloning endpoint
app.post('/api/voice-clone/tts', async (req, res) => {
  try {
    const { text, voice_name } = req.body;

    if (!text || !voice_name) {
      return res.status(400).json({ error: 'Text and Voice Name are required' });
    }

    console.log(`\n🎙️ Voice Clone Request: "${voice_name}"`);

    // Ensure we have an absolute path to the voices folder
    const VOICE_DIR = path.resolve(__dirname, 'voices');
    const voiceFile = path.join(VOICE_DIR, `${voice_name}.wav`);

    console.log(`🔍 Checking for file: ${voiceFile}`);

    if (!fs.existsSync(voiceFile)) {
      console.error('❌ Voice file not found at:', voiceFile);
      return res.status(404).json({
        error: `Voice file not found: ${voice_name}.wav`,
        path: voiceFile
      });
    }

    const ttsEndpoint = `${TTS_SERVER_URL}/tts`;
    console.log(`📡 Forwarding request to Python TTS server (${ttsEndpoint})...`);

    const pythonResponse = await fetch(ttsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice: voiceFile,
        text: text,
        language: req.body.language || 'en'
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS)
    });

    if (!pythonResponse.ok) {
      const errorData = await pythonResponse.text();
      console.error('❌ Python server returned error:', errorData);
      return res.status(500).json({
        error: 'Python TTS server error',
        details: errorData
      });
    }

    console.log('✅ Audio generated! Sending to frontend...');

    // Convert response to Buffer for Express
    const arrayBuffer = await pythonResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);

  } catch (error) {
    console.error('❌ Node Server Error:', error);

    if (error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Python server timed out' });
    }

    if (error.cause && error.cause.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: 'Cannot connect to Python server',
        solution: `Is tts_server.py running at ${TTS_SERVER_URL}?`
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// Get available cloned voices
app.get('/api/voice-clone/voices', (req, res) => {
  try {
    const voicesDir = path.resolve(__dirname, 'voices');
    if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir);

    const voices = fs.readdirSync(voicesDir)
      .filter(file => file.endsWith('.wav'))
      .map(file => file.replace('.wav', ''));

    console.log(`📋 Found voices: ${voices.join(', ')}`);
    res.json({ voices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📁 Voices folder: ${path.resolve(__dirname, 'voices')}\n`);
});


// --- TIKTOK LOGIC START ---
let tiktokConnection = null;
let tiktokMessageQueue = [];
// Recent gifts cache to deduplicate duplicate events from the TikTok connector
let recentGifts = new Map(); // key -> ts
const RECENT_GIFT_WINDOW_MS = 5000; // ignore duplicates within 5 seconds
const TIKTOK_ACTIVE_USER_TTL_MS = 60 * 1000;
let giftOverlayClients = [];
let likerLeaderboard = new Map(); // username → like count
let likerUserInfo = new Map(); // username → { nickname, avatar }
let likerLeaderboardClients = [];
let animationOverlayClients = []; // SSE clients for animation overlay
let tiktokViewerCount = 0;
let tiktokTopViewers = [];
let tiktokActiveUsers = new Map(); // uniqueId -> { uniqueId, nickname, avatar, source, lastSeen }

function rememberTikTokUser({ uniqueId, nickname, avatar }, source = 'event') {
    if (!uniqueId) return;
    const existing = tiktokActiveUsers.get(uniqueId) || {};
    tiktokActiveUsers.set(uniqueId, {
        uniqueId,
        nickname: nickname || existing.nickname || uniqueId,
        avatar: avatar || existing.avatar || null,
        source,
        lastSeen: Date.now()
    });
}

function pruneTikTokActiveUsers() {
    const cutoff = Date.now() - TIKTOK_ACTIVE_USER_TTL_MS;
    for (const [uniqueId, entry] of tiktokActiveUsers.entries()) {
        if (!entry || entry.lastSeen < cutoff) {
            tiktokActiveUsers.delete(uniqueId);
        }
    }
}

function resetTikTokAudienceState() {
    tiktokViewerCount = 0;
    tiktokTopViewers = [];
    tiktokActiveUsers.clear();
}

app.post('/api/tiktok/connect', (req, res) => {
    const { username } = req.body;

    if (tiktokConnection) {
        tiktokConnection.removeAllListeners();
        tiktokConnection.disconnect();
    }

    // Reset leaderboard on new connection
    likerLeaderboard.clear();
    resetTikTokAudienceState();

    tiktokConnection = new WebcastPushConnection(username);

    tiktokConnection.connect().then(state => {
        const statsViewerCount = Number(state?.roomInfo?.stats?.userCount || state?.roomInfo?.stats?.viewerCount || 0);
        if (Number.isFinite(statsViewerCount) && statsViewerCount > 0) {
            tiktokViewerCount = statsViewerCount;
        }
        console.log(`✅ SUCCESS: Connected to @${username}`);
        res.json({ success: true });
    }).catch(err => {
        console.error(`❌ FAILURE:`, err.message);
        res.status(500).json({ error: err.message });
    });

    // Capture Chat
    tiktokConnection.on('chat', data => {
        const hasEmotes = data.emotes && data.emotes.length > 0;
        const hasText = data.comment && data.comment.trim();
        rememberTikTokUser({
            uniqueId: data.uniqueId,
            nickname: data.nickname || data.uniqueId,
            avatar: data.profilePictureUrl || null
        }, 'chat');
        
        if (hasEmotes && hasText) {
            // COMBINED MESSAGE: Text + Stickers
            const msg = {
                type: 'combined',
                author: data.uniqueId,
                authorName: data.nickname || data.uniqueId,
                authorAvatar: data.profilePictureUrl || null,
                text: data.comment,
                emotes: data.emotes.map(e => ({
                    emoteId: e.emoteId,
                    emoteImage: e.emoteImageUrl,
                    position: e.placeInComment
                })),
                timestamp: Date.now()
            };
            
            log(`💬🖼️ [Combined] ${msg.authorName}: ${msg.text} + ${msg.emotes.length} sticker(s)`);
            tiktokMessageQueue.push(msg);
            
        } else if (hasEmotes) {
            // ONLY stickers (process first one for animation, show all)
            const msg = {
                type: 'emote',
                author: data.uniqueId,
                authorName: data.nickname || data.uniqueId,
                authorAvatar: data.profilePictureUrl || null,
                emotes: data.emotes.map(e => ({
                    emoteId: e.emoteId,
                    emoteImage: e.emoteImageUrl
                })),
                primaryEmoteId: data.emotes[0].emoteId, // For animation triggering
                timestamp: Date.now()
            };
            
            log(`🖼️ [Stickers Only] ${msg.authorName} sent ${msg.emotes.length} sticker(s)`);
            tiktokMessageQueue.push(msg);
            
        } else if (hasText) {
            // ONLY text
            const msg = {
                type: 'chat',
                author: data.uniqueId,
                authorName: data.nickname || data.uniqueId,
                authorAvatar: data.profilePictureUrl || null,
                text: data.comment,
                timestamp: Date.now()
            };
            
            log(`💬 [Chat] ${msg.authorName}: ${msg.text}`);
            tiktokMessageQueue.push(msg);
        }
    });

    // Capture Gifts
    tiktokConnection.on('gift', data => {
      const count = data.repeatCount || 1;
      const diamonds = (data.diamondCount || 0) * count;
      const msg = {
        type: 'gift',
        author: data.uniqueId,
        authorName: data.nickname || data.userName || data.uniqueId,
        authorAvatar: data.profilePictureUrl || null,
        giftName: data.giftName,
        giftPictureUrl: data.giftPictureUrl || data.gift?.image?.url_list?.[0] || null,
        repeatCount: count,
        diamondCount: diamonds,
        timestamp: Date.now()
      };

      // Deduplicate: create a robust signature and ignore if seen recently
      const normalizedGiftName = (msg.giftName || '').toLowerCase().trim();
      const giftIdField = data.gift?.id || data.giftId || data.id || '';
      const keyParts = [msg.author, normalizedGiftName, msg.repeatCount, msg.diamondCount, giftIdField];
      const key = keyParts.join(':');
      const now = Date.now();

      // Remove expired entries from the map
      for (const [k, ts] of recentGifts.entries()) {
        if (now - ts > RECENT_GIFT_WINDOW_MS) recentGifts.delete(k);
      }

      if (recentGifts.has(key)) {
        console.log(`🔁 Ignored duplicate gift event: ${msg.authorName} — ${msg.giftName}`);
        console.debug('Duplicate gift raw data warning');
        // console.debug('Duplicate gift raw data:', JSON.stringify(data));
        return;
      }

      // Add to recent cache and proceed
      recentGifts.set(key, now);

      console.log(`🎁 [Gift] ${msg.authorName} (@${msg.author}): ${msg.giftName} x${count} (${diamonds} diamonds)`);
      rememberTikTokUser({
        uniqueId: msg.author,
        nickname: msg.authorName,
        avatar: msg.authorAvatar
      }, 'gift');
      tiktokMessageQueue.push(msg);

      // Broadcast to gift overlay
      broadcastToGiftOverlay(msg);
    });

    // Capture Follows
    tiktokConnection.on('follow', data => {
        const msg = {
            type: 'follow',
            author: data.uniqueId,
            authorName: data.nickname || data.uniqueId,
            authorAvatar: data.profilePictureUrl || null,
            timestamp: Date.now()
        };
        console.log(`👤 [Follow] ${msg.authorName} (@${msg.author}) followed!`);
        rememberTikTokUser({
            uniqueId: msg.author,
            nickname: msg.authorName,
            avatar: msg.authorAvatar
        }, 'follow');
        tiktokMessageQueue.push(msg);
    });

    // Capture Shares
    tiktokConnection.on('share', data => {
        const msg = {
            type: 'share',
            author: data.uniqueId,
            authorName: data.nickname || data.uniqueId,
            authorAvatar: data.profilePictureUrl || null,
            timestamp: Date.now()
        };
        console.log(`📤 [Share] ${msg.authorName} (@${msg.author}) shared the stream!`);
        rememberTikTokUser({
            uniqueId: msg.author,
            nickname: msg.authorName,
            avatar: msg.authorAvatar
        }, 'share');
        tiktokMessageQueue.push(msg);
    });

    // Capture Emotes (free stickers/reactions)
    tiktokConnection.on('emote', data => {
        const msg = {
            type: 'emote',
            author: data.uniqueId,
            authorName: data.nickname || data.uniqueId,
            emoteId: data.emoteId || (data.emote && data.emote.emoteId),
            emoteName: (data.emote && data.emote.emoteName) || 'unknown',
            emoteImage: (data.emote && data.emote.image && data.emote.image.url) || null,
            timestamp: Date.now()
        };
        console.log(`😂 [Emote] ${msg.authorName} sent ${msg.emoteName} (ID: ${msg.emoteId})`);
        rememberTikTokUser({
            uniqueId: msg.author,
            nickname: msg.authorName,
            avatar: data.profilePictureUrl || null
        }, 'emote');

        // Broadcast to animation overlay
        broadcastToAnimationOverlay({
            type: 'emote',
            platform: 'tiktok',
            trigger: msg.emoteName,
            emoteId: msg.emoteId,
            author: msg.authorName
        });
    });

    // Capture Members Joining (viewer enters room)
    tiktokConnection.on('member', data => {
        const member = {
            uniqueId: data.uniqueId,
            nickname: data.nickname || data.uniqueId,
            avatar: data.profilePictureUrl || null
        };
        rememberTikTokUser(member, 'member');
    });

    // Capture viewer statistics + top viewers from room stats events
    tiktokConnection.on('roomUser', data => {
        const viewerCount = Number(data?.viewerCount || 0);
        tiktokViewerCount = Number.isFinite(viewerCount) ? viewerCount : 0;

        const rawTopViewers = Array.isArray(data?.topViewers)
            ? data.topViewers
            : Array.isArray(data?.ranksList)
                ? data.ranksList
                : [];

        tiktokTopViewers = rawTopViewers
            .map((entry) => {
                const user = entry?.user || {};
                const uniqueId = user.uniqueId || entry?.uniqueId || '';
                if (!uniqueId) return null;

                const mapped = {
                    uniqueId,
                    nickname: user.nickname || entry?.nickname || uniqueId,
                    avatar: user.profilePictureUrl || entry?.profilePictureUrl || null,
                    coinCount: Number(entry?.coinCount || 0)
                };

                rememberTikTokUser(mapped, 'topViewer');
                return mapped;
            })
            .filter(Boolean)
            .slice(0, 10);
    });

    // Capture Likes
    tiktokConnection.on('like', data => {
        const author = data.uniqueId;
        const count = data.likeCount || 1;
        rememberTikTokUser({
            uniqueId: author,
            nickname: data.nickname || author,
            avatar: data.profilePictureUrl || null
        }, 'like');

        // Update leaderboard
        const currentCount = likerLeaderboard.get(author) || 0;
        likerLeaderboard.set(author, currentCount + count);

        // Store user info for leaderboard
        if (!likerUserInfo.has(author)) {
            likerUserInfo.set(author, {
                nickname: data.nickname || author,
                avatar: data.profilePictureUrl || null
            });
        }

        console.log(`❤️ [Like] ${data.nickname || author} sent ${count} likes (total: ${currentCount + count})`);

        // Broadcast updated leaderboard
        broadcastLeaderboard();
    });
});

// Separate route for polling
app.get('/api/tiktok/messages', (req, res) => {
    res.json(tiktokMessageQueue);
    tiktokMessageQueue = [];
});

app.get('/api/tiktok/audience', (req, res) => {
    pruneTikTokActiveUsers();

    const activeUsers = Array.from(tiktokActiveUsers.values())
        .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
        .slice(0, 200);

    res.json({
        connected: Boolean(tiktokConnection && tiktokConnection.isConnected),
        viewerCount: tiktokViewerCount,
        activeUsers,
        topViewers: tiktokTopViewers,
        ttlMs: TIKTOK_ACTIVE_USER_TTL_MS,
        updatedAt: Date.now()
    });
});

// SSE endpoint for gift overlay
app.get('/overlay/gifts/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    giftOverlayClients.push(res);

    req.on('close', () => {
        const index = giftOverlayClients.indexOf(res);
        if (index > -1) giftOverlayClients.splice(index, 1);
    });
});

// SSE endpoint for liker leaderboard
app.get('/overlay/likers/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    likerLeaderboardClients.push(res);

    // Send current leaderboard immediately
    const leaderboard = getTopLikers();
    res.write(`data: ${JSON.stringify(leaderboard)}\n\n`);

    req.on('close', () => {
        const index = likerLeaderboardClients.indexOf(res);
        if (index > -1) likerLeaderboardClients.splice(index, 1);
    });
});

// Helper functions
function broadcastToGiftOverlay(giftData) {
    const data = JSON.stringify(giftData);
    giftOverlayClients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (err) {
            console.error('Gift overlay broadcast error:', err);
        }
    });
}

function broadcastLeaderboard() {
    const leaderboard = getTopLikers();
    const data = JSON.stringify(leaderboard);

    likerLeaderboardClients.forEach(client => {
        try {
            client.write(`data: ${data}\n\n`);
        } catch (err) {
            console.error('Leaderboard broadcast error:', err);
        }
    });
}

function getTopLikers(limit = 10) {
    return Array.from(likerLeaderboard.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([username, count]) => {
            const userInfo = likerUserInfo.get(username) || {};
            return {
                username,
                count,
                nickname: userInfo.nickname || username,
                avatar: userInfo.avatar || null
            };
        });
}

// Serve overlay HTML files
app.get('/overlay/gifts', (req, res) => {
    res.sendFile(path.join(__dirname, 'overlays', 'gifts.html'));
});

app.get('/overlay/likers', (req, res) => {
    res.sendFile(path.join(__dirname, 'overlays', 'likers.html'));
});

// Sound effects management
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

// Upload custom sound
const multer = require('multer');
const { log } = require('console');
function getCustomSoundsDir() {
    return path.join(__dirname, 'sounds', 'custom');
}

function isSafeSoundFilename(filename) {
    return /^[a-zA-Z0-9._-]+\.(mp3|wav|ogg)$/i.test(String(filename || ''));
}

const soundStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const soundsDir = getCustomSoundsDir();
        if (!fs.existsSync(soundsDir)) {
            fs.mkdirSync(soundsDir, { recursive: true });
        }
        cb(null, soundsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${Date.now()}${ext}`);
    }
});

const soundUpload = multer({
    storage: soundStorage,
    fileFilter: (req, file, cb) => {
        const allowed = ['.mp3', '.wav', '.ogg'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files (.mp3, .wav, .ogg) are allowed'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

app.post('/api/sounds/upload', soundUpload.single('sound'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    res.json({
        success: true,
        filename: req.file.filename,
        path: `/sounds/custom/${req.file.filename}`
    });
});

// Get available sounds
app.get('/api/sounds/list', (req, res) => {
    const soundsDir = path.join(__dirname, 'sounds');
    const customDir = getCustomSoundsDir();

    const builtIn = fs.existsSync(soundsDir)
        ? fs.readdirSync(soundsDir).filter(f => f.match(/\.(mp3|wav|ogg)$/i))
        : [];

    const custom = fs.existsSync(customDir)
        ? fs.readdirSync(customDir).filter(f => f.match(/\.(mp3|wav|ogg)$/i))
        : [];

    res.json({
        builtIn: builtIn.map(f => ({ name: f, path: `/sounds/${f}` })),
        custom: custom.map(f => ({ name: f, path: `/sounds/custom/${f}` }))
    });
});

// Delete a custom sound
app.delete('/api/sounds/custom/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!isSafeSoundFilename(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }

    const customDir = getCustomSoundsDir();
    const filePath = path.join(customDir, filename);

    if (!filePath.startsWith(customDir + path.sep)) {
        return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Sound not found' });
    }

    try {
        fs.unlinkSync(filePath);
        res.json({ success: true, filename });
    } catch (err) {
        console.error('Delete sound error:', err);
        res.status(500).json({ error: 'Failed to delete sound' });
    }
});

// --- TIKTOK LOGIC END ---




// ─── ANIMATION OVERLAY ENDPOINTS ────────────────────────────────────

// ─── Animation Config Storage (SQLite) ──────────────────────────────

// Load animation config
app.get('/api/animations/config/:name', (req, res) => {
  try {
    const config = storage.getAnimationConfig(req.params.name);
    res.json(config);
  } catch (err) {
    console.error('Config load error:', err);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// Save animation config
app.post('/api/animations/config/:name', (req, res) => {
  try {
    const savedConfig = storage.saveAnimationConfig(req.params.name, req.body || {});
    console.log(`✓ Saved animation config: ${req.params.name}`);

    const payload = JSON.stringify({ type: 'config', config: savedConfig });
    animationClients.forEach(client => {
      try {
        client.res.write(`data: ${payload}\n\n`);
      } catch (err) {
        console.error('Error sending config update to animation client:', err);
      }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Config save error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List all available configs
app.get('/api/animations/configs', (req, res) => {
  try {
    const configs = storage.listAnimationConfigNames();
    res.json({ configs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list configs' });
  }
});

// Delete a config
app.delete('/api/animations/config/:name', (req, res) => {
  try {
    if (req.params.name === 'default') {
      return res.status(400).json({ error: 'Cannot delete default config' });
    }

    storage.deleteAnimationConfig(req.params.name);

    console.log(`✓ Deleted config: ${req.params.name}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

// ─── Animation System ───────────────────────────────────────────────

// SSE clients for animation overlay
let animationClients = [];

// SSE endpoint for animation overlay
app.get('/overlay/animations/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const clientId = Date.now();
  const userAgent = String(req.headers['user-agent'] || '');
  const clientKind = userAgent.toLowerCase().includes('obs') ? 'obs' : 'browser';
  const newClient = { id: clientId, res, userAgent, kind: clientKind };
  animationClients.push(newClient);

  console.log(`✓ Animation overlay connected (${animationClients.length} total, kind=${clientKind})`);

  res.write('data: {"type":"connected"}\n\n');

  req.on('close', () => {
    animationClients = animationClients.filter(client => client.id !== clientId);
    console.log(`✗ Animation overlay disconnected (${animationClients.length} remaining, kind=${clientKind})`);
  });
});

// Trigger animation endpoint
app.post('/api/animations/trigger', (req, res) => {
  const { type, trigger, platform, author } = req.body;

  console.log(`🎬 Animation trigger: ${trigger} (${type}) from ${author || 'unknown'} on ${platform || 'unknown'}`);

  // Broadcast to all connected animation overlays
  const event = {
    type: 'animation',
    trigger: trigger,
    platform: platform || 'unknown',
    author: author || 'unknown',
    timestamp: Date.now()
  };

  const eventData = `data: ${JSON.stringify(event)}\n\n`;

  animationClients.forEach(client => {
    try {
      client.res.write(eventData);
    } catch (err) {
      console.error('Error sending to animation client:', err);
    }
  });

  res.json({ success: true, clients: animationClients.length });
});

// Stop active animations endpoint
app.post('/api/animations/stop', (req, res) => {
  const { source, reason } = req.body || {};
  console.log(`⏹️ Animation stop requested (${reason || 'manual'}) from ${source || 'unknown'}`);

  const event = {
    type: 'stop',
    source: source || 'unknown',
    reason: reason || 'manual-stop',
    timestamp: Date.now()
  };

  const eventData = `data: ${JSON.stringify(event)}\n\n`;
  animationClients.forEach(client => {
    try {
      client.res.write(eventData);
    } catch (err) {
      console.error('Error sending stop to animation client:', err);
    }
  });

  const obsClients = animationClients.filter(client => client.kind === 'obs').length;
  const browserClients = animationClients.length - obsClients;
  res.json({
    success: true,
    clients: animationClients.length,
    obsClients,
    browserClients
  });
});

const ALLOWED_ANIMATION_EXTENSIONS = new Set(['.mov', '.mp4', '.webm', '.avi']);

function getAnimationsDir() {
  return path.join(__dirname, 'animations');
}

function ensureAnimationsDir() {
  const animationsDir = getAnimationsDir();
  if (!fs.existsSync(animationsDir)) {
    fs.mkdirSync(animationsDir, { recursive: true });
  }
  return animationsDir;
}

function sanitizeFileBaseName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'animation';
}

function buildUniqueFilename(dir, baseName, ext) {
  let counter = 0;
  let candidate = `${baseName}${ext}`;
  while (fs.existsSync(path.join(dir, candidate))) {
    counter += 1;
    candidate = `${baseName}-${counter}${ext}`;
  }
  return candidate;
}

const animationUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ensureAnimationsDir()),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_ANIMATION_EXTENSIONS.has(ext) ? ext : '.mov';
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safeExt}`);
  }
});

const animationUpload = multer({
  storage: animationUploadStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_ANIMATION_EXTENSIONS.has(ext)) {
      cb(new Error('Only video files (.mov, .mp4, .webm, .avi) are allowed'));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB
});

app.post('/api/animations/upload', (req, res) => {
  animationUpload.single('animation')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
      const animationsDir = ensureAnimationsDir();
      const ext = path.extname(req.file.filename).toLowerCase();
      const requestedName = String(req.body?.name || '').trim();
      const originalBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
      const baseName = sanitizeFileBaseName(requestedName || originalBase);
      const finalFilename = buildUniqueFilename(animationsDir, baseName, ext);
      const finalPath = path.join(animationsDir, finalFilename);

      fs.renameSync(req.file.path, finalPath);

      res.json({
        success: true,
        filename: finalFilename,
        name: path.basename(finalFilename, ext),
        path: `/animations/${finalFilename}`
      });
    } catch (err) {
      try {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.error('Animation upload cleanup error:', cleanupErr);
      }
      console.error('Animation upload error:', err);
      res.status(500).json({ error: 'Failed to save uploaded animation' });
    }
  });
});

app.delete('/api/animations/file/:filename', (req, res) => {
  try {
    const animationsDir = ensureAnimationsDir();
    const filename = path.basename(String(req.params.filename || ''));
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_ANIMATION_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: 'Invalid animation file type' });
    }

    const filePath = path.join(animationsDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Animation file not found' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Animation delete error:', err);
    res.status(500).json({ error: 'Failed to delete animation file' });
  }
});

// List available animation files
app.get('/api/animations/list', (req, res) => {
  const animationsDir = ensureAnimationsDir();

  try {
    const files = fs.readdirSync(animationsDir)
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ALLOWED_ANIMATION_EXTENSIONS.has(ext);
      })
      .map(filename => ({
        filename: filename,
        name: filename.replace(/\.(mov|mp4|webm|avi)$/i, ''),
        path: `/animations/${filename}`
      }));

    res.json({ animations: files });
  } catch (err) {
    console.error('Error listing animations:', err);
    res.status(500).json({ error: 'Failed to list animations' });
  }
});

// Serve animation files
app.use('/animations', express.static(path.join(__dirname, 'animations')));

// Serve animation overlay
app.get('/overlay/animations', (req, res) => {
  res.sendFile(path.join(__dirname, 'overlays', 'animations.html'));
});

// ─── END ANIMATION OVERLAY ──────────────────────────────────────────

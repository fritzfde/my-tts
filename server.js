const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

const { WebcastPushConnection } = require('tiktok-live-connector');

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

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

// Proxy endpoint for ElevenLabs TTS
app.post('/api/elevenlabs/tts', async (req, res) => {
  try {
    const { text, voice_id, api_key } = req.body;

    if (!api_key) {
      return res.status(400).json({ error: 'ElevenLabs API key required' });
    }

    console.log('Generating TTS with ElevenLabs...');

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': api_key
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);

  } catch (error) {
    console.error('ElevenLabs error:', error);
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

    console.log('📡 Forwarding request to Python TTS server (127.0.0.1:5000)...');

    const pythonResponse = await fetch('http://127.0.0.1:5000/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice: voiceFile,
        text: text,
        language: req.body.language || 'en'
      }),
      signal: AbortSignal.timeout(60000)
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
        solution: 'Is tts_server.py running on port 5000?'
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
let giftOverlayClients = [];
let likerLeaderboard = new Map(); // username → like count
let likerUserInfo = new Map(); // username → { nickname, avatar }
let likerLeaderboardClients = [];
let animationOverlayClients = []; // SSE clients for animation overlay

app.post('/api/tiktok/connect', (req, res) => {
    const { username } = req.body;

    if (tiktokConnection) {
        tiktokConnection.removeAllListeners();
        tiktokConnection.disconnect();
    }

    // Reset leaderboard on new connection
    likerLeaderboard.clear();

    tiktokConnection = new WebcastPushConnection(username);

    tiktokConnection.connect().then(state => {
        console.log(`✅ SUCCESS: Connected to @${username}`);
        res.json({ success: true });
    }).catch(err => {
        console.error(`❌ FAILURE:`, err.message);
        res.status(500).json({ error: err.message });
    });

    // Capture Chat
    tiktokConnection.on('chat', data => {
        const msg = {
            type: 'chat',
            author: data.uniqueId,
            authorName: data.nickname || data.uniqueId,
            authorAvatar: data.profilePictureUrl || null,
            text: data.comment
        };
        console.log(`💬 [Chat] ${msg.authorName} (@${msg.author}): ${msg.text}`);
        tiktokMessageQueue.push(msg);
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
        console.log(`🎁 [Gift] ${msg.authorName} (@${msg.author}): ${msg.giftName} x${count} (${diamonds} diamonds)`);
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

        // Broadcast to animation overlay
        broadcastToAnimationOverlay({
            type: 'emote',
            platform: 'tiktok',
            trigger: msg.emoteName,
            emoteId: msg.emoteId,
            author: msg.authorName
        });
    });

    // Capture Likes
    tiktokConnection.on('like', data => {
        const author = data.uniqueId;
        const count = data.likeCount || 1;

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
const soundStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const soundsDir = path.join(__dirname, 'sounds', 'custom');
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

const upload = multer({
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

app.post('/api/sounds/upload', upload.single('sound'), (req, res) => {
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
    const customDir = path.join(soundsDir, 'custom');

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

// ─── ANIMATION OVERLAY ENDPOINTS ────────────────────────────────────

// SSE endpoint for animation overlay
app.get('/overlay/animations/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    animationOverlayClients.push(res);
    console.log(`🎬 Animation overlay client connected (${animationOverlayClients.length} total)`);

    req.on('close', () => {
        const index = animationOverlayClients.indexOf(res);
        if (index > -1) {
            animationOverlayClients.splice(index, 1);
            console.log(`🎬 Animation overlay client disconnected (${animationOverlayClients.length} remaining)`);
        }
    });
});

// Serve animation overlay HTML
app.get('/overlay/animations', (req, res) => {
    res.sendFile(path.join(__dirname, 'overlays', 'animations.html'));
});

// Get available animation files
app.get('/api/animations/list', (req, res) => {
    const animationsDir = path.join(__dirname, 'animations');

    if (!fs.existsSync(animationsDir)) {
        fs.mkdirSync(animationsDir, { recursive: true });
    }

    const files = fs.readdirSync(animationsDir).filter(f =>
        f.match(/\.(mov|mp4|webm)$/i)
    );

    res.json({
        animations: files.map(f => ({
            name: f.replace(/\.(mov|mp4|webm)$/i, ''),
            filename: f,
            path: `/animations/${f}`
        }))
    });
});

// Serve animation files
app.use('/animations', express.static(path.join(__dirname, 'animations')));

// Broadcast animation event to all connected overlay clients
function broadcastToAnimationOverlay(data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;

    animationOverlayClients.forEach(client => {
        try {
            client.write(payload);
        } catch (err) {
            console.error('Animation overlay broadcast error:', err);
        }
    });
}

// API endpoint to manually trigger animations (for testing)
app.post('/api/animations/trigger', (req, res) => {
    const { type, trigger, platform } = req.body;

    broadcastToAnimationOverlay({
        type: type || 'manual',
        platform: platform || 'test',
        trigger: trigger,
        author: 'Manual Trigger'
    });

    res.json({ success: true, message: `Triggered animation: ${trigger}` });
});

// ─── END ANIMATION OVERLAY ──────────────────────────────────────────

// --- TIKTOK LOGIC END ---


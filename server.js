const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

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
        text: text
      }),
      // Set a long timeout for TTS generation (XTTS can take a few seconds)
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


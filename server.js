const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { exec } = require('child_process');
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

    // Stream the audio response
    res.setHeader('Content-Type', 'audio/mpeg');
    response.body.pipe(res);

  } catch (error) {
    console.error('ElevenLabs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Local voice cloning endpoint - ALEX'S SETUP
app.post('/api/voice-clone/tts', async (req, res) => {
  try {
    const { text, voice_name } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (!voice_name) {
      return res.status(400).json({ error: 'Voice name is required' });
    }

    console.log(`\n🎙️ Voice Clone Request:`);
    console.log(`   Voice: ${voice_name}`);
    console.log(`   Text: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);

    // ALEX'S EXACT PATHS
    const PYTHON_VENV = '/Users/alex/Projects/voice-clone/myenv/bin/python3';
    const PYTHON_SCRIPT = '/Users/alex/Projects/voice-clone/tts_cli.py';
    const VOICE_DIR = path.join(__dirname, 'custom-voices');  // Changed to custom-voices

    const voiceFile = path.join(VOICE_DIR, `${voice_name}.wav`);
    const outputFile = path.join(__dirname, 'temp', `output_${Date.now()}.wav`);

    // Validate paths exist
    if (!fs.existsSync(PYTHON_VENV)) {
      console.error('❌ Python venv not found:', PYTHON_VENV);
      return res.status(500).json({
        error: 'Python environment not found',
        path: PYTHON_VENV,
        solution: 'Check that your Python virtual environment exists'
      });
    }

    if (!fs.existsSync(PYTHON_SCRIPT)) {
      console.error('❌ Python script not found:', PYTHON_SCRIPT);
      return res.status(500).json({
        error: 'Python script not found',
        path: PYTHON_SCRIPT,
        solution: 'Create tts_cli.py in your voice-clone folder'
      });
    }

    if (!fs.existsSync(voiceFile)) {
      console.error('❌ Voice file not found:', voiceFile);
      return res.status(404).json({
        error: `Voice file not found: ${voice_name}.wav`,
        path: voiceFile,
        solution: `Copy a voice WAV file to: ${VOICE_DIR}/${voice_name}.wav`
      });
    }

    // Create temp directory if needed
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
      console.log('📁 Created temp directory');
    }

    // Build command
    const command = `"${PYTHON_VENV}" "${PYTHON_SCRIPT}" --voice "${voiceFile}" --text "${text.replace(/"/g, '\\"')}" --output "${outputFile}"`;

    console.log(`🚀 Executing Python...`);

    // Execute with 60 second timeout (first run takes longer)
    exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Python execution failed:', error.message);
        if (stderr) console.error('   stderr:', stderr);
        return res.status(500).json({
          error: 'Python execution failed',
          details: error.message,
          stderr: stderr,
          command: command
        });
      }

      // Log Python output
      if (stdout) console.log('   stdout:', stdout.trim());
      if (stderr) console.log('   stderr:', stderr.trim());

      // Verify output file was created
      if (!fs.existsSync(outputFile)) {
        console.error('❌ Output file not created:', outputFile);
        return res.status(500).json({
          error: 'Audio file was not generated',
          path: outputFile
        });
      }

      const fileSize = fs.statSync(outputFile).size;
      console.log(`✅ Audio generated (${(fileSize / 1024).toFixed(1)} KB)`);

      // Send the audio file
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Length', fileSize);

      const fileStream = fs.createReadStream(outputFile);

      // Handle stream errors
      fileStream.on('error', (err) => {
        console.error('❌ File stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream audio file' });
        }
      });

      fileStream.pipe(res);

      // Clean up after sending
      res.on('finish', () => {
        // Delete temp file after response is sent
        setTimeout(() => {
          fs.unlink(outputFile, (err) => {
            if (err) {
              console.error('⚠️ Failed to delete temp file:', err.message);
            } else {
              console.log('🧹 Cleaned up temp file\n');
            }
          });
        }, 1000); // Wait 1 second to ensure file was fully sent
      });
    });

  } catch (error) {
    console.error('❌ Voice clone error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get available cloned voices
app.get('/api/voice-clone/voices', (req, res) => {
  try {
    const voicesDir = path.join(__dirname, 'custom-voices');  // Changed to custom-voices

    if (!fs.existsSync(voicesDir)) {
      console.log('No custom-voices directory found, creating...');
      fs.mkdirSync(voicesDir);
      return res.json({ voices: [] });
    }

    const files = fs.readdirSync(voicesDir);
    const voices = files
      .filter(file => file.endsWith('.wav'))
      .map(file => file.replace('.wav', ''));

    console.log(`📋 Available voices: ${voices.join(', ') || 'none'}`);
    res.json({ voices });
  } catch (error) {
    console.error('Error reading voices:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('\n🚀 YouTube TTS Server Started!');
  console.log(`📺 Open: http://localhost:${PORT}/yt-chat-tts.html`);
  console.log(`🎙️ Voice cloning: ENABLED`);
  console.log(`📁 Python app: /Users/alex/Projects/voice-clone/`);
  console.log(`📁 Custom voices: ${path.join(__dirname, 'custom-voices')}`);
  console.log('');
});
# 🎙️ YouTube Voice Clone & TTS

A sophisticated AI pipeline that allows you to clone voices from short audio clips and use them to speak text extracted from YouTube or custom input. It uses a Node.js frontend and a Python (XTTS v2) inference engine.

## 📁 Project Structure
* server.js: Node.js Express server (UI & API Proxy).
* tts_server.py: Python Flask server (Keeps the AI model loaded in RAM).
* record.py: CLI utility for recording high-quality voice samples.
* /voices: Directory where your .wav voice clones are stored.

---

## 🛠️ Installation

### 1. Python Inference Engine
# Navigate to project root
cd /Users/alex/Projects/voice-clone

# Create and activate virtual environment
python3 -m venv myenv
source myenv/bin/activate

# Install dependencies
pip install Flask coqui-tts sounddevice soundfile numpy

### 2. Node.js Orchestrator
# Install Express and CORS
npm install express cors

---

## 🎤 Creating Custom Voices (record.py)

To add a new voice, you must provide a high-quality audio sample.

### Usage via CLI
1. Start Recording:
   Run: python record.py
2. Stop Recording:
   Action: Press the [ENTER] key on your keyboard as soon as you are finished speaking.

### 💡 The "Pro-Tip" for Perfect Cloning
For the best results, read a phonetically balanced sentence. This ensures the AI learns all the nuances of your speech.

Read this text clearly:
"The quick brown fox jumps over the lazy dog, while the calm wind blows through the trees. Are those shy boxes of spinach ready for the next stage?"

* Optimal length: 6–12 seconds.
* Environment: Quiet room, no background noise, minimal echo.

### Adding the Voice to the App
Rename your output and move it to the voices folder:
mv voice.wav voices/your_name.wav

---

## 🚀 Running the App

You must run both servers in separate terminal windows.

### Terminal 1: Python TTS Server
source myenv/bin/activate
python tts_server.py
*Wait until the terminal says: ✅ Model loaded and ready!*

### Terminal 2: Node.js Server
npm start

Access the UI: http://localhost:3000

---

## 💻 CLI TTS Usage (Direct)

If you want to generate speech directly from terminal (without starting Node/Flask servers), use `tts.py`.

```bash
# From project root
source myenv/bin/activate
python tts.py \
  --voice voices/your_name.wav \
  --text "Hello, this is a voice clone test." \
  --output output.wav
```

### Arguments
* `--voice`: Path to the reference `.wav` file (speaker voice sample).
* `--text`: Text you want synthesized.
* `--output`: Output `.wav` path.

### Example
```bash
python tts.py --voice voices/alex.wav --text "Welcome to my cloned voice demo." --output demo.wav
```

---

## ⚙️ Performance Notes
* Hardware: On M1/M2/M3 Macs, generation takes ~5-15 seconds depending on text length.
* Reference Audio: Files between 6-10 seconds are ideal. Clips over 15 seconds increase processing time without improving quality.

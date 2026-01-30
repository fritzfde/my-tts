# YouTube Live Chat Text-to-Speech Reader

A modern web application that reads YouTube live stream chat messages aloud using text-to-speech with AI voice options.

## ✨ Features

- 🎯 **Real YouTube Live Chat Integration** - Reads actual chat messages from your streams
- 🎭 **AI Voice Characters** - Elon Musk and Donald Trump voices (requires ElevenLabs API)
- 💾 **Auto-Save Settings** - API keys and channel URL saved automatically
- 🔍 **Auto-Detect Streams** - Automatically find your current live stream
- 🎨 **Modern Dark UI** - Sleek, intuitive interface
- ⚙️ **Customizable** - Filter usernames, emojis, and links
- 🎤 **Multiple Voices** - Choose from system voices or AI voices

## Setup Instructions

### 1. Install Node.js
Download from: https://nodejs.org/

### 2. Install Dependencies
Open a terminal in this folder and run:
```bash
npm install
```

### 3. Get YouTube API Key
1. Go to: https://console.cloud.google.com/apis/credentials
2. Create a new project (or select an existing one)
3. Click "Enable APIs and Services"
4. Search for "YouTube Data API v3" and enable it
5. Go to "Credentials" → "Create Credentials" → "API Key"
6. Copy your API key

**Important**: Configure your API key:
- Go to "Credentials" in Google Cloud Console
- Click on your API key
- Under "API restrictions", select "Restrict key"
- Enable only "YouTube Data API v3"

### 4. Get ElevenLabs API Key (Optional - for Real AI Voices)
1. Go to: https://elevenlabs.io/
2. Sign up for a free account
3. Go to your profile → API Keys
4. Copy your API key
5. Note: Free tier includes 10,000 characters/month

### 5. Start the Server
```bash
npm start
```

The server will start at: http://localhost:3000

### 6. Open the App
Open your browser and go to: http://localhost:3000/index.html

## How to Use

### First Time Setup:
1. **Enter Your YouTube API Key** - It will be saved automatically
2. **Enter Your Channel URL** - Format: `https://www.youtube.com/@YourChannel`
3. **(Optional) Enter ElevenLabs API Key** - For realistic AI voices

### Finding Your Live Stream:
1. Click **"🔍 Find My Live Stream"** button
2. The app will automatically detect your current live stream
3. The stream URL will be filled in automatically

### Manual Mode:
You can also manually paste any YouTube live stream URL

### Start Reading:
1. Select your preferred voice (system or AI character)
2. Adjust speech rate, pitch, and volume if desired
3. Choose what to read (usernames, emojis, links)
4. Click **"▶ Start Reading Chat"**

## Reading Options

- ☐ **Read usernames** - When unchecked (default), only reads the message text
- ☐ **Read emojis** - When unchecked (default), filters out emoji characters  
- ☐ **Read links** - When unchecked (default), removes URLs from messages

## Voice Options

### System Voices
Standard text-to-speech voices from your operating system

### AI Character Voices
- **🎭 Elon Musk** - Requires ElevenLabs API key for realistic voice
- **🎭 Donald Trump** - Requires ElevenLabs API key for realistic voice

Without ElevenLabs API key, these use simulated voices with modified pitch/rate.

## Troubleshooting

### "Failed to fetch" error
- Make sure the Node.js server is running (`npm start`)
- Check that you're accessing http://localhost:3000/index.html

### "No live streams found"
- Make sure you have an active live stream running on your channel
- The stream must be **currently live** (not scheduled or ended)
- Check that your channel URL is correct

### "API Error: 403" or "quotaExceeded"
- You've exceeded your daily API quota (10,000 units/day for free tier)
- Wait 24 hours or upgrade your quota in Google Cloud Console

### "API Error: 400" or "Invalid API key"
- Double-check your API key is correct
- Ensure YouTube Data API v3 is enabled in Google Cloud Console
- Check that your API key restrictions allow YouTube Data API v3

### AI Voices Don't Sound Right
- **Without ElevenLabs**: Uses simulated voices (modified system TTS)
- **With ElevenLabs**: Uses realistic AI voice cloning
- Note: The default ElevenLabs voice IDs are placeholders. For best results:
  1. Create custom voices in ElevenLabs dashboard
  2. Update the voice IDs in the code

## API Usage

### YouTube API Quota
Each operation uses approximately:
- 1 unit for video details (one-time)
- 5 units per chat message request
- Free tier: 10,000 units/day (~2,000 chat requests)

### ElevenLabs Quota (Optional)
- Free tier: 10,000 characters/month
- Each chat message counts toward this limit
- Consider using system voices for high-volume streams

## Privacy & Security

- API keys are stored in browser localStorage (not transmitted)
- Your data never leaves your computer except for API calls
- The proxy server only forwards requests to YouTube/ElevenLabs APIs

## Tips for Best Experience

1. **Use AI voices sparingly** - They consume ElevenLabs quota quickly
2. **Filter content** - Uncheck emojis/links for cleaner speech
3. **Adjust speech rate** - Faster rates work better for busy chats
4. **Save your settings** - They persist between sessions

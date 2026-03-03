// ElevenLabs Voice Configuration
// Update these Voice IDs after you've added voices to your ElevenLabs account

const ELEVENLABS_CONFIG = {
  // How to get Voice IDs:
  // 1. Go to elevenlabs.io and log in
  // 2. Click "Voices" in the left sidebar
  // 3. Click on a voice you want to use
  // 4. Copy the "Voice ID" shown in the voice details
  
  voices: {
    // Replace these with your actual Voice IDs from ElevenLabs
    'elon': 'PASTE_YOUR_ELON_VOICE_ID_HERE',
    'trump': 'PASTE_YOUR_TRUMP_VOICE_ID_HERE'
    
    // Examples of pre-made voices you can find in Voice Library:
    // 'elon': 'pNInz6obpgDQGcFmaJgB',  // Adam (deep male voice)
    // 'trump': 'VR6AewLTigWG4xSOukaG',  // Antoni (confident male)
  },
  
  // Voice settings (adjust as needed)
  settings: {
    stability: 0.5,        // 0-1: Lower = more variable, Higher = more stable
    similarity_boost: 0.75, // 0-1: How closely to match the original voice
    style: 0.5,            // 0-1: Exaggeration of the voice style
    use_speaker_boost: true // Enhances clarity
  }
};

// Export for use in the app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ELEVENLABS_CONFIG;
}

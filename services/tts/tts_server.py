#!/usr/bin/env python3
"""
Persistent TTS server - keeps model loaded in memory
Much faster than loading model for each request!
"""

import sys
import json
from flask import Flask, request, send_file
from TTS.api import TTS
import os
import tempfile
import argparse

app = Flask(__name__)

# Load model once at startup (this takes ~5-10 seconds)
print("🔄 Loading XTTS v2 model (one-time setup)...", file=sys.stderr)
tts = TTS(
    model_name="tts_models/multilingual/multi-dataset/xtts_v2",
    gpu=False  # M1 Mac uses CPU
)
print("✅ Model loaded and ready!", file=sys.stderr)


@app.route('/tts', methods=['POST'])
def generate_speech():
    """Generate speech from JSON request"""
    try:
        data = request.get_json()
        voice_file = data.get('voice')
        text = data.get('text')

        if not voice_file or not text:
            return {'error': 'Missing voice_file or text'}, 400

        if not os.path.exists(voice_file):
            return {'error': f'Voice file not found: {voice_file}'}, 404

        # Create temp output file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
        output_path = temp_file.name
        temp_file.close()

        print(f"🎙️ Generating: '{text[:50]}...'", file=sys.stderr)

        # Generate speech (model already loaded - FAST!)
        tts.tts_to_file(
            text=text,
            speaker_wav=voice_file,
            language="en",
            file_path=output_path
        )

        print(f"✅ Generated in <1 second!", file=sys.stderr)

        # Send the file
        response = send_file(
            output_path,
            mimetype='audio/wav',
            as_attachment=False
        )

        # Clean up temp file after sending
        @response.call_on_close
        def cleanup():
            try:
                os.unlink(output_path)
            except:
                pass

        return response

    except Exception as e:
        import traceback
        print(f"❌ Error: {str(e)}", file=sys.stderr)
        traceback.print_exc()
        return {'error': str(e)}, 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return {'status': 'ready', 'model': 'xtts_v2'}


def cli_mode():
    parser = argparse.ArgumentParser(description="XTTS Voice Test")
    parser.add_argument("--voice", type=str, help="Path to voice wav file")
    parser.add_argument("--text", type=str, help="Text to synthesize")

    args, _ = parser.parse_known_args()

    if not args.voice or not args.text:
        return False  # Not CLI mode

    print("🎙️ CLI TTS MODE", file=sys.stderr)
    print(f"   Voice: {args.voice}", file=sys.stderr)
    print(f"   Text : {args.text}", file=sys.stderr)

    if not os.path.exists(args.voice):
        print("❌ Voice file not found", file=sys.stderr)
        sys.exit(1)

    output_path = "output.wav"

    tts.tts_to_file(
        text=args.text,
        speaker_wav=args.voice,
        language="en",
        file_path=output_path
    )

    print(f"✅ Saved to {output_path}", file=sys.stderr)
    sys.exit(0)


if __name__ == '__main__':
    # 1. Check if we should run in CLI mode first
    # We call the function and check if it handled the request
    is_cli = cli_mode()

    # 2. If cli_mode returned False (no args provided), start the server
    if not is_cli:
        print("\n🚀 No CLI arguments detected. Starting TTS Server...", file=sys.stderr)
        print("📡 Server: http://localhost:5000", file=sys.stderr)
        app.run(host='127.0.0.1', port=5000, debug=False)

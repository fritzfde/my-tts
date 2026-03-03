#!/usr/bin/env python3
"""
CLI wrapper for voice cloning TTS
Compatible with Node.js server calls
"""

import argparse
import sys
from TTS.api import TTS

def generate_speech(voice_file, text, output_file):
    """Generate speech using voice cloning"""
    try:
        print(f"Loading XTTS v2 model...", file=sys.stderr)

        # Initialize TTS (same as your tts.py)
        tts = TTS(
            model_name="tts_models/multilingual/multi-dataset/xtts_v2",
            gpu=False  # M1 Mac will use CPU, still fast!
        )

        print(f"Generating speech: '{text[:50]}...'", file=sys.stderr)

        # Generate speech (same as your tts.py)
        tts.tts_to_file(
            text=text,
            speaker_wav=voice_file,
            language="en",
            file_path=output_file
        )

        print(f"✅ Generated: {output_file}", file=sys.stderr)
        return True

    except Exception as e:
        print(f"❌ Error: {str(e)}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description='Generate speech using voice cloning')
    parser.add_argument('--voice', required=True, help='Path to reference voice WAV file')
    parser.add_argument('--text', required=True, help='Text to synthesize')
    parser.add_argument('--output', required=True, help='Output WAV file path')

    args = parser.parse_args()

    success = generate_speech(args.voice, args.text, args.output)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
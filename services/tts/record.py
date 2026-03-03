import sounddevice as sd
import soundfile as sf
import numpy as np
import sys

# Standard sampling rate for high-quality audio
SAMPLE_RATE = 44100

def record_manually():
    print("-" * 30)
    print("🎙️  RECORDING STARTED")
    print("👉 Speak clearly into your microphone.")
    print("👉 Press [ENTER] when you are finished.")
    print("-" * 30)

    recorded_chunks = []

    # The callback function receives audio data from the mic in real-time
    def callback(indata, frames, time, status):
        if status:
            print(status, file=sys.stderr)
        recorded_chunks.append(indata.copy())

    try:
        # InputStream keeps the mic active without a fixed end time
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, callback=callback):
            input("")  # This pauses the script until you hit Enter

        # Combine all small chunks into one final recording
        audio_data = np.concatenate(recorded_chunks, axis=0)

        # Save to file
        output_file = "voice.wav"
        sf.write(output_file, audio_data, SAMPLE_RATE)

        duration = len(audio_data) / SAMPLE_RATE
        print(f"\n✅ Saved to: {output_file}")
        print(f"📏 Total Length: {duration:.2f} seconds")
        print("💡 Tip: Rename this file and move it to your 'voices/' folder.")

    except Exception as e:
        print(f"\n❌ An error occurred: {e}")

if __name__ == "__main__":
    record_manually()
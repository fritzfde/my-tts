import json
import logging
import os
import tempfile
import time
import wave
import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

LOGGER = logging.getLogger("mic-asr")
logging.basicConfig(level=logging.INFO)
logging.getLogger("faster_whisper").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

app = FastAPI(title="Mic ASR Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_WHISPER_MODEL = None
_WHISPER_MODEL_NAME = None
VOICE_PROFILE_VERSION = 2


def as_bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def as_float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return float(default)
    try:
        return float(value)
    except Exception:
        return float(default)


def as_int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return int(default)
    try:
        return int(value)
    except Exception:
        return int(default)


def pcm16_to_float32(pcm16_bytes: bytes) -> np.ndarray:
    if not pcm16_bytes:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(pcm16_bytes, dtype="<i2").astype(np.float32) / 32768.0


def normalize_voice_signal(signal: np.ndarray) -> np.ndarray:
    if signal.size == 0:
        return signal
    normalized = signal.astype(np.float32, copy=True)
    normalized -= np.mean(normalized)
    peak = float(np.max(np.abs(normalized))) if normalized.size else 0.0
    if peak > 1e-5:
        normalized /= peak
    rms = float(np.sqrt(np.mean(np.square(normalized)) + 1e-10))
    if rms > 1e-5:
        normalized *= min(3.0, 0.12 / rms)
    np.clip(normalized, -1.0, 1.0, out=normalized)
    return normalized


def hz_to_mel(hz: np.ndarray | float) -> np.ndarray | float:
    return 2595.0 * np.log10(1.0 + (np.asarray(hz) / 700.0))


def mel_to_hz(mel: np.ndarray | float) -> np.ndarray | float:
    return 700.0 * (np.power(10.0, np.asarray(mel) / 2595.0) - 1.0)


@lru_cache(maxsize=32)
def get_mel_filterbank(sample_rate: int, n_fft: int, n_mels: int = 20, fmin: int = 80, fmax: int = 7600) -> np.ndarray:
    freq_bins = np.floor((n_fft + 1) * mel_to_hz(np.linspace(hz_to_mel(fmin), hz_to_mel(min(fmax, sample_rate // 2)), n_mels + 2)) / sample_rate).astype(int)
    filterbank = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for index in range(1, n_mels + 1):
        left = max(0, int(freq_bins[index - 1]))
        center = max(left + 1, int(freq_bins[index]))
        right = max(center + 1, int(freq_bins[index + 1]))
        for bucket in range(left, min(center, filterbank.shape[1])):
            filterbank[index - 1, bucket] = (bucket - left) / max(1, center - left)
        for bucket in range(center, min(right, filterbank.shape[1])):
            filterbank[index - 1, bucket] = (right - bucket) / max(1, right - center)
    return filterbank


@lru_cache(maxsize=32)
def get_dct_basis(n_input: int, n_coeffs: int) -> np.ndarray:
    basis = np.zeros((n_coeffs, n_input), dtype=np.float32)
    for coeff in range(n_coeffs):
        for index in range(n_input):
            basis[coeff, index] = math.cos((math.pi / n_input) * (index + 0.5) * coeff)
    return basis


def frame_audio(signal: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    if signal.size < frame_length:
        return np.empty((0, frame_length), dtype=np.float32)
    frame_count = 1 + max(0, (signal.size - frame_length) // hop_length)
    shape = (frame_count, frame_length)
    strides = (signal.strides[0] * hop_length, signal.strides[0])
    return np.lib.stride_tricks.as_strided(signal, shape=shape, strides=strides, writeable=False).copy()


def create_voice_feature_vector(pcm16_bytes: bytes, sample_rate: int = 16000) -> tuple[np.ndarray | None, int]:
    signal = normalize_voice_signal(pcm16_to_float32(pcm16_bytes))
    if signal.size < sample_rate:
        return None, 0

    frame_length = int(sample_rate * 0.025)
    hop_length = int(sample_rate * 0.010)
    frames = frame_audio(signal, frame_length, hop_length)
    if frames.size == 0:
        return None, 0

    rms = np.sqrt(np.mean(np.square(frames), axis=1) + 1e-10)
    zcr = np.mean(np.abs(np.diff(np.signbit(frames), axis=1)), axis=1).astype(np.float32)
    energy_floor = max(0.008, float(np.median(rms)) * 0.65)
    voiced_mask = rms >= energy_floor
    voiced_frames = frames[voiced_mask]
    voiced_rms = rms[voiced_mask]
    voiced_zcr = zcr[voiced_mask]

    if voiced_frames.shape[0] < 8:
        top_count = min(max(8, voiced_frames.shape[0]), frames.shape[0])
        top_indexes = np.argsort(rms)[-top_count:]
        voiced_frames = frames[top_indexes]
        voiced_rms = rms[top_indexes]
        voiced_zcr = zcr[top_indexes]

    if voiced_frames.shape[0] == 0:
        return None, 0

    emphasized = voiced_frames.copy()
    emphasized[:, 1:] = emphasized[:, 1:] - 0.97 * emphasized[:, :-1]
    window = np.hamming(frame_length).astype(np.float32)
    n_fft = 512
    spectrum = np.abs(np.fft.rfft(emphasized * window, n=n_fft, axis=1))
    power = np.square(spectrum).astype(np.float32)

    mel_bank = get_mel_filterbank(sample_rate, n_fft)
    mel_energy = np.maximum(power @ mel_bank.T, 1e-10)
    log_mel = np.log(mel_energy)
    dct_basis = get_dct_basis(log_mel.shape[1], 13)
    mfcc = log_mel @ dct_basis.T

    freqs = np.fft.rfftfreq(n_fft, d=1.0 / sample_rate).astype(np.float32)
    power_sum = np.maximum(np.sum(power, axis=1), 1e-10)
    spectral_centroid = np.sum(power * freqs[None, :], axis=1) / power_sum
    spectral_centroid /= max(1.0, sample_rate / 2.0)
    cumulative = np.cumsum(power, axis=1)
    rolloff_target = power_sum * 0.85
    spectral_rolloff = freqs[np.argmax(cumulative >= rolloff_target[:, None], axis=1)]
    spectral_rolloff /= max(1.0, sample_rate / 2.0)

    feature_vector = np.concatenate(
        [
            np.mean(mfcc, axis=0),
            np.std(mfcc, axis=0),
            np.array(
                [
                    float(np.mean(voiced_zcr)),
                    float(np.std(voiced_zcr)),
                    float(np.mean(spectral_centroid)),
                    float(np.std(spectral_centroid)),
                    float(np.mean(spectral_rolloff)),
                    float(np.std(spectral_rolloff)),
                ],
                dtype=np.float32,
            ),
        ]
    ).astype(np.float32)

    return feature_vector, int(voiced_frames.shape[0])


def build_voice_profile(pcm16_bytes: bytes, sample_rate: int = 16000) -> dict:
    feature_vector, frame_count = create_voice_feature_vector(pcm16_bytes, sample_rate=sample_rate)
    if feature_vector is None or frame_count < 8:
        raise ValueError("Not enough voiced audio. Speak clearly for a few seconds and try again.")
    return {
        "version": VOICE_PROFILE_VERSION,
        "sample_rate": int(sample_rate),
        "frame_count": int(frame_count),
        "vector": [round(float(value), 6) for value in feature_vector.tolist()],
    }


def normalize_voice_profile(profile: dict | None) -> dict | None:
    if not isinstance(profile, dict):
        return None
    try:
        version = int(profile.get("version") or 1)
    except Exception:
        return None
    if version != VOICE_PROFILE_VERSION:
        return None
    vector = profile.get("vector")
    if not isinstance(vector, list) or not vector:
        return None
    normalized = []
    for value in vector:
        try:
            normalized.append(float(value))
        except Exception:
            return None
    return {
        "version": version,
        "sample_rate": int(profile.get("sample_rate") or 16000),
        "frame_count": int(profile.get("frame_count") or 0),
        "vector": normalized,
    }


def score_voice_profile(profile: dict | None, pcm16_bytes: bytes, sample_rate: int = 16000) -> tuple[float, int]:
    normalized = normalize_voice_profile(profile)
    if not normalized:
        return 0.0, 0

    candidate_vector, frame_count = create_voice_feature_vector(pcm16_bytes, sample_rate=sample_rate)
    if candidate_vector is None or frame_count < 4:
        return 0.0, frame_count

    reference_vector = np.asarray(normalized["vector"], dtype=np.float32)
    if reference_vector.shape != candidate_vector.shape:
        return 0.0, frame_count

    cosine_denominator = float(np.linalg.norm(reference_vector) * np.linalg.norm(candidate_vector))
    cosine_similarity = float(np.dot(reference_vector, candidate_vector) / cosine_denominator) if cosine_denominator > 0 else 0.0
    cosine_score = max(0.0, min(1.0, (cosine_similarity + 1.0) / 2.0))

    mean_abs_delta = float(np.mean(np.abs(reference_vector - candidate_vector)))
    distance_score = max(0.0, min(1.0, math.exp(-3.75 * mean_abs_delta)))

    score = (0.7 * cosine_score) + (0.3 * distance_score)
    return max(0.0, min(1.0, score)), frame_count


def get_whisper_model():
    global _WHISPER_MODEL, _WHISPER_MODEL_NAME
    model_name = os.getenv("WHISPER_MODEL", "base")
    if _WHISPER_MODEL is not None and _WHISPER_MODEL_NAME == model_name:
        return _WHISPER_MODEL

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - runtime dependency
        raise RuntimeError(f"faster-whisper import failed: {exc}") from exc

    device = os.getenv("WHISPER_DEVICE", "cpu")
    compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
    try:
        _WHISPER_MODEL = WhisperModel(model_name, device=device, compute_type=compute_type)
        _WHISPER_MODEL_NAME = model_name
        LOGGER.info("Loaded faster-whisper model '%s' (%s, %s)", model_name, device, compute_type)
    except Exception as exc:  # pragma: no cover - runtime dependency
        raise RuntimeError(f"whisper model load failed: {exc}") from exc
    return _WHISPER_MODEL


def transcribe_wav_file(file_path: str, language_hint: str = "auto") -> dict:
    model = get_whisper_model()
    language = None if language_hint == "auto" else language_hint
    whisper_vad_filter = as_bool_env("WHISPER_VAD_FILTER", False)
    start = time.perf_counter()
    try:
        segments, info = model.transcribe(
            file_path,
            language=language,
            task="transcribe",
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=whisper_vad_filter,
        )

        texts = []
        avg_logprobs = []
        no_speech_probs = []
        for segment in segments:
            part = (segment.text or "").strip()
            if part:
                texts.append(part)
            avg_logprob = getattr(segment, "avg_logprob", None)
            if avg_logprob is None:
                continue
            try:
                avg_logprobs.append(float(avg_logprob))
            except Exception:
                continue
            no_speech_prob = getattr(segment, "no_speech_prob", None)
            if no_speech_prob is None:
                continue
            try:
                no_speech_probs.append(float(no_speech_prob))
            except Exception:
                continue

        full_text = " ".join(texts).strip()
        if avg_logprobs:
            mean_logprob = sum(avg_logprobs) / max(1, len(avg_logprobs))
            confidence = max(0.0, min(1.0, float(pow(2.718281828, mean_logprob))))
        else:
            confidence = 0.0
        no_speech_prob = (
            (sum(no_speech_probs) / max(1, len(no_speech_probs)))
            if no_speech_probs
            else 0.0
        )

        detected_language = getattr(info, "language", None) or (language_hint if language_hint != "auto" else "en")
        return {
            "text": full_text,
            "language": detected_language,
            "confidence": confidence,
            "no_speech_prob": no_speech_prob,
            "backend": "faster-whisper",
            "model": os.getenv("WHISPER_MODEL", "base"),
            "latency_ms": int((time.perf_counter() - start) * 1000),
        }
    except ValueError as exc:
        if "max() iterable argument is empty" in str(exc):
            return {
                "text": "",
                "language": language_hint if language_hint != "auto" else "en",
                "confidence": 0.0,
                "no_speech_prob": 0.0,
                "backend": "faster-whisper",
                "model": os.getenv("WHISPER_MODEL", "base"),
                "latency_ms": int((time.perf_counter() - start) * 1000),
            }
        raise RuntimeError(f"whisper transcribe failed: {exc}") from exc
    except Exception as exc:  # pragma: no cover - runtime dependency
        raise RuntimeError(f"whisper transcribe failed: {exc}") from exc


def transcribe_pcm16_chunk(pcm16_bytes: bytes, sample_rate: int = 16000, language_hint: str = "auto") -> dict:
    if not pcm16_bytes:
        return {
            "text": "",
            "language": "en",
            "confidence": 0.0,
            "no_speech_prob": 0.0,
            "backend": "faster-whisper",
            "model": os.getenv("WHISPER_MODEL", "base"),
            "latency_ms": 0,
        }

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
            temp_path = temp_file.name
        with wave.open(temp_path, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm16_bytes)
        return transcribe_wav_file(temp_path, language_hint=language_hint)
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass


class PcmVadSegmenter:
    def __init__(self, sample_rate: int = 16000, frame_ms: int = 30, vad_mode: int = 2):
        try:
            import webrtcvad
        except Exception as exc:  # pragma: no cover - runtime dependency
            raise RuntimeError(f"webrtcvad import failed: {exc}") from exc

        self.sample_rate = sample_rate
        self.frame_ms = frame_ms
        self.frame_bytes = int(sample_rate * frame_ms / 1000) * 2
        self.vad = webrtcvad.Vad(vad_mode)
        self.pending = bytearray()
        self.in_speech = False
        self.buffer = bytearray()
        self.speech_frames = 0
        self.silence_frames = 0
        self.min_speech_frames = max(2, int(os.getenv("ASR_MIN_SPEECH_FRAMES", "5")))
        self.max_silence_frames = max(3, int(os.getenv("ASR_MAX_SILENCE_FRAMES", "12")))
        self.max_speech_frames = max(25, int(os.getenv("ASR_MAX_SPEECH_FRAMES", "500")))

    def reset(self) -> None:
        self.in_speech = False
        self.buffer = bytearray()
        self.speech_frames = 0
        self.silence_frames = 0

    def emit_if_ready(self) -> list[bytes]:
        if self.speech_frames >= self.min_speech_frames and len(self.buffer) >= self.frame_bytes:
            out = bytes(self.buffer)
            self.reset()
            return [out]
        self.reset()
        return []

    def process(self, chunk: bytes) -> list[bytes]:
        outputs = []
        if not chunk:
            return outputs

        self.pending.extend(chunk)
        while len(self.pending) >= self.frame_bytes:
            frame = bytes(self.pending[: self.frame_bytes])
            del self.pending[: self.frame_bytes]
            try:
                speech = self.vad.is_speech(frame, self.sample_rate)
            except Exception:
                speech = False

            if speech:
                if not self.in_speech:
                    self.in_speech = True
                    self.buffer = bytearray()
                    self.speech_frames = 0
                    self.silence_frames = 0
                self.buffer.extend(frame)
                self.speech_frames += 1
                self.silence_frames = 0
            elif self.in_speech:
                self.buffer.extend(frame)
                self.silence_frames += 1
                if self.silence_frames >= self.max_silence_frames:
                    outputs.extend(self.emit_if_ready())

            if self.in_speech and self.speech_frames >= self.max_speech_frames:
                outputs.extend(self.emit_if_ready())

        return outputs

    def flush(self) -> list[bytes]:
        return self.emit_if_ready() if self.in_speech else []


def create_pcm_vad_segmenter() -> PcmVadSegmenter:
    frame_ms = int(os.getenv("ASR_VAD_FRAME_MS", "30"))
    if frame_ms not in {10, 20, 30}:
        frame_ms = 30
    vad_mode = int(os.getenv("ASR_VAD_MODE", "1"))
    vad_mode = max(0, min(3, vad_mode))
    return PcmVadSegmenter(sample_rate=16000, frame_ms=frame_ms, vad_mode=vad_mode)


def get_segment_duration_ms(pcm16_bytes: bytes, sample_rate: int = 16000) -> int:
    if not pcm16_bytes:
        return 0
    samples = len(pcm16_bytes) / 2
    seconds = samples / max(1, sample_rate)
    return int(seconds * 1000)


def get_pcm_rms_and_peak(pcm16_bytes: bytes) -> tuple[float, float]:
    if not pcm16_bytes:
        return 0.0, 0.0

    sample_count = len(pcm16_bytes) // 2
    if sample_count <= 0:
        return 0.0, 0.0

    sum_squares = 0.0
    peak = 0.0
    for index in range(0, len(pcm16_bytes) - 1, 2):
        sample = int.from_bytes(pcm16_bytes[index:index + 2], byteorder="little", signed=True) / 32768.0
        abs_sample = abs(sample)
        sum_squares += sample * sample
        if abs_sample > peak:
            peak = abs_sample

    rms = math.sqrt(sum_squares / max(1, sample_count))
    return rms, peak


def should_emit_asr_result(transcript_text: str, asr: dict, pcm16_bytes: bytes, sample_rate: int = 16000) -> tuple[bool, str]:
    normalized = " ".join(str(transcript_text or "").strip().lower().split())
    if not normalized:
        return False, "empty"

    confidence = float(asr.get("confidence") or 0.0)
    no_speech_prob = float(asr.get("no_speech_prob") or 0.0)
    duration_ms = get_segment_duration_ms(pcm16_bytes, sample_rate=sample_rate)
    words = normalized.split()

    min_segment_ms = max(0, as_int_env("ASR_MIN_SEGMENT_MS", 900))
    min_confidence = max(0.0, min(1.0, as_float_env("ASR_MIN_CONFIDENCE", 0.72)))
    max_no_speech_prob = max(0.0, min(1.0, as_float_env("ASR_MAX_NO_SPEECH_PROB", 0.55)))
    min_single_word_chars = max(1, as_int_env("ASR_MIN_SINGLE_WORD_CHARS", 4))
    min_single_word_ms = max(min_segment_ms, as_int_env("ASR_MIN_SINGLE_WORD_MS", 1200))
    min_short_phrase_confidence = max(0.0, min(1.0, as_float_env("ASR_MIN_SHORT_PHRASE_CONFIDENCE", 0.82)))

    if duration_ms < min_segment_ms:
        return False, "short-segment"
    if no_speech_prob > 0 and no_speech_prob >= max_no_speech_prob:
        return False, "high-no-speech-prob"
    if confidence > 0 and confidence < min_confidence:
        return False, "low-confidence"
    if len(words) == 1:
        if len(words[0]) < min_single_word_chars:
            return False, "single-word-too-short"
        if duration_ms < min_single_word_ms:
            return False, "single-word-too-brief"
    if len(words) <= 2 and confidence > 0 and confidence < min_short_phrase_confidence:
        return False, "short-phrase-low-confidence"

    return True, "ok"


@app.post("/profile/extract")
async def extract_profile(request: Request, sample_rate: int = 16000):
    pcm16_bytes = await request.body()
    if not pcm16_bytes:
        raise HTTPException(status_code=400, detail="No audio sample was received.")

    try:
        profile = build_voice_profile(pcm16_bytes, sample_rate=max(8000, min(48000, int(sample_rate or 16000))))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime dependency
        raise HTTPException(status_code=500, detail=f"Voice profile extraction failed: {exc}") from exc

    return {
        "ok": True,
        "profile": profile,
        "recommended_threshold": 0.74,
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "mic-asr",
        "whisper_model": os.getenv("WHISPER_MODEL", "base"),
        "whisper_device": os.getenv("WHISPER_DEVICE", "cpu"),
        "whisper_compute_type": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
        "whisper_vad_filter": as_bool_env("WHISPER_VAD_FILTER", False),
        "vad_mode": int(os.getenv("ASR_VAD_MODE", "1")),
        "frame_ms": int(os.getenv("ASR_VAD_FRAME_MS", "30")),
    }


@app.websocket("/ws/mic-trigger")
async def ws_mic_trigger(websocket: WebSocket):
    await websocket.accept()
    language = websocket.query_params.get("language", "auto")
    LOGGER.info("Mic ASR websocket connected (language=%s)", language)
    speaker_profile = None
    speaker_gate_enabled = False
    speaker_threshold = 0.74

    try:
        segmenter = create_pcm_vad_segmenter()
    except RuntimeError as exc:
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close(code=4503)
        return

    await websocket.send_json(
        {
            "type": "ready",
            "sample_rate": 16000,
            "frame_ms": segmenter.frame_ms,
            "vad_mode": int(os.getenv("ASR_VAD_MODE", "1")),
            "speaker_gate_supported": True,
        }
    )

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            text_msg = message.get("text")
            if text_msg:
                stripped = text_msg.strip()
                if stripped.lower() == "flush":
                    chunks = segmenter.flush()
                else:
                    try:
                        payload = json.loads(stripped)
                    except Exception:
                        continue
                    if str(payload.get("type") or "").strip().lower() == "speaker_profile":
                        normalized_profile = normalize_voice_profile(payload.get("profile"))
                        requested_enabled = payload.get("enabled") is True
                        if requested_enabled and not normalized_profile:
                            await websocket.send_json(
                                {
                                    "type": "speaker_profile_status",
                                    "enabled": False,
                                    "has_profile": False,
                                    "detail": "No valid voice profile was provided.",
                                }
                            )
                            continue
                        speaker_profile = normalized_profile
                        speaker_gate_enabled = requested_enabled and normalized_profile is not None
                        try:
                            speaker_threshold = float(payload.get("threshold") or 0.74)
                        except Exception:
                            speaker_threshold = 0.74
                        speaker_threshold = max(0.5, min(0.98, speaker_threshold))
                        await websocket.send_json(
                            {
                                "type": "speaker_profile_status",
                                "enabled": speaker_gate_enabled,
                                "has_profile": normalized_profile is not None,
                                "speaker_threshold": speaker_threshold,
                            }
                        )
                    continue
            else:
                payload = message.get("bytes")
                if not payload:
                    continue
                chunks = segmenter.process(payload)

            for pcm_bytes in chunks:
                segment_duration_ms = get_segment_duration_ms(pcm_bytes, sample_rate=16000)
                segment_rms, segment_peak = get_pcm_rms_and_peak(pcm_bytes)
                min_rms = max(0.0, as_float_env("ASR_MIN_RMS", 0.006))
                min_peak = max(0.0, as_float_env("ASR_MIN_PEAK", 0.025))
                if segment_rms < min_rms and segment_peak < min_peak:
                    LOGGER.info(
                        "Mic ASR: skipped quiet segment (%s bytes, %sms, rms=%.4f, peak=%.4f)",
                        len(pcm_bytes),
                        segment_duration_ms,
                        segment_rms,
                        segment_peak,
                    )
                    continue
                speaker_similarity = 0.0
                if speaker_gate_enabled and speaker_profile is not None:
                    speaker_similarity, speaker_frames = score_voice_profile(speaker_profile, pcm_bytes, sample_rate=16000)
                    if speaker_similarity < speaker_threshold:
                        LOGGER.info(
                            "Mic ASR: ignored speaker mismatch (score=%.2f < %.2f, frames=%s)",
                            speaker_similarity,
                            speaker_threshold,
                            speaker_frames,
                        )
                        await websocket.send_json(
                            {
                                "type": "speaker_ignored",
                                "speaker_similarity": speaker_similarity,
                                "speaker_threshold": speaker_threshold,
                                "segment_duration_ms": segment_duration_ms,
                            }
                        )
                        continue
                LOGGER.info("Mic ASR: transcribing segment (%s bytes, %sms)", len(pcm_bytes), segment_duration_ms)
                try:
                    asr = transcribe_pcm16_chunk(pcm_bytes, sample_rate=16000, language_hint=language)
                except RuntimeError as exc:
                    LOGGER.exception("Mic ASR transcribe error")
                    await websocket.send_json({"type": "error", "detail": str(exc)})
                    continue

                transcript_text = str(asr.get("text") or "").strip()
                if not transcript_text:
                    LOGGER.info("Mic ASR: empty transcript for segment")
                    continue

                should_emit, reason = should_emit_asr_result(
                    transcript_text,
                    asr,
                    pcm_bytes,
                    sample_rate=16000,
                )
                if not should_emit:
                    LOGGER.info(
                        "Mic ASR: ignored transcript (%s, conf=%.2f, no_speech=%.2f): \"%s\"",
                        reason,
                        float(asr.get("confidence") or 0.0),
                        float(asr.get("no_speech_prob") or 0.0),
                        transcript_text[:160],
                    )
                    await websocket.send_json(
                        {
                            "type": "ignored",
                            "ignored_reason": reason,
                            "transcript_text": transcript_text,
                            "language": str(asr.get("language") or language or "en"),
                            "asr_confidence": float(asr.get("confidence") or 0.0),
                            "asr_no_speech_prob": float(asr.get("no_speech_prob") or 0.0),
                            "asr_model": str(asr.get("model") or os.getenv("WHISPER_MODEL", "base")),
                            "asr_latency_ms": int(asr.get("latency_ms") or 0),
                            "segment_duration_ms": segment_duration_ms,
                            "speaker_similarity": speaker_similarity,
                            "speaker_threshold": speaker_threshold if speaker_gate_enabled else 0.0,
                        }
                    )
                    continue

                LOGGER.info(
                    "Mic ASR: transcript=\"%s\" (conf=%.2f, no_speech=%.2f)",
                    transcript_text[:160],
                    float(asr.get("confidence") or 0.0),
                    float(asr.get("no_speech_prob") or 0.0),
                )

                await websocket.send_json(
                    {
                        "type": "final",
                        "transcript_text": transcript_text,
                        "language": str(asr.get("language") or language or "en"),
                        "asr_confidence": float(asr.get("confidence") or 0.0),
                        "asr_no_speech_prob": float(asr.get("no_speech_prob") or 0.0),
                        "asr_model": str(asr.get("model") or os.getenv("WHISPER_MODEL", "base")),
                        "asr_latency_ms": int(asr.get("latency_ms") or 0),
                        "segment_duration_ms": segment_duration_ms,
                        "speaker_similarity": speaker_similarity,
                        "speaker_threshold": speaker_threshold if speaker_gate_enabled else 0.0,
                    }
                )
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - runtime path
        LOGGER.exception("Mic ASR websocket loop failed")
    finally:
        try:
            for pcm_bytes in segmenter.flush():
                speaker_similarity = 0.0
                if speaker_gate_enabled and speaker_profile is not None:
                    speaker_similarity, _ = score_voice_profile(speaker_profile, pcm_bytes, sample_rate=16000)
                    if speaker_similarity < speaker_threshold:
                        continue
                asr = transcribe_pcm16_chunk(pcm_bytes, sample_rate=16000, language_hint=language)
                transcript_text = str(asr.get("text") or "").strip()
                if not transcript_text:
                    continue
                should_emit, _ = should_emit_asr_result(
                    transcript_text,
                    asr,
                    pcm_bytes,
                    sample_rate=16000,
                )
                if not should_emit:
                    continue
                await websocket.send_json(
                    {
                        "type": "final",
                        "transcript_text": transcript_text,
                        "language": str(asr.get("language") or language or "en"),
                        "asr_confidence": float(asr.get("confidence") or 0.0),
                        "asr_no_speech_prob": float(asr.get("no_speech_prob") or 0.0),
                        "asr_model": str(asr.get("model") or os.getenv("WHISPER_MODEL", "base")),
                        "asr_latency_ms": int(asr.get("latency_ms") or 0),
                        "segment_duration_ms": get_segment_duration_ms(pcm_bytes, sample_rate=16000),
                        "speaker_similarity": speaker_similarity,
                        "speaker_threshold": speaker_threshold if speaker_gate_enabled else 0.0,
                    }
                )
        except Exception:
            pass

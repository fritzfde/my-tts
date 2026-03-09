import logging
import os
import tempfile
import time
import wave
import math
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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
        }
    )

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break

            text_msg = message.get("text")
            if text_msg:
                if text_msg.strip().lower() == "flush":
                    chunks = segmenter.flush()
                else:
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
                    }
                )
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - runtime path
        LOGGER.exception("Mic ASR websocket loop failed")
    finally:
        try:
            for pcm_bytes in segmenter.flush():
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
                    }
                )
        except Exception:
            pass

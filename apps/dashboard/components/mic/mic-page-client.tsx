'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMicWsUrl, extractMicVoiceProfile, getMicHealth } from '@/lib/api/mic';
import {
  buildMicSettingsRecord,
  DEFAULT_MIC_ASR_BASE_URL,
  DEFAULT_MIC_VOICE_MATCH_THRESHOLD,
  normalizeVoiceMatchThreshold
} from '@/lib/mic-settings';
import { saveSettings } from '@/lib/api/settings';
import { useMicStore } from '@/lib/stores/mic-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { MicSettingsState, MicTranscriptEvent, MicVoiceProfile } from '@/lib/types/mic';

type MicPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

function formatClock(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleTimeString();
  }
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function computeInputLevel(input: Float32Array) {
  if (!input?.length) return 0;
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    sum += input[index] * input[index];
  }
  return Math.sqrt(sum / input.length);
}

function downsampleToPcm16(input: Float32Array, inSampleRate: number, outSampleRate = 16000) {
  if (!input || !input.length) return new ArrayBuffer(0);

  if (inSampleRate === outSampleRate) {
    const out = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return out.buffer;
  }

  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outLength);
  let inOffset = 0;

  for (let index = 0; index < outLength; index += 1) {
    const nextOffset = Math.min(input.length, Math.round((index + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let inner = inOffset; inner < nextOffset; inner += 1) {
      accum += input[inner];
      count += 1;
    }
    const sample = count ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    inOffset = nextOffset;
  }

  return out.buffer;
}

function concatArrayBuffers(buffers: ArrayBuffer[]) {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  buffers.forEach((buffer) => {
    merged.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  return merged.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function pcm16ToWavDataUrl(pcmBuffer: ArrayBuffer, sampleRate = 16000) {
  const pcmBytes = new Uint8Array(pcmBuffer);
  const wavBuffer = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(wavBuffer);
  const bytes = new Uint8Array(wavBuffer);

  function writeAscii(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  }

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);
  bytes.set(pcmBytes, 44);

  return `data:audio/wav;base64,${arrayBufferToBase64(wavBuffer)}`;
}

export function MicPageClient({ initialScope, initialSettings }: MicPageClientProps) {
  const hydrate = useMicStore((state) => state.hydrate);
  const hydrated = useMicStore((state) => state.hydrated);
  const scope = useMicStore((state) => state.scope);
  const rawSettings = useMicStore((state) => state.rawSettings);
  const asrBaseUrl = useMicStore((state) => state.asrBaseUrl);
  const language = useMicStore((state) => state.language);
  const triggerMode = useMicStore((state) => state.triggerMode);
  const voiceGateEnabled = useMicStore((state) => state.voiceGateEnabled);
  const voiceProfile = useMicStore((state) => state.voiceProfile);
  const voicePreviewDataUrl = useMicStore((state) => state.voicePreviewDataUrl);
  const voiceMatchThreshold = useMicStore((state) => state.voiceMatchThreshold);
  const health = useMicStore((state) => state.health);
  const healthError = useMicStore((state) => state.healthError);
  const listening = useMicStore((state) => state.listening);
  const connecting = useMicStore((state) => state.connecting);
  const enrolling = useMicStore((state) => state.enrolling);
  const micLevel = useMicStore((state) => state.micLevel);
  const status = useMicStore((state) => state.status);
  const transcripts = useMicStore((state) => state.transcripts);
  const notice = useMicStore((state) => state.notice);
  const error = useMicStore((state) => state.error);
  const commitSettingsState = useMicStore((state) => state.commitSettingsState);
  const setAsrBaseUrl = useMicStore((state) => state.setAsrBaseUrl);
  const setLanguage = useMicStore((state) => state.setLanguage);
  const setTriggerMode = useMicStore((state) => state.setTriggerMode);
  const setVoiceGateEnabled = useMicStore((state) => state.setVoiceGateEnabled);
  const setVoiceProfile = useMicStore((state) => state.setVoiceProfile);
  const setVoicePreviewDataUrl = useMicStore((state) => state.setVoicePreviewDataUrl);
  const setVoiceMatchThreshold = useMicStore((state) => state.setVoiceMatchThreshold);
  const setHealth = useMicStore((state) => state.setHealth);
  const setListeningState = useMicStore((state) => state.setListeningState);
  const setMicLevel = useMicStore((state) => state.setMicLevel);
  const prependTranscript = useMicStore((state) => state.prependTranscript);
  const clearTranscripts = useMicStore((state) => state.clearTranscripts);
  const setNotice = useMicStore((state) => state.setNotice);
  const setError = useMicStore((state) => state.setError);

  const initializedRef = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkNodeRef = useRef<GainNode | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPreviewingSample, setIsPreviewingSample] = useState(false);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings
    });
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings]);

  const currentSettingsState = useMemo<MicSettingsState>(
    () => ({
      asrBaseUrl,
      language,
      triggerMode,
      voiceGateEnabled,
      voiceProfile,
      voicePreviewDataUrl,
      voiceMatchThreshold
    }),
    [asrBaseUrl, language, triggerMode, voiceGateEnabled, voiceProfile, voicePreviewDataUrl, voiceMatchThreshold]
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const nextRawSettings = buildMicSettingsRecord(rawSettings, currentSettingsState);
          await saveSettings(nextRawSettings, scope);
          commitSettingsState(currentSettingsState, nextRawSettings);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to save mic settings');
        }
      })();
    }, 300);

    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [commitSettingsState, currentSettingsState, hydrated, rawSettings, scope, setError]);

  function teardownAudio() {
    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current.onaudioprocess = null;
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (sinkNodeRef.current) {
      try {
        sinkNodeRef.current.disconnect();
      } catch {}
      sinkNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        void audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch {}
      streamRef.current = null;
    }
    setMicLevel(0);
  }

  function pushTranscript(event: MicTranscriptEvent) {
    prependTranscript(event);
  }

  async function refreshHealth() {
    try {
      const nextHealth = await getMicHealth(asrBaseUrl || DEFAULT_MIC_ASR_BASE_URL);
      setHealth(nextHealth, '');
      setListeningState({
        status: listening
          ? `Mic active • ${triggerMode === 'suggest' ? 'suggestion mode' : 'listening'}`
          : `Mic ASR online (${nextHealth.whisperModel}, ${nextHealth.whisperDevice})`
      });
      return true;
    } catch (err) {
      setHealth(null, err instanceof Error ? err.message : 'ASR health check failed');
      if (!listening && !connecting) {
        setListeningState({
          status: 'Mic ASR is offline. Start npm run start:asr and try again.'
        });
      }
      return false;
    }
  }

  async function recordEnrollmentSample(durationMs = 5500) {
    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      throw new Error('Microphone capture is not supported in this browser');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const audioContext = new AudioContextCtor();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const sinkNode = audioContext.createGain();
    sinkNode.gain.value = 0;
    const processorNode = audioContext.createScriptProcessor(2048, 1, 1);
    const collected: ArrayBuffer[] = [];

    processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      setMicLevel(computeInputLevel(input));
      const pcm = downsampleToPcm16(input, audioContext.sampleRate, 16000);
      if (pcm.byteLength > 0) {
        collected.push(pcm.slice(0));
      }
    };

    sourceNode.connect(processorNode);
    processorNode.connect(sinkNode);
    sinkNode.connect(audioContext.destination);

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    try {
      processorNode.disconnect();
      sourceNode.disconnect();
      sinkNode.disconnect();
    } catch {}
    processorNode.onaudioprocess = null;
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    setMicLevel(0);

    return concatArrayBuffers(collected);
  }

  async function handleEnrollVoice() {
    if (listening || connecting) {
      setError('Stop mic listening before enrolling your voice profile.');
      return;
    }

    setListeningState({ enrolling: true, status: 'Speak naturally for a few seconds to enroll your voice profile...' });
    try {
      const healthOk = await refreshHealth();
      if (!healthOk) throw new Error('ASR service is unavailable');

      const pcmBuffer = await recordEnrollmentSample();
      if (pcmBuffer.byteLength < 16000) {
        throw new Error('The recorded sample was too short. Speak for a few seconds and try again.');
      }

      const result = await extractMicVoiceProfile(asrBaseUrl, pcmBuffer);
      setVoiceProfile(result.profile as MicVoiceProfile);
      setVoicePreviewDataUrl(pcm16ToWavDataUrl(pcmBuffer, 16000));
      setVoiceMatchThreshold(normalizeVoiceMatchThreshold(result.recommendedThreshold || DEFAULT_MIC_VOICE_MATCH_THRESHOLD));
      setVoiceGateEnabled(true);
      setNotice('Voice profile saved. The mic can now react only to your voice.');
      setListeningState({ status: 'Voice profile ready for recognition.' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice enrollment failed');
      setListeningState({ status: 'Voice enrollment failed.' });
    } finally {
      setListeningState({ enrolling: false });
    }
  }

  async function handlePreviewSample() {
    if (!voicePreviewDataUrl) {
      setError('No enrolled voice sample is stored yet.');
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }

    try {
      const audio = new Audio(voicePreviewDataUrl);
      previewAudioRef.current = audio;
      setIsPreviewingSample(true);
      audio.onended = () => {
        if (previewAudioRef.current === audio) {
          previewAudioRef.current = null;
        }
        setIsPreviewingSample(false);
      };
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice preview failed');
      setIsPreviewingSample(false);
    }
  }

  function handleClearProfile() {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      previewAudioRef.current = null;
    }
    setIsPreviewingSample(false);
    setVoiceProfile(null);
    setVoicePreviewDataUrl('');
    setVoiceGateEnabled(false);
    setNotice('Voice profile cleared.');
  }

  async function startListening() {
    if (listening || connecting || enrolling) return;
    if (voiceGateEnabled && !voiceProfile) {
      setError('Only my voice is enabled, but no voice profile is enrolled yet.');
      return;
    }

    const healthOk = await refreshHealth();
    if (!healthOk) return;

    const AudioContextCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
    if (!navigator.mediaDevices?.getUserMedia || !AudioContextCtor) {
      setError('Microphone capture is not supported in this browser');
      return;
    }

    setListeningState({ connecting: true, status: 'Connecting microphone to ASR...' });
    clearTranscripts();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const audioContext = new AudioContextCtor();
      await audioContext.resume();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const sinkNode = audioContext.createGain();
      sinkNode.gain.value = 0;
      const processorNode = audioContext.createScriptProcessor(2048, 1, 1);
      const socket = new WebSocket(buildMicWsUrl(asrBaseUrl, language));

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      sinkNodeRef.current = sinkNode;
      processorNodeRef.current = processorNode;
      socketRef.current = socket;
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        if (voiceGateEnabled) {
          socket.send(
            JSON.stringify({
              type: 'speaker_profile',
              enabled: true,
              threshold: voiceMatchThreshold,
              profile: voiceProfile
            })
          );
        } else {
          socket.send(JSON.stringify({ type: 'speaker_profile', enabled: false }));
        }

        sourceNode.connect(processorNode);
        processorNode.connect(sinkNode);
        sinkNode.connect(audioContext.destination);

        processorNode.onaudioprocess = (event) => {
          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          setMicLevel(computeInputLevel(input));
          const pcm = downsampleToPcm16(input, audioContext.sampleRate, 16000);
          if (pcm.byteLength > 0) {
            socketRef.current.send(pcm);
          }
        };

        setListeningState({
          connecting: false,
          listening: true,
          status: triggerMode === 'suggest' ? 'Mic active • suggestion mode' : 'Mic active • listening'
        });
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data || '{}'));
          const timestamp = Date.now();

          if (message.type === 'ready') {
            setListeningState({
              status: `Mic active • ${triggerMode === 'suggest' ? 'suggestion mode' : 'listening'} (vad=${Number(message.frame_ms || 0)}ms)`
            });
            return;
          }

          if (message.type === 'speaker_profile_status') {
            setListeningState({
              status: message.enabled
                ? `Mic voice gate active at ${formatPercent(Number(message.speaker_threshold || voiceMatchThreshold))}`
                : 'Mic active without voice gate'
            });
            return;
          }

          if (message.type === 'speaker_ignored') {
            pushTranscript({
              id: `speaker-ignored-${timestamp}`,
              type: 'speaker_ignored',
              text: 'Ignored non-matching voice',
              detail: `${formatPercent(Number(message.speaker_similarity || 0))} < ${formatPercent(Number(message.speaker_threshold || voiceMatchThreshold))}`,
              language,
              confidence: 0,
              durationMs: Number(message.segment_duration_ms || 0),
              voiceSimilarity: Number(message.speaker_similarity || 0),
              voiceThreshold: Number(message.speaker_threshold || voiceMatchThreshold),
              timestamp
            });
            return;
          }

          if (message.type === 'ignored') {
            pushTranscript({
              id: `ignored-${timestamp}`,
              type: 'ignored',
              text: String(message.transcript_text || '').trim() || 'Ignored transcript',
              detail: String(message.ignored_reason || 'ignored'),
              language: String(message.language || language),
              confidence: Number(message.asr_confidence || 0),
              durationMs: Number(message.segment_duration_ms || 0),
              voiceSimilarity: Number(message.speaker_similarity || 0),
              voiceThreshold: Number(message.speaker_threshold || 0),
              timestamp
            });
            return;
          }

          if (message.type === 'final') {
            pushTranscript({
              id: `final-${timestamp}`,
              type: 'final',
              text: String(message.transcript_text || '').trim(),
              detail: `${String(message.language || language).toUpperCase()} • ${Math.round(Number(message.segment_duration_ms || 0))}ms`,
              language: String(message.language || language),
              confidence: Number(message.asr_confidence || 0),
              durationMs: Number(message.segment_duration_ms || 0),
              voiceSimilarity: Number(message.speaker_similarity || 0),
              voiceThreshold: Number(message.speaker_threshold || 0),
              timestamp
            });
            return;
          }

          if (message.type === 'error') {
            pushTranscript({
              id: `error-${timestamp}`,
              type: 'error',
              text: 'ASR error',
              detail: String(message.detail || 'Unknown ASR error'),
              language,
              confidence: 0,
              durationMs: 0,
              voiceSimilarity: 0,
              voiceThreshold: 0,
              timestamp
            });
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onerror = () => {
        setError('Mic websocket error. Check the ASR URL and whether npm run start:asr is running.');
      };

      socket.onclose = () => {
        teardownAudio();
        setListeningState({
          listening: false,
          connecting: false,
          status: 'Mic is inactive.'
        });
      };
    } catch (err) {
      teardownAudio();
      setListeningState({
        listening: false,
        connecting: false,
        status: 'Mic failed to start.'
      });
      setError(err instanceof Error ? err.message : 'Mic failed to start');
    }
  }

  function stopListening() {
    if (socketRef.current) {
      try {
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send('flush');
        }
      } catch {}
      try {
        socketRef.current.close(1000, 'stop');
      } catch {}
      socketRef.current = null;
    }

    teardownAudio();
    setListeningState({
      listening: false,
      connecting: false,
      status: 'Mic is inactive.'
    });
  }

  const voiceProfileSummary = voiceProfile
    ? `${voiceProfile.frameCount} voiced frames • ${voiceProfile.vector.length} features`
    : 'No voice profile enrolled yet.';

  return (
    <div className="mic-page">
      <section className="live-summary-grid mic-summary-grid">
        <article className={`live-summary-card ${health?.ok ? 'is-connected' : ''}`}>
          <span>ASR status</span>
          <strong>{health?.ok ? 'Online' : 'Offline'}</strong>
          <p>{health ? `${health.whisperModel} on ${health.whisperDevice}` : (healthError || 'Not checked yet')}</p>
        </article>
        <article className={`live-summary-card ${listening ? 'is-connected' : ''}`}>
          <span>Mic stream</span>
          <strong>{listening ? 'Listening' : (connecting ? 'Connecting' : 'Idle')}</strong>
          <p>{status}</p>
        </article>
        <article className={`live-summary-card ${voiceGateEnabled && voiceProfile ? 'is-connected' : ''}`}>
          <span>Voice gate</span>
          <strong>{voiceGateEnabled ? 'Enabled' : 'Disabled'}</strong>
          <p>{voiceProfileSummary}</p>
        </article>
        <article className="live-summary-card">
          <span>Mic level</span>
          <strong>{Math.round(micLevel * 100)}%</strong>
          <p>{triggerMode === 'suggest' ? 'Suggestion mode is selected.' : 'Auto trigger mode is selected.'}</p>
        </article>
      </section>

      {(notice || error) ? (
        <div className={`live-banner ${error ? 'is-error' : 'is-notice'}`}>
          <strong>{error ? 'Attention' : 'Updated'}</strong>
          <span>{error || notice}</span>
        </div>
      ) : null}

      <div className="live-layout-grid mic-layout-grid">
        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Mic setup</p>
                <h2>ASR and recognition settings</h2>
              </div>
              <span className={`live-pill ${health?.ok ? 'is-connected' : ''}`}>{health?.ok ? 'Healthy' : 'Check service'}</span>
            </div>

            <label className="live-field">
              <span>Mic ASR URL</span>
              <input value={asrBaseUrl} onChange={(event) => setAsrBaseUrl(event.target.value)} placeholder={DEFAULT_MIC_ASR_BASE_URL} />
            </label>

            <div className="live-form-grid">
              <label className="live-field">
                <span>Language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="auto">Auto detect</option>
                  <option value="en">English</option>
                  <option value="de">German</option>
                  <option value="pl">Polish</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="it">Italian</option>
                </select>
              </label>
              <label className="live-field">
                <span>Trigger mode</span>
                <select value={triggerMode} onChange={(event) => setTriggerMode(event.target.value === 'suggest' ? 'suggest' : 'auto')}>
                  <option value="auto">Auto trigger</option>
                  <option value="suggest">Suggestion mode</option>
                </select>
              </label>
            </div>

            <label className="live-field">
              <span>Voice match threshold</span>
              <div className="live-inline-range">
                <input
                  type="range"
                  min={60}
                  max={95}
                  value={Math.round(voiceMatchThreshold * 100)}
                  onChange={(event) => setVoiceMatchThreshold(normalizeVoiceMatchThreshold(Number(event.target.value)))}
                />
                <strong>{formatPercent(voiceMatchThreshold)}</strong>
              </div>
            </label>

            <label className="live-field mic-toggle-field">
              <span>Only my voice</span>
              <input type="checkbox" checked={voiceGateEnabled} onChange={(event) => setVoiceGateEnabled(event.target.checked)} />
            </label>

            <div className="live-actions-row">
              <button className="live-button" type="button" onClick={() => void refreshHealth()}>
                Refresh health
              </button>
              <button className="live-button is-primary" type="button" onClick={() => void startListening()} disabled={listening || connecting || enrolling}>
                {connecting ? 'Connecting…' : listening ? 'Listening…' : 'Start listening'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={stopListening} disabled={!listening && !connecting}>
                Stop
              </button>
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Voice profile</p>
                <h2>Enrollment and preview</h2>
              </div>
              <span className={`live-pill ${voiceProfile ? 'is-connected' : ''}`}>{voiceProfile ? 'Ready' : 'Missing'}</span>
            </div>

            <div className="mic-profile-card">
              <strong>{voiceProfile ? 'Voice profile ready' : 'No voice profile enrolled'}</strong>
              <p>{voiceProfileSummary}</p>
            </div>

            <div className="live-actions-row">
              <button className="live-button is-primary" type="button" onClick={() => void handleEnrollVoice()} disabled={enrolling || listening || connecting}>
                {enrolling ? 'Enrolling…' : 'Enroll my voice'}
              </button>
              <button className="live-button" type="button" onClick={() => void handlePreviewSample()} disabled={!voicePreviewDataUrl || isPreviewingSample}>
                {isPreviewingSample ? 'Playing…' : 'Preview sample'}
              </button>
              <button className="live-button is-ghost" type="button" onClick={handleClearProfile} disabled={!voiceProfile && !voicePreviewDataUrl}>
                Clear
              </button>
            </div>
          </section>
        </div>

        <div className="live-column">
          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">Diagnostics</p>
                <h2>Transcript stream</h2>
              </div>
              <span className="live-pill">{transcripts.length} events</span>
            </div>

            <div className="mic-level-meter">
              <div className="mic-level-bar" style={{ width: `${Math.max(4, micLevel * 100)}%` }} />
            </div>

            <div className="live-actions-row">
              <button className="live-button is-ghost" type="button" onClick={clearTranscripts}>
                Clear transcript log
              </button>
            </div>

            <div className="live-activity-list">
              {transcripts.length === 0 ? <div className="live-empty">Start listening to inspect ASR events and transcript quality here.</div> : transcripts.map((entry) => (
                <article key={entry.id} className={`live-activity-card accent-${entry.type}`}>
                  <header>
                    <div>
                      <strong>{entry.type.replace(/_/g, ' ')}</strong>
                      <span>{entry.language.toUpperCase()} · {entry.confidence > 0 ? `${Math.round(entry.confidence * 100)}% confidence` : 'diagnostic event'}</span>
                    </div>
                    <time>{formatClock(entry.timestamp)}</time>
                  </header>
                  <p>{entry.text}</p>
                  <small>{entry.detail}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="live-panel">
            <div className="live-panel-header">
              <div>
                <p className="live-panel-kicker">ASR runtime</p>
                <h2>Service details</h2>
              </div>
            </div>

            <div className="mic-runtime-grid">
              <div className="mic-runtime-card">
                <span>Model</span>
                <strong>{health?.whisperModel || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>Device</span>
                <strong>{health?.whisperDevice || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>Compute</span>
                <strong>{health?.whisperComputeType || 'Unknown'}</strong>
              </div>
              <div className="mic-runtime-card">
                <span>VAD</span>
                <strong>{health ? `${health.vadMode} • ${health.frameMs}ms` : 'Unknown'}</strong>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

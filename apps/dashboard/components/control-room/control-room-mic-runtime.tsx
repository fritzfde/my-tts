'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildMicWsUrl, getMicHealth } from '@/lib/api/mic';
import {
  computeInputLevel,
  downsampleToPcm16,
  type WindowWithWebkitAudioContext
} from '@/lib/mic-browser';
import { DEFAULT_MIC_ASR_BASE_URL } from '@/lib/mic-settings';
import { registerMicRuntime } from '@/lib/runtime/mic-runtime';
import { useMicStore } from '@/lib/stores/mic-store';
import type { MicTranscriptEvent } from '@/lib/types/mic';

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

function summarizeTranscript(event: MicTranscriptEvent) {
  if (event.type === 'speaker_ignored') return 'Voice mismatch';
  if (event.type === 'ignored') return 'Ignored transcript';
  if (event.type === 'error') return 'ASR error';
  return event.text || 'Transcript';
}

export function ControlRoomMicRuntime() {
  const asrBaseUrl = useMicStore((state) => state.asrBaseUrl);
  const language = useMicStore((state) => state.language);
  const triggerMode = useMicStore((state) => state.triggerMode);
  const voiceGateEnabled = useMicStore((state) => state.voiceGateEnabled);
  const voiceProfile = useMicStore((state) => state.voiceProfile);
  const voiceMatchThreshold = useMicStore((state) => state.voiceMatchThreshold);
  const health = useMicStore((state) => state.health);
  const healthError = useMicStore((state) => state.healthError);
  const listening = useMicStore((state) => state.listening);
  const connecting = useMicStore((state) => state.connecting);
  const enrolling = useMicStore((state) => state.enrolling);
  const micLevel = useMicStore((state) => state.micLevel);
  const status = useMicStore((state) => state.status);
  const transcripts = useMicStore((state) => state.transcripts);
  const clearTranscripts = useMicStore((state) => state.clearTranscripts);
  const setHealth = useMicStore((state) => state.setHealth);
  const setListeningState = useMicStore((state) => state.setListeningState);
  const setMicLevel = useMicStore((state) => state.setMicLevel);
  const prependTranscript = useMicStore((state) => state.prependTranscript);
  const setNotice = useMicStore((state) => state.setNotice);
  const setError = useMicStore((state) => state.setError);

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkNodeRef = useRef<GainNode | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const recentTranscripts = useMemo(() => transcripts.slice(0, 6), [transcripts]);
  const dockVisible = listening || connecting || recentTranscripts.length > 0;

  const teardownAudio = useCallback(() => {
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
  }, [setMicLevel]);

  const stopListening = useCallback(() => {
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
  }, [setListeningState, teardownAudio]);

  const pushTranscript = useCallback(
    (event: MicTranscriptEvent) => {
      prependTranscript(event);
      setCollapsed(false);
    },
    [prependTranscript]
  );

  const refreshHealth = useCallback(async () => {
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
  }, [asrBaseUrl, connecting, listening, setHealth, setListeningState, triggerMode]);

  const startListening = useCallback(async () => {
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
    setCollapsed(false);

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
  }, [
    asrBaseUrl,
    clearTranscripts,
    connecting,
    enrolling,
    language,
    listening,
    pushTranscript,
    refreshHealth,
    setError,
    setListeningState,
    setMicLevel,
    triggerMode,
    voiceGateEnabled,
    voiceMatchThreshold,
    voiceProfile
  ]);

  useEffect(() => {
    const unregister = registerMicRuntime({
      startListening,
      stopListening
    });
    return unregister;
  }, [startListening, stopListening]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  useEffect(() => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    try {
      socketRef.current.send(
        JSON.stringify(
          voiceGateEnabled
            ? {
                type: 'speaker_profile',
                enabled: true,
                threshold: voiceMatchThreshold,
                profile: voiceProfile
              }
            : { type: 'speaker_profile', enabled: false }
        )
      );
      setNotice(voiceGateEnabled ? 'Updated live mic voice gate settings.' : 'Live mic voice gate disabled.');
    } catch {
      // ignore runtime sync issues; next reconnect will resync
    }
  }, [setNotice, voiceGateEnabled, voiceMatchThreshold, voiceProfile]);

  useEffect(() => {
    if (dockVisible) {
      setCollapsed(false);
    }
  }, [dockVisible, recentTranscripts.length]);

  if (!dockVisible) {
    return null;
  }

  return (
    <div className={`control-room-mic-dock${collapsed ? ' is-collapsed' : ''}`}>
      <button
        type="button"
        className="control-room-mic-dock-peek"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span>Mic runtime</span>
        <strong>{listening ? 'Active' : connecting ? 'Connecting' : `${recentTranscripts.length} events`}</strong>
      </button>

      {!collapsed ? (
        <div className="control-room-mic-dock-body">
          <div className="control-room-mic-dock-header">
            <div>
              <p className="control-room-mic-dock-kicker">Global mic dock</p>
              <strong>{status}</strong>
              <small>
                {health?.ok ? `${health.whisperModel} • ${health.whisperDevice}` : (healthError || 'Health unknown')} • {triggerMode === 'suggest' ? 'Suggestion mode' : 'Auto trigger'}
              </small>
            </div>
            <div className="control-room-mic-dock-actions">
              <button type="button" className="control-room-runtime-button" onClick={stopListening} disabled={!listening && !connecting}>
                Stop
              </button>
              <button type="button" className="control-room-runtime-button is-ghost" onClick={() => clearTranscripts()}>
                Clear log
              </button>
              <button type="button" className="control-room-runtime-button is-ghost" onClick={() => setCollapsed(true)}>
                Collapse
              </button>
            </div>
          </div>

          <div className="control-room-mic-dock-controls">
            <div className="control-room-mic-dock-stat">
              <span>Voice gate</span>
              <strong>{voiceGateEnabled ? `On • ${formatPercent(voiceMatchThreshold)}` : 'Off'}</strong>
            </div>
            <div className="control-room-mic-dock-stat">
              <span>Mic level</span>
              <div className="control-room-level-bar">
                <div className="control-room-level-bar-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            </div>
          </div>

          <div className="control-room-mic-transcripts">
            {recentTranscripts.map((event) => (
              <article key={event.id} className={`control-room-mic-transcript control-room-mic-transcript-${event.type}`}>
                <div>
                  <strong>{summarizeTranscript(event)}</strong>
                  <span>{event.detail}</span>
                </div>
                <time dateTime={new Date(event.timestamp).toISOString()}>{formatClock(event.timestamp)}</time>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

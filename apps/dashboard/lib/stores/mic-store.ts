'use client';

import { create } from 'zustand';
import { buildMicSettingsRecord, parseMicSettings } from '@/lib/mic-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { MicHealth, MicSettingsState, MicTranscriptEvent } from '@/lib/types/mic';

const MAX_TRANSCRIPT_EVENTS = 50;

const defaultSettingsState: MicSettingsState = {
  asrBaseUrl: 'http://127.0.0.1:8001',
  language: 'auto',
  triggerMode: 'auto',
  voiceGateEnabled: false,
  voiceProfile: null,
  voicePreviewDataUrl: '',
  voiceMatchThreshold: 0.74
};

type MicStoreState = MicSettingsState & {
  scope: string;
  rawSettings: PersistedSettingsRecord;
  health: MicHealth | null;
  healthError: string;
  listening: boolean;
  connecting: boolean;
  enrolling: boolean;
  micLevel: number;
  status: string;
  transcripts: MicTranscriptEvent[];
  notice: string;
  error: string;
  hydrated: boolean;
  hydrate: (payload: { scope: string; rawSettings: PersistedSettingsRecord }) => void;
  commitSettingsState: (value: MicSettingsState, rawSettings?: PersistedSettingsRecord) => void;
  setAsrBaseUrl: (value: string) => void;
  setLanguage: (value: string) => void;
  setTriggerMode: (value: MicSettingsState['triggerMode']) => void;
  setVoiceGateEnabled: (value: boolean) => void;
  setVoiceProfile: (value: MicSettingsState['voiceProfile']) => void;
  setVoicePreviewDataUrl: (value: string) => void;
  setVoiceMatchThreshold: (value: number) => void;
  setHealth: (value: MicHealth | null, error?: string) => void;
  setListeningState: (value: { listening?: boolean; connecting?: boolean; enrolling?: boolean; status?: string }) => void;
  setMicLevel: (value: number) => void;
  prependTranscript: (value: MicTranscriptEvent) => void;
  clearTranscripts: () => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
};

export const useMicStore = create<MicStoreState>((set) => ({
  ...defaultSettingsState,
  scope: 'local-dev',
  rawSettings: {},
  health: null,
  healthError: '',
  listening: false,
  connecting: false,
  enrolling: false,
  micLevel: 0,
  status: 'Mic is inactive.',
  transcripts: [],
  notice: '',
  error: '',
  hydrated: false,
  hydrate: ({ scope, rawSettings }) => {
    const parsed = parseMicSettings(rawSettings);
    set({
      scope,
      rawSettings,
      ...parsed,
      hydrated: true,
      notice: '',
      error: ''
    });
  },
  commitSettingsState: (value, rawSettings) =>
    set((state) => ({
      ...value,
      rawSettings: rawSettings || buildMicSettingsRecord(state.rawSettings, value)
    })),
  setAsrBaseUrl: (value) => set({ asrBaseUrl: String(value || '').trim() }),
  setLanguage: (value) => set({ language: String(value || '').trim().toLowerCase() || 'auto' }),
  setTriggerMode: (value) => set({ triggerMode: value === 'suggest' ? 'suggest' : 'auto' }),
  setVoiceGateEnabled: (value) => set({ voiceGateEnabled: value === true }),
  setVoiceProfile: (value) => set({ voiceProfile: value }),
  setVoicePreviewDataUrl: (value) => set({ voicePreviewDataUrl: String(value || '').trim() }),
  setVoiceMatchThreshold: (value) => set({ voiceMatchThreshold: Math.max(0.6, Math.min(0.95, Number(value) || 0.74)) }),
  setHealth: (value, error = '') =>
    set({
      health: value,
      healthError: error
    }),
  setListeningState: (value) =>
    set((state) => ({
      listening: value.listening ?? state.listening,
      connecting: value.connecting ?? state.connecting,
      enrolling: value.enrolling ?? state.enrolling,
      status: value.status ?? state.status
    })),
  setMicLevel: (value) =>
    set({
      micLevel: Math.max(0, Math.min(1, Number(value) || 0))
    }),
  prependTranscript: (value) =>
    set((state) => ({
      transcripts: [value, ...state.transcripts].slice(0, MAX_TRANSCRIPT_EVENTS)
    })),
  clearTranscripts: () => set({ transcripts: [] }),
  setNotice: (value) => set({ notice: value, error: '' }),
  setError: (value) => set({ error: value, notice: '' })
}));

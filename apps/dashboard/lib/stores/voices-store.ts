'use client';

import { create } from 'zustand';
import { buildVoicesSettingsRecord, parseVoicesSettings } from '@/lib/voices-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { VoicesSettingsState } from '@/lib/types/voices';

type VoicesStoreState = VoicesSettingsState & {
  scope: string;
  rawSettings: PersistedSettingsRecord;
  clonedVoices: string[];
  notice: string;
  error: string;
  hydrated: boolean;
  hydrate: (payload: {
    scope: string;
    rawSettings: PersistedSettingsRecord;
    clonedVoices: string[];
  }) => void;
  setClonedVoices: (value: string[]) => void;
  commitSettingsState: (value: VoicesSettingsState, rawSettings?: PersistedSettingsRecord) => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
};

const defaultState: VoicesSettingsState = {
  youtubeDefaultVoice: '',
  tiktokDefaultVoice: '',
  autoGenderDetection: false,
  defaultMaleVoice: '',
  defaultFemaleVoice: '',
  ollamaBaseUrl: 'http://localhost:11434',
  customVoiceLanguages: {},
  hiddenVoices: [],
  enabledLanguages: ['en', 'de', 'es', 'uk', 'ru'],
  userVoices: {},
  recentUsers: [],
  userDisplayNames: {},
  previewText: 'This is a voice preview for the control room.',
  previewVolume: 100
};

export const useVoicesStore = create<VoicesStoreState>((set) => ({
  ...defaultState,
  scope: 'local-dev',
  rawSettings: {},
  clonedVoices: [],
  notice: '',
  error: '',
  hydrated: false,
  hydrate: ({ scope, rawSettings, clonedVoices }) => {
    const parsed = parseVoicesSettings(rawSettings);
    set({
      scope,
      rawSettings,
      clonedVoices,
      ...parsed,
      hydrated: true,
      notice: '',
      error: ''
    });
  },
  setClonedVoices: (value) =>
    set({
      clonedVoices: value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    }),
  commitSettingsState: (value, rawSettings) =>
    set((state) => ({
      ...value,
      rawSettings: rawSettings || buildVoicesSettingsRecord(state.rawSettings, value)
    })),
  setNotice: (value) => set({ notice: value, error: '' }),
  setError: (value) => set({ error: value, notice: '' })
}));


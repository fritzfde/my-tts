'use client';

import { create } from 'zustand';
import { buildPersistedSettingsRecord, parseSoundSettings } from '@/lib/sounds-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { SoundFile, SoundSettingsState } from '@/lib/types/sounds';

type SoundsStoreState = SoundSettingsState & {
  scope: string;
  rawSettings: PersistedSettingsRecord;
  sounds: SoundFile[];
  selectedSoundPath: string;
  activeSoundPath: string;
  notice: string;
  error: string;
  hydrated: boolean;
  hydrate: (payload: {
    scope: string;
    rawSettings: PersistedSettingsRecord;
    sounds: SoundFile[];
  }) => void;
  setKeywordFilter: (value: string) => void;
  setGlobalVolume: (value: number) => void;
  setViewerChatTriggersEnabled: (value: boolean) => void;
  setSelectedSoundPath: (value: string) => void;
  setActiveSoundPath: (value: string) => void;
  setSounds: (value: SoundFile[]) => void;
  upsertSound: (value: SoundFile) => void;
  removeSound: (soundPath: string) => void;
  commitSettingsState: (value: SoundSettingsState) => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
};

const defaultSettingsState: SoundSettingsState = {
  keywordFilter: '',
  globalVolume: 100,
  viewerChatTriggersEnabled: true,
  soundKeywords: {},
  soundKeywordEnabled: {},
  soundVoiceKeywordEnabled: {},
  soundVolumes: {},
  rules: []
};

export const useSoundsStore = create<SoundsStoreState>((set) => ({
  ...defaultSettingsState,
  scope: 'local-dev',
  rawSettings: {},
  sounds: [],
  selectedSoundPath: '',
  activeSoundPath: '',
  notice: '',
  error: '',
  hydrated: false,
  hydrate: ({ scope, rawSettings, sounds }) => {
    const parsed = parseSoundSettings(rawSettings);
    set({
      scope,
      rawSettings,
      sounds,
      ...parsed,
      selectedSoundPath: sounds[0]?.path || '',
      hydrated: true,
      notice: '',
      error: ''
    });
  },
  setKeywordFilter: (value) => set({ keywordFilter: String(value || '').trim().toLowerCase().replace(/\s+/g, ' ') }),
  setGlobalVolume: (value) => set({ globalVolume: Math.min(100, Math.max(0, Math.round(Number(value) || 0))) }),
  setViewerChatTriggersEnabled: (value: boolean) => set({ viewerChatTriggersEnabled: value === true }),
  setSelectedSoundPath: (value) => set({ selectedSoundPath: value }),
  setActiveSoundPath: (value) => set({ activeSoundPath: value }),
  setSounds: (value) =>
    set((state) => ({
      sounds: value,
      selectedSoundPath: value.some((entry) => entry.path === state.selectedSoundPath)
        ? state.selectedSoundPath
        : (value[0]?.path || ''),
      activeSoundPath: value.some((entry) => entry.path === state.activeSoundPath)
        ? state.activeSoundPath
        : ''
    })),
  upsertSound: (value) =>
    set((state) => {
      const existing = state.sounds.filter((entry) => entry.path !== value.path);
      const nextSounds = [...existing, value].sort((left, right) => left.name.localeCompare(right.name));
      return {
        sounds: nextSounds,
        selectedSoundPath: state.selectedSoundPath || value.path
      };
    }),
  removeSound: (soundPath) =>
    set((state) => {
      const nextSounds = state.sounds.filter((entry) => entry.path !== soundPath);
      const nextKeywords = { ...state.soundKeywords };
      const nextViewer = { ...state.soundKeywordEnabled };
      const nextVoice = { ...state.soundVoiceKeywordEnabled };
      const nextVolumes = { ...state.soundVolumes };
      delete nextKeywords[soundPath];
      delete nextViewer[soundPath];
      delete nextVoice[soundPath];
      delete nextVolumes[soundPath];
      const nextSettingsState: SoundSettingsState = {
        keywordFilter: state.keywordFilter,
        globalVolume: state.globalVolume,
        viewerChatTriggersEnabled: state.viewerChatTriggersEnabled,
        soundKeywords: nextKeywords,
        soundKeywordEnabled: nextViewer,
        soundVoiceKeywordEnabled: nextVoice,
        soundVolumes: nextVolumes,
        rules: state.rules.map((rule) => (rule.soundPath === soundPath ? { ...rule, soundPath: '' } : rule))
      };
      return {
        sounds: nextSounds,
        selectedSoundPath:
          state.selectedSoundPath === soundPath ? (nextSounds[0]?.path || '') : state.selectedSoundPath,
        activeSoundPath: state.activeSoundPath === soundPath ? '' : state.activeSoundPath,
        ...nextSettingsState,
        rawSettings: buildPersistedSettingsRecord(state.rawSettings, nextSettingsState)
      };
    }),
  commitSettingsState: (value) =>
    set((state) => ({
      ...value,
      rawSettings: buildPersistedSettingsRecord(state.rawSettings, value)
    })),
  setNotice: (value) => set({ notice: value, error: '' }),
  setError: (value) => set({ error: value, notice: '' })
}));

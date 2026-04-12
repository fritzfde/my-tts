'use client';

import { create } from 'zustand';
import {
  buildAnimationSettingsRecord,
  normalizeAnimationConfig,
  parseAnimationUiState,
  syncAnimationMappingsWithFiles
} from '@/lib/animations-settings';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { AnimationConfig, AnimationFile, AnimationUiState, AnimationMapping } from '@/lib/types/animations';

type AnimationsStoreState = AnimationUiState & {
  scope: string;
  rawSettings: PersistedSettingsRecord;
  config: AnimationConfig;
  animations: AnimationFile[];
  selectedTrigger: string;
  activeTrigger: string;
  notice: string;
  error: string;
  hydrated: boolean;
  hydrate: (payload: {
    scope: string;
    rawSettings: PersistedSettingsRecord;
    config: AnimationConfig;
    animations: AnimationFile[];
  }) => void;
  setKeywordFilter: (value: string) => void;
  setViewerChatTriggersEnabled: (value: boolean) => void;
  setConfig: (value: AnimationConfig) => void;
  setAnimations: (value: AnimationFile[]) => void;
  setSelectedTrigger: (value: string) => void;
  setActiveTrigger: (value: string) => void;
  commitUiState: (value: AnimationUiState, rawSettings?: PersistedSettingsRecord) => void;
  replaceConfig: (value: AnimationConfig, rawSettings?: PersistedSettingsRecord) => void;
  upsertAnimation: (value: AnimationFile) => void;
  removeAnimationByFilename: (filename: string) => void;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
};

const defaultUiState: AnimationUiState = {
  keywordFilter: '',
  viewerChatTriggersEnabled: true
};

const defaultConfig: AnimationConfig = normalizeAnimationConfig(null);

function chooseSelectedTrigger(config: AnimationConfig, preferred = '') {
  if (preferred && Object.prototype.hasOwnProperty.call(config.mappings, preferred)) {
    return preferred;
  }
  return Object.keys(config.mappings).sort((a, b) => a.localeCompare(b))[0] || '';
}

export const useAnimationsStore = create<AnimationsStoreState>((set) => ({
  ...defaultUiState,
  scope: 'local-dev',
  rawSettings: {},
  config: defaultConfig,
  animations: [],
  selectedTrigger: '',
  activeTrigger: '',
  notice: '',
  error: '',
  hydrated: false,
  hydrate: ({ scope, rawSettings, config, animations }) => {
    const uiState = parseAnimationUiState(rawSettings);
    const normalizedConfig: AnimationConfig = {
      ...normalizeAnimationConfig(config),
      mappings: syncAnimationMappingsWithFiles(normalizeAnimationConfig(config).mappings, animations)
    };
    set({
      scope,
      rawSettings,
      animations,
      ...uiState,
      config: normalizedConfig,
      selectedTrigger: chooseSelectedTrigger(normalizedConfig),
      hydrated: true,
      notice: '',
      error: ''
    });
  },
  setKeywordFilter: (value) => set({ keywordFilter: String(value || '').trim().toLowerCase().replace(/\s+/g, ' ') }),
  setViewerChatTriggersEnabled: (value) => set({ viewerChatTriggersEnabled: value === true }),
  setConfig: (value) =>
    set((state) => ({
      config: value,
      selectedTrigger: chooseSelectedTrigger(value, state.selectedTrigger),
      activeTrigger: Object.prototype.hasOwnProperty.call(value.mappings, state.activeTrigger) ? state.activeTrigger : ''
    })),
  setAnimations: (value) =>
    set((state) => {
      const syncedConfig: AnimationConfig = {
        ...state.config,
        mappings: syncAnimationMappingsWithFiles(state.config.mappings, value)
      };
      return {
        animations: value,
        config: syncedConfig,
        selectedTrigger: chooseSelectedTrigger(syncedConfig, state.selectedTrigger),
        activeTrigger: Object.prototype.hasOwnProperty.call(syncedConfig.mappings, state.activeTrigger) ? state.activeTrigger : ''
      };
    }),
  setSelectedTrigger: (value) => set({ selectedTrigger: value }),
  setActiveTrigger: (value) => set({ activeTrigger: value }),
  commitUiState: (value, rawSettings) =>
    set((state) => ({
      ...value,
      rawSettings: rawSettings || buildAnimationSettingsRecord(state.rawSettings, value, state.config)
    })),
  replaceConfig: (value, rawSettings) =>
    set((state) => ({
      config: value,
      rawSettings: rawSettings || buildAnimationSettingsRecord(state.rawSettings, {
        keywordFilter: state.keywordFilter,
        viewerChatTriggersEnabled: state.viewerChatTriggersEnabled
      }, value),
      selectedTrigger: chooseSelectedTrigger(value, state.selectedTrigger),
      activeTrigger: Object.prototype.hasOwnProperty.call(value.mappings, state.activeTrigger) ? state.activeTrigger : ''
    })),
  upsertAnimation: (value) =>
    set((state) => {
      const nextAnimations = [...state.animations.filter((entry) => entry.filename !== value.filename), value]
        .sort((a, b) => a.name.localeCompare(b.name));
      const nextMappings = syncAnimationMappingsWithFiles(state.config.mappings, nextAnimations);
      const nextConfig = { ...state.config, mappings: nextMappings };
      const nextTrigger = Object.entries(nextMappings).find(([, mapping]) => mapping.file === value.filename)?.[0] || '';
      return {
        animations: nextAnimations,
        config: nextConfig,
        selectedTrigger: nextTrigger || chooseSelectedTrigger(nextConfig, state.selectedTrigger)
      };
    }),
  removeAnimationByFilename: (filename) =>
    set((state) => {
      const nextAnimations = state.animations.filter((entry) => entry.filename !== filename);
      const nextMappings: Record<string, AnimationMapping> = {};
      Object.entries(state.config.mappings).forEach(([trigger, mapping]) => {
        if (mapping.file !== filename) {
          nextMappings[trigger] = mapping;
        }
      });
      const nextConfig = {
        ...state.config,
        mappings: syncAnimationMappingsWithFiles(nextMappings, nextAnimations)
      };
      return {
        animations: nextAnimations,
        config: nextConfig,
        selectedTrigger: chooseSelectedTrigger(nextConfig, state.selectedTrigger),
        activeTrigger: state.activeTrigger && Object.prototype.hasOwnProperty.call(nextConfig.mappings, state.activeTrigger)
          ? state.activeTrigger
          : ''
      };
    }),
  setNotice: (value) => set({ notice: value, error: '' }),
  setError: (value) => set({ error: value, notice: '' })
}));

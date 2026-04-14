'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { listKnownTikTokGiftNames } from '@/lib/api/platforms';
import { deleteSound, generateSoundKeywords, listSounds, uploadSound } from '@/lib/api/sounds';
import { saveSettings } from '@/lib/api/settings';
import { stopGlobalSoundPreview, toggleGlobalSoundPreview } from '@/lib/runtime/sound-runtime';
import {
  applySoundDraftToState,
  buildKnownGiftNamesRecord,
  buildPersistedSettingsRecord,
  buildSoundDraft,
  createSoundAlertRule,
  describeSoundRule,
  normalizeSoundPath,
  parseKnownGiftNames,
  parseKeywordList,
  resolveLinkedAnimationsForRule,
  SOUND_EVENT_LABELS
} from '@/lib/sounds-settings';
import { useSoundsStore } from '@/lib/stores/sounds-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { SoundAlertRule, SoundEventType, SoundFile, SoundSettingsDraft, SoundSettingsState } from '@/lib/types/sounds';

type SoundsPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialSounds: SoundFile[];
};

const RULE_EVENT_OPTIONS: Array<{ value: SoundEventType; label: string }> = [
  { value: 'gift_any', label: SOUND_EVENT_LABELS.gift_any },
  { value: 'gift_name', label: SOUND_EVENT_LABELS.gift_name },
  { value: 'gift_value', label: SOUND_EVENT_LABELS.gift_value },
  { value: 'follow', label: SOUND_EVENT_LABELS.follow },
  { value: 'share', label: SOUND_EVENT_LABELS.share },
  { value: 'join', label: SOUND_EVENT_LABELS.join },
  { value: 'leave', label: SOUND_EVENT_LABELS.leave }
];

function isLifecycleEventType(eventType: SoundEventType) {
  return eventType === 'join' || eventType === 'leave';
}

function getRuleConditionType(eventType: SoundEventType) {
  if (eventType === 'gift_name') return 'gift_name';
  if (eventType === 'gift_value') return 'gift_value';
  return '';
}

export function SoundsPageClient({ initialScope, initialSettings, initialSounds }: SoundsPageClientProps) {
  const hydrate = useSoundsStore((state) => state.hydrate);
  const hydrated = useSoundsStore((state) => state.hydrated);
  const scope = useSoundsStore((state) => state.scope);
  const rawSettings = useSoundsStore((state) => state.rawSettings);
  const sounds = useSoundsStore((state) => state.sounds);
  const keywordFilter = useSoundsStore((state) => state.keywordFilter);
  const globalVolume = useSoundsStore((state) => state.globalVolume);
  const viewerChatTriggersEnabled = useSoundsStore((state) => state.viewerChatTriggersEnabled);
  const soundKeywords = useSoundsStore((state) => state.soundKeywords);
  const soundKeywordEnabled = useSoundsStore((state) => state.soundKeywordEnabled);
  const soundVoiceKeywordEnabled = useSoundsStore((state) => state.soundVoiceKeywordEnabled);
  const soundVolumes = useSoundsStore((state) => state.soundVolumes);
  const rules = useSoundsStore((state) => state.rules);
  const selectedSoundPath = useSoundsStore((state) => state.selectedSoundPath);
  const activeSoundPath = useSoundsStore((state) => state.activeSoundPath);
  const notice = useSoundsStore((state) => state.notice);
  const error = useSoundsStore((state) => state.error);
  const setKeywordFilter = useSoundsStore((state) => state.setKeywordFilter);
  const setGlobalVolume = useSoundsStore((state) => state.setGlobalVolume);
  const setViewerChatTriggersEnabled = useSoundsStore((state) => state.setViewerChatTriggersEnabled);
  const setSelectedSoundPath = useSoundsStore((state) => state.setSelectedSoundPath);
  const setSounds = useSoundsStore((state) => state.setSounds);
  const upsertSound = useSoundsStore((state) => state.upsertSound);
  const removeSound = useSoundsStore((state) => state.removeSound);
  const commitSettingsState = useSoundsStore((state) => state.commitSettingsState);
  const setNotice = useSoundsStore((state) => state.setNotice);
  const setError = useSoundsStore((state) => state.setError);

  const [draft, setDraft] = useState<SoundSettingsDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRefreshingGifts, setIsRefreshingGifts] = useState(false);
  const initializedRef = useRef(false);
  const filterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalVolumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerGatePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings,
      sounds: initialSounds
    });
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings, initialSounds]);

  const selectedSound = useMemo(
    () => sounds.find((entry) => entry.path === selectedSoundPath) || null,
    [selectedSoundPath, sounds]
  );

  const currentSettingsState = useMemo<SoundSettingsState>(
    () => ({
      keywordFilter,
      globalVolume,
      viewerChatTriggersEnabled,
      soundKeywords,
      soundKeywordEnabled,
      soundVoiceKeywordEnabled,
      soundVolumes,
      rules
    }),
    [
      globalVolume,
      keywordFilter,
      rules,
      soundKeywordEnabled,
      soundKeywords,
      soundVoiceKeywordEnabled,
      soundVolumes,
      viewerChatTriggersEnabled
    ]
  );

  const knownGiftNames = useMemo(() => parseKnownGiftNames(rawSettings), [rawSettings]);

  useEffect(() => {
    if (!selectedSound) {
      setDraft(null);
      return;
    }
    setDraft(buildSoundDraft(selectedSound.path, currentSettingsState));
  }, [currentSettingsState, selectedSound]);

  useEffect(() => {
    return () => {
      if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
      if (globalVolumePersistTimerRef.current) clearTimeout(globalVolumePersistTimerRef.current);
      if (viewerGatePersistTimerRef.current) clearTimeout(viewerGatePersistTimerRef.current);
    };
  }, []);

  async function persistSettingsState(nextState: SoundSettingsState, nextRawSettings?: PersistedSettingsRecord) {
    const resolvedRawSettings = nextRawSettings || buildPersistedSettingsRecord(rawSettings, nextState);
    await saveSettings(resolvedRawSettings, scope);
    commitSettingsState(nextState, resolvedRawSettings);
  }

  useEffect(() => {
    if (!hydrated) return;
    if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    filterPersistTimerRef.current = setTimeout(() => {
      void persistSettingsState(currentSettingsState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save filter');
      });
    }, 350);

    return () => {
      if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    };
  }, [hydrated, keywordFilter]);

  useEffect(() => {
    if (!hydrated) return;
    if (globalVolumePersistTimerRef.current) clearTimeout(globalVolumePersistTimerRef.current);
    globalVolumePersistTimerRef.current = setTimeout(() => {
      void persistSettingsState(currentSettingsState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save global volume');
      });
    }, 250);

    return () => {
      if (globalVolumePersistTimerRef.current) clearTimeout(globalVolumePersistTimerRef.current);
    };
  }, [globalVolume, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (viewerGatePersistTimerRef.current) clearTimeout(viewerGatePersistTimerRef.current);
    viewerGatePersistTimerRef.current = setTimeout(() => {
      void persistSettingsState(currentSettingsState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save global viewer chat gate');
      });
    }, 200);

    return () => {
      if (viewerGatePersistTimerRef.current) clearTimeout(viewerGatePersistTimerRef.current);
    };
  }, [hydrated, viewerChatTriggersEnabled]);

  const filteredSounds = useMemo(() => {
    if (!keywordFilter) return sounds;
    return sounds.filter((sound) => {
      const haystack = [sound.name, sound.path, ...(soundKeywords[sound.path] || [])].join(' ').toLowerCase();
      return haystack.includes(keywordFilter);
    });
  }, [keywordFilter, soundKeywords, sounds]);

  const keywordCount = useMemo(
    () => Object.values(soundKeywords).reduce((sum, keywords) => sum + keywords.length, 0),
    [soundKeywords]
  );

  function stopPreview() {
    stopGlobalSoundPreview();
  }

  async function handlePlaySound(soundPath: string) {
    const normalizedPath = normalizeSoundPath(soundPath);
    if (!normalizedPath) return;
    try {
      await toggleGlobalSoundPreview(normalizedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play sound');
    }
  }

  async function handleRefreshSounds() {
    setIsRefreshing(true);
    try {
      const nextSounds = await listSounds();
      setSounds(nextSounds);
      setNotice('Sound library refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh sounds');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleRefreshGiftNames() {
    setIsRefreshingGifts(true);
    try {
      const fetchedNames = await listKnownTikTokGiftNames();
      const mergedNames = Array.from(new Set([...knownGiftNames, ...fetchedNames])).sort((left, right) =>
        left.localeCompare(right)
      );
      const nextRawSettings = buildKnownGiftNamesRecord(rawSettings, mergedNames);
      await persistSettingsState(currentSettingsState, nextRawSettings);
      setNotice(mergedNames.length > 0 ? 'Gift names refreshed from TikTok.' : 'No TikTok gift names available right now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh TikTok gifts');
    } finally {
      setIsRefreshingGifts(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uploaded = await uploadSound(file);
      upsertSound(uploaded);
      setSelectedSoundPath(uploaded.path);

      let keywordWarning = '';
      try {
        const keywordResult = await generateSoundKeywords(uploaded.path);
        const generatedKeywords = parseKeywordList(keywordResult.keywords);
        keywordWarning = keywordResult.warning;
        if (generatedKeywords.length > 0) {
          const nextState: SoundSettingsState = {
            ...currentSettingsState,
            soundKeywords: {
              ...soundKeywords,
              [uploaded.path]: generatedKeywords
            },
            soundKeywordEnabled: Object.prototype.hasOwnProperty.call(soundKeywordEnabled, uploaded.path)
              ? soundKeywordEnabled
              : { ...soundKeywordEnabled, [uploaded.path]: false },
            soundVoiceKeywordEnabled: Object.prototype.hasOwnProperty.call(soundVoiceKeywordEnabled, uploaded.path)
              ? soundVoiceKeywordEnabled
              : { ...soundVoiceKeywordEnabled, [uploaded.path]: false }
          };
          await persistSettingsState(nextState);
        }
      } catch (keywordError) {
        keywordWarning = keywordError instanceof Error ? keywordError.message : 'Keyword generation failed';
      }

      setNotice(
        keywordWarning
          ? `Uploaded ${uploaded.name}. Keywords generated with warning: ${keywordWarning}`
          : `Uploaded ${uploaded.name}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload sound');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(sound: SoundFile) {
    if (!window.confirm(`Delete ${sound.name}?`)) return;
    try {
      if (activeSoundPath === sound.path) {
        stopPreview();
      }
      await deleteSound(sound.path);
      removeSound(sound.path);
      const nextStore = useSoundsStore.getState();
      await saveSettings(nextStore.rawSettings, nextStore.scope);
      setNotice(`Deleted ${sound.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete sound');
    }
  }

  async function handleSaveDraft() {
    if (!selectedSound || !draft) return;
    setIsSaving(true);
    try {
      const nextState = applySoundDraftToState(selectedSound.path, currentSettingsState, draft);
      await persistSettingsState(nextState);
      setNotice(`Saved settings for ${selectedSound.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sound settings');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerateKeywords() {
    if (!selectedSound) return;
    setIsGenerating(true);
    try {
      const result = await generateSoundKeywords(selectedSound.path);
      setDraft((current) => ({
        keywordsText: parseKeywordList(result.keywords).join('\n'),
        viewerChatEnabled: current?.viewerChatEnabled ?? false,
        voiceEnabled: current?.voiceEnabled ?? false,
        volume: current?.volume ?? 100
      }));
      setNotice(
        result.warning ? `Keywords generated with warning: ${result.warning}` : `Keywords generated for ${selectedSound.name}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate keywords');
    } finally {
      setIsGenerating(false);
    }
  }

  async function persistRules(nextRules: SoundAlertRule[]) {
    const nextState: SoundSettingsState = {
      ...currentSettingsState,
      rules: nextRules
    };
    await persistSettingsState(nextState);
  }

  async function handleAddRule() {
    try {
      await persistRules([...rules, createSoundAlertRule({ eventType: 'gift_any' })]);
      setNotice('Added a new alert rule.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add alert rule');
    }
  }

  async function updateRule(ruleId: string, updater: (rule: SoundAlertRule) => SoundAlertRule) {
    const nextRules = rules.map((rule) => (rule.id === ruleId ? updater({ ...rule }) : rule));
    await persistRules(nextRules);
  }

async function handleRuleEventTypeChange(ruleId: string, nextType: string) {
    const normalizedType = RULE_EVENT_OPTIONS.some((option) => option.value === nextType)
      ? (nextType as SoundEventType)
      : 'gift_any';
    try {
      await updateRule(ruleId, (rule) => {
        const updated = createSoundAlertRule({ ...rule, eventType: normalizedType });
        if (getRuleConditionType(updated.eventType) === '') {
          updated.eventValue = '';
        }
        if (!isLifecycleEventType(updated.eventType)) {
          updated.recurringOnly = false;
          updated.minStaySeconds = 0;
        }
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event type');
    }
  }

  async function handleRuleValueChange(ruleId: string, value: string) {
    try {
      await updateRule(ruleId, (rule) => createSoundAlertRule({ ...rule, eventValue: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule value');
    }
  }

  async function handleRuleSoundChange(ruleId: string, soundPath: string) {
    try {
      await updateRule(ruleId, (rule) => ({ ...rule, soundPath: normalizeSoundPath(soundPath) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update sound selection');
    }
  }

  async function handleRuleEnabledChange(ruleId: string, enabled: boolean) {
    try {
      await updateRule(ruleId, (rule) => ({ ...rule, enabled }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule status');
    }
  }

  async function handleRuleRecurringChange(ruleId: string, recurringOnly: boolean) {
    try {
      await updateRule(ruleId, (rule) => ({ ...rule, recurringOnly }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update recurring setting');
    }
  }

  async function handleRuleStayChange(ruleId: string, nextValue: string) {
    try {
      await updateRule(ruleId, (rule) => ({
        ...rule,
        minStaySeconds: Math.max(0, Math.floor(Number(nextValue) || 0))
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update minimum stay time');
    }
  }

  async function handleDeleteRule(ruleId: string) {
    try {
      await persistRules(rules.filter((rule) => rule.id !== ruleId));
      setNotice('Deleted alert rule.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete alert rule');
    }
  }

  return (
    <section className="sounds-page">
      <header className="sounds-page-hero">
        <div>
          <p className="feature-page-eyebrow">First Real React Slice</p>
          <h2>Sound Alerts</h2>
          <p className="sounds-page-summary">
            This page is backed by the live legacy API and persisted settings store. It now covers the core sound
            library and sound rule editing, while animation linkage remains visible as external context until the
            animation slice is migrated.
          </p>
        </div>
        <div className="sounds-page-stats" aria-label="Sound library stats">
          <article>
            <span>Sounds</span>
            <strong>{sounds.length}</strong>
          </article>
          <article>
            <span>Keywords</span>
            <strong>{keywordCount}</strong>
          </article>
          <article>
            <span>Alert rules</span>
            <strong>{rules.length}</strong>
          </article>
        </div>
      </header>

      <section className="sounds-toolbar">
        <label className="sounds-toolbar-field">
          <span>Filter by keyword</span>
          <input
            type="search"
            value={keywordFilter}
            onChange={(event) => setKeywordFilter(event.target.value)}
            placeholder="Search name, path, or keyword"
          />
        </label>

        <label className="sounds-toolbar-field sounds-toolbar-volume">
          <span>Global sound volume</span>
          <div className="sounds-toolbar-range-row">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={globalVolume}
              onChange={(event) => setGlobalVolume(Number(event.target.value))}
            />
            <strong>{globalVolume}%</strong>
          </div>
        </label>

        <label className="sounds-inline-toggle">
          <input
            type="checkbox"
            checked={viewerChatTriggersEnabled}
            onChange={(event) => setViewerChatTriggersEnabled(event.target.checked)}
          />
          <span>Viewer chat can trigger sounds globally</span>
        </label>

        <div className="sounds-toolbar-actions">
          <label className="sounds-upload-button">
            <input type="file" accept=".mp3,.wav,.ogg,audio/*" onChange={(event) => void handleUpload(event.target.files)} />
            <span>{isUploading ? 'Uploading…' : 'Upload sound'}</span>
          </label>
          <button type="button" className="sounds-secondary-button" onClick={() => void handleRefreshSounds()}>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </section>

      {(notice || error) && (
        <div className={error ? 'sounds-feedback sounds-feedback-error' : 'sounds-feedback'} role="status">
          {error || notice}
        </div>
      )}

      <div className="sounds-layout-grid">
        <section className="sounds-library-panel">
          <div className="sounds-panel-header">
            <h3>Library</h3>
            <span>{filteredSounds.length} visible</span>
          </div>

          <div className="sounds-library-grid">
            {filteredSounds.length === 0 ? (
              <div className="sounds-empty-state">No sounds match the current filter.</div>
            ) : (
              filteredSounds.map((sound) => {
                const keywords = soundKeywords[sound.path] || [];
                const summary = keywords.length > 0
                  ? `${keywords.length} keyword${keywords.length === 1 ? '' : 's'}${soundKeywordEnabled[sound.path] ? ' • Viewer chat' : ''}${soundVoiceKeywordEnabled[sound.path] ? ' • Voice' : ''}`
                  : 'No keywords';
                const isActive = activeSoundPath === sound.path;
                const isSelected = selectedSoundPath === sound.path;
                return (
                  <article
                    key={sound.path}
                    className={`sound-card${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                  >
                    <button type="button" className="sound-card-main" onClick={() => void handlePlaySound(sound.path)}>
                      <span className="sound-card-title">{sound.name}</span>
                      <span className="sound-card-summary">{summary}</span>
                      <span className="sound-card-hover-action">{isActive ? 'Stop' : 'Play'}</span>
                    </button>
                    <div className="sound-card-actions">
                      <button type="button" className="sounds-secondary-button" onClick={() => setSelectedSoundPath(sound.path)}>
                        Settings
                      </button>
                      <button type="button" className="sounds-danger-button" onClick={() => void handleDelete(sound)}>
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="sounds-editor-panel">
          <div className="sounds-panel-header">
            <h3>Sound settings</h3>
            <span>{selectedSound ? selectedSound.name : 'Select a sound'}</span>
          </div>

          {selectedSound && draft ? (
            <div className="sounds-editor-form">
              <div className="sounds-editor-actions">
                <button type="button" className="sounds-secondary-button" onClick={() => void handlePlaySound(selectedSound.path)}>
                  {activeSoundPath === selectedSound.path ? 'Stop preview' : 'Play preview'}
                </button>
                <button type="button" className="sounds-secondary-button" onClick={() => void handleGenerateKeywords()}>
                  {isGenerating ? 'Generating…' : 'Generate keywords'}
                </button>
              </div>

              <label className="sounds-editor-field">
                <span>Keywords</span>
                <textarea
                  rows={10}
                  value={draft.keywordsText}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, keywordsText: event.target.value } : current))
                  }
                  placeholder="One keyword per line"
                />
              </label>

              <div className="sounds-editor-check-grid">
                <label className="sounds-toggle">
                  <input
                    type="checkbox"
                    checked={draft.viewerChatEnabled}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, viewerChatEnabled: event.target.checked } : current))
                    }
                  />
                  <span>Viewer chat can trigger this sound</span>
                </label>
                <label className="sounds-toggle">
                  <input
                    type="checkbox"
                    checked={draft.voiceEnabled}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, voiceEnabled: event.target.checked } : current))
                    }
                  />
                  <span>Voice trigger can activate this sound</span>
                </label>
              </div>

              <label className="sounds-editor-field">
                <span>Per-sound volume</span>
                <div className="sounds-toolbar-range-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.volume}
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, volume: Number(event.target.value) } : current))
                    }
                  />
                  <strong>{draft.volume}%</strong>
                </div>
              </label>

              <button type="button" className="sounds-primary-button" onClick={() => void handleSaveDraft()}>
                {isSaving ? 'Saving…' : 'Save sound settings'}
              </button>
            </div>
          ) : (
            <div className="sounds-empty-state sounds-empty-state-editor">
              Select a sound from the library to edit its keywords, toggles, and volume.
            </div>
          )}
        </aside>
      </div>

      <section className="sounds-rules-panel">
        <div className="sounds-panel-header sounds-rules-header">
          <div>
            <h3>Alert rules</h3>
            <span>Sound rule editing is now live in React</span>
          </div>
          <div className="sounds-rules-actions">
            <button type="button" className="sounds-secondary-button" onClick={() => void handleRefreshGiftNames()}>
              {isRefreshingGifts ? 'Refreshing gifts…' : 'Refresh gift names'}
            </button>
            <button type="button" className="sounds-primary-button" onClick={() => void handleAddRule()}>
              Add rule
            </button>
          </div>
        </div>

        <datalist id="soundRuleGiftNames">
          {knownGiftNames.map((giftName) => (
            <option key={giftName} value={giftName} />
          ))}
        </datalist>

        {rules.length === 0 ? (
          <div className="sounds-empty-state">No alert rules are currently saved.</div>
        ) : (
          <div className="sounds-rules-list">
            {rules.map((rule) => {
              const conditionType = getRuleConditionType(rule.eventType);
              const linkedAnimations = resolveLinkedAnimationsForRule(rule, rawSettings);
              return (
                <article key={rule.id} className={`sound-rule-card${rule.enabled ? '' : ' is-disabled'}`}>
                  <div className="sound-rule-top-row">
                    <label className="sounds-editor-field">
                      <span>Event</span>
                      <select
                        value={rule.eventType}
                        onChange={(event) => void handleRuleEventTypeChange(rule.id, event.target.value)}
                      >
                        {RULE_EVENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="sounds-toggle sounds-toggle-inline">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) => void handleRuleEnabledChange(rule.id, event.target.checked)}
                      />
                      <span>{rule.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>

                  <div className="sound-rule-grid">
                    <label className="sounds-editor-field">
                      <span>Condition</span>
                      {conditionType === 'gift_name' ? (
                        <input
                          type="text"
                          list="soundRuleGiftNames"
                          value={rule.eventValue}
                          onChange={(event) => void handleRuleValueChange(rule.id, event.target.value)}
                          placeholder="Gift name"
                        />
                      ) : conditionType === 'gift_value' ? (
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={rule.eventValue}
                          onChange={(event) => void handleRuleValueChange(rule.id, event.target.value)}
                          placeholder="Diamond value"
                        />
                      ) : isLifecycleEventType(rule.eventType) ? (
                        <div className="sound-rule-lifecycle-fields">
                          <label className="sounds-toggle sounds-toggle-inline">
                            <input
                              type="checkbox"
                              checked={rule.recurringOnly}
                              onChange={(event) => void handleRuleRecurringChange(rule.id, event.target.checked)}
                            />
                            <span>Recurring only</span>
                          </label>
                          <label className="sounds-editor-field">
                            <span>Minimum stay</span>
                            <div className="sound-rule-stay-row">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={rule.minStaySeconds > 0 ? String(rule.minStaySeconds) : ''}
                                onChange={(event) => void handleRuleStayChange(rule.id, event.target.value)}
                                placeholder="0"
                              />
                              <strong>s</strong>
                            </div>
                          </label>
                        </div>
                      ) : (
                        <div className="sounds-empty-inline">No extra condition for this event type.</div>
                      )}
                    </label>

                    <label className="sounds-editor-field">
                      <span>Sound</span>
                      <div className="sound-rule-sound-row">
                        <select
                          value={rule.soundPath}
                          onChange={(event) => void handleRuleSoundChange(rule.id, event.target.value)}
                        >
                          <option value="">No sound</option>
                          {sounds.map((sound) => (
                            <option key={sound.path} value={sound.path}>
                              {sound.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="sounds-secondary-button"
                          onClick={() => void handlePlaySound(rule.soundPath)}
                          disabled={!rule.soundPath}
                        >
                          {activeSoundPath === rule.soundPath ? 'Stop' : 'Play'}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="sound-rule-footer">
                    <div className="sound-rule-animation-linkage">
                      <span>Linked animation</span>
                      {linkedAnimations.length > 0 ? (
                        <div className="sound-rule-animation-badges">
                          {linkedAnimations.map((trigger) => (
                            <span key={trigger} className="sound-rule-animation-badge">
                              {trigger}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <strong>None linked from animation mappings yet.</strong>
                      )}
                      <small>Animation mapping still lives in the animation slice and legacy dashboard for now.</small>
                    </div>

                    <div className="sound-rule-footer-actions">
                      <button type="button" className="sounds-danger-button" onClick={() => void handleDeleteRule(rule.id)}>
                        Delete rule
                      </button>
                    </div>
                  </div>

                  <p className="sound-rule-summary">{describeSoundRule(rule)}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

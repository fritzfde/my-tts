'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteSound, generateSoundKeywords, listSounds, uploadSound } from '@/lib/api/sounds';
import { saveSettings } from '@/lib/api/settings';
import { legacyMediaUrl } from '@/lib/api/config';
import {
  applySoundDraftToState,
  buildPersistedSettingsRecord,
  describeSoundRule,
  keywordListToText,
  normalizeSoundPath,
  parseKeywordList,
  SOUND_EVENT_LABELS
} from '@/lib/sounds-settings';
import { useSoundsStore } from '@/lib/stores/sounds-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { SoundFile, SoundSettingsDraft } from '@/lib/types/sounds';

type SoundsPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialSounds: SoundFile[];
};

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
  const setActiveSoundPath = useSoundsStore((state) => state.setActiveSoundPath);
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initializedRef = useRef(false);
  const filterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalVolumePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!selectedSound) {
      setDraft(null);
      return;
    }

    setDraft({
      keywordsText: keywordListToText(soundKeywords[selectedSound.path] || []),
      viewerChatEnabled: soundKeywordEnabled[selectedSound.path] === true,
      voiceEnabled: soundVoiceKeywordEnabled[selectedSound.path] === true,
      volume: soundVolumes[selectedSound.path] ?? 100
    });
  }, [selectedSound, soundKeywordEnabled, soundKeywords, soundVoiceKeywordEnabled, soundVolumes]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (filterPersistTimerRef.current) {
        clearTimeout(filterPersistTimerRef.current);
      }
      if (globalVolumePersistTimerRef.current) {
        clearTimeout(globalVolumePersistTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current || !activeSoundPath) return;
    audioRef.current.volume = Math.min(
      1,
      Math.max(0, (globalVolume / 100) * ((soundVolumes[activeSoundPath] ?? 100) / 100))
    );
  }, [activeSoundPath, globalVolume, soundVolumes]);

  useEffect(() => {
    if (!hydrated) return;
    if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    filterPersistTimerRef.current = setTimeout(() => {
      const nextSettings = buildPersistedSettingsRecord(rawSettings, {
        keywordFilter,
        globalVolume,
        viewerChatTriggersEnabled,
        soundKeywords,
        soundKeywordEnabled,
        soundVoiceKeywordEnabled,
        soundVolumes,
        rules
      });
      void saveSettings(nextSettings, scope).catch((err) => {
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
      const nextSettings = buildPersistedSettingsRecord(rawSettings, {
        keywordFilter,
        globalVolume,
        viewerChatTriggersEnabled,
        soundKeywords,
        soundKeywordEnabled,
        soundVoiceKeywordEnabled,
        soundVolumes,
        rules
      });
      void saveSettings(nextSettings, scope).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save global volume');
      });
    }, 250);

    return () => {
      if (globalVolumePersistTimerRef.current) clearTimeout(globalVolumePersistTimerRef.current);
    };
  }, [hydrated, globalVolume]);

  useEffect(() => {
    if (!hydrated) return;
    const nextSettings = buildPersistedSettingsRecord(rawSettings, {
      keywordFilter,
      globalVolume,
      viewerChatTriggersEnabled,
      soundKeywords,
      soundKeywordEnabled,
      soundVoiceKeywordEnabled,
      soundVolumes,
      rules
    });
    const timer = setTimeout(() => {
      void saveSettings(nextSettings, scope).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save global viewer chat gate');
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [hydrated, viewerChatTriggersEnabled]);

  const filteredSounds = useMemo(() => {
    if (!keywordFilter) return sounds;
    return sounds.filter((sound) => {
      const haystack = [
        sound.name,
        sound.path,
        ...(soundKeywords[sound.path] || [])
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keywordFilter);
    });
  }, [keywordFilter, soundKeywords, sounds]);

  const keywordCount = useMemo(
    () => Object.values(soundKeywords).reduce((sum, keywords) => sum + keywords.length, 0),
    [soundKeywords]
  );

  function stopPreview() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setActiveSoundPath('');
  }

  async function handlePlaySound(soundPath: string) {
    const normalizedPath = normalizeSoundPath(soundPath);
    if (!normalizedPath) return;
    if (activeSoundPath === normalizedPath) {
      stopPreview();
      return;
    }

    stopPreview();

    const audio = new Audio(legacyMediaUrl(normalizedPath));
    audio.volume = Math.min(1, Math.max(0, (globalVolume / 100) * ((soundVolumes[normalizedPath] ?? 100) / 100)));
    audio.addEventListener('ended', () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
        setActiveSoundPath('');
      }
    });
    audio.addEventListener('pause', () => {
      if (audioRef.current === audio && audio.currentTime === 0) {
        audioRef.current = null;
        setActiveSoundPath('');
      }
    });
    audioRef.current = audio;
    setActiveSoundPath(normalizedPath);
    try {
      await audio.play();
    } catch (err) {
      audioRef.current = null;
      setActiveSoundPath('');
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
          const nextState = {
            keywordFilter,
            globalVolume,
            viewerChatTriggersEnabled,
            soundKeywords: {
              ...soundKeywords,
              [uploaded.path]: generatedKeywords
            },
            soundKeywordEnabled: Object.prototype.hasOwnProperty.call(soundKeywordEnabled, uploaded.path)
              ? soundKeywordEnabled
              : { ...soundKeywordEnabled, [uploaded.path]: false },
            soundVoiceKeywordEnabled: Object.prototype.hasOwnProperty.call(soundVoiceKeywordEnabled, uploaded.path)
              ? soundVoiceKeywordEnabled
              : { ...soundVoiceKeywordEnabled, [uploaded.path]: false },
            soundVolumes: soundVolumes,
            rules
          };
          await persistSettingsFromState(nextState);
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

  async function persistSettingsFromState(nextState: ReturnType<typeof applySoundDraftToState>) {
    const nextRaw = buildPersistedSettingsRecord(rawSettings, nextState);
    await saveSettings(nextRaw, scope);
    commitSettingsState(nextState);
  }

  async function handleSaveDraft() {
    if (!selectedSound || !draft) return;
    setIsSaving(true);
    try {
      const nextState = applySoundDraftToState(selectedSound.path, {
        keywordFilter,
        globalVolume,
        viewerChatTriggersEnabled,
        soundKeywords,
        soundKeywordEnabled,
        soundVoiceKeywordEnabled,
        soundVolumes,
        rules
      }, draft);
      await persistSettingsFromState(nextState);
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
        keywordsText: keywordListToText(parseKeywordList(result.keywords)),
        viewerChatEnabled: current?.viewerChatEnabled ?? false,
        voiceEnabled: current?.voiceEnabled ?? false,
        volume: current?.volume ?? 100
      }));
      setNotice(result.warning ? `Keywords generated with warning: ${result.warning}` : `Keywords generated for ${selectedSound.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate keywords');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="sounds-page">
      <header className="sounds-page-hero">
        <div>
          <p className="feature-page-eyebrow">First Real React Slice</p>
          <h2>Sound Alerts</h2>
          <p className="sounds-page-summary">
            This page is now backed by the live legacy API. We are using it to establish typed wrappers, persisted
            settings handling, reusable cards, and a practical React state shape before moving on to animations.
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
                  onChange={(event) => setDraft((current) => current ? { ...current, keywordsText: event.target.value } : current)}
                  placeholder="One keyword per line"
                />
              </label>

              <div className="sounds-editor-check-grid">
                <label className="sounds-toggle">
                  <input
                    type="checkbox"
                    checked={draft.viewerChatEnabled}
                    onChange={(event) => setDraft((current) => current ? { ...current, viewerChatEnabled: event.target.checked } : current)}
                  />
                  <span>Viewer chat can trigger this sound</span>
                </label>
                <label className="sounds-toggle">
                  <input
                    type="checkbox"
                    checked={draft.voiceEnabled}
                    onChange={(event) => setDraft((current) => current ? { ...current, voiceEnabled: event.target.checked } : current)}
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
                    onChange={(event) => setDraft((current) => current ? { ...current, volume: Number(event.target.value) } : current)}
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
        <div className="sounds-panel-header">
          <h3>Alert rules</h3>
          <span>React editor is the next step</span>
        </div>
        {rules.length === 0 ? (
          <div className="sounds-empty-state">No alert rules are currently saved.</div>
        ) : (
          <div className="sounds-rules-table-wrapper">
            <table className="sounds-rules-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Condition</th>
                  <th>Sound</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{SOUND_EVENT_LABELS[rule.eventType]}</td>
                    <td>{rule.enabled ? 'Enabled' : 'Disabled'}</td>
                    <td>{describeSoundRule(rule)}</td>
                    <td>{sounds.find((entry) => entry.path === rule.soundPath)?.name || 'No sound selected'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}

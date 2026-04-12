export type PersistedSettingsRecord = Record<string, string>;

export type SettingsPayload = {
  scope: string;
  settings: PersistedSettingsRecord;
};

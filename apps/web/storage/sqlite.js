const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_ANIMATION_CONFIG = {
  enabled: true,
  mappings: {},
  globalPosition: 'bottom-left',
  globalScale: 1.0,
  animationVolume: 100,
  chroma: {
    greenThreshold: 70,
    tolerance: 60,
    spillReduction: 0.5
  }
};

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseJsonRows(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  return JSON.parse(text);
}

class SqliteStorage {
  constructor({ dbFile, legacyAnimationConfigFile } = {}) {
    this.dbFile = dbFile || path.resolve(process.cwd(), 'data', 'app-settings.sqlite');
    this.legacyAnimationConfigFile = legacyAnimationConfigFile || path.resolve(process.cwd(), 'animation-config.json');
  }

  runSql(sql, options = {}) {
    const args = [];
    if (options.json) args.push('-json');
    args.push(this.dbFile);

    return execFileSync('sqlite3', args, {
      input: sql,
      encoding: 'utf8'
    });
  }

  normalizeAnimationConfig(config = {}) {
    return {
      enabled: config.enabled ?? true,
      mappings: config.mappings || {},
      globalPosition: config.globalPosition || 'bottom-left',
      globalScale: config.globalScale || 1.0,
      animationVolume: config.animationVolume ?? 100,
      chroma: config.chroma || { greenThreshold: 70, tolerance: 60, spillReduction: 0.5 }
    };
  }

  init() {
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    this.runSql(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS app_settings (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(scope, key)
      );
      CREATE TABLE IF NOT EXISTS animation_configs (
        name TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const configCount = Number(String(this.runSql('SELECT COUNT(*) FROM animation_configs;')).trim() || '0');
    if (configCount > 0) return;

    let seedConfigs = { default: DEFAULT_ANIMATION_CONFIG };
    if (fs.existsSync(this.legacyAnimationConfigFile)) {
      try {
        const legacyRaw = fs.readFileSync(this.legacyAnimationConfigFile, 'utf8');
        const legacyParsed = JSON.parse(legacyRaw);
        if (legacyParsed && typeof legacyParsed === 'object' && Object.keys(legacyParsed).length > 0) {
          seedConfigs = legacyParsed;
          console.log('✓ Imported animation configs from legacy animation-config.json into SQLite');
        }
      } catch (err) {
        console.warn('Failed to import legacy animation-config.json, using defaults:', err.message);
      }
    }

    Object.entries(seedConfigs).forEach(([name, config]) => {
      this.saveAnimationConfig(name, config);
    });
  }

  getSettings(scope) {
    const rows = parseJsonRows(this.runSql(
      `SELECT key, value FROM app_settings WHERE scope = ${sqlQuote(scope)};`,
      { json: true }
    ));

    const settings = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    return settings;
  }

  saveSettings(scope, settings = {}) {
    const entries = Object.entries(settings);
    const statements = [
      'BEGIN;',
      `DELETE FROM app_settings WHERE scope = ${sqlQuote(scope)};`
    ];

    entries.forEach(([key, value]) => {
      statements.push(
        `INSERT INTO app_settings(scope, key, value, updated_at) VALUES(${sqlQuote(scope)}, ${sqlQuote(key)}, ${sqlQuote(value)}, CURRENT_TIMESTAMP);`
      );
    });

    statements.push('COMMIT;');
    this.runSql(statements.join('\n'));
  }

  getAnimationConfig(name) {
    const rows = parseJsonRows(this.runSql(
      `SELECT config_json FROM animation_configs WHERE name = ${sqlQuote(name)} LIMIT 1;`,
      { json: true }
    ));

    if (rows.length === 0 && name !== 'default') {
      return this.getAnimationConfig('default');
    }

    if (rows.length === 0) {
      return DEFAULT_ANIMATION_CONFIG;
    }

    return this.normalizeAnimationConfig(JSON.parse(rows[0].config_json));
  }

  saveAnimationConfig(name, config) {
    const normalized = this.normalizeAnimationConfig(config);
    this.runSql(`
      INSERT INTO animation_configs(name, config_json, updated_at)
      VALUES(${sqlQuote(name)}, ${sqlQuote(JSON.stringify(normalized))}, CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET
        config_json = excluded.config_json,
        updated_at = CURRENT_TIMESTAMP;
    `);
    return normalized;
  }

  listAnimationConfigNames() {
    const rows = parseJsonRows(this.runSql(
      'SELECT name FROM animation_configs ORDER BY name ASC;',
      { json: true }
    ));
    return rows.map((row) => row.name);
  }

  deleteAnimationConfig(name) {
    this.runSql(`DELETE FROM animation_configs WHERE name = ${sqlQuote(name)};`);
  }
}

module.exports = {
  SqliteStorage,
  DEFAULT_ANIMATION_CONFIG
};

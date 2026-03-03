const path = require('path');
const { SqliteStorage } = require('./sqlite');

function createStorage({ driver = 'sqlite', baseDir = process.cwd(), sqlite = {} } = {}) {
  if (driver === 'sqlite') {
    return new SqliteStorage({
      dbFile: sqlite.dbFile || path.join(baseDir, 'data', 'app-settings.sqlite'),
      legacyAnimationConfigFile: sqlite.legacyAnimationConfigFile || path.join(baseDir, 'animation-config.json')
    });
  }

  if (driver === 'postgres') {
    throw new Error('DB_DRIVER=postgres is not implemented yet. Use DB_DRIVER=sqlite for now.');
  }

  throw new Error(`Unsupported DB_DRIVER "${driver}"`);
}

module.exports = {
  createStorage
};

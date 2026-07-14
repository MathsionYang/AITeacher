(function initAITeacherStorage(global) {
  "use strict";

  const STORAGE_SCHEMA_VERSION = 3;
  const DEFAULT_NAMESPACE = "ai-teacher-rj-math";

  const COLLECTIONS = {
    mistakes: "mistakes",
    schedule: "schedule",
    coursewareReviews: "courseware_reviews",
    scoreHistory: "score_history",
    roleMode: "role_mode"
  };

  const SQLITE_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS courseware_reviews (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS practice_sets (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS grading_submissions (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, confidence REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS mistakes (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS score_history (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, score INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);"
  ];

  function createLocalJsonStorage(options = {}) {
    const namespace = options.namespace || DEFAULT_NAMESPACE;
    const schemaVersion = options.schemaVersion || STORAGE_SCHEMA_VERSION;

    function getRaw(key) {
      return global.localStorage ? global.localStorage.getItem(key) : null;
    }

    function setRaw(key, value) {
      if (!global.localStorage) return;
      global.localStorage.setItem(key, value);
    }

    function getJson(key, fallback) {
      try {
        const raw = getRaw(key);
        return raw ? JSON.parse(raw) : cloneJson(fallback);
      } catch (error) {
        return cloneJson(fallback);
      }
    }

    function setJson(key, value) {
      setRaw(key, JSON.stringify(value));
    }

    function getString(key, fallback = "") {
      const value = getRaw(key);
      return value == null ? fallback : value;
    }

    function setString(key, value) {
      setRaw(key, String(value));
    }

    function remove(key) {
      if (!global.localStorage) return;
      global.localStorage.removeItem(key);
    }

    function removeMany(keys) {
      keys.forEach(remove);
    }

    function buildEnvelope(type, data, metadata = {}) {
      return {
        schemaVersion,
        storageKind: "local-json",
        namespace,
        type,
        exportedAt: new Date().toISOString(),
        exportVersion: metadata.exportVersion || `${type}-v${schemaVersion}`,
        ...metadata,
        data
      };
    }

    function sqliteMigrationPlan() {
      return {
        target: "sqlite",
        schemaVersion,
        collections: COLLECTIONS,
        schema: SQLITE_SCHEMA,
        strategy: [
          "导出 local-json envelope",
          "创建 SQLite schema",
          "按 collection 将 JSON payload 写入对应表",
          "保留 schemaVersion/exportVersion/reviewStatus 用于回滚和兼容导入"
        ]
      };
    }

    return {
      kind: "local-json",
      namespace,
      schemaVersion,
      getJson,
      setJson,
      getString,
      setString,
      remove,
      removeMany,
      buildEnvelope,
      sqliteMigrationPlan
    };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  const api = {
    STORAGE_SCHEMA_VERSION,
    COLLECTIONS,
    SQLITE_SCHEMA,
    createLocalJsonStorage
  };

  global.AITeacherStorage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

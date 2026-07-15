(function initAITeacherStorage(global) {
  "use strict";

  const STORAGE_SCHEMA_VERSION = 7;
  const DEFAULT_NAMESPACE = "ai-teacher-rj-math";

  const COLLECTIONS = {
    mistakes: "mistakes",
    schedule: "schedule",
    coursewareReviews: "courseware_reviews",
    scoreHistory: "score_history",
    roleMode: "role_mode",
    generationCache: "generation_cache",
    pptPlans: "ppt_plans",
    accounts: "accounts",
    subjectScope: "subject_scope",
    modelSettings: "model_settings",
    generationRecords: "generation_records",
    gradingSubmissions: "grading_submissions"
  };

  const SQLITE_SCHEMA = [
    "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, role TEXT NOT NULL, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS teacher_profiles (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL, subject_scope_json TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS model_settings (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, base_url TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS textbook_scopes (id TEXT PRIMARY KEY, publisher TEXT NOT NULL, subject_id TEXT NOT NULL, grade_id TEXT NOT NULL, volume_id TEXT NOT NULL, unit_id TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS courseware_reviews (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS coursewares (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, title TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS courseware_versions (id TEXT PRIMARY KEY, courseware_id TEXT NOT NULL, version_no INTEGER NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS practice_sets (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS scheduled_papers (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, frequency TEXT NOT NULL, total_score INTEGER NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS papers (id TEXT PRIMARY KEY, creator_account_id TEXT, paper_type TEXT NOT NULL, scope_key TEXT NOT NULL, title TEXT NOT NULL, total_score INTEGER NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, knowledge_point TEXT NOT NULL, question_type TEXT NOT NULL, difficulty TEXT NOT NULL, answer TEXT NOT NULL, review_status TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS paper_questions (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, question_id TEXT NOT NULL, order_no INTEGER NOT NULL, point INTEGER NOT NULL, payload_json TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS grading_submissions (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, confidence REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS ocr_records (id TEXT PRIMARY KEY, submission_id TEXT, image_ref TEXT, recognized_text TEXT NOT NULL, average_confidence REAL NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS mistakes (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS score_history (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, score INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS generation_cache (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS generation_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, scope_key TEXT NOT NULL, source TEXT, item_count INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS ppt_plans (id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, review_status TEXT NOT NULL, export_version TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);"
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
          "保留 schemaVersion/exportVersion/reviewStatus 用于回滚和兼容导入",
          "后端上线时由 Go 或 Java 服务接管教师账号、教材范围、课件、试卷、生成记录、OCR 和本地判分记录"
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

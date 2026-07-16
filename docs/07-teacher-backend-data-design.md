# 教师端与后端数据设计

## 1. 当前 MVP 边界

当前只做教师端：

- 登录页只开放教师登录。
- 教师端只保留课件生成、同步出题、周期测验出题、系统设置。
- 不做学生端、班级管理、学生管理。
- 不做学生作答、自动判分、OCR 批改、错题库和成绩趋势。
- 本地数据先保存在 localStorage，当前数据层 schemaVersion 为 8。
- 后续如需要服务端，优先用 Go 或 Java + SQLite/本地数据库承接。

## 2. 本地集合

```text
accounts
subjectScope
modelSettings
coursewareReviews
pptPlans
generationCache
generationRecords
schedule
```

历史课件、同步出题记录和周期测验记录在教师端支持本机删除。删除只移除对应 localStorage/后端记录，不删除知识点包，也不影响已导出的 PDF/PPTX/JSON 文件。

## 3. 推荐数据库表

```text
accounts
  id, role, username, password_hash, display_name, status, payload_json, created_at, updated_at

teacher_profiles
  id, account_id, name, subject_scope_json, payload_json, created_at, updated_at

model_settings
  id, provider, model, base_url, payload_json, updated_at

textbook_scopes
  id, publisher, subject_id, grade_id, volume_id, unit_id, payload_json, updated_at

coursewares
  id, scope_key, title, review_status, export_version, payload_json, created_at, updated_at

courseware_versions
  id, courseware_id, version_no, review_status, export_version, payload_json, created_at

practice_sets
  id, scope_key, review_status, export_version, payload_json, updated_at

scheduled_papers
  id, scope_key, frequency, question_count, total_score, review_status, export_version, payload_json, created_at, updated_at

papers
  id, creator_account_id, paper_type, scope_key, title, total_score, review_status, export_version, payload_json, created_at, updated_at

questions
  id, unit_id, knowledge_point, question_type, difficulty, answer, review_status, payload_json, created_at, updated_at

paper_questions
  id, paper_id, question_id, order_no, point, payload_json

generation_cache
  id, scope_key, kind, payload_json, updated_at

generation_records
  id, kind, scope_key, source, item_count, deleted_at, payload_json, created_at

ppt_plans
  id, scope_key, review_status, export_version, payload_json, updated_at
```

当前推荐业务 schema 不包含 `classes`、`students`、`student_id`，也不包含学生提交、OCR 批改和成绩趋势表。旧版本地字段如需迁移，可作为 legacy payload 兼容读取。

## 4. 迁移路线

1. 本机导出 local-json envelope。
2. 后端读取 `schemaVersion`、`exportVersion` 和 `sqliteMigrationPlan`。
3. 按 collection 写入对应表。
4. 早期版本以 `payload_json` 为主，避免频繁拆字段。
5. 如未来重新引入在线作答端，再单独设计账号、作业、提交、OCR、判分、错题和权限表。

## 5. 权限原则

- 模型和 Agent 不决定权限。
- 教师登录、数据读写、导出权限由本地规则或后端规则控制。
- API Key 不进入代码仓库。
- 本地代理或后端模型网关负责托管真实 Key。

# 教师端与后端数据设计

## 1. 当前 MVP 边界

当前版本仍是本机前端原型：

- `login.html` 提供教师/学生两个入口，但只开放教师端。
- 教师端左侧导航固定为：导学课件、同步出题、错题库、周期测验、班级管理、系统设置。
- 默认教师账号为 `teacher / teacher123`，会话保存在 `ai-teacher-auth-session-v1`。
- 班级、学生、课件、练习、提交、错题和成绩先保存在 localStorage。
- `storage-adapter.js` schema v6 已给 SQLite 和后续 Go/Java 后端预留表结构。

本机登录只用于 MVP 演示，不是正式安全认证。正式版本必须由后端负责密码强哈希、会话、权限、审计和未成年人数据保护。

## 2. 教师端功能

- 登录教师工作台。
- 设置学科、年级、册别、单元。
- 切换当前班级，班级默认范围同步到侧栏。
- 新增/删除班级；有学生的班级不允许直接删除。
- 给当前班级添加/删除学生。
- 在系统设置中配置模型与 Agent、本地数据备份/恢复/清理和拍照/OCR 校正入口。
- 生成、审核、导入导出课件。
- 生成、导入导出同步练习。
- 保存课件生成记录、出题记录、判分提交记录、成绩记录和错题记录。

学生端暂不开放。后续开放后，学生登录应只能访问自己的练习、提交、成绩和错题。

## 3. 推荐数据库表

```text
accounts
  id, role, username, password_hash, status, created_at, updated_at

teacher_profiles
  id, account_id, name, subject_scope_json, created_at, updated_at

classes
  id, teacher_id, name, grade_id, subject_id, volume_id, status, created_at, updated_at

students
  id, class_id, account_id, name, student_no, status, created_at, updated_at

textbook_scopes
  id, publisher, subject_id, grade_id, volume_id, unit_id, payload_json, updated_at

coursewares
  id, class_id, scope_key, title, review_status, export_version, payload_json, created_at, updated_at

courseware_versions
  id, courseware_id, version_no, review_status, export_version, payload_json, created_at

papers
  id, class_id, creator_account_id, paper_type, scope_key, title, total_score, review_status, export_version, payload_json, created_at, updated_at

questions
  id, unit_id, knowledge_point, question_type, difficulty, answer, review_status, payload_json, created_at, updated_at

paper_questions
  id, paper_id, question_id, order_no, point, payload_json

submissions
  id, paper_id, class_id, student_id, origin, score, total_score, accuracy, payload_json, created_at

submission_answers
  id, submission_id, question_id, order_no, student_answer, correct_answer, is_correct, score, point, payload_json

ocr_records
  id, submission_id, image_ref, recognized_text, average_confidence, payload_json, created_at

mistakes
  id, student_id, class_id, question_id, unit_id, knowledge_point_id, student_answer, error_reason, status, review_count, next_review_at

score_records
  id, student_id, class_id, unit_id, score, total_score, accuracy, knowledge_stats, created_at

generation_records
  id, class_id, creator_account_id, kind, scope_key, source, item_count, payload_json, created_at
```

## 4. 迁移路线

1. 教师在本机导出 local-json 备份。
2. 后端读取 envelope 的 `schemaVersion`、`exportVersion` 和 `sqliteMigrationPlan`。
3. 按 collection 写入对应表：`accounts`、`classes`、`students`、`coursewares`、`papers`、`submissions`、`mistakes`、`score_records`。
4. 历史课件和试卷保留 `payload_json`，先不强行拆所有字段，避免早期 schema 频繁变动。
5. 学生端开放后，提交记录必须绑定 `student_id`；已有班级级提交可作为班级历史记录保留。

## 5. 权限原则

- 教师只能管理自己创建或被授权的班级。
- 学生只能读取自己的练习、提交、成绩和错题。
- Agent 不能决定权限，所有权限由后端规则判断。
- API Key 不进入浏览器，继续由本地代理或后端模型网关托管。
- 答题照片和 OCR 记录应支持删除、导出和最小化保存。

# 系统设计

## 1. 当前原型架构

```text
index.html
  -> styles.css
  -> data.js       人教版小学数学原创样例知识图谱
  -> app.js        课件生成、出题、判分、错题库、周期测验
  -> localStorage  本地错题库和测验设置
```

当前 MVP 是纯前端单机原型，覆盖人教版小学数学 3-6 年级，适合快速验证流程、交互和数据结构。后续产品化时应拆成前端、后端 API、内容库、AI 服务、OCR 服务和任务调度服务。

## 2. 模块拆分

### 教材知识库

职责：

- 管理教材版本、学科、年级、册别、单元；MVP 仅启用 3-6 年级。
- 管理每个单元的知识点、能力目标、题型标签。
- 为课件生成、出题和错题分析提供统一范围。

当前实现：

- `data.js` 内置 `RJ_MATH_CONTENT`，并通过 `supportedGrades` 限定 3-6 年级。
- 单元字段包括 `title`、`summary`、`tags`、`points`。

正式实现：

- 建议使用数据库表 `textbook_versions`、`subjects`、`grades`、`volumes`、`units`、`knowledge_points`。
- 教研后台负责维护知识点和审核题目。

### 课件生成

职责：

- 基于单元知识点生成课堂结构。
- 输出导入、讲解、例题、练习、小结、作业。
- 支持 Markdown/PPT 导出。

当前实现：

- `app.js` 中 `buildCoursewareSlides()` 生成结构化课件页。
- `buildCoursewareMarkdown()` 导出 Markdown。

正式实现：

- 前端提交教材范围和教学目标。
- 后端调用大模型生成初稿。
- 教研规则校验知识点覆盖和难度。
- 用户可二次编辑后导出 PPTX。

### 出题系统

职责：

- 按单元、题量、难度生成题目。
- 每题必须有答案、分值、解析、考点。
- 支持练习卷、测验卷、错题卷。

当前实现：

- `generateQuestions()` 根据知识点标签生成原创计算题、应用题、几何题和统计题。
- `state.currentQuestions` 保存当前试卷。

正式实现：

- 题库优先，AI 生成作为补充。
- 每道 AI 题必须经过规则校验：答案可计算、难度匹配、无版权风险。
- 对过程题增加步骤评分点。

### 拍照批改

职责：

- 上传答题图片。
- OCR/版面识别题号和答案。
- 对比标准答案和评分规则。
- 输出分数和解析。

当前实现：

- 文件上传和图片预览已完成。
- `answerInput` 作为 OCR 识别文本/人工校正区。
- `gradeAnswers()` 完成结构化判分。

正式实现：

```text
图片上传
  -> 图像预处理
  -> OCR/手写识别
  -> 题号答案结构化
  -> 置信度判断
  -> 低置信度人工确认
  -> 判分
  -> 解析与错因归类
```

### 错题库

职责：

- 记录错题、错因、知识点、答题时间和掌握状态。
- 支持去重、复习、标记掌握。
- 支持错题随机组卷。

当前实现：

- `localStorage` 保存 `ai-teacher-rj-math-mistakes-v1`。
- `saveMistakesFromResults()` 自动入库。
- `buildMistakePaper()` 随机生成错题卷。

正式实现：

- 用户维度持久化。
- 错题按知识点聚类。
- 增加遗忘曲线、复习间隔、掌握度评分。

### 周期测验

职责：

- 设置周期、题量、错题占比。
- 自动按当前学习范围和错题生成测验。
- 记录测验结果和掌握趋势。

当前实现：

- 本地保存周期配置。
- `buildScheduledPaper()` 立即生成周期测验。

正式实现：

- 后端任务调度。
- 微信/短信/App 推送。
- 生成测验后进入待完成状态。

## 3. 建议后端数据模型

```text
users
  id, role, name, grade, created_at

textbook_versions
  id, name, publisher, stage

subjects
  id, name, stage

units
  id, version_id, subject_id, grade, volume, title, order_no

knowledge_points
  id, unit_id, name, description, difficulty_band

questions
  id, unit_id, knowledge_point_id, type, difficulty, stem, answer, explanation, scoring_rule, source_type

papers
  id, user_id, paper_type, title, scope, total_score, created_at

paper_questions
  id, paper_id, question_id, order_no, point

submissions
  id, user_id, paper_id, image_url, recognized_text, score, created_at

submission_items
  id, submission_id, question_id, student_answer, is_correct, score, feedback

mistakes
  id, user_id, question_id, unit_id, knowledge_point_id, student_answer, error_reason, status, review_count, next_review_at

schedules
  id, user_id, frequency, question_count, mistake_ratio, active, next_run_at
```

## 4. AI/OCR 接入建议

- OCR：优先用云 OCR 或自建 PaddleOCR/TrOCR 服务，手写数学建议保留人工确认。
- 题目生成：大模型负责生成候选题，规则引擎负责校验答案。
- 判分：结构化题走确定性判分，开放题走 AI 评分 + 置信度 + 人工复核。
- 解析：大模型生成讲解，但必须引用题目、答案和知识点，避免自由发挥。
- 错因归类：先用固定枚举，再用模型辅助解释。

## 5. 隐私与版权

- 不保存不必要的学生照片。
- 答题图片和学习数据要区分家长、老师、学生权限。
- 未成年人数据要支持删除、导出和最小化存储。
- 教材内容必须使用授权目录、自建摘要或公开允许使用的内容。
- 商业题库和教辅题目必须确认授权来源。

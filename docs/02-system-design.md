# 系统设计

## 1. 当前原型架构

```text
index.html
  -> styles.css
  -> data.js       教材元数据、来源目录、知识包注册函数
  -> knowledge/    按年级和册别拆分的知识点 JS 数据包
  -> agents/       大模型与 Agent 配置声明
  -> app.js        课件生成、出题、判分、错题库、周期测验
  -> localStorage  本地错题库和测验设置
```

当前 MVP 是纯前端单机原型，覆盖人教版小学数学 3-6 年级，适合快速验证流程、交互和数据结构。产品方向保持客户电脑本地部署，不要求自建服务器；后续可把内容库、AI 调用、OCR、PDF/PPTX 导出封装为本地模块，或接入用户自行配置的模型/OCR API。

## 2. 模块拆分

### 教材知识库

职责：

- 管理教材版本、学科、年级、册别、单元；MVP 仅启用 3-6 年级。
- 管理每个单元的知识点、能力目标、题型标签。
- 为课件生成、出题和错题分析提供统一范围。

当前实现：

- `data.js` 内置 `RJ_MATH_CONTENT`、来源目录和 `registerRJMathKnowledge()` 注册函数，并通过 `supportedGrades` 限定 3-6 年级。
- `knowledge/rj-grade{n}-math-{volume}.js` 按年级、册别独立维护知识点。
- 单元字段包括 `title`、`summary`、`tags`、`points`，并继承来源文档和教材来源文件信息。

正式实现：

- 建议使用数据库表 `textbook_versions`、`subjects`、`grades`、`volumes`、`units`、`knowledge_points`。
- 教研后台负责维护知识点和审核题目。

### 课件生成

职责：

- 基于单元知识点生成课堂结构。
- 输出导入、讲解、例题、练习、小结、作业。
- 同一输入在同一模板版本下保持大致稳定。
- 每页优先使用图形、表格、数轴、流程或动画表达，文字只做辅助说明。
- 支持人工审核修改、PDF/Markdown 导出。

当前实现：

- `app.js` 中 `buildCoursewareSlides()` 生成结构化课件页，并按知识点标签选择视觉模板。
- 审核稿保存在 `localStorage` 的 `ai-teacher-rj-math-courseware-reviews-v1`。
- `buildCoursewareMarkdown()` 导出 Markdown，`window.print()` 配合打印样式导出 PDF。

正式实现：

- 本地前端提交教材范围、教学目标和知识点 JSON。
- 本地 Agent 或用户配置的大模型生成结构化初稿；模型配置参考 `.env.example`，Agent 声明参考 `agents/ai-teacher-agents.yaml`。
- 规则引擎校验知识点覆盖、来源、题型重复和版权风险。
- 用户审核后导出 PDF/Markdown，后续可扩展本地 PPTX 导出。

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

- 模型协议：参考 OfferAgent，采用 OpenAI-compatible Chat Completions；provider、model、apiKey、baseUrl、timeout、temperature、seed 均可配置。
- 安全策略：API Key 不提交、不写入代码、不建议持久化到 `localStorage`；浏览器直连失败时使用客户电脑上的本地代理或客户自有模型网关。
- 课件：大模型只基于结构化客观知识点生成课件 JSON，固定模板和低随机性参数保证稳定性。
- 视觉：Agent 负责把知识点映射为分数格、几何图、统计柱、数轴、流程图等参数化图形。
- OCR：可用本地 PaddleOCR/TrOCR，也可接入用户配置的云 OCR；手写数学建议保留人工确认。
- 题目生成：大模型负责生成候选题，规则引擎负责校验答案和题型重复度。
- 判分：结构化题走确定性判分，开放题走 AI 评分 + 置信度 + 人工复核。
- 解析：大模型生成讲解，但必须引用题目、答案和知识点，避免自由发挥。
- 错因归类：先用固定枚举，再用模型辅助解释。

详细分工见 `docs/06-llm-agent-architecture.md`。核心原则是：大模型负责理解、生成、诊断、规划；Agent 负责编排和检查；判分、题库、来源、权限和合规则尽量规则化、结构化。

## 5. 隐私与版权

- 不保存不必要的学生照片。
- 答题图片和学习数据要区分家长、老师、学生权限。
- 未成年人数据要支持删除、导出和最小化存储。
- 教材内容必须使用授权目录、自建摘要或公开允许使用的内容。
- 商业题库和教辅题目必须确认授权来源。

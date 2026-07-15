# 系统设计

## 1. 当前原型架构

```text
index.html
  -> styles.css
  -> data.js       教材元数据、来源目录、知识包注册函数
  -> knowledge/    按年级和册别拆分的知识点 JS 数据包
  -> agents/       大模型与 Agent 配置声明
  -> mock-data.js  本地测试数据，可替换
  -> scripts/local_proxy_node.js Node 本地模型代理
  -> scripts/local_proxy.py      Python 本地模型代理
  -> model-client.js       OpenAI-compatible 模型客户端
  -> agent-orchestrator.js 课件 Agent、出题 Agent、PPT 制作 Agent 编排
  -> pptx-exporter.js 本地 PPT 方案校验与 PPTX 文件生成
  -> login.html    本机教师登录入口，学生入口预留
  -> app.js        课件生成、出题、判分、错题库、周期测验
  -> storage-adapter.js  local-json 本地数据层 / SQLite 迁移 schema
```

当前 MVP 是纯前端单机原型，覆盖人教版小学数学 3-6 年级，适合快速验证流程、交互和数据结构。产品方向保持客户电脑本地部署，不要求自建服务器；内容库、AI 调用、OCR、PDF/PPTX 导出都按本地模块封装，后续可接入用户自行配置的模型/OCR API。

`mock-data.js` 用于本地测试，不和教材知识包混在一起。默认只在 localStorage 没有数据时注入测试错题、历史成绩和测验设置；需要强制覆盖本地数据时，将 `mode` 改为 `replace`。

## 2. 登录、教师端与端划分

当前 MVP 先开放教师端。`login.html` 保留教师/学生两个登录按钮，但学生登录只提示“暂未开放”；教师登录成功后写入本机 localStorage 会话并进入 `index.html`。这只是本机 MVP 认证，正式账号、密码哈希、会话、权限和审计要由后续 Go 或 Java 后端接管。

教师/教研路径：

- 登录教师端。
- 通过左侧导航进入导学课件、同步出题、错题库、周期测验、班级管理和系统设置。
- 在侧栏切换学科、年级、册别、单元和当前班级。
- 管理班级名册，新增/删除班级，添加/移除学生。
- 使用 AI 生成课件和同步练习。
- 审核课件内容、知识点来源、题目边界、答案和解析。
- 保存审核稿，导出 JSON、Markdown、PDF 或 PPTX。
- 查看已完成题目数、错题数、成绩趋势和薄弱知识点。
- 在系统设置中配置模型与 Agent、本地数据备份/恢复/清理，以及拍照/OCR 校正入口。

学生/家长路径后续开放：

- 学生通过账号登录个人空间。
- 查看教师发布或导入的导学课。
- 完成同步练习和测验。
- 提交答题照片或手动答案。
- 查看个人错题、解析和复习计划。

端划分演进：

- 阶段 1：本机教师登录 + 班级/学生名册 + 教师端工作台。
- 阶段 2：Go 或 Java 后端接管账号、班级、学生、课件、试卷、提交和 OCR 记录。
- 阶段 3：开放学生端，支持学生个人练习记录、作业提交、班级报告和权限控制。

## 3. 模块拆分

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

### 教师端与班级管理

职责：

- 保存教师账号和本地登录状态。
- 管理当前教师可见班级。
- 管理班级下学生名册。
- 班级默认年级、学科、册别可同步到侧栏范围。
- 为后续每个学生的练习记录、提交记录和错题画像预留数据维度。

当前实现：

- `login.html` 使用本地默认教师账号 `teacher / teacher123`，写入 `ai-teacher-auth-session-v1`。
- `app.js` 初始化时检查教师会话，没有会话则回到登录页。
- `classes` 默认创建“三年级一班”，教师可新增、切换、删除空班级。
- `students` 保存学生姓名、学号和所属班级，当前支持添加和移除。
- `scoreHistory`、`mistakes`、`generationRecords`、`submissions` 会带上班级信息，后续可迁移到学生维度。
- 左侧导航固定为 6 项：导学课件、同步出题、错题库、周期测验、班级管理、系统设置。拍照/OCR 校正作为同步出题和系统设置中的内部流程，不作为教师端一级导航。

正式实现：

- 后端使用 `accounts`、`teacher_profiles`、`classes`、`students`、`submissions`、`submission_answers` 等表。
- 登录态使用服务端 session 或 JWT，密码只保存强哈希。
- 学生端开放后，提交记录必须绑定 `student_id`，教师端按班级聚合查看。

### 课件生成

职责：

- 基于单元知识点生成课堂结构。
- 输出导入、讲解、例题、练习、小结、作业。
- 同一输入在同一模板版本下保持大致稳定。
- 每页优先使用图形、表格、数轴、流程或动画表达；图形必须服务知识点理解，而不是装饰。
- 支持人工审核修改、JSON 导入导出、PDF/Markdown/PPTX 导出。

当前实现：

- `app.js` 中 `buildCoursewareSlides()` 生成结构化课件页，并按知识点标签选择视觉模板。
- `renderScenarioVisual()` 会把情境导入和例题精讲优先渲染为数量关系图，例如文具购物题显示 3 个笔记本、1 支钢笔和总价算式，剩余平均分题显示总量条和 4 人分组。
- `agent-orchestrator.js` 可选调用课件 Agent，基于当前单元客观知识点生成结构化课件 JSON；也可调用 PPT 制作 Agent，把已审核课件转成结构化 `ppt_plan_json`。
- 审核稿通过 `storage-adapter.js` 写入本地 local-json 数据层，当前底层兼容 localStorage，记录包含 `reviewStatus`、`exportVersion`、`schemaVersion` 和时间戳。
- 知识点课件默认不展示模板课件；AI 课件按钮放在“知识点课件”页面内，生成过程只展示进度动画，完成模型返回和规则校验后再一次性展示审核稿。
- 课件审核稿可导出为 JSON，也可从历史 JSON 导入；导入时优先根据文件中的年级、册别、单元恢复范围。
- `buildCoursewareMarkdown()` 导出 Markdown，`window.print()` 配合打印样式导出 PDF，`pptx-exporter.js` 使用本地 Office Open XML 渲染器导出 `.pptx`。

正式实现：

- 本地前端提交教材范围、教学目标和知识点 JSON。
- 本地 Agent 或用户配置的大模型生成结构化初稿；模型配置参考 `.env.example`，Agent 声明参考 `agents/ai-teacher-agents.yaml`。
- 规则引擎校验知识点覆盖、来源、客观题型、开放题过滤和版权风险。
- 用户审核后导出 JSON、PDF、Markdown 或 PPTX。PPTX 可使用本地模板直接导出，也可先让 PPT 制作 Agent 生成排版方案再导出。

### 出题系统

职责：

- 按单元和难度生成题目，题量固定为 10 题。
- 每题必须有答案、分值、解析、考点。
- 支持练习卷、测验卷、错题卷。

当前实现：

- `generateQuestions()` 根据知识点标签生成原创选择题、填空题、计算填空题、单位换算填空题和数据填空题。
- `capQuestionCount()` 将每次组卷题量固定为 10 题。
- `validatePaper()` 要求每套同步练习覆盖当前单元全部知识点，每个知识点至少出现 1 题。
- `normalizePaperPoints()` 将当前试卷分值归一为 100 分。
- `enforceUnitQuestionBoundary()` 对进入当前试卷的题目做 `unitId`、`unitTitle`、`knowledgePoint` 校验，确保同步练习只出现所选单元知识点。
- `validateKnowledgePointRelevance()` 进一步检查题干证据，避免普通加法、乘法等无关题目只贴上当前单元知识点标签后进入试卷。
- 同步练习、错题卷和周期测验都限制在当前单元知识点边界内。
- `agent-orchestrator.js` 可选调用出题 Agent 生成候选客观题，进入试卷前仍会经过单元边界、题干与知识点匹配、客观题型、开放题过滤、题型重复和分值规则处理。
- 同步出题页面默认空白；点击 AI 生成练习时先显示进度动画，题目全部生成并通过单元边界、客观题型、开放题过滤、题型重复和 100 分制校验后再展示。
- `state.currentQuestions` 保存当前试卷，当前练习可导出为 JSON，也可导入历史练习 JSON；导出内容包含题目、答案草稿和最近判分结果。
- 同步出题页提供 `practiceAnswerInput`，可直接填写答案并调用共享判分逻辑，结果同步写入拍照批改页的 `answerInput`、成绩面板和逐题解析。

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
- `scripts/local_ocr_paddle.py` 提供本机 PaddleOCR 代理，默认监听 `http://127.0.0.1:8790/ocr`，前端点击“OCR 识别”后上传图片 Data URL。
- `answerInput` 作为 OCR 识别文本/人工校正区，也接收同步出题页答案同步；`parseAnswerReview()` 会结构化题号、答案、置信度和低置信状态。
- OCR 返回的 `answerItems`、`lines` 和置信度会进入 `parseAnswerReview()`，如果用户改动识别文本，则按手动校正重新评估。
- `gradeCurrentAnswers()` 是共享判分入口，`gradeAnswers()` 和同步出题页判分按钮都复用它。
- `scoreHistoryKey` 将每次成绩保存到浏览器本地存储。
- `renderPerformanceFeedback()` 根据分数段展示鼓励图、奖状、撒花或领奖台动画。
- `renderScoreTrends()` 根据历史成绩绘制趋势图，并按知识点统计薄弱程度。

正式实现：

```text
图片上传
  -> 图像预处理
  -> OCR/手写识别
  -> 题号答案结构化
  -> 置信度判断
  -> 低置信度人工确认
  -> 结构化题号答案进入判分
  -> 判分
  -> 解析与错因归类
```

### 错题库

职责：

- 记录错题、错因、知识点、答题时间和掌握状态。
- 支持去重、复习、标记掌握。
- 支持错题随机组卷。

当前实现：

- `storage-adapter.js` local-json 层保存 `ai-teacher-rj-math-mistakes-v1`，并在备份中提供 SQLite 迁移计划。
- `saveMistakesFromResults()` 自动入库。
- `renderMistakeStats()` 展示已完成题目数量、当前错题数量和已掌握错题数量。
- `deleteMistake()` 支持从错题库移除单题，`buildMistakePaper()` 随机生成错题卷。

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

## 4. 建议后端数据模型

```text
accounts
  id, role, username, password_hash, status, created_at, updated_at

teacher_profiles
  id, account_id, name, subject_scope_json, created_at, updated_at

classes
  id, teacher_id, name, grade_id, subject_id, volume_id, status, created_at, updated_at

students
  id, class_id, account_id, name, student_no, status, created_at, updated_at

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
  id, class_id, creator_account_id, paper_type, title, scope, total_score, review_status, created_at

paper_questions
  id, paper_id, question_id, order_no, point

submissions
  id, student_id, class_id, paper_id, origin, score, total_score, accuracy, created_at

submission_items
  id, submission_id, question_id, student_answer, is_correct, score, feedback

ocr_records
  id, submission_id, image_ref, recognized_text, average_confidence, created_at

mistakes
  id, student_id, class_id, question_id, unit_id, knowledge_point_id, student_answer, error_reason, status, review_count, next_review_at

schedules
  id, user_id, frequency, question_count, mistake_ratio, active, next_run_at

score_records
  id, student_id, class_id, unit_id, score, total_score, accuracy, knowledge_stats, created_at

generation_records
  id, class_id, creator_account_id, kind, scope, source, item_count, created_at
```

## 5. AI/OCR 接入建议

- 模型协议：参考 OfferAgent，采用 OpenAI-compatible Chat Completions；provider、model、apiKey、baseUrl、timeout、temperature、seed 均可配置。
- 当前实现：`model-client.js` 提供连接测试和 JSON 生成；页面侧栏默认选择“本地代理”，由 `scripts/local_proxy_node.js` 或 `scripts/local_proxy.py` 读取本机 `1.md`/`.env` 后转发模型请求。
- 安全策略：API Key 不提交、不写入代码、不写入 `localStorage`；推荐本地代理模式，页面 API Key 留空，Key 只存在客户电脑本地配置文件中。
- 课件：大模型只基于结构化客观知识点生成课件 JSON，固定模板和低随机性参数保证稳定性。
- 视觉：Agent 负责把知识点映射为分数格、几何图、统计柱、数轴、流程图等参数化图形。
- OCR：当前接入本地 PaddleOCR 代理；后续可替换 TrOCR、云 OCR 或客户自有 OCR 接口。手写数学建议保留人工确认。
- 题目生成：大模型负责生成候选客观题，规则引擎负责校验答案、客观题型和题型重复度。
- 判分：选择题、填空题、计算填空题等结构化题走确定性判分；说明理由、综合算式、判断改错、作图等开放题不进入当前 MVP 自动试卷。
- 解析：大模型生成讲解，但必须引用题目、答案和知识点，避免自由发挥。
- 错因归类：先用固定枚举，再用模型辅助解释。

详细分工见 `docs/06-llm-agent-architecture.md`。核心原则是：大模型负责理解、生成、诊断、规划；Agent 负责编排和检查；判分、题库、来源、权限和合规则尽量规则化、结构化。

## 6. 隐私与版权

- 不保存不必要的学生照片。
- 答题图片和学习数据要区分家长、老师、学生权限。
- 未成年人数据要支持删除、导出和最小化存储。
- 教材内容必须使用授权目录、自建摘要或公开允许使用的内容。
- 商业题库和教辅题目必须确认授权来源。

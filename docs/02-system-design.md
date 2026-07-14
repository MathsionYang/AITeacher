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
  -> agent-orchestrator.js 课件 Agent 与出题 Agent 编排
  -> app.js        课件生成、出题、判分、错题库、周期测验
  -> storage-adapter.js  local-json 本地数据层 / SQLite 迁移 schema
```

当前 MVP 是纯前端单机原型，覆盖人教版小学数学 3-6 年级，适合快速验证流程、交互和数据结构。产品方向保持客户电脑本地部署，不要求自建服务器；后续可把内容库、AI 调用、OCR、PDF/PPTX 导出封装为本地模块，或接入用户自行配置的模型/OCR API。

`mock-data.js` 用于本地测试，不和教材知识包混在一起。默认只在 localStorage 没有数据时注入测试错题、历史成绩和测验设置；需要强制覆盖本地数据时，将 `mode` 改为 `replace`。

## 2. 角色模式与端划分

当前 MVP 不拆独立教师端，采用同一个本地工具承载学生学习闭环和教师审核能力。角色差异先通过页面入口显隐、操作权限和本地字段控制，避免过早引入账号、班级和发布流复杂度。

学生/家长路径：

- 选择教材版本、年级、册别和单元。
- 查看已生成或导入的知识点课件。
- 生成或导入同步练习，在同步出题页直接填写答案。
- 完成判分、逐题解析、错题入库和周期测验。
- 查看成绩趋势和薄弱知识点。

教师/教研路径：

- 选择教材范围和知识点。
- 使用 AI 生成课件和同步练习。
- 审核课件内容、知识点来源、题目边界、答案和解析。
- 保存审核稿，导出 JSON、Markdown 或 PDF。
- 查看已完成题目数、错题数、成绩趋势和薄弱知识点。

端划分演进：

- 阶段 1：增加“教师模式/学生模式”切换；学生模式隐藏模型配置、审核编辑、内容导出和数据清理，教师模式保留生成、审核、导入导出和学情统计。
- 阶段 2：增加本地角色权限字段，配合本地数据层保存审核稿、成绩、错题和角色设置。
- 阶段 3：只有出现多学生账号、班级作业、权限控制、发布审核流和班级报告后，才拆独立教师端。

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

### 课件生成

职责：

- 基于单元知识点生成课堂结构。
- 输出导入、讲解、例题、练习、小结、作业。
- 同一输入在同一模板版本下保持大致稳定。
- 每页优先使用图形、表格、数轴、流程或动画表达；图形必须服务知识点理解，而不是装饰。
- 支持人工审核修改、JSON 导入导出、PDF/Markdown 导出。

当前实现：

- `app.js` 中 `buildCoursewareSlides()` 生成结构化课件页，并按知识点标签选择视觉模板。
- `agent-orchestrator.js` 可选调用课件 Agent，基于当前单元客观知识点生成结构化课件 JSON。
- 审核稿通过 `storage-adapter.js` 写入本地 local-json 数据层，当前底层兼容 localStorage，记录包含 `reviewStatus`、`exportVersion`、`schemaVersion` 和时间戳。
- 知识点课件默认不展示模板课件；AI 课件按钮放在“知识点课件”页面内，生成过程只展示进度动画，完成模型返回和规则校验后再一次性展示审核稿。
- 课件审核稿可导出为 JSON，也可从历史 JSON 导入；导入时优先根据文件中的年级、册别、单元恢复范围。
- `buildCoursewareMarkdown()` 导出 Markdown，`window.print()` 配合打印样式导出 PDF。

正式实现：

- 本地前端提交教材范围、教学目标和知识点 JSON。
- 本地 Agent 或用户配置的大模型生成结构化初稿；模型配置参考 `.env.example`，Agent 声明参考 `agents/ai-teacher-agents.yaml`。
- 规则引擎校验知识点覆盖、来源、客观题型、开放题过滤和版权风险。
- 用户审核后导出 JSON、PDF 或 Markdown，后续可扩展本地 PPTX 导出。

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

score_records
  id, user_id, unit_id, score, total_score, accuracy, knowledge_stats, created_at
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

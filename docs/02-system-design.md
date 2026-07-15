# AI Teacher MVP 系统设计

## 1. 当前形态

当前版本是纯本机教师端前端应用：

```text
login.html
  -> 本机教师登录
index.html
  -> 四模块教师工作台
app.js
  -> 状态、渲染、出题、课件、判分、导出
rule-engine.js
  -> 题目规则、单元边界、题型过滤、答案判定
storage-adapter.js
  -> local-json 数据层与 SQLite 迁移计划
model-client.js
  -> OpenAI-compatible 模型调用
agent-orchestrator.js
  -> 课件 Agent、出题 Agent、PPT Agent
```

不需要业务服务器。模型和 OCR 如需真实调用，分别通过客户电脑上的本地代理访问。

## 2. 信息架构

教师端一级导航：

- 课件生成
- 同步出题
- 周期测验出题
- 系统设置

隐藏的内部判分/OCR结构保留给流程复用，但不作为一级导航展示。

## 3. 状态模型

核心状态：

```text
subjectId = math
grade = 3 | 4 | 5 | 6
volume = A
unitId = 当前单元
modelSettings = provider/model/baseUrl
coursewareReviews = 课件审核稿
generationRecords = 课件/出题/测验生成历史
currentQuestions = 当前同步练习
scheduledQuestions = 当前周期测验卷
scoreHistory = 本机判分历史
```

单元同步规则：

- `coursewareUnitSelect`、`practiceUnitSelect`、`scheduleUnitSelect` 共用 `state.unitId`。
- 任一页面切换单元后调用 `setActiveUnit()`。
- 切换单元会清空当前练习和当前测验卷，防止跨单元误用。
- 系统设置只保存学科、年级、册别和模型配置。

## 4. 课件生成

输入：

- 年级、册别、单元
- 当前单元客观知识点
- 来源说明
- 教学目标

输出：

- MarkdownFlow 导学内容
- 图形化解释
- 导学互动
- 审核状态
- 导出版本号

课件记录写入 `coursewareReviews`，历史列表只显示当前单元记录。

## 5. 同步出题

流程：

1. 教师选择或继承当前单元。
2. 出题 Agent 生成候选题。
3. `rule-engine.js` 校验：
   - 单元边界
   - 当前单元知识点全覆盖
   - 固定 10 题
   - 总分 100
   - 客观题型
   - 开放题过滤
   - 答案可判定
4. 合格题进入 `currentQuestions`。
5. 生成记录写入 `generationRecords`，含题目快照。

导出：

- 空白卷 PDF
- 含答案 PDF
- JSON

## 6. 周期测验出题

周期测验与同步出题共享规则引擎。当前 MVP 不跨单元组卷，也不混入其他模块的题目。

生成结果写入：

- `state.scheduledQuestions`
- `generationRecords(kind = scheduled_paper)`

支持从历史记录载入，并导出空白卷 PDF / 含答案 PDF。

## 7. 数据层

`storage-adapter.js` schema v7 以教师端为主：

- `accounts`
- `teacher_profiles`
- `model_settings`
- `textbook_scopes`
- `coursewares`
- `courseware_versions`
- `practice_sets`
- `scheduled_papers`
- `papers`
- `questions`
- `paper_questions`
- `grading_submissions`
- `ocr_records`
- `score_history`
- `generation_cache`
- `generation_records`
- `ppt_plans`

不再设计 `classes`、`students`、`student_id` 作为当前 MVP 表结构。

## 8. UI 约束

- 左侧导航 `position: sticky; top: 0; height: 100vh; overflow-y: auto`。
- 右侧内容独立滚动。
- 页面避免重复显示年级、册别、学科设置。
- 生成页默认显示当前单元历史记录，生成完成后才展示新内容。
- 课件图形化必须服务理解，不能只做装饰。

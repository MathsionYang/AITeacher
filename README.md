# AI Teacher MVP

小学数学人教版同步学习 MVP。当前版本是一个可直接打开的本地前端原型，聚焦：

- 教材范围选择：人教版、小学数学、3-6 年级、上下册、单元
- 知识点课件：按单元生成视觉化课件，支持审核编辑、PDF/Markdown 导出
- 同步出题：只按当前所选单元知识点生成练习，最多 20 题，总分 100 分
- 拍照批改：支持上传答题照片预览，并用 OCR/手动校正文本文本完成判分
- 逐题解析：自动给出考点、答案、解题思路和错因提示
- 错题库：自动记住错题，支持随机生成错题卷
- 周期测验：配置每日/每周/每月测验计划，并生成测验卷
- 成绩反馈：100 分制保存历史成绩，按分数段展示鼓励图、奖状、撒花和领奖台动画，并分析薄弱知识点
- 大模型与 Agent：参考 OfferAgent 的 OpenAI-compatible 配置方式，只在生成、解析、诊断、规划环节使用模型

## 打开方式

直接用浏览器打开：

```text
D:\AITeacher\index.html
```

不需要安装依赖，也不需要启动服务。

## MVP 边界

- 当前内容为原创样例知识点和原创题，不包含教材原文、课本图片或商业题库。
- 拍照批改已完成上传、预览、答案解析和判分流程；真正的 OCR/手写识别作为适配器预留，当前用“模拟识别/手动校正”完成闭环。
- 判分先覆盖客观题、计算题、填空题等结构化题型；应用题过程分和开放题将在后续阶段接入更细评分规则。

## 知识点数据包

知识点按“年级 + 册别”拆成独立 JS 文件，便于后续单册替换更新：

- `knowledge/rj-grade3-math-a.js`
- `knowledge/rj-grade4-math-a.js`
- `knowledge/rj-grade5-math-a.js`
- `knowledge/rj-grade6-math-a.js`

每个 JS 文件对应 `docs/knowledge/` 下的一份客观知识点提炼文档。新增下册或其他教材版本时，新增一个知识包并在 `index.html` 中引入即可。

## 模型配置与 Agent

MVP 不配置模型也能运行，默认走本地模板、规则出题和确定性判分。页面左侧“模型与 Agent”是可选增强入口：

- 配置位置：在页面侧栏选择服务商、模型、Base URL，并填写临时 API Key
- 代码入口：`model-client.js` 负责 OpenAI-compatible `/chat/completions` 调用；`agent-orchestrator.js` 负责编排课件 Agent 和出题 Agent
- 当前能力：支持测试连接、AI 生成课件审核稿、AI 生成同步练习候选题
- 安全策略：真实 Key 不提交、不写入代码、不持久化到浏览器 localStorage，只在当前页面内存中使用
- 规则边界：AI 题目进入试卷前仍会做当前单元 `unitId`、`unitTitle`、`knowledgePoint` 校验，题量最多 20 题，总分归一为 100 分
- 本地部署：浏览器直连模型接口遇到 CORS 时，可把 Base URL 指向客户电脑上的本地代理或客户自有模型网关

环境变量样例见 `.env.example`，Agent 声明见 `agents/ai-teacher-agents.yaml`。

## Mock Data

测试数据单独放在 `mock-data.js`，页面会在 `app.js` 前加载它。默认 `mode` 为 `seed-if-empty`：本地浏览器没有历史数据时才注入 mock 错题、成绩趋势和测验设置；如果需要每次强制使用 mock 文件内容，可把 `mode` 改为 `replace`。替换测试场景时只改这个文件。

## 文档

- [MVP PRD](docs/01-mvp-prd.md)
- [系统设计](docs/02-system-design.md)
- [交付计划](docs/03-delivery-plan.md)
- [教材与题库版权合规方案](docs/04-copyright-compliance.md)
- [AI 课件生成规范](docs/05-ai-courseware-generation-spec.md)
- [大模型与 Agent 架构设计](docs/06-llm-agent-architecture.md)
- [人教版三年级数学上册客观知识点提炼](docs/knowledge/rj-grade3-math-a-objective-knowledge.md)
- [人教版四年级数学上册客观知识点提炼](docs/knowledge/rj-grade4-math-a-objective-knowledge.md)
- [人教版五年级数学上册客观知识点提炼](docs/knowledge/rj-grade5-math-a-objective-knowledge.md)
- [人教版六年级数学上册客观知识点提炼](docs/knowledge/rj-grade6-math-a-objective-knowledge.md)

# 课题通 EduForge

人教版小学数学 3-6 年级教师端本机工具。当前版本只做教师端，不做学生端、班级管理和学生管理。

## 当前模块

- 课件生成：选择单元后生成 MarkdownFlow 导学课件，支持历史课件、审核编辑、授课全屏、PDF/Markdown/PPTX/JSON 导出。
- 同步出题：直接复用当前单元，也可在本页修改单元；固定生成 10 道客观题，总分 100 分，覆盖本单元全部知识点，支持历史记录、人工审核、空白卷 PDF、含答案 PDF 和 JSON 导入导出。
- 周期测验出题：按当前单元生成固定 10 题测验卷，支持历史记录、空白卷 PDF 和含答案 PDF。
- 系统设置：只保留学科、年级、册别和模型配置。单元不在系统设置里选，课件/同步出题/周期测验任一页面修改单元后会同步到其他页面。

左侧导航固定为四项：`课件生成`、`同步出题`、`周期测验出题`、`系统设置`。侧栏采用固定高度和 sticky 布局，不随右侧长内容一起滚动。

## 打开方式

直接用浏览器打开：

```text
D:\AITeacher\login.html
```

默认教师账号：

```text
账号：teacher001
密码：123456
```

不需要安装业务服务器。真实模型调用才需要启动本地代理。

## 模型与 Agent

不配置模型也能运行，系统会使用本地模板和规则引擎生成可审核试题。

- 模型配置在 `系统设置` 中维护，推荐选择本地代理。
- `model-client.js` 负责 OpenAI-compatible `/chat/completions`。
- `agent-orchestrator.js` 编排导学课件 Agent、出题 Agent、PPT 制作 Agent。
- `rule-engine.js` 在模型之后做规则校验：单元边界、客观题型、题量固定 10、知识点全覆盖、总分 100、开放题过滤、答案可判定。

本地模型代理：

```powershell
start_aiteacher_node.bat
# 或
python scripts\local_proxy.py --key-file 1.md
```

`1.md` 示例：

```text
KEY:你的模型 Key
URL:模型服务商 OpenAI-Compatible Base URL
```

页面选择“本地代理”，Base URL 使用 `http://127.0.0.1:8787`，API Key 留空。

## OCR

当前 MVP 不做学生作答、自动判分、拍照批改和错题解析；PaddleOCR 本地代理脚本仅作为后续扩展保留。需要单独测试 OCR 能力时：

```powershell
python -m pip install paddlepaddle paddleocr
start_aiteacher_ocr.bat
```

默认 OCR 地址：`http://127.0.0.1:8790/ocr`。

## 本地数据

当前使用 localStorage，本地数据层由 `storage-adapter.js` 封装，并提供 SQLite/后端迁移计划。schema v7 按教师端设计，保留：

- 账号与教师配置
- 学科/年级/册别/单元范围
- 模型配置
- 课件审核稿和 PPT 方案
- 同步练习、周期测验、题目、生成记录
- 旧版判分/OCR 字段仅作为迁移兼容保留，不再作为当前产品模块

不再把班级、学生、学生端记录作为 MVP 数据表。

## 知识点数据包

知识点按“年级 + 册别”拆成独立 JS 文件：

- `knowledge/rj-grade3-math-a.js`
- `knowledge/rj-grade4-math-a.js`
- `knowledge/rj-grade5-math-a.js`
- `knowledge/rj-grade6-math-a.js`

每个 JS 文件对应 `docs/knowledge/` 下的一份客观知识点提炼文档。

## 测试

```powershell
node --check app.js
node scripts\run_mvp_checks.js
python -m py_compile scripts\local_ocr_paddle.py
```

## 文档

- [MVP PRD](docs/01-mvp-prd.md)
- [系统设计](docs/02-system-design.md)
- [交付计划](docs/03-delivery-plan.md)
- [教材与题库版权合规方案](docs/04-copyright-compliance.md)
- [AI 课件生成规范](docs/05-ai-courseware-generation-spec.md)
- [大模型与 Agent 架构设计](docs/06-llm-agent-architecture.md)
- [教师端与后端数据设计](docs/07-teacher-backend-data-design.md)

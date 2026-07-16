# 微信小程序与云开发方案

## 1. 结论

小程序版本不建议把大模型 URL 和 API Key 直接配置在前端。推荐使用微信云开发 / CloudBase 承接后端逻辑：小程序只负责选择年级、册别、单元和展示审核结果，云函数负责读取模型配置、调用大模型、执行规则引擎并写入云数据库。

这不是完全没有后端，而是不用自建服务器。云函数作为 Serverless 后端，替代本地 Node 代理和未来自建 Go/Java 服务的早期能力。

## 2. 当前小程序定位

- 产品名称：课题通 EduForge。
- 端类型：只做教师端，不做学生端。
- 当前功能：课件生成、同步出题、周期测验出题、我的/系统设置。
- 学科范围：小学数学，人教版，3-6 年级上册知识点包。
- 导出能力：小程序内先保留导出按钮，具体导出逻辑可后续用云函数或前端能力实现。
- 不做内容：学生作答、自动判分、OCR 批改、错题库、班级管理、学生管理。

## 3. 为什么不能直接在小程序配置 Key

- 小程序前端代码和本地缓存存在被逆向、抓包和复用的风险。
- 大模型 Key 泄露后会产生费用风险、额度风险和接口滥用风险。
- 微信小程序发布版需要合法 HTTPS request 域名，不能依赖老师电脑上的 127.0.0.1 本地代理。
- 开发工具中关闭域名校验只适合调试，不是正式架构。

因此：

```text
不要：小程序 -> 大模型 URL + API Key
推荐：小程序 -> 云函数/后端模型网关 -> 大模型
```

## 4. 推荐架构

```text
微信小程序 wapp
  -> wx.cloud.callFunction
      -> CloudBase 云函数
          -> 读取模型配置
          -> 调用 OpenAI-Compatible 大模型接口
          -> 执行规则引擎
          -> 写入云数据库
          -> 返回课件/试卷审核稿
```

云函数按职责拆分：

```text
testModel
  测试当前模型配置是否可用

generateCourseware
  输入教师端范围和单元知识点
  调用课件 Agent
  返回可审核课件稿

generateQuestions
  输入单元、题量、难度、测验类型
  调用出题 Agent
  使用规则引擎校验
  返回可审核试卷

listHistories / deleteHistory
  查询和删除历史课件、历史出题、历史测验

getSettings / saveSettings
  查询和保存教师端设置、当前模型显示状态
```

## 5. 模型配置方案

### MVP 阶段

模型配置放在云函数环境变量中：

```text
LLM_PROVIDER=qwen
LLM_MODEL=qwen-plus
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=xxx
```

修改模型 URL 时，在云开发控制台更新环境变量并重新部署/刷新云函数配置。小程序前端只显示当前模型名称和连接状态，不显示 Key。

### 正式阶段

用云数据库保存模型配置：

```text
model_settings
  _id
  provider
  model
  baseUrl
  apiKeyEncrypted
  enabled
  updatedAt
  updatedBy
```

要求：

- API Key 必须加密或放在云函数环境变量，不向小程序返回明文。
- 前端最多显示脱敏 Key，例如 sk-****abcd。
- 保存新配置前先调用 testModel 测试。
- 测试成功后再切换 enabled 配置。

## 6. 规则引擎放置位置

规则引擎应放在云函数里执行，而不是只放小程序前端。前端可保留轻量展示校验，但质量底线必须由云端执行。

规则引擎必须检查：

- 出题范围不能超过当前单元知识点边界。
- 同步出题固定 10 道题。
- 周期测验题量 10-100 题。
- 总分归一为 100 分。
- 每次生成要覆盖本单元全部知识点。
- 只允许选择题、填空题、计算填空题、单位换算填空题、数据填空题。
- 过滤说明理由题、判断改错题、作图题、开放问答题等主观题。
- 选择题必须能结构化验算，且只有一个正确答案。
- 答案必须是短标准答案，方便教师审核。

生成失败时，云函数可以让模型重试 1-2 次；仍失败则返回明确错误，不用 mock 数据冒充结果。

## 7. 云数据库集合设计

```text
teacher_profiles
  教师账号、姓名、默认学科范围

subject_scopes
  年级、册别、学科、出版社、当前单元

model_settings
  模型服务商、模型名、Base URL、Key 脱敏/加密信息

coursewares
  课件标题、单元、审核状态、版本号、slides JSON

papers
  同步练习和周期测验试卷、题目、总分、审核状态、版本号

generation_records
  生成类型、单元、模型来源、通过规则校验数量、创建时间

knowledge_packages
  可选。后续如果知识点不再打包进代码，可迁移到云数据库。
```

当前 MVP 不设计 classes、students、student_answers、ocr_records、mistakes、score_history。

## 8. 前端配置变化

小程序前端“我的/系统设置”建议只保留：

- 年级
- 学科
- 册别
- 当前模型状态
- 后端/云环境状态
- 测试连接按钮

不再让普通教师直接填写真实模型 Key。开发阶段如果需要填写地址，应该填写课题通后端 API 地址或云环境 ID，而不是大模型供应商地址。

## 9. 开发与发布路线

### 第 1 阶段：本地小程序 MVP

- 保留 wapp 当前 UI。
- 课件和出题按钮先接统一 service 层。
- service 层支持本地预览与 CloudBase 云函数两种模式切换。
- 不再新增学生端和判分模块。

### 第 2 阶段：接入 CloudBase

- 初始化云开发环境。
- 新增云函数 testModel、generateCourseware、generateQuestions。
- 将 rule-engine.js 移入云函数依赖。
- 小程序改为 wx.cloud.callFunction。
- 云函数环境变量保存模型 URL 和 Key。

### 第 3 阶段：云数据库持久化

- 生成结果写入 coursewares、papers、generation_records。
- 历史课件、历史出题、历史测验从云数据库读取。
- 删除历史记录只标记 deletedAt，便于后续审计和恢复。

### 第 4 阶段：管理化模型配置

- 增加 model_settings 集合。
- 增加模型配置测试和启用流程。
- 前端显示模型状态，不暴露明文 Key。

## 10. 和 Web/桌面版的区别

| 项目 | Web/本机版 | 小程序版 |
| --- | --- | --- |
| 模型代理 | 可用本地 Node/Python 代理 | 不适合正式使用本地代理 |
| Key 保存 | 本机配置或代理读取 | 云函数环境变量/云数据库加密保存 |
| 网络要求 | 可访问 127.0.0.1 | 发布版必须 HTTPS 合法域名或云函数 |
| 规则引擎 | 浏览器内可执行 | 云函数内必须执行 |
| 历史数据 | localStorage | 云数据库 |
| 导出 | 浏览器/PPTX/PDF 能力更强 | 先保留按钮，后续云端或小程序能力实现 |

## 11. 验收标准

- 小程序前端不包含真实大模型 Key。
- 小程序生成课件和题目时只调用云函数或后端 API。
- 云函数生成失败时返回明确错误，不使用 mock 数据冒充 AI 结果。
- 出题结果经过规则引擎校验，并返回审核状态和版本号。
- 同步出题只生成当前单元 10 道题。
- 周期测验只围绕当前单元知识点生成 10-100 道题。
- 历史课件、历史出题、历史测验支持查询和删除。
- README 能直接定位到本方案文档。


## 12. 已落地代码骨架

当前仓库已经在 `wapp/` 下预留 CloudBase 接入骨架：

- `wapp/utils/teacher-service.js`：小程序统一服务层，负责在本地预览和云函数之间切换。
- `wapp/project.config.json`：已配置 `cloudfunctionRoot: "cloudfunctions/"`。
- `wapp/cloudfunctions/testModel`：模型连通性测试云函数骨架。
- `wapp/cloudfunctions/generateCourseware`：课件生成云函数骨架。
- `wapp/cloudfunctions/generateQuestions`：出题云函数骨架。
- `wapp/data/curriculum.js`：小程序端教材范围与知识点数据，后续可迁移到云数据库。

默认 `cloudEnabled=false`，方便开发工具里本地预览 UI。正式接入时，在“我的 / 模型设置”中开启云开发并填写云环境 ID，生成按钮会走对应云函数；云函数未实现模型逻辑时会返回明确错误，不会把本地预览数据伪装成云端 AI 结果。

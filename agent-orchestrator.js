(function initAITeacherAgentOrchestrator(global) {
  "use strict";

  function createAgentOrchestrator(dependencies = {}) {
    const modelClient = dependencies.modelClient;

    async function testConnection(runtimeConfig) {
      ensureModelClient();
      return modelClient.testModelConnection(runtimeConfig);
    }

    async function generateCourseware(runtimeConfig, scope, fallbackSlides) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const payload = await modelClient.generateJson(runtimeConfig, [
        { role: "system", content: buildCoursewareSystemPrompt() },
        { role: "user", content: JSON.stringify({ scope, fallbackSlides }) }
      ]);
      return {
        source: "llm",
        agent: "courseware_agent",
        slides: Array.isArray(payload?.slides) ? payload.slides : []
      };
    }

    async function generateCoursewareStream(runtimeConfig, scope, fallbackSlides, onToken) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const generate = modelClient.generateJsonStream || modelClient.generateJson;
      const payload = await generate(runtimeConfig, [
        { role: "system", content: buildCoursewareSystemPrompt() },
        { role: "user", content: JSON.stringify({ scope, fallbackSlides }) }
      ], {}, onToken);
      return {
        source: "llm",
        agent: "courseware_agent",
        slides: Array.isArray(payload?.slides) ? payload.slides : []
      };
    }

    async function generateQuestions(runtimeConfig, scope) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const payload = await modelClient.generateJson(runtimeConfig, [
        { role: "system", content: buildQuestionSystemPrompt() },
        { role: "user", content: JSON.stringify(scope) }
      ]);
      return {
        source: "llm",
        agent: "question_agent",
        questions: Array.isArray(payload?.questions) ? payload.questions : []
      };
    }

    async function generateQuestionsStream(runtimeConfig, scope, onToken) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const generate = modelClient.generateJsonStream || modelClient.generateJson;
      const payload = await generate(runtimeConfig, [
        { role: "system", content: buildQuestionSystemPrompt() },
        { role: "user", content: JSON.stringify(scope) }
      ], {}, onToken);
      return {
        source: "llm",
        agent: "question_agent",
        questions: Array.isArray(payload?.questions) ? payload.questions : []
      };
    }

    async function generatePptPlan(runtimeConfig, scope, coursewareSlides, fallbackPlan) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const payload = await modelClient.generateJson(runtimeConfig, [
        { role: "system", content: buildPptPlanSystemPrompt() },
        { role: "user", content: JSON.stringify({ scope, coursewareSlides, fallbackPlan }) }
      ]);
      return {
        source: "llm",
        agent: "ppt_maker_agent",
        plan: payload?.plan || payload?.pptPlan || payload
      };
    }

    async function generatePptPlanStream(runtimeConfig, scope, coursewareSlides, fallbackPlan, onToken) {
      ensureModelClient();
      ensureRuntime(runtimeConfig);
      const generate = modelClient.generateJsonStream || modelClient.generateJson;
      const payload = await generate(runtimeConfig, [
        { role: "system", content: buildPptPlanSystemPrompt() },
        { role: "user", content: JSON.stringify({ scope, coursewareSlides, fallbackPlan }) }
      ], {}, onToken);
      return {
        source: "llm",
        agent: "ppt_maker_agent",
        plan: payload?.plan || payload?.pptPlan || payload
      };
    }

    function ensureModelClient() {
      if (!modelClient) throw new Error("模型客户端未加载。");
    }

    return {
      generateCourseware,
      generateCoursewareStream,
      generatePptPlan,
      generatePptPlanStream,
      generateQuestions,
      generateQuestionsStream,
      testConnection
    };
  }

  function ensureRuntime(runtimeConfig) {
    if (!runtimeConfig?.model) throw new Error("请先填写模型名称。");
  }

  function buildCoursewareSystemPrompt() {
    return [
      "你是小学数学课件 Agent，只能基于已审核知识点生成原创课件 JSON。",
      "不要复述教材原文，不要复制教材例题，不要生成课本图片描述。",
      "图形化必须服务理解知识点、数量关系、公式来源、步骤顺序或错因。",
      "情境导入和例题精讲页优先使用可图解的生活情境，例如物品数量、单价总价、已完成/剩余/平均分，并用少量文字说明图中关系。",
      "保持页数、标题顺序和 visualType 稳定，优先沿用 fallbackSlides 的结构。",
      "visualType 可用 goals、scenario、concept、practice、summary；情境导入和例题精讲优先用 scenario。",
      "scenario 页可返回 visualData，但只能使用结构化数据，不能返回 HTML、SVG、图片链接或教材原图。",
      "visualData.kind 可用 stationery、share、quantity：stationery.items 写 type/label/count/priceLabel/expression；share 写 total/done/remain/groups/each/unitLabel/expression；quantity.bars 写 label/valueLabel/width。",
      "返回 JSON 对象：{ \"slides\": [{ \"title\": string, \"body\": string, \"bullets\": string[], \"visualType\": string, \"visualData\": object|null }] }。"
    ].join("\n");
  }

  function buildQuestionSystemPrompt() {
    return [
      "你是小学数学出题 Agent，只能围绕用户当前选择单元的知识点生成原创题。",
      "不得生成其他单元、其他年级或未列入 knowledgePoints 的内容。",
      "题干内容必须能直接证明它属于所填 knowledgePoint，不能只把知识点标签贴到无关计算题上。",
      "例如混合运算题必须出现两级运算或小括号；线段图/表格数量关系题必须出现表格、线段图或明确数量关系；统计题必须出现统计表、统计图或数据读取。",
      "每次必须生成 10 道题，并覆盖当前 scope.knowledgePoints 中的全部知识点，每个知识点至少 1 道。",
      "只生成客观、易判分题型：选择题、填空题、计算填空题、单位换算填空题、数据填空题。",
      "不要生成说明理由题、综合算式题、判断改错题、开放问答题、作图题或需要人工主观判分的题。",
      "选择题必须在题干中给出 A/B/C/D 或 ①②③④ 选项，answer 只写标准选项；填空题 answer 必须是短标准答案。",
      "如果题干问‘哪个算式结果等于 N’，必须逐项验算，确保恰好一个选项等于 N，且 answer 指向该选项。",
      "questionType 必须使用上述客观题型之一；每题必须有答案、解析、题型、详细步骤、易错点和检查方法。",
      "不要复制教材原题或商业题库题目。",
      "返回 JSON 对象：{ \"questions\": [{ \"knowledgePoint\": string, \"questionType\": string, \"difficulty\": string, \"stem\": string, \"answer\": string, \"explanation\": string, \"detailSteps\": string[], \"commonMistake\": string, \"checkMethod\": string }] }。"
    ].join("\n");
  }

  function buildPptPlanSystemPrompt() {
    return [
      "你是小学数学 PPT 制作 Agent，只负责生成结构化 PPT 方案 JSON，不直接生成 PPTX、HTML、SVG 或图片。",
      "输入包含已审核课件页、知识点、来源、visualData 和本地 fallbackPlan；你必须优先沿用 fallbackPlan 的页数、知识点覆盖和视觉数据。",
      "PPT 排版要清爽、美观、适合小学数学课堂：每页一个重点，文字少，图形表达服务理解，不做装饰性堆砌。",
      "可用 layout：cover、goals、visual-left、visual-right、concept、practice、summary。情境图解页优先 visual-left 或 visual-right。",
      "每页 title 不超过 24 字，body 不超过 80 字，bullets 不超过 5 条且每条不超过 28 字。",
      "visualData 只能复用或轻微整理输入中的结构化数据，不要创造教材原图、教材原文或商业题库内容。",
      "每页必须保留 sources 或继承 fallbackPlan.sources；不得删除来源说明。",
      "返回 JSON 对象：{ \"plan\": { \"title\": string, \"subtitle\": string, \"theme\": \"math-clean\", \"pages\": [{ \"layout\": string, \"type\": string, \"title\": string, \"subtitle\": string, \"body\": string, \"bullets\": string[], \"visualKind\": string, \"visualData\": object|null, \"sources\": array }], \"sources\": array } }。"
    ].join("\n");
  }

  global.AITeacherAgentOrchestrator = {
    createAgentOrchestrator
  };
})(typeof window !== "undefined" ? window : globalThis);

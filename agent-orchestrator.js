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

    function ensureModelClient() {
      if (!modelClient) throw new Error("模型客户端未加载。");
    }

    return {
      generateCourseware,
      generateQuestions,
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
      "保持页数、标题顺序和 visualType 稳定，优先沿用 fallbackSlides 的结构。",
      "返回 JSON 对象：{ \"slides\": [{ \"title\": string, \"body\": string, \"bullets\": string[], \"visualType\": string }] }。"
    ].join("\n");
  }

  function buildQuestionSystemPrompt() {
    return [
      "你是小学数学出题 Agent，只能围绕用户当前选择单元的知识点生成原创题。",
      "不得生成其他单元、其他年级或未列入 knowledgePoints 的内容。",
      "每题必须有答案、解析、题型、详细步骤、易错点和检查方法。",
      "不要复制教材原题或商业题库题目。",
      "返回 JSON 对象：{ \"questions\": [{ \"knowledgePoint\": string, \"questionType\": string, \"difficulty\": string, \"stem\": string, \"answer\": string, \"explanation\": string, \"detailSteps\": string[], \"commonMistake\": string, \"checkMethod\": string }] }。"
    ].join("\n");
  }

  global.AITeacherAgentOrchestrator = {
    createAgentOrchestrator
  };
})(typeof window !== "undefined" ? window : globalThis);

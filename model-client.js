(function initAITeacherModelClient(global) {
  "use strict";

  const providerDefaults = {
    local_proxy: {
      label: "本地代理（推荐）",
      model: "qwen-plus",
      baseUrl: "http://127.0.0.1:8787",
      requiresApiKey: false
    },
    openai: { label: "OpenAI", model: "gpt-4.1-mini", baseUrl: "https://api.openai.com/v1" },
    deepseek: { label: "DeepSeek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
    qwen: { label: "通义千问", model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    kimi: { label: "Kimi / Moonshot", model: "moonshot-v1-8k", baseUrl: "https://api.moonshot.cn/v1" },
    custom: { label: "OpenAI-Compatible 自定义接口", model: "", baseUrl: "" }
  };

  function createModelClient(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl || global.fetch?.bind(global);
    const AbortControllerImpl = dependencies.AbortControllerImpl || global.AbortController;
    const now = dependencies.now || (() => global.performance?.now?.() ?? Date.now());
    const timeoutMs = dependencies.timeoutMs || 90000;

    async function testModelConnection(input) {
      const startedAt = now();
      const content = await requestChat(input, [
        { role: "user", content: "Reply with OK." }
      ], {
        max_tokens: 8,
        temperature: 0
      });
      return {
        ok: true,
        endpoint: resolveChatCompletionsEndpoint(input),
        latency_ms: Math.max(0, Math.round(now() - startedAt)),
        sample: String(content || "").trim().slice(0, 40)
      };
    }

    async function generateJson(input, messages, options = {}) {
      const content = await requestChat(input, messages, {
        ...options,
        response_format: { type: "json_object" },
        temperature: input.temperature ?? 0,
        seed: input.seed ?? 20260713
      });
      return parseJsonResponse(content);
    }

    async function requestChat(input, messages, options = {}) {
      if (typeof fetchImpl !== "function") throw new Error("当前浏览器不支持 fetch。");
      if (typeof AbortControllerImpl !== "function") throw new Error("当前浏览器不支持 AbortController。");
      if (requiresApiKey(input) && !input?.apiKey) throw new Error("请先填写临时 API Key，或选择本地代理。");
      if (!input?.model) throw new Error("请先填写模型名称。");

      const controller = new AbortControllerImpl();
      const timeoutId = global.setTimeout?.(() => controller.abort(), input.timeoutMs || timeoutMs);
      let response;
      const headers = {
        "Content-Type": "application/json",
        ...(input?.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {})
      };

      try {
        response = await fetchImpl(resolveChatCompletionsEndpoint(input), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: input.model,
            messages,
            temperature: options.temperature ?? input.temperature ?? 0,
            seed: options.seed ?? input.seed ?? 20260713,
            stream: false,
            ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
            ...(options.response_format ? { response_format: options.response_format } : {})
          }),
          signal: controller.signal
        });
      } finally {
        if (timeoutId !== undefined) global.clearTimeout?.(timeoutId);
      }

      if (!response.ok) {
        const text = await safeReadText(response);
        throw new Error(formatHttpError(response, text));
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("模型返回为空或格式不兼容。");
      return content;
    }

    function resolveChatCompletionsEndpoint(input) {
      const baseUrl = resolveBaseUrl(input).trim().replace(/\/+$/, "");
      if (!baseUrl) throw new Error("请填写 Base URL，或选择带默认地址的模型服务商。");
      return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
    }

    function resolveBaseUrl(input) {
      return input.baseUrl || providerDefaults[input.provider]?.baseUrl || "";
    }

    function requiresApiKey(input) {
      return providerDefaults[input?.provider]?.requiresApiKey !== false;
    }

    return {
      generateJson,
      requestChat,
      resolveChatCompletionsEndpoint,
      testModelConnection
    };
  }

  function parseJsonResponse(content) {
    try {
      return JSON.parse(stripJsonFence(content));
    } catch {
      throw new Error("模型没有返回合法 JSON，请检查模型是否支持 JSON 输出。");
    }
  }

  function stripJsonFence(content) {
    return String(content || "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  async function safeReadText(response) {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }

  function formatHttpError(response, bodyText = "") {
    const text = bodyText.replace(/\s+/g, " ").trim().slice(0, 260);
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    return `HTTP ${response.status}${statusText}${text ? `: ${text}` : ""}`;
  }

  global.AITeacherModelClient = {
    createModelClient,
    providerDefaults,
    formatHttpError
  };
})(typeof window !== "undefined" ? window : globalThis);

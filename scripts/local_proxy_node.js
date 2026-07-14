#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WEB_ROOT = ROOT;

const PROVIDER_DEFAULTS = {
  openai: { key: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  deepseek: { key: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1" },
  qwen: { key: "QWEN_API_KEY", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  kimi: { key: "KIMI_API_KEY", baseUrl: "https://api.moonshot.cn/v1" },
  custom: { key: "CUSTOM_LLM_API_KEY", baseUrl: "" }
};

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

function parseArgs(argv) {
  const args = {
    keyFile: path.join(ROOT, "1.md"),
    envFile: path.join(ROOT, ".env"),
    webPort: 5173,
    proxyPort: 8787,
    timeout: 120000
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--key-file" && next) args.keyFile = path.resolve(next), index += 1;
    else if (arg === "--env-file" && next) args.envFile = path.resolve(next), index += 1;
    else if (arg === "--web-port" && next) args.webPort = Number(next), index += 1;
    else if (arg === "--proxy-port" && next) args.proxyPort = Number(next), index += 1;
    else if (arg === "--timeout" && next) args.timeout = Number(next) * 1000, index += 1;
  }
  return args;
}

function normalizeBaseUrl(value) {
  let text = String(value || "").trim().replace(/\/+$/, "");
  if (text.endsWith("/chat/completions")) text = text.slice(0, -"/chat/completions".length);
  return text.replace(/\/+$/, "");
}

function readKeyFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const keyMatch = raw.match(/KEY\s*:\s*(\S+)/);
  const urlMatch = raw.match(/URL\s*:\s*(\S+)/);
  if (!keyMatch || !urlMatch) throw new Error("Key file must contain KEY: and URL:");
  return { apiKey: keyMatch[1].trim(), baseUrl: normalizeBaseUrl(urlMatch[1]) };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce((env, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return env;
    const [key, ...rest] = trimmed.split("=");
    env[key.trim()] = rest.join("=").trim().replace(/^['\"]|['\"]$/g, "");
    return env;
  }, {});
}

function resolveFromEnv(env) {
  const provider = String(env.LLM_PROVIDER || "qwen").trim().toLowerCase();
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
  const apiKey = env[defaults.key] || env.CUSTOM_LLM_API_KEY || "";
  const baseUrl = provider === "custom"
    ? env.CUSTOM_LLM_BASE_URL || ""
    : env.CUSTOM_LLM_BASE_URL || defaults.baseUrl;
  if (!apiKey || !baseUrl) {
    throw new Error("Missing model key or base URL. Add KEY/URL to 1.md, or fill .env with LLM_PROVIDER and provider API key.");
  }
  return { apiKey, baseUrl: normalizeBaseUrl(baseUrl) };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400"
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache"
  });
  response.end(JSON.stringify(payload));
}

function createProxyServer(config) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    if (request.method === "GET" && ["/health", "/healthz"].includes(pathname)) {
      sendJson(response, 200, { ok: true, upstream: config.baseUrl });
      return;
    }

    if (request.method !== "POST" || !["/chat/completions", "/v1/chat/completions"].includes(pathname)) {
      sendJson(response, 404, { error: "Only /chat/completions is supported" });
      return;
    }

    try {
      if (typeof fetch !== "function") throw new Error("Node.js 18+ is required for native fetch.");
      const body = await readBody(request);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.timeout);
      let upstreamResponse;
      try {
        upstreamResponse = await fetch(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": request.headers["content-type"] || "application/json; charset=utf-8"
          },
          body,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const payload = Buffer.from(await upstreamResponse.arrayBuffer());
      response.writeHead(upstreamResponse.status, {
        ...corsHeaders(),
        "Content-Type": upstreamResponse.headers.get("content-type") || "application/json",
        "Cache-Control": "no-cache"
      });
      response.end(payload);
    } catch (error) {
      sendJson(response, 502, { error: error.message || String(error) });
    }
  });
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    let pathname = decodeURIComponent(url.pathname || "/");
    if (pathname === "/") pathname = "/index.html";

    const filePath = path.resolve(WEB_ROOT, pathname.replace(/^\/+/, ""));
    const relativePath = path.relative(WEB_ROOT, filePath);
    const extension = path.extname(filePath).toLowerCase();
    const hasPrivatePart = relativePath.split(path.sep).some((part) => part.startsWith("."));
    const outsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);

    if (outsideRoot || hasPrivatePart || !CONTENT_TYPES[extension] || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }

    const data = fs.readFileSync(filePath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension],
      "Content-Length": data.length,
      "Cache-Control": "no-cache"
    });
    response.end(data);
  });
}

function main() {
  const args = parseArgs(process.argv);
  const config = fs.existsSync(args.keyFile)
    ? { ...readKeyFile(args.keyFile), source: args.keyFile }
    : { ...resolveFromEnv(readEnvFile(args.envFile)), source: args.envFile };
  config.timeout = args.timeout;

  const webServer = createStaticServer();
  const proxyServer = createProxyServer(config);

  webServer.listen(args.webPort, "127.0.0.1");
  proxyServer.listen(args.proxyPort, "127.0.0.1");

  console.log("AITeacher Node 本地模型代理已启动");
  console.log(`页面地址: http://127.0.0.1:${args.webPort}/`);
  console.log(`模型代理 Base URL: http://127.0.0.1:${args.proxyPort}`);
  console.log(`上游 Base URL: ${config.baseUrl}`);
  console.log(`配置来源: ${config.source}`);
  console.log("页面中选择“本地代理”，API Key 可留空。");
  console.log("按 Ctrl+C 停止");

  process.on("SIGINT", () => {
    webServer.close();
    proxyServer.close();
    process.exit(0);
  });
}

main();

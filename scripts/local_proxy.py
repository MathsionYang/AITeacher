import argparse
import json
import re
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT

PROVIDER_DEFAULTS = {
    "openai": {
        "key": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1",
    },
    "deepseek": {
        "key": "DEEPSEEK_API_KEY",
        "base_url": "https://api.deepseek.com/v1",
    },
    "qwen": {
        "key": "QWEN_API_KEY",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    "kimi": {
        "key": "KIMI_API_KEY",
        "base_url": "https://api.moonshot.cn/v1",
    },
    "custom": {
        "key": "CUSTOM_LLM_API_KEY",
        "base_url": "",
    },
}


def read_key_file(path):
    raw = Path(path).read_text(encoding="utf-8")
    key_match = re.search(r"KEY\s*:\s*(\S+)", raw)
    url_match = re.search(r"URL\s*:\s*(\S+)", raw)
    if not key_match or not url_match:
        raise RuntimeError("Key file must contain KEY: and URL:")
    return key_match.group(1).strip(), normalize_base_url(url_match.group(1))


def read_env_file(path):
    env = {}
    if not Path(path).is_file():
        return env
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def resolve_from_env(env):
    provider = (env.get("LLM_PROVIDER") or "qwen").strip().lower()
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["custom"])
    api_key = env.get(defaults["key"], "") or env.get("CUSTOM_LLM_API_KEY", "")
    base_url = (
        env.get("CUSTOM_LLM_BASE_URL", "")
        if provider == "custom"
        else env.get("CUSTOM_LLM_BASE_URL", "") or defaults["base_url"]
    )
    if not api_key or not base_url:
        raise RuntimeError(
            "Missing model key or base URL. Add KEY/URL to 1.md, or fill .env with LLM_PROVIDER and provider API key."
        )
    return api_key, normalize_base_url(base_url)


def normalize_base_url(value):
    text = str(value or "").strip().rstrip("/")
    if text.endswith("/chat/completions"):
        text = text[: -len("/chat/completions")]
    return text.rstrip("/")


class LocalProxyHandler(BaseHTTPRequestHandler):
    upstream_api_key = ""
    upstream_base_url = ""
    request_timeout = 120

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/health", "/healthz"):
            self.send_json({"ok": True, "upstream": self.upstream_base_url}, 200)
            return
        self.send_json({"error": "Only /chat/completions is supported"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path not in ("/chat/completions", "/v1/chat/completions"):
            self.send_json({"error": "Only /chat/completions is supported"}, 404)
            return

        content_length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(content_length)
        authorization = f"Bearer {self.upstream_api_key}"

        request = urllib.request.Request(
            f"{self.upstream_base_url}/chat/completions",
            data=body,
            headers={
                "Authorization": authorization,
                "Content-Type": self.headers.get("content-type", "application/json; charset=utf-8"),
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout) as response:
                self.send_response(response.status)
                self.send_cors_headers()
                self.send_header("Content-Type", response.headers.get("content-type", "application/json"))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()

                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            self.send_cors_headers()
            self.send_header("Content-Type", error.headers.get("content-type", "application/json"))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as error:
            self.send_json({"error": str(error)}, 502)

    def send_json(self, payload, status):
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Max-Age", "86400")

    def log_message(self, format, *args):
        print(f"[proxy] {self.address_string()} - {format % args}")


class StaticHandler(BaseHTTPRequestHandler):
    content_types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".ico": "image/x-icon",
    }

    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path in ("", "/"):
            path = "/index.html"

        file_path = (WEB_ROOT / path.lstrip("/")).resolve()
        allowed_root = str(WEB_ROOT.resolve())
        suffix = file_path.suffix.lower()
        has_private_part = any(part.startswith(".") for part in file_path.relative_to(WEB_ROOT).parts) if str(file_path).startswith(allowed_root) else True

        if (
            not str(file_path).startswith(allowed_root)
            or has_private_part
            or suffix not in self.content_types
            or not file_path.is_file()
        ):
            self.send_response(404)
            self.end_headers()
            return

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self.content_types[suffix])
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        print(f"[web] {self.address_string()} - {format % args}")


def serve(server):
    with server:
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-file", default=str(ROOT / "1.md"))
    parser.add_argument("--env-file", default=str(ROOT / ".env"))
    parser.add_argument("--web-port", type=int, default=5173)
    parser.add_argument("--proxy-port", type=int, default=8787)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()

    key_file = Path(args.key_file)
    if key_file.is_file():
        upstream_api_key, upstream_base_url = read_key_file(key_file)
        config_source = str(key_file)
    else:
        upstream_api_key, upstream_base_url = resolve_from_env(read_env_file(args.env_file))
        config_source = str(args.env_file)

    LocalProxyHandler.upstream_api_key = upstream_api_key
    LocalProxyHandler.upstream_base_url = upstream_base_url
    LocalProxyHandler.request_timeout = args.timeout

    web_server = ThreadingHTTPServer(("127.0.0.1", args.web_port), StaticHandler)
    proxy_server = ThreadingHTTPServer(("127.0.0.1", args.proxy_port), LocalProxyHandler)

    threading.Thread(target=serve, args=(web_server,), daemon=True).start()
    threading.Thread(target=serve, args=(proxy_server,), daemon=True).start()

    print("AITeacher 本地模型代理已启动")
    print(f"页面地址: http://127.0.0.1:{args.web_port}/")
    print(f"模型代理 Base URL: http://127.0.0.1:{args.proxy_port}")
    print(f"上游 Base URL: {upstream_base_url}")
    print(f"配置来源: {config_source}")
    print("页面中选择“本地代理”，API Key 可留空。")
    print("按 Ctrl+C 停止")

    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        web_server.shutdown()
        proxy_server.shutdown()


if __name__ == "__main__":
    main()

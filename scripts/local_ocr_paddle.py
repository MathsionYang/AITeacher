#!/usr/bin/env python3
"""Local PaddleOCR proxy for AITeacher.

Runs a small local HTTP service on 127.0.0.1 and accepts JSON image payloads:

  POST /ocr
  { "image": "data:image/png;base64,...", "expectedQuestionCount": 10 }

The service returns raw OCR lines plus a best-effort question-number/answer
structure. Scoring still happens in the browser rule engine after manual review.
"""

import argparse
import base64
import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


# PaddleOCR on Windows can hit PaddlePaddle oneDNN/PIR runtime errors on some
# CPU builds. Keep MKLDNN/oneDNN disabled by default for stability; users can
# opt in with --enable-mkldnn after local verification.
os.environ.setdefault("FLAGS_use_mkldnn", "0")
os.environ.setdefault("FLAGS_use_onednn", "0")
os.environ.setdefault("FLAGS_tracer_onednn_ops_on", "")
os.environ.setdefault("OMP_NUM_THREADS", "2")

MAX_BODY_BYTES = 18 * 1024 * 1024
FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")
FULLWIDTH_CHOICE = str.maketrans("ＡＢＣＤａｂｃｄ", "ABCDabcd")


class PaddleOcrRuntime:
    def __init__(self, args):
        self.args = args
        self.ocr = None
        self.lock = threading.Lock()
        self.model_profile = "not-loaded"

    def load(self):
        with self.lock:
            if self.ocr is not None:
                return self.ocr

            try:
                from paddleocr import PaddleOCR
            except Exception as error:
                raise RuntimeError(
                    "PaddleOCR is not installed. Install it with: "
                    "python -m pip install paddlepaddle paddleocr"
                ) from error

            errors = []
            for label, options in self._candidate_options():
                try:
                    self.ocr = PaddleOCR(**options)
                    self.model_profile = label
                    return self.ocr
                except TypeError as error:
                    errors.append(f"{label}: {error}")
                except Exception as error:
                    errors.append(f"{label}: {error}")

            raise RuntimeError("Unable to initialize PaddleOCR. " + " | ".join(errors[-3:]))

    def _candidate_options(self):
        common_v3 = {
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
            "lang": self.args.lang,
            "enable_mkldnn": self.args.enable_mkldnn,
            "mkldnn_cache_capacity": 0 if not self.args.enable_mkldnn else 10,
        }
        if self.args.device:
            common_v3["device"] = self.args.device

        if not self.args.default_models:
            small_v3 = {
                **common_v3,
                "text_detection_model_name": self.args.det_model,
                "text_recognition_model_name": self.args.rec_model,
            }
            yield "ppocr-v6-small", small_v3

        yield "paddleocr-default", common_v3

        legacy = {
            "lang": self.args.lang,
            "use_angle_cls": False,
            "show_log": False,
            "use_mkldnn": self.args.enable_mkldnn,
        }
        yield "paddleocr-legacy", legacy

    def predict(self, image_path):
        ocr = self.load()
        started = time.perf_counter()

        if hasattr(ocr, "predict"):
            result = ocr.predict(input=str(image_path))
            lines = normalize_predict_result(result)
        else:
            result = ocr.ocr(str(image_path), cls=False)
            lines = normalize_legacy_result(result)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return lines, elapsed_ms


def normalize_predict_result(result):
    lines = []
    pages = result if isinstance(result, list) else [result]
    for page in pages:
        data = result_to_dict(page)
        if isinstance(data, dict) and isinstance(data.get("res"), dict):
            data = data["res"]
        if not isinstance(data, dict):
            continue

        texts = data.get("rec_texts") or data.get("texts") or []
        scores = data.get("rec_scores") or data.get("scores") or []
        boxes = data.get("rec_polys") or data.get("dt_polys") or data.get("rec_boxes") or []

        for index, text in enumerate(texts):
            normalized = clean_ocr_text(text)
            if not normalized:
                continue
            lines.append({
                "text": normalized,
                "confidence": safe_score(scores[index] if index < len(scores) else None),
                "box": safe_box(boxes[index] if index < len(boxes) else None),
            })
    return lines


def normalize_legacy_result(result):
    lines = []
    pages = result if isinstance(result, list) else [result]
    for page in pages:
        if not isinstance(page, list):
            continue
        for item in page:
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            box = item[0]
            rec = item[1]
            if isinstance(rec, (list, tuple)) and len(rec) >= 2:
                text, score = rec[0], rec[1]
            else:
                continue
            normalized = clean_ocr_text(text)
            if normalized:
                lines.append({
                    "text": normalized,
                    "confidence": safe_score(score),
                    "box": safe_box(box),
                })
    return lines


def result_to_dict(value):
    if isinstance(value, dict):
        return value
    for attr in ("res", "json"):
        candidate = getattr(value, attr, None)
        if isinstance(candidate, dict):
            return candidate
    for method_name in ("to_dict", "to_json"):
        method = getattr(value, method_name, None)
        if callable(method):
            try:
                candidate = method()
                if isinstance(candidate, dict):
                    return candidate
                if isinstance(candidate, str):
                    return json.loads(candidate)
            except Exception:
                pass
    return {}


def safe_score(value):
    try:
        score = float(value)
    except Exception:
        score = 0.0
    return max(0.0, min(1.0, round(score, 4)))


def safe_box(value):
    if value is None:
        return None
    try:
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, (list, tuple)):
            return value
    except Exception:
        pass
    return None


def clean_ocr_text(value):
    text = str(value or "").translate(FULLWIDTH_DIGITS).translate(FULLWIDTH_CHOICE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_answer(value):
    text = clean_ocr_text(value)
    text = re.sub(r"^(答案|答|ans|answer)\s*[:：]?\s*", "", text, flags=re.IGNORECASE)
    text = text.strip(" .。:：;；,，")
    choice = re.fullmatch(r"[A-Da-d]", text)
    if choice:
        return text.upper()
    return text


def extract_answer_items(lines, expected_count=0):
    items = []
    used_numbers = set()
    unnumbered = []

    for line in lines:
        text = clean_ocr_text(line.get("text", ""))
        if not text:
            continue
        match = re.match(r"^\s*(?:第\s*)?(\d{1,2})\s*(?:题)?\s*[\.\、\):：\-]?\s*(.+?)\s*$", text)
        if match:
            question_no = int(match.group(1))
            answer = clean_answer(match.group(2))
            if answer:
                items.append({
                    "questionNo": question_no,
                    "answer": answer,
                    "confidence": safe_score(line.get("confidence")),
                    "rawLine": text,
                    "source": "paddleocr",
                })
                used_numbers.add(question_no)
        else:
            unnumbered.append(line)

    next_no = 1
    for line in unnumbered:
        if expected_count and next_no > expected_count:
            break
        while next_no in used_numbers:
            next_no += 1
        text = clean_answer(line.get("text", ""))
        if not text:
            continue
        items.append({
            "questionNo": next_no,
            "answer": text,
            "confidence": max(0.0, safe_score(line.get("confidence")) - 0.15),
            "rawLine": clean_ocr_text(line.get("text", "")),
            "source": "paddleocr",
        })
        used_numbers.add(next_no)
        next_no += 1

    items.sort(key=lambda item: item["questionNo"])
    if expected_count:
        items = [item for item in items if 1 <= item["questionNo"] <= expected_count]
    return items


def build_response(lines, elapsed_ms, runtime, expected_count):
    answer_items = extract_answer_items(lines, expected_count)
    raw_text = "\n".join(line["text"] for line in lines)
    answers_text = "\n".join(f"{item['questionNo']}. {item['answer']}" for item in answer_items)
    low_confidence = [item for item in answer_items if item["confidence"] < 0.7]
    return {
        "ok": True,
        "provider": "paddleocr",
        "modelProfile": runtime.model_profile,
        "elapsedMs": elapsed_ms,
        "rawText": raw_text,
        "answersText": answers_text or raw_text,
        "lines": lines,
        "answerItems": answer_items,
        "summary": {
            "lineCount": len(lines),
            "answerCount": len(answer_items),
            "lowConfidenceCount": len(low_confidence),
        },
    }


def decode_image_payload(payload):
    image_value = payload.get("image") or payload.get("imageBase64") or ""
    if not image_value:
        raise ValueError("Missing image data.")
    if "," in image_value and image_value.lower().startswith("data:image/"):
        header, encoded = image_value.split(",", 1)
        suffix_match = re.search(r"data:image/([a-zA-Z0-9.+-]+);base64", header)
        suffix = "." + (suffix_match.group(1).replace("jpeg", "jpg") if suffix_match else "png")
    else:
        encoded = image_value
        suffix = ".png"
    data = base64.b64decode(encoded, validate=True)
    if not data:
        raise ValueError("Empty image data.")
    return data, suffix


class OcrHandler(BaseHTTPRequestHandler):
    runtime = None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path in ("/health", "/healthz"):
            self.send_json({
                "ok": True,
                "provider": "paddleocr",
                "loaded": self.runtime.ocr is not None,
                "modelProfile": self.runtime.model_profile,
            }, 200)
            return
        self.send_json({"error": "Only /ocr is supported."}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path not in ("/ocr", "/v1/ocr"):
            self.send_json({"error": "Only /ocr is supported."}, 404)
            return

        content_length = int(self.headers.get("content-length", "0"))
        if content_length <= 0 or content_length > MAX_BODY_BYTES:
            self.send_json({"error": "Image payload is empty or too large."}, 413)
            return

        temp_path = None
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            image_data, suffix = decode_image_payload(payload)
            expected_count = int(payload.get("expectedQuestionCount") or 0)

            with tempfile.NamedTemporaryFile(prefix="aiteacher-ocr-", suffix=suffix, delete=False) as image_file:
                image_file.write(image_data)
                temp_path = Path(image_file.name)

            lines, elapsed_ms = self.runtime.predict(temp_path)
            self.send_json(build_response(lines, elapsed_ms, self.runtime, expected_count), 200)
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, 500)
        finally:
            if temp_path and temp_path.exists() and not self.runtime.args.keep_images:
                try:
                    temp_path.unlink()
                except Exception:
                    pass

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
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Max-Age", "86400")

    def log_message(self, format, *args):
        print(f"[ocr] {self.address_string()} - {format % args}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--lang", default="ch")
    parser.add_argument("--device", default="", help="Optional PaddleOCR device, e.g. cpu or gpu:0.")
    parser.add_argument("--det-model", default="PP-OCRv6_small_det")
    parser.add_argument("--rec-model", default="PP-OCRv6_small_rec")
    parser.add_argument("--default-models", action="store_true", help="Skip explicit small/mobile model names and use PaddleOCR defaults.")
    parser.add_argument("--keep-images", action="store_true", help="Keep temporary uploaded images for debugging.")
    parser.add_argument("--enable-mkldnn", action="store_true", help="Opt in to Paddle MKLDNN/oneDNN acceleration. Disabled by default for Windows CPU stability.")
    args = parser.parse_args()

    if args.enable_mkldnn:
        os.environ["FLAGS_use_mkldnn"] = "1"
        os.environ["FLAGS_use_onednn"] = "1"

    runtime = PaddleOcrRuntime(args)
    OcrHandler.runtime = runtime
    server = ThreadingHTTPServer((args.host, args.port), OcrHandler)

    print(f"AITeacher PaddleOCR proxy listening at http://{args.host}:{args.port}/ocr")
    print("Paddle MKLDNN/oneDNN acceleration: " + ("enabled" if args.enable_mkldnn else "disabled"))
    print("First OCR request may take longer while PaddleOCR loads/downloads models.")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()

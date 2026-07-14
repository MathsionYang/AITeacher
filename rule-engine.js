(function initAITeacherRuleEngine(global) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const DIFFICULTIES = new Set(["基础", "提高", "挑战"]);
  const UNIT_WORDS = [
    "平方厘米", "立方厘米", "平方分米", "立方分米", "平方米", "立方米",
    "厘米", "分米", "千米", "毫米", "米", "cm²", "cm³", "cm2", "cm3", "cm",
    "元", "角", "分", "克", "千克", "吨", "小时", "分钟", "秒", "分"
  ];
  const OBJECTIVE_TYPE_KEYWORDS = ["选择", "填空", "计算", "口算", "单位换算", "图形识别", "数据读取"];
  const OPEN_ENDED_STEM_KEYWORDS = [
    "说明", "为什么", "理由", "解释", "简述", "请描述", "描述过程", "描述理由", "描述思路",
    "写出过程", "解题过程", "请写出", "写出对应", "综合算式", "合并成", "合并为",
    "写成综合", "列综合", "列式说明", "如果不对", "不对请", "对吗", "错在哪里",
    "改正", "纠正", "改一改", "请改", "请说明", "证明", "作图"
  ];

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function capQuestionCount(value) {
    return clamp(Number(value) || 6, 3, 20);
  }

  function capGeneratedQuestionCount(value) {
    return clamp(Number(value) || 0, 0, 20);
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeLooseText(value) {
    return normalizeText(value)
      .replace(/[，。；;、]/g, "")
      .replace(/：/g, ":")
      .replace(/＝/g, "=")
      .replace(/[（）]/g, "")
      .toLowerCase();
  }

  function normalizeAnswer(value) {
    let text = normalizeLooseText(value).replace(/\s+/g, "");
    UNIT_WORDS.forEach((unit) => {
      text = text.replaceAll(unit.toLowerCase(), "");
    });
    return text
      .replace(/答[:：]?/g, "")
      .replace(/^解[:：]?/g, "")
      .replace(/约等于/g, "")
      .replace(/≈/g, "");
  }

  function parseNumberLike(value) {
    const text = normalizeAnswer(value).replace(/^x=/, "");
    if (/^-?\d+(\.\d+)?%$/.test(text)) return Number(text.replace("%", "")) / 100;

    const mixedFraction = text.match(/^(-?\d+)[又又]?(\d+)\/(\d+)$/);
    if (mixedFraction) {
      const whole = Number(mixedFraction[1]);
      const numerator = Number(mixedFraction[2]);
      const denominator = Number(mixedFraction[3]);
      if (denominator) return whole + Math.sign(whole || 1) * (numerator / denominator);
    }

    const fraction = text.match(/^(-?\d+)\/(\d+)$/);
    if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1]) / Number(fraction[2]);
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return Number.NaN;
  }

  function isCorrectAnswer(submitted, expected) {
    const cleanSubmitted = normalizeAnswer(submitted);
    const cleanExpected = normalizeAnswer(expected);
    if (!cleanSubmitted) return false;
    if (cleanSubmitted === cleanExpected) return true;

    const submittedNumber = parseNumberLike(cleanSubmitted);
    const expectedNumber = parseNumberLike(cleanExpected);
    if (Number.isFinite(submittedNumber) && Number.isFinite(expectedNumber)) {
      return Math.abs(submittedNumber - expectedNumber) < 0.001;
    }

    const submittedParts = splitCompositeAnswer(cleanSubmitted);
    const expectedParts = splitCompositeAnswer(cleanExpected);
    if (submittedParts.length > 1 && submittedParts.length === expectedParts.length) {
      return expectedParts.every((expectedPart, index) => isCorrectAnswer(submittedParts[index], expectedPart));
    }

    return cleanExpected.includes(cleanSubmitted) || cleanSubmitted.includes(cleanExpected);
  }

  function splitCompositeAnswer(value) {
    return normalizeAnswer(value)
      .split(/(?:和|,|，|\+|、)/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function paperTotal(questions) {
    return questions.reduce((sum, questionItem) => sum + (Number(questionItem.point) || 0), 0);
  }

  function normalizePaperPoints(questions) {
    const capped = (Array.isArray(questions) ? questions : []).slice(0, 20);
    if (!capped.length) return [];
    const base = Math.floor(100 / capped.length);
    const remainder = 100 - base * capped.length;
    return capped.map((questionItem, index) => ({
      ...questionItem,
      point: base + (index < remainder ? 1 : 0)
    }));
  }

  function resolveKnowledgePoint(value, unit) {
    const text = normalizeText(value);
    if (!text) return "";
    const points = unit?.points || [];
    const exact = points.find((point) => point === text);
    if (exact) return exact;
    return points.find((point) => point.includes(text) || text.includes(point)) || "";
  }

  function enforceUnitQuestionBoundary(questions, unit) {
    const allowedPoints = new Set(unit?.points || []);
    return (Array.isArray(questions) ? questions : [])
      .map((questionItem) => {
        const knowledgePoint = resolveKnowledgePoint(questionItem?.knowledgePoint, unit);
        return {
          ...questionItem,
          unitId: unit?.id,
          unitTitle: unit?.title,
          knowledgePoint
        };
      })
      .filter((questionItem) => (
        questionItem.unitId === unit?.id
        && questionItem.unitTitle === unit?.title
        && (!allowedPoints.size || allowedPoints.has(questionItem.knowledgePoint))
      ));
  }

  function dedupeByStem(questions) {
    const seen = new Set();
    return (Array.isArray(questions) ? questions : []).filter((questionItem) => {
      const key = normalizeLooseText(questionItem?.stem);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function rebalanceQuestionTypes(questions, count) {
    const safeCount = capGeneratedQuestionCount(count || questions?.length || 0);
    const maxSameType = Math.max(4, Math.ceil(Math.max(safeCount, 1) / 3));
    const typeCounts = {};
    return (Array.isArray(questions) ? questions : []).filter((questionItem) => {
      const type = normalizeText(questionItem?.questionType) || "同步练习题";
      const used = typeCounts[type] || 0;
      if (used >= maxSameType) return false;
      typeCounts[type] = used + 1;
      return true;
    });
  }

  function validateQuestion(questionItem, unit) {
    const issues = [];
    const warnings = [];
    const knowledgePoint = resolveKnowledgePoint(questionItem?.knowledgePoint, unit);
    const stem = normalizeText(questionItem?.stem);
    const answer = normalizeText(questionItem?.answer);
    const explanation = normalizeText(questionItem?.explanation);
    const questionType = normalizeObjectiveQuestionType(questionItem?.questionType, stem);
    const difficulty = DIFFICULTIES.has(questionItem?.difficulty) ? questionItem.difficulty : "基础";

    if (!stem) issues.push("题干为空");
    if (!answer) issues.push("答案为空");
    if (!explanation) warnings.push("解析为空或过短");
    if (!knowledgePoint) issues.push("知识点不在当前单元边界内");
    if (!isObjectiveQuestionType(questionType)) issues.push("题型不是选择题、填空题或计算填空题");
    if (isOpenEndedStem(stem)) issues.push("题干包含说明、改正、综合算式等开放作答要求");
    if (questionType.includes("选择") && !hasChoiceOptions(stem)) issues.push("选择题缺少 A/B/C/D 或 ①②③④ 选项");
    if (!isAnswerCheckable(answer)) issues.push("答案不是短标准答案，自动判分不稳定");

    return {
      ok: issues.length === 0,
      issues,
      warnings,
      question: {
        ...questionItem,
        unitId: unit?.id,
        unitTitle: unit?.title,
        knowledgePoint,
        stem,
        answer,
        explanation,
        questionType,
        difficulty
      }
    };
  }

  function validatePaper(questions, unit, options = {}) {
    const limit = capGeneratedQuestionCount(options.limit || questions?.length || 0);
    const rejected = [];
    const accepted = [];
    dedupeByStem(questions).forEach((questionItem) => {
      const result = validateQuestion(questionItem, unit);
      if (result.ok) accepted.push(result.question);
      else rejected.push({ question: questionItem, issues: result.issues });
    });

    const scoped = enforceUnitQuestionBoundary(accepted, unit);
    const balanced = rebalanceQuestionTypes(scoped, limit);
    const normalized = normalizePaperPoints(balanced.slice(0, limit || 20));
    const issues = [];
    if (!normalized.length && questions?.length) issues.push("没有题目通过规则校验");
    if (normalized.length > 20) issues.push("题量超过 20 题");
    if (normalized.length && paperTotal(normalized) !== 100) issues.push("总分未归一为 100 分");

    return {
      questions: normalized,
      rejected,
      issues,
      summary: {
        requested: limit,
        accepted: normalized.length,
        rejected: rejected.length,
        totalScore: paperTotal(normalized)
      }
    };
  }

  function normalizeObjectiveQuestionType(questionType, stem = "") {
    const type = normalizeText(questionType);
    if (type.includes("选择") || hasChoiceOptions(stem)) return type.includes("图形") ? "图形选择题" : "选择题";
    if (type.includes("单位")) return "单位换算填空题";
    if (type.includes("数据") || type.includes("统计")) return "数据填空题";
    if (type.includes("计算") || type.includes("口算") || type.includes("竖式")) return "计算填空题";
    if (type.includes("填空")) return "填空题";
    return type || "填空题";
  }

  function isObjectiveQuestionType(questionType) {
    const type = normalizeText(questionType);
    return OBJECTIVE_TYPE_KEYWORDS.some((keyword) => type.includes(keyword));
  }

  function isOpenEndedStem(stem) {
    const text = normalizeLooseText(stem);
    return OPEN_ENDED_STEM_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
  }

  function hasChoiceOptions(stem) {
    const text = normalizeText(stem);
    return /(?:A[.．、:：]|B[.．、:：]|C[.．、:：]|D[.．、:：])/.test(text) || /(?:①|②|③|④)/.test(text);
  }

  function isAnswerCheckable(answer) {
    const text = normalizeAnswer(answer);
    if (!text) return false;
    if (/^[a-d]$/.test(text) || /^选?[a-d]$/.test(text)) return true;
    if (/^[①②③④]$/.test(text)) return true;
    if (Number.isFinite(parseNumberLike(text))) return true;
    if (/^(锐角|直角|钝角|平角|周角|是|否|对|错|正确|错误|正面|侧面|上面|左面|右面|参照点)$/.test(text)) return true;
    if (splitCompositeAnswer(text).length > 1) return splitCompositeAnswer(text).every((part) => Number.isFinite(parseNumberLike(part)) || part.length <= 8);
    return text.length <= 12;
  }

  const api = {
    SCHEMA_VERSION,
    capQuestionCount,
    capGeneratedQuestionCount,
    clamp,
    dedupeByStem,
    enforceUnitQuestionBoundary,
    isCorrectAnswer,
    normalizeAnswer,
    normalizePaperPoints,
    normalizeText,
    paperTotal,
    parseNumberLike,
    rebalanceQuestionTypes,
    resolveKnowledgePoint,
    isOpenEndedStem,
    isObjectiveQuestionType,
    validatePaper,
    validateQuestion
  };

  global.AITeacherRuleEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

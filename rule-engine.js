(function initAITeacherRuleEngine(global) {
  "use strict";

  const SCHEMA_VERSION = 2;
  const REQUIRED_QUESTION_COUNT = 10;
  const MAX_PAPER_QUESTION_COUNT = 100;
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
    return REQUIRED_QUESTION_COUNT;
  }

  function capGeneratedQuestionCount(value) {
    return clamp(Number(value) || 0, 0, MAX_PAPER_QUESTION_COUNT);
  }

  function capPaperQuestionCount(value) {
    return clamp(Number(value) || REQUIRED_QUESTION_COUNT, REQUIRED_QUESTION_COUNT, MAX_PAPER_QUESTION_COUNT);
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
    const capped = (Array.isArray(questions) ? questions : []).slice(0, MAX_PAPER_QUESTION_COUNT);
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
    if (knowledgePoint) {
      const relevanceIssue = validateKnowledgePointRelevance(questionItem, unit, knowledgePoint, stem);
      if (relevanceIssue) issues.push(relevanceIssue);
    }
    if (!isObjectiveQuestionType(questionType)) issues.push("题型不是选择题、填空题或计算填空题");
    if (isOpenEndedStem(stem)) issues.push("题干包含说明、改正、综合算式等开放作答要求");
    if (questionType.includes("选择") && !hasChoiceOptions(stem)) issues.push("选择题缺少 A/B/C/D 或 ①②③④ 选项");
    if (questionType.includes("选择")) {
      const choiceIssue = validateArithmeticChoiceQuestion(stem, answer);
      if (choiceIssue) issues.push(choiceIssue);
    }
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
    const exactCount = options.exactCount !== false;
    const requireKnowledgeCoverage = options.requireKnowledgeCoverage !== false;
    const explicitExactCount = Number(options.exactQuestionCount);
    const hasExplicitExactCount = Number.isFinite(explicitExactCount) && explicitExactCount > 0;
    const exactTarget = hasExplicitExactCount ? capPaperQuestionCount(explicitExactCount) : REQUIRED_QUESTION_COUNT;
    const limit = hasExplicitExactCount
      ? exactTarget
      : exactCount
        ? capQuestionCount(options.limit)
        : capGeneratedQuestionCount(options.limit || questions?.length || 0);
    const rejected = [];
    const accepted = [];
    dedupeByStem(questions).forEach((questionItem) => {
      const result = validateQuestion(questionItem, unit);
      if (result.ok) accepted.push(result.question);
      else rejected.push({ question: questionItem, issues: result.issues });
    });

    const scoped = enforceUnitQuestionBoundary(accepted, unit);
    const selected = requireKnowledgeCoverage ? selectQuestionsForKnowledgeCoverage(scoped, unit, limit) : rebalanceQuestionTypes(scoped, limit).slice(0, limit || MAX_PAPER_QUESTION_COUNT);
    const normalized = normalizePaperPoints(selected.slice(0, limit || MAX_PAPER_QUESTION_COUNT));
    const missingKnowledgePoints = requireKnowledgeCoverage ? findMissingKnowledgePoints(normalized, unit) : [];
    const issues = [];
    if (!normalized.length && questions?.length) issues.push("没有题目通过规则校验");
    if ((hasExplicitExactCount || exactCount) && normalized.length !== exactTarget) issues.push(`题量必须为 ${exactTarget} 题`);
    if (missingKnowledgePoints.length) issues.push(`未覆盖知识点：${missingKnowledgePoints.join("、")}`);
    if ((unit?.points || []).length > limit) issues.push(`当前单元知识点超过 ${limit} 个，无法用 ${limit} 题全部覆盖`);
    if (normalized.length > exactTarget && (hasExplicitExactCount || exactCount)) issues.push(`题量超过 ${exactTarget} 题`);
    if (normalized.length && paperTotal(normalized) !== 100) issues.push("总分未归一为 100 分");

    return {
      questions: normalized,
      rejected,
      issues,
      summary: {
        requested: limit,
        accepted: normalized.length,
        rejected: rejected.length,
        missingKnowledgePoints,
        totalScore: paperTotal(normalized)
      }
    };
  }

  function selectQuestionsForKnowledgeCoverage(questions, unit, limit = REQUIRED_QUESTION_COUNT) {
    const safeLimit = limit || REQUIRED_QUESTION_COUNT;
    const selected = [];
    const used = new Set();
    const points = (unit?.points || []).filter(Boolean).slice(0, safeLimit);

    points.forEach((point) => {
      const index = questions.findIndex((questionItem, questionIndex) => (
        !used.has(questionIndex) && questionItem.knowledgePoint === point
      ));
      if (index >= 0) {
        selected.push(questions[index]);
        used.add(index);
      }
    });

    const typeCounts = {};
    selected.forEach((questionItem) => {
      const type = normalizeText(questionItem?.questionType) || "同步练习题";
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    const maxSameType = Math.max(4, Math.ceil(Math.max(safeLimit, 1) / 3));

    questions.forEach((questionItem, questionIndex) => {
      if (selected.length >= safeLimit || used.has(questionIndex)) return;
      const type = normalizeText(questionItem?.questionType) || "同步练习题";
      if ((typeCounts[type] || 0) >= maxSameType) return;
      selected.push(questionItem);
      used.add(questionIndex);
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    questions.forEach((questionItem, questionIndex) => {
      if (selected.length >= safeLimit || used.has(questionIndex)) return;
      selected.push(questionItem);
      used.add(questionIndex);
    });

    return selected;
  }

  function findMissingKnowledgePoints(questions, unit) {
    const covered = new Set((Array.isArray(questions) ? questions : []).map((questionItem) => questionItem.knowledgePoint).filter(Boolean));
    return (unit?.points || []).filter((point) => !covered.has(point));
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

  function validateKnowledgePointRelevance(questionItem, unit, knowledgePoint, stem) {
    const point = normalizeText(knowledgePoint);
    const rawStem = normalizeText(stem);
    const text = normalizeLooseText(stem);
    if (!point || !rawStem) return "";

    const hasArithmetic = /\d/.test(rawStem) && /[+\-－—–×xX*÷\/]/.test(rawStem);
    const hasAddSub = /[+\-－—–]/.test(rawStem);
    const hasMulDiv = /[×xX*÷\/]/.test(rawStem);
    const hasParentheses = /[()（）]/.test(rawStem);
    const hasChoice = hasChoiceOptions(rawStem);
    const issue = "题干内容与当前知识点不匹配";

    if (point.includes("不含括号") && point.includes("混合运算")) {
      if (!hasArithmetic || !hasAddSub || !hasMulDiv) return issue;
      if (!hasChoice && hasParentheses) return issue;
    }

    if (point.includes("含小括号") && point.includes("混合运算")) {
      if (!hasArithmetic || !hasParentheses) return issue;
    }

    if (point.includes("分步算式") || point.includes("合并成综合算式")) {
      if (!hasArithmetic || !includesAnyText(text, ["分步", "第一步", "第二步", "先算", "再算", "同一过程", "对应算式"])) return issue;
    }

    if ((point.includes("线段图") || point.includes("表格")) && point.includes("数量关系")) {
      if (!hasRepresentationEvidence(rawStem, text)) return issue;
    }

    if (point.includes("单价数量总价")) {
      if (!includesAnyText(text, ["单价", "数量", "总价", "每", "元", "买"])) return issue;
    }

    if (point.includes("速度时间路程")) {
      if (!includesAnyText(text, ["速度", "时间", "路程", "每小时", "每分钟", "千米", "米"])) return issue;
    }

    if (point.includes("运算律") || point.includes("交换律") || point.includes("结合律") || point.includes("分配律") || point.includes("简便计算")) {
      if (!includesAnyText(text, ["交换律", "结合律", "分配律", "简便", "凑整"]) && !/[+\-－—–×xX*÷\/]/.test(rawStem)) return issue;
    }

    if (point.includes("角")) {
      if (!includesAnyText(text, ["角", "度", "°", "量角器", "锐角", "直角", "钝角", "平角", "周角", "顶点", "边"])) return issue;
    }

    if (point.includes("统计") || point.includes("统计图") || point.includes("统计表") || point.includes("平均数") || point.includes("可能性")) {
      if (!includesAnyText(text, ["统计", "数据", "表", "图", "每格", "平均", "最多", "最少", "差值", "可能", "一定", "不可能"]) && !/\|.+\|/.test(rawStem)) return issue;
    }

    if (point.includes("长度") || point.includes("毫米") || point.includes("厘米") || point.includes("分米") || point.includes("千米")) {
      if (!includesAnyText(text, ["长度", "毫米", "厘米", "分米", "千米", "米", "线段"])) return issue;
    }

    if (point.includes("质量") || point.includes("克、千克、吨") || point.includes("等量关系推算未知质量")) {
      if (!includesAnyText(text, ["质量", "克", "千克", "吨", "称", "重"])) return issue;
    }

    if (point.includes("人民币")) {
      if (!includesAnyText(text, ["元", "角", "分", "人民币", "钱"])) return issue;
    }

    if (point.includes("时间")) {
      if (!includesAnyText(text, ["时间", "小时", "分钟", "秒", "时", "分"])) return issue;
    }

    if (point.includes("面积")) {
      if (!includesAnyText(text, ["面积", "平方", "底", "高", "长", "宽", "三角形", "梯形", "平行四边形", "圆"]) && !/[cCmM][mM]2|cm²|m²/.test(rawStem)) return issue;
    }

    if (point.includes("体积")) {
      if (!includesAnyText(text, ["体积", "立方", "长方体", "正方体", "长", "宽", "高"]) && !/[cCmM][mM]3|cm³|m³/.test(rawStem)) return issue;
    }

    if (point.includes("小数")) {
      if (!text.includes("小数") && !/\d+\.\d+/.test(rawStem)) return issue;
    }

    if (point.includes("分数") || point.includes("单位 1")) {
      if (!includesAnyText(text, ["分数", "几分", "单位1", "单位 1", "约分", "倒数"]) && !/\d+\s*\/\s*\d+/.test(rawStem)) return issue;
    }

    if (point.includes("百分数") || point.includes("百分率") || point.includes("增长率") || point.includes("折扣") || point.includes("利率")) {
      if (!includesAnyText(text, ["百分", "百分率", "增长率", "折扣", "利率", "成数"]) && !/%/.test(rawStem)) return issue;
    }

    if (point.includes("方程") || point.includes("字母") || point.includes("未知数")) {
      if (!includesAnyText(text, ["方程", "字母", "未知数", "等量", "式子"]) && !/[a-zA-Z]/.test(rawStem)) return issue;
    }

    if (point.includes("数对")) {
      if (!includesAnyText(text, ["数对", "列", "行", "坐标"]) && !/\(\s*-?\d+\s*,\s*-?\d+\s*\)/.test(rawStem)) return issue;
    }

    if (point.includes("负数") || point.includes("正数")) {
      if (!includesAnyText(text, ["负数", "正数", "数轴", "温度", "海拔", "收支", "0"]) && !/-\d/.test(rawStem)) return issue;
    }

    if (point.includes("圆")) {
      if (!includesAnyText(text, ["圆", "半径", "直径", "圆周率", "周长", "面积", "π"])) return issue;
    }

    if (point.includes("观察") || point.includes("视图") || point.includes("组合体")) {
      if (!includesAnyText(text, ["观察", "视图", "正面", "侧面", "上面", "前面", "组合体", "小正方体"])) return issue;
    }

    return "";
  }

  function hasRepresentationEvidence(rawStem, looseText) {
    return includesAnyText(looseText, ["线段图", "表格", "表中", "数量关系", "已看", "剩余", "总数", "单位1", "单位 1"])
      || /\|.+\|/.test(rawStem)
      || /<table/i.test(rawStem);
  }

  function includesAnyText(text, needles) {
    return needles.some((needle) => text.includes(normalizeLooseText(needle)));
  }


  function validateArithmeticChoiceQuestion(stem, answer) {
    const target = extractArithmeticChoiceTarget(stem);
    if (!Number.isFinite(target)) return "";

    const options = parseChoiceOptions(stem);
    if (options.length < 2) return "选择题选项无法结构化验算";

    const evaluated = options.map((option) => ({
      ...option,
      value: evaluateArithmeticExpression(option.text)
    }));
    const invalidOption = evaluated.find((option) => !Number.isFinite(option.value));
    if (invalidOption) return "选择题选项包含无法验算的算式";

    const matching = evaluated.filter((option) => Math.abs(option.value - target) < 0.001);
    if (matching.length !== 1) return "选择题算式验算失败：必须恰好有一个选项等于题干目标值";

    const answerIndex = normalizeChoiceAnswerIndex(answer);
    if (answerIndex !== matching[0].index) return "选择题答案与算式验算结果不一致";
    return "";
  }

  function extractArithmeticChoiceTarget(stem) {
    const text = normalizeText(stem);
    if (!/[\u7b97\u5f0f\u7ed3\u679c]/.test(text)) return Number.NaN;
    const patterns = [
      /(?:\u7ed3\u679c\s*)?\u7b49\u4e8e\s*(-?\d+(?:\.\d+)?)/,
      /(?:\u7ed3\u679c\s*)?(?:\u662f|\u4e3a)\s*(-?\d+(?:\.\d+)?)/,
      /(?:equal\s+to|equals)\s*(-?\d+(?:\.\d+)?)/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return Number.NaN;
  }

  function parseChoiceOptions(stem) {
    const text = normalizeText(stem);
    const markerPattern = /([A-D])\s*[\.\uff0e\u3001\u3002\uff1a:]|([\u2460\u2461\u2462\u2463])/g;
    const markers = [];
    let match;
    while ((match = markerPattern.exec(text)) !== null) {
      const label = match[1] || match[2];
      const index = normalizeChoiceAnswerIndex(label);
      if (!index) continue;
      markers.push({ label, index, start: match.index, end: markerPattern.lastIndex });
    }
    return markers.map((marker, position) => {
      const next = markers[position + 1];
      return {
        label: marker.label,
        index: marker.index,
        text: text.slice(marker.end, next ? next.start : text.length).trim()
      };
    }).filter((option) => option.text);
  }

  function normalizeChoiceAnswerIndex(answer) {
    const text = normalizeText(answer).replace(/^\u9009/, "").trim();
    const first = text.charAt(0).toUpperCase();
    if (first >= "A" && first <= "D") return first.charCodeAt(0) - 64;
    const circled = { "\u2460": 1, "\u2461": 2, "\u2462": 3, "\u2463": 4 };
    if (circled[first]) return circled[first];
    if (/^[1-4]$/.test(first)) return Number(first);
    return 0;
  }

  function evaluateArithmeticExpression(expression) {
    const tokens = tokenizeArithmeticExpression(expression);
    if (!tokens.length) return Number.NaN;
    let cursor = 0;

    function parseExpression() {
      let value = parseTerm();
      while (cursor < tokens.length && (tokens[cursor] === "+" || tokens[cursor] === "-")) {
        const operator = tokens[cursor++];
        const right = parseTerm();
        value = operator === "+" ? value + right : value - right;
      }
      return value;
    }

    function parseTerm() {
      let value = parseFactor();
      while (cursor < tokens.length && (tokens[cursor] === "*" || tokens[cursor] === "/")) {
        const operator = tokens[cursor++];
        const right = parseFactor();
        if (operator === "/" && Math.abs(right) < 0.0000001) return Number.NaN;
        value = operator === "*" ? value * right : value / right;
      }
      return value;
    }

    function parseFactor() {
      const token = tokens[cursor++];
      if (token === "(") {
        const value = parseExpression();
        if (tokens[cursor] !== ")") return Number.NaN;
        cursor += 1;
        return value;
      }
      if (token === "-" || token === "+") {
        const value = parseFactor();
        return token === "-" ? -value : value;
      }
      const value = Number(token);
      return Number.isFinite(value) ? value : Number.NaN;
    }

    const value = parseExpression();
    return cursor === tokens.length && Number.isFinite(value) ? value : Number.NaN;
  }

  function tokenizeArithmeticExpression(expression) {
    const normalized = normalizeText(expression)
      .replace(/[（]/g, "(")
      .replace(/[）]/g, ")")
      .replace(/[×xX*]/g, "*")
      .replace(/[÷/]/g, "/")
      .replace(/[－—–]/g, "-");
    const tokens = [];
    const pattern = /\d+(?:\.\d+)?|[()+\-*/]/g;
    let match;
    while ((match = pattern.exec(normalized)) !== null) tokens.push(match[0]);
    return tokens;
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
    REQUIRED_QUESTION_COUNT,
    capQuestionCount,
    capGeneratedQuestionCount,
    capPaperQuestionCount,
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
    findMissingKnowledgePoints,
    isOpenEndedStem,
    isObjectiveQuestionType,
    selectQuestionsForKnowledgeCoverage,
    validateKnowledgePointRelevance,
    validatePaper,
    validateQuestion
  };

  global.AITeacherRuleEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

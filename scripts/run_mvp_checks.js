const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ruleEngine = require("../rule-engine.js");
const storageApi = require("../storage-adapter.js");

assert.equal(storageApi.STORAGE_SCHEMA_VERSION, 4);
assert.ok(storageApi.SQLITE_SCHEMA.some((sql) => sql.includes("courseware_reviews")));
assert.ok(storageApi.SQLITE_SCHEMA.some((sql) => sql.includes("grading_submissions")));
assert.ok(storageApi.SQLITE_SCHEMA.some((sql) => sql.includes("generation_cache")));

const storage = storageApi.createLocalJsonStorage({ namespace: "test-ai-teacher" });
const envelope = storage.buildEnvelope("local-data-backup", { mistakes: [] });
assert.equal(envelope.storageKind, "local-json");
assert.equal(envelope.schemaVersion, 4);
assert.equal(envelope.namespace, "test-ai-teacher");
assert.equal(envelope.type, "local-data-backup");
assert.ok(storage.sqliteMigrationPlan().schema.some((sql) => sql.includes("score_history")));

const rootDir = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(rootDir, "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");
const ocrProxySource = fs.readFileSync(path.join(rootDir, "scripts", "local_ocr_paddle.py"), "utf8");
const agentSource = fs.readFileSync(path.join(rootDir, "agent-orchestrator.js"), "utf8");
assert.ok(indexSource.includes("id=\"runOcrBtn\""));
assert.ok(indexSource.includes("id=\"ocrStatusPanel\""));
assert.ok(indexSource.includes("id=\"questionCount\" type=\"number\" min=\"10\" max=\"10\" value=\"10\" disabled"));
assert.ok(indexSource.includes("id=\"scheduledCount\" type=\"number\" min=\"10\" max=\"10\" value=\"10\" disabled"));
assert.ok(indexSource.includes("id=\"coursewareMoreMenu\""));
assert.ok(indexSource.includes("class=\"action-menu-panel\""));
assert.ok(indexSource.indexOf("id=\"downloadCoursewareBtn\"") > indexSource.indexOf("id=\"coursewareMoreMenu\""));
assert.ok(appSource.includes("http://127.0.0.1:8790"));
assert.ok(appSource.includes("function formatDateTime"));
assert.ok(appSource.includes("parseAnswerReview(answerText, \"paddleocr\""));
assert.ok(appSource.includes("function setOcrStatus"));
assert.ok(appSource.includes("已接收 ${receivedChars} 字内容"));
assert.ok(agentSource.includes("generateQuestionsStream"));
assert.ok(agentSource.includes("每次必须生成 10 道题"));
assert.ok(agentSource.includes("情境导入和例题精讲页优先使用可图解的生活情境"));
assert.ok(agentSource.includes("visualData.kind 可用 stationery、share、quantity"));
assert.ok(appSource.includes("function hasKnowledgeCoverage"));
assert.ok(appSource.includes("function formatPaperValidationError"));
assert.ok(appSource.includes("未覆盖知识点"));
assert.ok(appSource.includes("generationCacheKey"));
assert.ok(appSource.includes("writeGenerationCache"));
assert.ok(appSource.includes("function renderScenarioVisual"));
assert.ok(appSource.includes("renderStationeryScenario"));
assert.ok(appSource.includes("renderCraftShareScenario"));
assert.ok(appSource.includes("function normalizeSlideVisualData"));
assert.ok(appSource.includes("visualData: buildDefaultSlideVisualData"));
assert.ok(appSource.includes("visualType: \"scenario\""));
assert.ok(stylesSource.includes(".stationery-scenario"));
assert.ok(stylesSource.includes(".notebook"));
assert.ok(stylesSource.includes(".pen-object"));
assert.ok(stylesSource.includes(".craft-scenario"));
assert.ok(stylesSource.includes(".action-menu-panel"));
assert.ok(stylesSource.includes(".menu-action"));
const questionCardSource = appSource.slice(appSource.indexOf("function renderQuestionCard"), appSource.indexOf("function renderExplanationDetail"));
assert.ok(questionCardSource.includes("function renderQuestionCard"));
assert.equal(questionCardSource.includes("知识点来源"), false);
assert.ok(appSource.includes("function renderStemContent"));
assert.ok(appSource.includes("class=\"stem-table\""));
assert.ok(appSource.includes("function parseInlineMarkdownTable"));
assert.ok(appSource.includes("(?<=\\|)\\s+(?=\\|)"));
assert.equal(appSource.includes("当前还没有练习题，请先生成或导入练习，再进行 OCR 识别。"), false);
assert.ok(ocrProxySource.includes("class PaddleOcrRuntime"));
assert.ok(ocrProxySource.includes("PP-OCRv6_small"));
assert.ok(ocrProxySource.includes("FLAGS_use_mkldnn"));
assert.ok(ocrProxySource.includes("--enable-mkldnn"));
assert.ok(ocrProxySource.includes("enable_mkldnn"));

const unit = {
  id: "g3a-u2",
  title: "混合运算",
  points: ["不含括号的两级混合运算", "含小括号的混合运算", "分步算式合并成综合算式", "用线段图或表格分析数量关系"]
};

const questions = [
  {
    id: "q1",
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: "不含括号的两级混合运算",
    questionType: "基础计算题",
    difficulty: "基础",
    stem: "12 + 3 x 4 = ?",
    answer: "24",
    explanation: "先乘后加。"
  },
  {
    id: "q2",
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: "含小括号的混合运算",
    questionType: "基础计算题",
    difficulty: "基础",
    stem: "(12 + 3) x 4 = ?",
    answer: "60",
    explanation: "先算括号。"
  },
  {
    id: "q3",
    unitId: "other",
    unitTitle: "其他单元",
    knowledgePoint: "其他知识点",
    questionType: "跨单元题",
    difficulty: "提高",
    stem: "跨单元题",
    answer: "1",
    explanation: "不应进入本单元。"
  }
];

assert.equal(ruleEngine.REQUIRED_QUESTION_COUNT, 10);
assert.equal(ruleEngine.capQuestionCount(99), 10);
assert.equal(ruleEngine.capQuestionCount(1), 10);
assert.equal(ruleEngine.capGeneratedQuestionCount(1), 1);

const scoped = ruleEngine.enforceUnitQuestionBoundary(questions, unit);
assert.equal(scoped.length, 2);
assert.ok(scoped.every((question) => question.unitId === unit.id));
assert.ok(scoped.every((question) => unit.points.includes(question.knowledgePoint)));

const normalized = ruleEngine.normalizePaperPoints(scoped);
assert.equal(normalized.length, 2);
assert.equal(ruleEngine.paperTotal(normalized), 100);
assert.deepEqual(normalized.map((question) => question.point), [50, 50]);

const prepared = ruleEngine.validatePaper(questions, unit, { limit: 20 });
assert.equal(prepared.questions.length, 2);
assert.equal(prepared.rejected.length, 1);
assert.equal(prepared.summary.totalScore, 100);
assert.ok(prepared.issues.some((issue) => issue.includes("题量必须为 10 题")));
assert.ok(prepared.summary.missingKnowledgePoints.includes("分步算式合并成综合算式"));

function coveredQuestion(point, index) {
  if (point === "不含括号的两级混合运算") {
    const a = 12 + index;
    const answer = String(a + 3 * 4);
    return {
      id: `covered-${index}`,
      unitId: unit.id,
      unitTitle: unit.title,
      knowledgePoint: point,
      questionType: "计算填空题",
      difficulty: "基础",
      stem: `填空：${a} + 3 × 4 = ____。`,
      answer,
      explanation: `先算 3×4=12，再算 ${a}+12=${answer}。`
    };
  }
  if (point === "含小括号的混合运算") {
    const a = 8 + index;
    const answer = String((a + 2) * 3);
    return {
      id: `covered-${index}`,
      unitId: unit.id,
      unitTitle: unit.title,
      knowledgePoint: point,
      questionType: "计算填空题",
      difficulty: "基础",
      stem: `填空：(${a} + 2) × 3 = ____。`,
      answer,
      explanation: `先算小括号 ${a}+2=${a + 2}，再乘 3 得 ${answer}。`
    };
  }
  if (point === "分步算式合并成综合算式") {
    const groups = 3 + index;
    const each = 2;
    const extra = 5 + index;
    return {
      id: `covered-${index}`,
      unitId: unit.id,
      unitTitle: unit.title,
      knowledgePoint: point,
      questionType: "选择题",
      difficulty: "基础",
      stem: `选择题：分步计算为：先算 ${groups} × ${each}，再加 ${extra}。下面哪个算式表示同一过程？ A. ${groups}+${each}+${extra} B. ${groups}×${each}+${extra} C. (${groups}+${each})×${extra} D. ${groups}×(${each}+${extra})`,
      answer: "B",
      explanation: `分步顺序是先乘再加，对应 ${groups}×${each}+${extra}。`
    };
  }
  const perDay = 4 + index;
  const days = 3;
  const rest = 10 + index;
  const read = perDay * days;
  const total = read + rest;
  return {
    id: `covered-${index}`,
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: point,
    questionType: "数据填空题",
    difficulty: "基础",
    stem: `填空：每天看 ${perDay} 页，看了 ${days} 天，还剩 ${rest} 页。用表格整理数量关系。\n| 已看页数 | 剩余页数 | 总页数 |\n| --- | --- | --- |\n| ____ | ${rest} | ____ |`,
    answer: `${read}和${total}`,
    explanation: `已看 ${perDay}×${days}=${read} 页，总页数 ${read}+${rest}=${total} 页。`
  };
}

const coveredPaper = Array.from({ length: 10 }, (_, index) => coveredQuestion(unit.points[index % unit.points.length], index));
const coveredPrepared = ruleEngine.validatePaper(coveredPaper, unit, { limit: 10 });
assert.equal(coveredPrepared.questions.length, 10);
assert.equal(coveredPrepared.summary.totalScore, 100);
assert.deepEqual(coveredPrepared.summary.missingKnowledgePoints, []);
assert.equal(coveredPrepared.issues.some((issue) => issue.includes("未覆盖")), false);
assert.equal(coveredPrepared.issues.some((issue) => issue.includes("题量必须")), false);

const openEndedQuestions = [
  {
    id: "open1",
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: "分步算式合并成综合算式",
    questionType: "填空题",
    difficulty: "基础",
    stem: "请把这两个算式合并成一个综合算式。",
    answer: "12+3x4",
    explanation: "开放写法不稳定。"
  },
  {
    id: "open2",
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: "含小括号的混合运算",
    questionType: "填空题",
    difficulty: "基础",
    stem: "请写出对应的综合算式，并说明为什么不需要小括号。",
    answer: "12+3x4",
    explanation: "需要主观说明。"
  },
  {
    id: "open3",
    unitId: unit.id,
    unitTitle: unit.title,
    knowledgePoint: "不含括号的两级混合运算",
    questionType: "选择题",
    difficulty: "基础",
    stem: "下面这道题的计算对吗？如果不对，请改正。 A. 对 B. 错 C. 不能确定 D. 都不对",
    answer: "B",
    explanation: "判断改错题不进入自动判分题库。"
  }
];

const rejectedOpenEnded = ruleEngine.validatePaper(openEndedQuestions, unit, { limit: 20 });
assert.equal(rejectedOpenEnded.questions.length, 0);
assert.equal(rejectedOpenEnded.rejected.length, 3);
assert.ok(rejectedOpenEnded.rejected.every((item) => item.issues.some((issue) => issue.includes("开放"))));
assert.equal(ruleEngine.isOpenEndedStem("选择题：描述位置时通常要先确定什么？ A. 参照点 B. 颜色 C. 重量 D. 价格"), false);
assert.equal(ruleEngine.isObjectiveQuestionType("判断改错题"), false);

const choiceWithoutOptions = ruleEngine.validateQuestion({
  id: "bad-choice",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "不含括号的两级混合运算",
  questionType: "选择题",
  difficulty: "基础",
  stem: "选择题：12 + 3 x 4 应先算哪一步？",
  answer: "A",
  explanation: "缺少选项。"
}, unit);
assert.equal(choiceWithoutOptions.ok, false);
assert.ok(choiceWithoutOptions.issues.some((issue) => issue.includes("选项")));

const validChoice = ruleEngine.validateQuestion({
  id: "choice-ok",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "不含括号的两级混合运算",
  questionType: "选择题",
  difficulty: "基础",
  stem: "选择题：12 + 3 x 4 应先算哪一步？ A. 3 x 4 B. 12 + 3 C. 12 x 4 D. 从左到右随意算",
  answer: "A",
  explanation: "乘除优先于加减。"
}, unit);
assert.equal(validChoice.ok, true);
assert.equal(validChoice.question.questionType, "选择题");


const invalidExpressionChoice = ruleEngine.validateQuestion({
  id: "bad-expression-choice",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: unit.points[0],
  questionType: "\u9009\u62e9\u9898",
  difficulty: "\u57fa\u7840",
  stem: "\u4e0b\u9762\u54ea\u4e2a\u7b97\u5f0f\u7684\u7ed3\u679c\u7b49\u4e8e 7\uff1f \u2460 56 \u00f7 (8 - 1) \u2461 56 \u00f7 8 - 1 \u2462 56 - 8 \u00f7 1 \u2463 (56 - 8) \u00f7 1",
  answer: "\u2460",
  explanation: "\u9700\u9010\u9879\u9a8c\u7b97\u9009\u9879\u3002"
}, unit);
assert.equal(invalidExpressionChoice.ok, false);
assert.ok(invalidExpressionChoice.issues.some((issue) => issue.includes("\u9a8c\u7b97")));

const validExpressionChoice = ruleEngine.validateQuestion({
  id: "good-expression-choice",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: unit.points[0],
  questionType: "\u9009\u62e9\u9898",
  difficulty: "\u57fa\u7840",
  stem: "\u4e0b\u9762\u54ea\u4e2a\u7b97\u5f0f\u7684\u7ed3\u679c\u7b49\u4e8e 7\uff1f \u2460 56 \u00f7 (8 - 1) \u2461 56 \u00f7 8 \u2462 56 - 8 \u00f7 1 \u2463 (56 - 8) \u00f7 1",
  answer: "\u2461",
  explanation: "56 \u00f7 8 = 7\uff0c\u6240\u4ee5\u9009\u2461\u3002"
}, unit);
assert.equal(validExpressionChoice.ok, true);

const validFillBlank = ruleEngine.validateQuestion({
  id: "fill-ok",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "不含括号的两级混合运算",
  questionType: "计算填空题",
  difficulty: "基础",
  stem: "填空：12 + 3 x 4 = ____。",
  answer: "24",
  explanation: "先算 3 x 4，再加 12。"
}, unit);
assert.equal(validFillBlank.ok, true);
assert.equal(validFillBlank.question.questionType, "计算填空题");

const plainAddAsMixed = ruleEngine.validateQuestion({
  id: "plain-add-as-mixed",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "不含括号的两级混合运算",
  questionType: "计算填空题",
  difficulty: "基础",
  stem: "填空：107 + 54 = ____。",
  answer: "161",
  explanation: "普通加法不能冒充两级混合运算。"
}, unit);
assert.equal(plainAddAsMixed.ok, false);
assert.ok(plainAddAsMixed.issues.some((issue) => issue.includes("不匹配")));

const plainAddAsStepExpression = ruleEngine.validateQuestion({
  id: "plain-add-as-step",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "分步算式合并成综合算式",
  questionType: "填空题",
  difficulty: "基础",
  stem: "填空：113 + 56 = ____。",
  answer: "169",
  explanation: "普通加法不能冒充分步算式知识点。"
}, unit);
assert.equal(plainAddAsStepExpression.ok, false);
assert.ok(plainAddAsStepExpression.issues.some((issue) => issue.includes("不匹配")));

const plainMultiplyAsTableRelation = ruleEngine.validateQuestion({
  id: "plain-multiply-as-table",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "用线段图或表格分析数量关系",
  questionType: "填空题",
  difficulty: "基础",
  stem: "填空：12 × 9 = ____。",
  answer: "108",
  explanation: "普通乘法不能冒充表格数量关系。"
}, unit);
assert.equal(plainMultiplyAsTableRelation.ok, false);
assert.ok(plainMultiplyAsTableRelation.issues.some((issue) => issue.includes("不匹配")));

const validTableRelation = ruleEngine.validateQuestion({
  id: "table-relation-ok",
  unitId: unit.id,
  unitTitle: unit.title,
  knowledgePoint: "用线段图或表格分析数量关系",
  questionType: "数据填空题",
  difficulty: "基础",
  stem: "填空：小明每天看 6 页书，看了 4 天，还剩 18 页。先用表格整理数量关系，再填写空格。\n| 已看页数 | 剩余页数 | 总页数 |\n| --- | --- | --- |\n| ____ | 18 | ____ |",
  answer: "24和42",
  explanation: "已看页数 6×4=24 页，总页数 24+18=42 页。"
}, unit);
assert.equal(validTableRelation.ok, true);

const multiplicationUnit = {
  id: "g4a-u3",
  title: "多位数乘两位数",
  points: ["三位数乘两位数笔算", "部分积对位", "乘法估算", "积的变化规律", "单价数量总价", "速度时间路程"]
};

const validPriceRelation = ruleEngine.validateQuestion({
  id: "price-relation-ok",
  unitId: multiplicationUnit.id,
  unitTitle: multiplicationUnit.title,
  knowledgePoint: "单价数量总价",
  questionType: "数据填空题",
  difficulty: "基础",
  stem: "填空：练习本每本 12 元，买 4 本。根据“单价 × 数量 = 总价”填写表格。\n| 单价 | 数量 | 总价 |\n| --- | --- | --- |\n| 12 元/本 | 4 本 | ____ 元 |",
  answer: "48",
  explanation: "总价 = 单价×数量 = 12×4=48 元。"
}, multiplicationUnit);
assert.equal(validPriceRelation.ok, true);

assert.equal(ruleEngine.isCorrectAnswer("24 平方厘米", "24"), true);
assert.equal(ruleEngine.isCorrectAnswer("x = 8", "8"), true);
assert.equal(ruleEngine.isCorrectAnswer("1/2", "0.5"), true);
assert.equal(ruleEngine.isCorrectAnswer("10%", "0.1"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 35", "25和35"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 36", "25和35"), false);

console.log("MVP rule/storage/OCR checks passed.");

const assert = require("node:assert/strict");
const ruleEngine = require("../rule-engine.js");

const unit = {
  id: "g3a-u2",
  title: "混合运算",
  points: ["不含括号的两级混合运算", "含小括号的混合运算", "分步算式合并成综合算式"]
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

assert.equal(ruleEngine.capQuestionCount(99), 20);
assert.equal(ruleEngine.capQuestionCount(1), 3);
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

assert.equal(ruleEngine.isCorrectAnswer("24 平方厘米", "24"), true);
assert.equal(ruleEngine.isCorrectAnswer("x = 8", "8"), true);
assert.equal(ruleEngine.isCorrectAnswer("1/2", "0.5"), true);
assert.equal(ruleEngine.isCorrectAnswer("10%", "0.1"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 35", "25和35"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 36", "25和35"), false);

console.log("MVP rule checks passed.");

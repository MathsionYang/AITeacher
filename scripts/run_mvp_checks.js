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

assert.equal(ruleEngine.isCorrectAnswer("24 平方厘米", "24"), true);
assert.equal(ruleEngine.isCorrectAnswer("x = 8", "8"), true);
assert.equal(ruleEngine.isCorrectAnswer("1/2", "0.5"), true);
assert.equal(ruleEngine.isCorrectAnswer("10%", "0.1"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 35", "25和35"), true);
assert.equal(ruleEngine.isCorrectAnswer("25 和 36", "25和35"), false);

console.log("MVP rule checks passed.");
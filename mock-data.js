(function () {
  window.AI_TEACHER_MOCK_DATA = {
    enabled: true,
    mode: "seed-if-empty",
    initialScope: {
      grade: "3",
      volume: "A",
      unitId: "g3a-u2",
      difficulty: "基础",
      questionCount: 8
    },
    schedule: {
      frequency: "每周",
      count: 10,
      mistakeRatio: 40,
      updatedAt: "2026-07-13T08:00:00.000Z"
    },
    scoreHistory: [
      {
        id: "mock-score-g3a-u2-1",
        createdAt: "2026-07-01T08:00:00.000Z",
        gradeId: "3",
        gradeName: "三年级",
        volumeId: "A",
        volumeName: "上册",
        unitId: "g3a-u2",
        unitTitle: "混合运算",
        difficulty: "基础",
        questionCount: 8,
        score: 58,
        total: 100,
        accuracy: 50,
        correctCount: 4,
        wrongCount: 4,
        knowledgeStats: {
          "不含括号的两级混合运算": { score: 18, total: 36, attempts: 3, correctCount: 1, wrongCount: 2 },
          "含小括号的混合运算": { score: 14, total: 24, attempts: 2, correctCount: 1, wrongCount: 1 },
          "分步算式合并成综合算式": { score: 26, total: 40, attempts: 3, correctCount: 2, wrongCount: 1 }
        }
      },
      {
        id: "mock-score-g3a-u2-2",
        createdAt: "2026-07-05T08:00:00.000Z",
        gradeId: "3",
        gradeName: "三年级",
        volumeId: "A",
        volumeName: "上册",
        unitId: "g3a-u2",
        unitTitle: "混合运算",
        difficulty: "基础",
        questionCount: 8,
        score: 72,
        total: 100,
        accuracy: 63,
        correctCount: 5,
        wrongCount: 3,
        knowledgeStats: {
          "不含括号的两级混合运算": { score: 28, total: 36, attempts: 3, correctCount: 2, wrongCount: 1 },
          "含小括号的混合运算": { score: 12, total: 24, attempts: 2, correctCount: 1, wrongCount: 1 },
          "用线段图或表格分析数量关系": { score: 32, total: 40, attempts: 3, correctCount: 2, wrongCount: 1 }
        }
      },
      {
        id: "mock-score-g3a-u2-3",
        createdAt: "2026-07-10T08:00:00.000Z",
        gradeId: "3",
        gradeName: "三年级",
        volumeId: "A",
        volumeName: "上册",
        unitId: "g3a-u2",
        unitTitle: "混合运算",
        difficulty: "提高",
        questionCount: 10,
        score: 86,
        total: 100,
        accuracy: 80,
        correctCount: 8,
        wrongCount: 2,
        knowledgeStats: {
          "不含括号的两级混合运算": { score: 30, total: 30, attempts: 3, correctCount: 3, wrongCount: 0 },
          "含小括号的混合运算": { score: 20, total: 30, attempts: 3, correctCount: 2, wrongCount: 1 },
          "分步算式合并成综合算式": { score: 18, total: 20, attempts: 2, correctCount: 2, wrongCount: 0 },
          "用线段图或表格分析数量关系": { score: 18, total: 20, attempts: 2, correctCount: 1, wrongCount: 1 }
        }
      }
    ],
    mistakes: [
      {
        id: "mock-mistake-g3a-u2-1",
        grade: "三年级",
        volume: "上册",
        unitTitle: "混合运算",
        knowledgePoint: "含小括号的混合运算",
        questionType: "变式计算题",
        stem: "计算：36 ÷ (3 + 3) = ?",
        answer: "6",
        explanation: "先算小括号里面的 3 + 3 = 6，再算 36 ÷ 6 = 6。",
        detailSteps: [
          "审题：看到小括号，先确定括号内是一个整体。",
          "建模：按先括号、再乘除的顺序计算。",
          "计算：3 + 3 = 6，36 ÷ 6 = 6。",
          "作答：结果写 6，并用 6 × 6 = 36 检查。"
        ],
        commonMistake: "容易先算 36 ÷ 3，把小括号的优先级漏掉。",
        checkMethod: "检查方法：把括号内结果看成除数，再用乘法回验。",
        submitted: "15",
        point: 12,
        difficulty: "基础",
        status: "待复习",
        count: 2,
        createdAt: "2026-07-05T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z"
      },
      {
        id: "mock-mistake-g3a-u2-2",
        grade: "三年级",
        volume: "上册",
        unitTitle: "混合运算",
        knowledgePoint: "用线段图或表格分析数量关系",
        questionType: "生活应用题",
        stem: "每盒彩笔 8 支，买 3 盒后又拿出 5 支，还剩多少支？",
        answer: "19",
        explanation: "先求 3 盒一共有 8 × 3 = 24 支，再拿出 5 支，24 - 5 = 19 支。",
        detailSteps: [
          "审题：先找到每盒支数、盒数和拿出数量。",
          "建模：先乘法求总数，再减法求剩余。",
          "计算：8 × 3 = 24，24 - 5 = 19。",
          "作答：还剩 19 支。"
        ],
        commonMistake: "容易把 5 支也乘进去，或没有区分总数和剩余数。",
        checkMethod: "检查方法：剩余 19 支加拿出的 5 支，应回到总数 24 支。",
        submitted: "29",
        point: 13,
        difficulty: "基础",
        status: "待复习",
        count: 1,
        createdAt: "2026-07-10T08:00:00.000Z",
        updatedAt: "2026-07-10T08:00:00.000Z"
      }
    ],
    coursewareReviews: {}
  };
})();

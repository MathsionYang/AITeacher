function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function generateCourseware(scope, unit) {
  const slides = [
    {
      title: "学习目标",
      visualType: "target",
      visualText: "目标拆解",
      body: `本节围绕“${unit.title}”，逐步掌握 ${unit.points.slice(0, 3).join("、")} 等关键知识点。`
    },
    {
      title: "情境导入",
      visualType: "relation",
      visualText: "数量关系图",
      body: "从生活问题进入：先找已知量，再确定要求的问题，用图形或表格把数量关系表示清楚。"
    },
    {
      title: "概念讲解",
      visualType: "model",
      visualText: "图形模型",
      body: `把“${unit.points[0]}”转化成可观察的模型，先理解含义，再总结计算或判断方法。`
    },
    {
      title: "例题精讲",
      visualType: "steps",
      visualText: "步骤卡",
      body: "审题、列式、计算、检查四步走。每一步都标出对应的知识点，便于课堂追问。"
    },
    {
      title: "课堂练习",
      visualType: "practice",
      visualText: "由易到难",
      body: "练习覆盖本单元全部知识点，同类题不堆叠，优先选择答案标准、便于核对的题型。"
    },
    {
      title: "小结与作业",
      visualType: "summary",
      visualText: "知识闭环",
      body: "用一句话总结方法，再布置 2-3 道客观练习题，帮助教师快速检查掌握情况。"
    }
  ];

  return {
    id: makeId("cw"),
    title: `${scope.gradeName}${scope.volumeName} · ${unit.title} 导学课件`,
    unitId: unit.id,
    unitTitle: unit.title,
    createdAt: nowText(),
    status: "待审核",
    points: unit.points,
    slides
  };
}

function generatePractice(unit, difficulty) {
  const questions = buildQuestions(unit, 10, difficulty || "基础");
  return {
    id: makeId("practice"),
    title: `${unit.title} 同步练习`,
    unitId: unit.id,
    unitTitle: unit.title,
    createdAt: nowText(),
    totalScore: 100,
    difficulty: difficulty || "基础",
    count: questions.length,
    status: "待审核",
    questions
  };
}

function generateSchedule(unit, options) {
  const count = Math.max(10, Math.min(100, Number(options && options.count) || 20));
  const frequency = (options && options.frequency) || "每周";
  const questions = buildQuestions(unit, count, "综合");
  return {
    id: makeId("schedule"),
    title: `${unit.title} ${frequency}测验`,
    unitId: unit.id,
    unitTitle: unit.title,
    createdAt: nowText(),
    totalScore: 100,
    count: questions.length,
    frequency,
    status: "待审核",
    questions
  };
}

function buildQuestions(unit, count, difficulty) {
  const points = unit.points || [];
  const types = ["选择题", "填空题", "计算填空", "单位/概念填空"];
  const scores = distributeScores(count);
  return Array.from({ length: count }, (_, index) => {
    const point = points[index % points.length] || unit.title;
    const type = types[index % types.length];
    return makeQuestion(unit, point, type, difficulty, index + 1, scores[index]);
  });
}

function distributeScores(count) {
  const base = Math.floor(100 / count);
  let rest = 100 - base * count;
  return Array.from({ length: count }, () => {
    const score = base + (rest > 0 ? 1 : 0);
    rest -= rest > 0 ? 1 : 0;
    return score;
  });
}

function makeQuestion(unit, point, type, difficulty, number, score) {
  const seed = number + point.length + unit.title.length;
  const a = (seed % 7) + 3;
  const b = (seed % 5) + 2;
  const product = a * b;
  const common = {
    id: makeId(`q${number}`),
    number,
    type,
    difficulty,
    score,
    knowledgePoint: point,
    auditHint: "教师审核：检查题干是否只涉及当前单元知识点，答案是否唯一且可核对。"
  };

  if (type === "选择题") {
    return Object.assign(common, {
      stem: `关于“${point}”，下面说法正确的是哪一项？`,
      options: [
        "A. 先理解数量关系，再选择对应方法",
        "B. 可以不看单位直接计算",
        "C. 所有题都只能用一种方法",
        "D. 估算时不需要检查结果范围"
      ],
      answer: "A",
      explanation: "先确定知识点和数量关系，再选择计算、比较或判断方法，答案唯一。"
    });
  }

  if (type === "填空题") {
    return Object.assign(common, {
      stem: `${a} 个相同数量，每个是 ${b}，总量是（ ）。`,
      answer: String(product),
      explanation: `求几个相同数量的总和，用 ${a}×${b}=${product}。`
    });
  }

  if (type === "计算填空") {
    return Object.assign(common, {
      stem: `计算并填空：${(a / 10).toFixed(1)} × ${b} =（ ）。`,
      answer: (a * b / 10).toFixed(1),
      explanation: `可先按整数计算 ${a}×${b}=${product}，再根据小数位数确定结果。`
    });
  }

  return Object.assign(common, {
    stem: `把“${point}”对应的方法补充完整：先找（ ），再列式或判断。`,
    answer: "数量关系",
    explanation: "客观题只要求填写关键步骤，便于教师快速核对。"
  });
}

module.exports = {
  generateCourseware,
  generatePractice,
  generateSchedule
};

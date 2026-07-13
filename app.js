(function () {
  const content = window.RJ_MATH_CONTENT;
  const mistakeKey = "ai-teacher-rj-math-mistakes-v1";
  const scheduleKey = "ai-teacher-rj-math-schedule-v1";

  const state = {
    grade: "3",
    volume: "A",
    unitId: "",
    difficulty: "基础",
    questionCount: 6,
    currentQuestions: [],
    answersVisible: false,
    activeTab: "courseware",
    gradingResults: [],
    mistakes: readJson(mistakeKey, []),
    schedule: readJson(scheduleKey, { frequency: "每周", count: 10, mistakeRatio: 40 })
  };

  const $ = (id) => document.getElementById(id);

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function gradeData() {
    return content.grades[state.grade];
  }

  function volumeData() {
    return gradeData().volumes[state.volume];
  }

  function unitData() {
    return volumeData().units.find((item) => item.id === state.unitId) || volumeData().units[0];
  }

  function init() {
    buildSelectors();
    restoreScheduleControls();
    bindEvents();
    state.unitId = volumeData().units[0].id;
    $("unitSelect").value = state.unitId;
    generatePractice();
    renderAll();
  }

  function buildSelectors() {
    $("gradeSelect").innerHTML = Object.entries(content.grades)
      .map(([id, grade]) => `<option value="${id}">${grade.name}</option>`)
      .join("");
    $("gradeSelect").value = state.grade;
    refreshVolumeOptions();
    refreshUnitOptions();
  }

  function refreshVolumeOptions() {
    $("volumeSelect").innerHTML = Object.entries(gradeData().volumes)
      .map(([id, volume]) => `<option value="${id}">${volume.name}</option>`)
      .join("");
    $("volumeSelect").value = state.volume;
  }

  function refreshUnitOptions() {
    $("unitSelect").innerHTML = volumeData().units
      .map((unit) => `<option value="${unit.id}">${unit.title}</option>`)
      .join("");
    state.unitId = volumeData().units[0].id;
    $("unitSelect").value = state.unitId;
  }

  function bindEvents() {
    $("gradeSelect").addEventListener("change", (event) => {
      state.grade = event.target.value;
      state.volume = "A";
      refreshVolumeOptions();
      refreshUnitOptions();
      generatePractice();
      renderAll();
    });

    $("volumeSelect").addEventListener("change", (event) => {
      state.volume = event.target.value;
      refreshUnitOptions();
      generatePractice();
      renderAll();
    });

    $("unitSelect").addEventListener("change", (event) => {
      state.unitId = event.target.value;
      generatePractice();
      renderAll();
    });

    $("difficultySelect").addEventListener("change", (event) => {
      state.difficulty = event.target.value;
      generatePractice();
      renderAll();
    });

    $("questionCount").addEventListener("change", (event) => {
      state.questionCount = clamp(Number(event.target.value) || 6, 3, 20);
      event.target.value = state.questionCount;
      generatePractice();
      renderAll();
    });

    $("generatePaperBtn").addEventListener("click", () => {
      generatePractice();
      switchTab("practice");
      renderAll();
    });

    $("downloadCoursewareBtn").addEventListener("click", downloadCourseware);
    $("showAnswerBtn").addEventListener("click", () => {
      state.answersVisible = !state.answersVisible;
      renderPractice();
    });
    $("copyAnswersBtn").addEventListener("click", copyAnswerTemplate);
    $("simulateOcrBtn").addEventListener("click", simulateOcr);
    $("gradeBtn").addEventListener("click", gradeAnswers);
    $("answerImage").addEventListener("change", previewAnswerImage);
    $("mistakePaperBtn").addEventListener("click", buildMistakePaper);
    $("clearMasteredBtn").addEventListener("click", clearMastered);
    $("saveScheduleBtn").addEventListener("click", saveSchedule);
    $("scheduledPaperBtn").addEventListener("click", buildScheduledPaper);
    $("mistakeRatio").addEventListener("input", (event) => {
      $("mistakeRatioLabel").textContent = `${event.target.value}%`;
    });

    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });

    $("mistakeList").addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      const id = event.target.dataset.id;
      if (!action || !id) return;
      if (action === "master") markMistakeMastered(id);
      if (action === "delete") deleteMistake(id);
    });
  }

  function switchTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === tab);
    });
  }

  function renderAll() {
    renderScope();
    renderCourseware();
    renderPractice();
    renderMistakes();
    renderSchedule();
    renderMetrics();
  }

  function renderScope() {
    const unit = unitData();
    $("scopeLabel").textContent = `${gradeData().name}${volumeData().name} · ${unit.title}`;
    $("scopeSummary").textContent = unit.summary;
  }

  function renderMetrics() {
    $("questionMetric").textContent = state.currentQuestions.length;
    $("mistakeMetric").textContent = state.mistakes.filter((item) => item.status !== "已掌握").length;
    $("scheduleMetric").textContent = state.schedule ? state.schedule.frequency : "未设置";
  }

  function renderCourseware() {
    const unit = unitData();
    $("knowledgePoints").innerHTML = unit.points
      .map((point) => `<span class="tag">${escapeHtml(point)}</span>`)
      .join("");

    $("coursewareSlides").innerHTML = buildCoursewareSlides(unit)
      .map(
        (slide, index) => `
          <article class="slide-card">
            <h4>${index + 1}. ${escapeHtml(slide.title)}</h4>
            <p>${escapeHtml(slide.body)}</p>
            <ul>${slide.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          </article>
        `
      )
      .join("");
  }

  function buildCoursewareSlides(unit) {
    const [firstPoint, secondPoint, thirdPoint] = padPoints(unit.points);
    return [
      {
        title: "学习目标",
        body: `本节围绕“${unit.title}”建立清晰概念和可迁移方法。`,
        bullets: [`说清楚：${firstPoint}`, `做准确：${secondPoint}`, `会应用：${thirdPoint}`]
      },
      {
        title: "情境导入",
        body: "从生活问题进入数学表达，让学生先观察、再表达、再列式。",
        bullets: [`用熟悉情境引出 ${unit.tags[0] || "核心概念"}`, "让学生说出已知条件和问题", "鼓励用图、表、式三种方式表达"]
      },
      {
        title: "概念讲解",
        body: "把抽象概念拆成可观察、可操作、可验证的步骤。",
        bullets: unit.points.slice(0, 3)
      },
      {
        title: "例题精讲",
        body: "用一道典型题示范审题、建模、计算和检查。",
        bullets: ["先圈关键词", "再确定数量关系", "最后用估算或逆运算检查"]
      },
      {
        title: "课堂练习",
        body: "由易到难安排基础题、变式题和小应用题。",
        bullets: [`基础：${unit.tags[0] || "概念"}直接应用`, "提高：改变条件或表达方式", "挑战：结合生活场景解释结果"]
      },
      {
        title: "小结与作业",
        body: "把本节内容收束成知识点、方法和易错提醒。",
        bullets: ["写下今天最重要的一个方法", "完成 5-8 道同步练习", "把错题归因后加入错题本"]
      }
    ];
  }

  function padPoints(points) {
    const result = points.slice();
    while (result.length < 3) result.push(points[0] || "核心知识点");
    return result;
  }

  function renderPractice() {
    const list = $("practiceList");
    list.classList.toggle("show-answers", state.answersVisible);
    $("showAnswerBtn").textContent = state.answersVisible ? "隐藏答案" : "显示答案";

    if (!state.currentQuestions.length) {
      list.className = "question-list empty-state";
      list.textContent = "还没有生成题目，点击左侧生成同步练习。";
      return;
    }

    list.className = `question-list${state.answersVisible ? " show-answers" : ""}`;
    list.innerHTML = state.currentQuestions.map(renderQuestionCard).join("");
  }

  function renderQuestionCard(question, index) {
    return `
      <article class="question-card">
        <h4>${index + 1}. ${escapeHtml(question.stem)}</h4>
        <div class="question-meta">
          <span class="pill blue">${escapeHtml(question.knowledgePoint)}</span>
          <span class="pill orange">${escapeHtml(question.difficulty)}</span>
          <span class="pill">${question.point} 分</span>
        </div>
        <div class="answer-block">
          <p><strong>答案：</strong>${escapeHtml(question.answer)}</p>
          <p><strong>解析：</strong>${escapeHtml(question.explanation)}</p>
        </div>
      </article>
    `;
  }

  function generatePractice() {
    const unit = unitData();
    state.currentQuestions = generateQuestions(unit, Number(state.grade), state.difficulty, state.questionCount);
    state.gradingResults = [];
    $("gradingSummary").classList.remove("active");
    $("gradingSummary").innerHTML = "";
    $("gradingResults").innerHTML = "";
  }

  function generateQuestions(unit, grade, difficulty, count) {
    const questions = [];
    for (let index = 0; index < count; index += 1) {
      const tag = unit.tags[index % unit.tags.length] || "综合";
      questions.push(makeQuestion({ unit, grade, difficulty, tag, index }));
    }
    return questions;
  }

  function makeQuestion(context) {
    const { tag } = context;
    if (includesAny(tag, ["分数"])) return fractionQuestion(context);
    if (includesAny(tag, ["小数"])) return decimalQuestion(context);
    if (includesAny(tag, ["百分数"])) return percentQuestion(context);
    if (includesAny(tag, ["比例", "比"])) return ratioQuestion(context);
    if (includesAny(tag, ["方程"])) return equationQuestion(context);
    if (includesAny(tag, ["体积"])) return volumeQuestion(context);
    if (includesAny(tag, ["面积"])) return areaQuestion(context);
    if (includesAny(tag, ["长度", "单位", "人民币"])) return conversionQuestion(context);
    if (includesAny(tag, ["时间"])) return timeQuestion(context);
    if (includesAny(tag, ["统计"])) return statisticsQuestion(context);
    if (includesAny(tag, ["图形", "角", "方向", "观察"])) return geometryQuestion(context);
    if (includesAny(tag, ["乘除", "倍数", "口诀", "余数"])) return multiplicationQuestion(context);
    return arithmeticQuestion(context);
  }

  function arithmeticQuestion({ unit, grade, difficulty, tag, index }) {
    const base = difficultyBase(grade, difficulty);
    const a = base + index * 3 + 7;
    const b = Math.max(2, Math.floor(base / 2) + index + 4);
    const isSubtract = index % 2 === 1;
    const stem = isSubtract
      ? `${a + b} - ${b} = ?`
      : `${a} + ${b} = ?`;
    const answer = String(isSubtract ? a : a + b);
    return question(unit, tag, difficulty, stem, answer, `先看运算符号，再按数位或口算策略计算，结果是 ${answer}。`, index);
  }

  function multiplicationQuestion({ unit, grade, difficulty, tag, index }) {
    const factor = difficulty === "挑战" ? 13 : difficulty === "提高" ? 9 : 6;
    const a = Math.max(2, grade + index + 2);
    const b = factor + (index % 4);
    if (index % 3 === 2) {
      const total = a * b + (difficulty === "基础" ? 0 : index + 1);
      const answer = difficulty === "基础" ? String(b) : `${b} 余 ${index + 1}`;
      const stem = `${total} ÷ ${a} = ?`;
      return question(unit, tag, difficulty, stem, answer, `用乘法口诀或试商：${a} × ${b} = ${a * b}，${total} 除以 ${a} 的结果为 ${answer}。`, index);
    }
    const answer = String(a * b);
    return question(unit, tag, difficulty, `${a} × ${b} = ?`, answer, `把 ${a} 个 ${b} 相加，或用乘法口诀/竖式计算，积是 ${answer}。`, index);
  }

  function decimalQuestion({ unit, difficulty, tag, index }) {
    const scale = difficulty === "挑战" ? 100 : 10;
    const a = (12 + index * 3) / scale;
    const b = (8 + index * 2) / scale;
    const multiply = difficulty === "挑战" && index % 2 === 0;
    const answerNumber = multiply ? a * b : a + b;
    const answer = trimNumber(answerNumber);
    const stem = multiply ? `${trimNumber(a)} × ${trimNumber(b)} = ?` : `${trimNumber(a)} + ${trimNumber(b)} = ?`;
    return question(unit, tag, difficulty, stem, answer, `小数计算要先确定运算方法，再处理小数点位置，结果是 ${answer}。`, index);
  }

  function fractionQuestion({ unit, difficulty, tag, index }) {
    const denominator = difficulty === "基础" ? 8 : 12 + (index % 3);
    const a = 1 + (index % 3);
    const b = difficulty === "挑战" ? 2 + (index % 4) : 1 + (index % 2);
    const numerator = a + b;
    const answer = reduceFraction(numerator, denominator);
    const stem = `${a}/${denominator} + ${b}/${denominator} = ?`;
    return question(unit, tag, difficulty, stem, answer, `同分母分数相加，分母不变，分子相加：${a}+${b}=${numerator}，再化简为 ${answer}。`, index);
  }

  function percentQuestion({ unit, difficulty, tag, index }) {
    const amount = difficulty === "基础" ? 80 + index * 10 : 120 + index * 20;
    const rate = difficulty === "挑战" ? 35 : difficulty === "提高" ? 25 : 10;
    const answer = trimNumber((amount * rate) / 100);
    const stem = `${amount} 的 ${rate}% 是多少？`;
    return question(unit, tag, difficulty, stem, answer, `百分数可以转化为小数：${rate}% = ${rate / 100}，所以 ${amount} × ${rate / 100} = ${answer}。`, index);
  }

  function ratioQuestion({ unit, difficulty, tag, index }) {
    const a = 2 + (index % 3);
    const b = difficulty === "挑战" ? 5 + (index % 4) : 3 + (index % 3);
    const total = (a + b) * (difficulty === "基础" ? 6 : 8);
    const answer = `${(total * a) / (a + b)} 和 ${(total * b) / (a + b)}`;
    const stem = `把 ${total} 按 ${a}:${b} 分成两部分，两部分分别是多少？`;
    return question(unit, tag, difficulty, stem, answer, `总份数是 ${a + b}，每份是 ${total} ÷ ${a + b}，再分别乘 ${a} 和 ${b}。`, index);
  }

  function equationQuestion({ unit, difficulty, tag, index }) {
    const x = 4 + index;
    const a = difficulty === "基础" ? 2 : 3;
    const b = difficulty === "挑战" ? 11 : 5;
    const c = a * x + b;
    const stem = `解方程：${a}x + ${b} = ${c}`;
    return question(unit, tag, difficulty, stem, `x=${x}`, `先两边同时减 ${b}，得 ${a}x=${a * x}；再两边同时除以 ${a}，得 x=${x}。`, index);
  }

  function areaQuestion({ unit, difficulty, tag, index }) {
    const length = 8 + index + (difficulty === "挑战" ? 7 : 0);
    const width = 5 + (index % 5);
    const answer = String(length * width);
    const stem = `一个长方形长 ${length} cm，宽 ${width} cm，面积是多少平方厘米？`;
    return question(unit, tag, difficulty, stem, answer, `长方形面积 = 长 × 宽，所以 ${length} × ${width} = ${answer} 平方厘米。`, index);
  }

  function volumeQuestion({ unit, difficulty, tag, index }) {
    const length = 4 + index;
    const width = 3 + (index % 3);
    const height = difficulty === "基础" ? 2 : 5;
    const answer = String(length * width * height);
    const stem = `一个长方体长 ${length} cm，宽 ${width} cm，高 ${height} cm，体积是多少立方厘米？`;
    return question(unit, tag, difficulty, stem, answer, `长方体体积 = 长 × 宽 × 高，所以 ${length} × ${width} × ${height} = ${answer}。`, index);
  }

  function conversionQuestion({ unit, difficulty, tag, index }) {
    if (tag.includes("人民币")) {
      const yuan = 3 + index;
      const jiao = difficulty === "基础" ? 5 : 8;
      const answer = String(yuan * 10 + jiao);
      return question(unit, tag, difficulty, `${yuan} 元 ${jiao} 角 = ? 角`, answer, `1 元 = 10 角，所以 ${yuan} 元是 ${yuan * 10} 角，再加 ${jiao} 角，共 ${answer} 角。`, index);
    }
    const meters = 2 + index;
    const answer = String(meters * 100);
    return question(unit, tag, difficulty, `${meters} 米 = ? 厘米`, answer, `1 米 = 100 厘米，所以 ${meters} 米 = ${answer} 厘米。`, index);
  }

  function timeQuestion({ unit, difficulty, tag, index }) {
    const startHour = 8 + (index % 4);
    const minutes = difficulty === "基础" ? 25 : 45 + index * 5;
    const endMinutes = minutes % 60;
    const endHour = startHour + Math.floor(minutes / 60);
    const answer = `${endHour}:${String(endMinutes).padStart(2, "0")}`;
    const stem = `${startHour}:00 开始上课，经过 ${minutes} 分钟后是几点？`;
    return question(unit, tag, difficulty, stem, answer, `经过时间要按 60 分钟进 1 小时计算，${startHour}:00 加 ${minutes} 分钟是 ${answer}。`, index);
  }

  function statisticsQuestion({ unit, difficulty, tag, index }) {
    const values = difficulty === "基础" ? [6 + index, 8 + index, 10 + index] : [12 + index, 15 + index, 18 + index];
    const answer = String(values.reduce((sum, value) => sum + value, 0) / values.length);
    const stem = `三次数学练习得分分别是 ${values.join("、")} 分，平均分是多少？`;
    return question(unit, tag, difficulty, stem, answer, `平均数 = 总数 ÷ 份数，先求和再除以 ${values.length}，平均分是 ${answer}。`, index);
  }

  function geometryQuestion({ unit, difficulty, tag, index }) {
    if (tag.includes("角")) {
      const angle = difficulty === "基础" ? 90 : 35 + index * 10;
      const type = angle === 90 ? "直角" : angle < 90 ? "锐角" : "钝角";
      return question(unit, tag, difficulty, `${angle}° 的角属于锐角、直角还是钝角？`, type, `小于 90° 是锐角，等于 90° 是直角，大于 90° 小于 180° 是钝角，所以答案是${type}。`, index);
    }
    const answer = "先确定参照点，再按方向和距离描述";
    return question(unit, tag, difficulty, "描述位置时，通常要先确定什么，再说明方向和距离？", answer, "位置与方向问题要先确定观测点或参照点，再描述方向、角度和距离。", index);
  }

  function question(unit, knowledgePoint, difficulty, stem, answer, explanation, index) {
    return {
      id: `${unit.id}-q${Date.now()}-${index}`,
      unitId: unit.id,
      unitTitle: unit.title,
      knowledgePoint,
      difficulty,
      stem,
      answer,
      explanation,
      point: difficulty === "挑战" ? 8 : difficulty === "提高" ? 6 : 5
    };
  }

  function difficultyBase(grade, difficulty) {
    const base = grade <= 1 ? 6 : grade <= 2 ? 20 : grade <= 4 ? 100 : 200;
    if (difficulty === "提高") return base * 2;
    if (difficulty === "挑战") return base * 3;
    return base;
  }

  function includesAny(text, needles) {
    return needles.some((needle) => text.includes(needle));
  }

  function reduceFraction(numerator, denominator) {
    const factor = gcd(numerator, denominator);
    const top = numerator / factor;
    const bottom = denominator / factor;
    return bottom === 1 ? String(top) : `${top}/${bottom}`;
  }

  function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
  }

  function trimNumber(value) {
    return Number(value.toFixed(4)).toString();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function downloadCourseware() {
    const markdown = buildCoursewareMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${gradeData().name}${volumeData().name}-${unitData().title}-课件大纲.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function buildCoursewareMarkdown() {
    const unit = unitData();
    const slides = buildCoursewareSlides(unit);
    const lines = [
      `# ${gradeData().name}${volumeData().name} ${unit.title} 课件大纲`,
      "",
      `> 教材范围：${content.version} ${content.subject}`,
      `> 内容说明：${content.note}`,
      "",
      "## 知识点",
      ...unit.points.map((point) => `- ${point}`),
      ""
    ];
    slides.forEach((slide, index) => {
      lines.push(`## ${index + 1}. ${slide.title}`, "", slide.body, "");
      slide.bullets.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    });
    return lines.join("\n");
  }

  async function copyAnswerTemplate() {
    const template = state.currentQuestions.map((_, index) => `${index + 1}. `).join("\n");
    $("answerInput").value = template;
    switchTab("grading");
    try {
      await navigator.clipboard.writeText(template);
    } catch (error) {
      // Clipboard access can be blocked on file://, the textarea still receives the template.
    }
  }

  function previewAnswerImage(event) {
    const file = event.target.files && event.target.files[0];
    const preview = $("answerPreview");
    if (!file) {
      preview.style.display = "none";
      preview.removeAttribute("src");
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
  }

  function simulateOcr() {
    if (!state.currentQuestions.length) generatePractice();
    const lines = state.currentQuestions.map((question, index) => {
      const shouldMiss = index % 4 === 2;
      const answer = shouldMiss ? makeNearbyWrongAnswer(question.answer, index) : question.answer;
      return `${index + 1}. ${answer}`;
    });
    $("answerInput").value = lines.join("\n");
  }

  function makeNearbyWrongAnswer(answer, index) {
    const numeric = parseNumberLike(answer);
    if (Number.isFinite(numeric)) return trimNumber(numeric + index + 1);
    if (answer.includes("锐角")) return "直角";
    if (answer.includes("直角")) return "锐角";
    if (answer.includes("钝角")) return "锐角";
    return `${answer}（漏写单位）`;
  }

  function gradeAnswers() {
    if (!state.currentQuestions.length) generatePractice();
    const answers = parseAnswers($("answerInput").value);
    const results = state.currentQuestions.map((question, index) => {
      const submitted = answers[index + 1] || "";
      const correct = isCorrectAnswer(submitted, question.answer);
      return {
        question,
        index,
        submitted,
        correct,
        score: correct ? question.point : 0
      };
    });
    state.gradingResults = results;
    saveMistakesFromResults(results);
    renderGradingResults(results);
    renderMistakes();
    renderMetrics();
  }

  function parseAnswers(text) {
    const answers = {};
    const fallback = [];
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^(\d+)\s*[\.、:：=]?\s*(.+)$/);
        if (match) answers[Number(match[1])] = match[2].trim();
        else fallback.push(line);
      });
    fallback.forEach((value, index) => {
      if (!answers[index + 1]) answers[index + 1] = value;
    });
    return answers;
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

    return cleanExpected.includes(cleanSubmitted) || cleanSubmitted.includes(cleanExpected);
  }

  function normalizeAnswer(value) {
    return String(value)
      .replace(/\s+/g, "")
      .replace(/[，。；;]/g, "")
      .replace(/：/g, ":")
      .replace(/＝/g, "=")
      .replace(/厘米|平方厘米|立方厘米|cm|cm²|cm³/g, "")
      .toLowerCase();
  }

  function parseNumberLike(value) {
    const text = normalizeAnswer(value).replace(/^x=/, "");
    if (/^-?\d+(\.\d+)?%$/.test(text)) return Number(text.replace("%", "")) / 100;
    const fraction = text.match(/^(-?\d+)\/(\d+)$/);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return Number.NaN;
  }

  function renderGradingResults(results) {
    const total = results.reduce((sum, item) => sum + item.question.point, 0);
    const score = results.reduce((sum, item) => sum + item.score, 0);
    const correctCount = results.filter((item) => item.correct).length;
    const accuracy = results.length ? Math.round((correctCount / results.length) * 100) : 0;

    $("gradingSummary").classList.add("active");
    $("gradingSummary").innerHTML = `
      <div><strong>${score}/${total}</strong><span>总分</span></div>
      <div><strong>${accuracy}%</strong><span>正确率</span></div>
      <div><strong>${correctCount}</strong><span>答对题数</span></div>
      <div><strong>${results.length - correctCount}</strong><span>新增错题</span></div>
    `;

    $("gradingResults").innerHTML = results
      .map((item) => {
        const { question } = item;
        return `
          <article class="result-card ${item.correct ? "" : "wrong"}">
            <h4>${item.index + 1}. ${escapeHtml(question.stem)}</h4>
            <div class="question-meta">
              <span class="pill ${item.correct ? "green" : "red"}">${item.correct ? "正确" : "需复习"}</span>
              <span class="pill blue">${escapeHtml(question.knowledgePoint)}</span>
              <span class="pill">${item.score}/${question.point} 分</span>
            </div>
            <p><strong>学生答案：</strong>${escapeHtml(item.submitted || "未作答")}</p>
            <p><strong>正确答案：</strong>${escapeHtml(question.answer)}</p>
            <p><strong>解析思路：</strong>${escapeHtml(question.explanation)}</p>
          </article>
        `;
      })
      .join("");
  }

  function saveMistakesFromResults(results) {
    const wrongItems = results.filter((item) => !item.correct);
    wrongItems.forEach((item) => {
      const existing = state.mistakes.find((mistake) => mistake.stem === item.question.stem && mistake.status !== "已掌握");
      if (existing) {
        existing.count += 1;
        existing.submitted = item.submitted;
        existing.updatedAt = new Date().toISOString();
        return;
      }
      state.mistakes.unshift({
        id: `${Date.now()}-${item.index}`,
        grade: gradeData().name,
        volume: volumeData().name,
        unitTitle: unitData().title,
        knowledgePoint: item.question.knowledgePoint,
        stem: item.question.stem,
        answer: item.question.answer,
        explanation: item.question.explanation,
        submitted: item.submitted,
        point: item.question.point,
        difficulty: item.question.difficulty,
        status: "待复习",
        count: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });
    writeJson(mistakeKey, state.mistakes);
  }

  function renderMistakes() {
    const activeMistakes = state.mistakes.filter((item) => item.status !== "已掌握");
    const list = $("mistakeList");
    if (!activeMistakes.length) {
      list.className = "mistake-list empty-state";
      list.textContent = "暂无错题。完成一次判分后，错题会自动出现在这里。";
      return;
    }

    list.className = "mistake-list";
    list.innerHTML = activeMistakes
      .map(
        (item) => `
          <article class="mistake-card">
            <h4>${escapeHtml(item.stem)}</h4>
            <div class="question-meta">
              <span class="pill blue">${escapeHtml(item.grade)} ${escapeHtml(item.volume)}</span>
              <span class="pill orange">${escapeHtml(item.knowledgePoint)}</span>
              <span class="pill red">错 ${item.count} 次</span>
            </div>
            <p><strong>学生答案：</strong>${escapeHtml(item.submitted || "未作答")}</p>
            <p><strong>正确答案：</strong>${escapeHtml(item.answer)}</p>
            <p><strong>复盘提示：</strong>${escapeHtml(item.explanation)}</p>
            <div class="mistake-actions">
              <button class="secondary-btn small" data-action="master" data-id="${item.id}">标记已掌握</button>
              <button class="secondary-btn small" data-action="delete" data-id="${item.id}">删除</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function markMistakeMastered(id) {
    const item = state.mistakes.find((mistake) => mistake.id === id);
    if (!item) return;
    item.status = "已掌握";
    item.updatedAt = new Date().toISOString();
    writeJson(mistakeKey, state.mistakes);
    renderMistakes();
    renderMetrics();
  }

  function deleteMistake(id) {
    state.mistakes = state.mistakes.filter((mistake) => mistake.id !== id);
    writeJson(mistakeKey, state.mistakes);
    renderMistakes();
    renderMetrics();
  }

  function clearMastered() {
    state.mistakes = state.mistakes.filter((mistake) => mistake.status !== "已掌握");
    writeJson(mistakeKey, state.mistakes);
    renderMistakes();
    renderMetrics();
  }

  function buildMistakePaper() {
    const activeMistakes = shuffle(state.mistakes.filter((item) => item.status !== "已掌握")).slice(0, state.questionCount);
    if (!activeMistakes.length) {
      switchTab("mistakes");
      return;
    }
    state.currentQuestions = activeMistakes.map((item, index) => ({
      id: `mistake-${item.id}-${index}`,
      unitId: unitData().id,
      unitTitle: item.unitTitle,
      knowledgePoint: item.knowledgePoint,
      difficulty: item.difficulty,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      point: item.point
    }));
    state.answersVisible = false;
    switchTab("practice");
    renderAll();
  }

  function restoreScheduleControls() {
    $("frequencySelect").value = state.schedule.frequency;
    $("scheduledCount").value = state.schedule.count;
    $("mistakeRatio").value = state.schedule.mistakeRatio;
    $("mistakeRatioLabel").textContent = `${state.schedule.mistakeRatio}%`;
  }

  function saveSchedule() {
    state.schedule = {
      frequency: $("frequencySelect").value,
      count: clamp(Number($("scheduledCount").value) || 10, 5, 30),
      mistakeRatio: clamp(Number($("mistakeRatio").value) || 0, 0, 80),
      updatedAt: new Date().toISOString()
    };
    $("scheduledCount").value = state.schedule.count;
    writeJson(scheduleKey, state.schedule);
    renderSchedule();
    renderMetrics();
  }

  function renderSchedule() {
    const schedule = state.schedule;
    $("scheduleStatus").innerHTML = `
      <strong>${escapeHtml(schedule.frequency)}测验已配置</strong>
      <p>每次 ${schedule.count} 题，其中错题占比 ${schedule.mistakeRatio}%。当前会从“${escapeHtml(unitData().title)}”和错题库混合组卷。</p>
    `;
  }

  function buildScheduledPaper() {
    saveSchedule();
    const count = state.schedule.count;
    const mistakeCount = Math.round((count * state.schedule.mistakeRatio) / 100);
    const activeMistakes = shuffle(state.mistakes.filter((item) => item.status !== "已掌握")).slice(0, mistakeCount);
    const newQuestionCount = Math.max(0, count - activeMistakes.length);
    const newQuestions = generateQuestions(unitData(), Number(state.grade), state.difficulty, newQuestionCount);
    const mistakeQuestions = activeMistakes.map((item, index) => ({
      id: `scheduled-mistake-${item.id}-${index}`,
      unitId: unitData().id,
      unitTitle: item.unitTitle,
      knowledgePoint: item.knowledgePoint,
      difficulty: item.difficulty,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      point: item.point
    }));
    state.currentQuestions = shuffle([...mistakeQuestions, ...newQuestions]);
    $("scheduledPaper").className = "question-list";
    $("scheduledPaper").innerHTML = state.currentQuestions.map(renderQuestionCard).join("");
    renderPractice();
    renderMetrics();
  }

  function shuffle(items) {
    return items
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map((item) => item.value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  init();
})();


(function () {
  const content = window.RJ_MATH_CONTENT;
  const mistakeKey = "ai-teacher-rj-math-mistakes-v1";
  const scheduleKey = "ai-teacher-rj-math-schedule-v1";
  const coursewareReviewKey = "ai-teacher-rj-math-courseware-reviews-v1";
  const scoreHistoryKey = "ai-teacher-rj-math-score-history-v1";
  const feedbackPhraseKey = "ai-teacher-rj-math-last-feedback-phrase-v1";

  const state = {
    grade: "3",
    volume: "A",
    unitId: "",
    difficulty: "基础",
    questionCount: 6,
    currentQuestions: [],
    answersVisible: false,
    activeTab: "courseware",
    coursewareEditMode: false,
    gradingResults: [],
    mistakes: readJson(mistakeKey, []),
    coursewareReviews: readJson(coursewareReviewKey, {}),
    scoreHistory: readJson(scoreHistoryKey, []),
    schedule: readJson(scheduleKey, { frequency: "每周", count: 10, mistakeRatio: 40 })
  };

  const $ = (id) => document.getElementById(id);
  let celebrationTimer = null;

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
    const grade = gradeData();
    return grade.volumes[state.volume] || grade.volumes[firstVolumeId(grade)];
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
    $("gradeSelect").innerHTML = supportedGradeEntries()
      .map(([id, grade]) => `<option value="${id}">${grade.name}</option>`)
      .join("");
    if (!content.grades[state.grade] || !supportedGradeIds().includes(state.grade)) {
      state.grade = supportedGradeIds()[0] || Object.keys(content.grades)[0];
    }
    state.volume = firstVolumeId(gradeData());
    $("gradeSelect").value = state.grade;
    refreshVolumeOptions();
    refreshUnitOptions();
  }

  function supportedGradeIds() {
    return content.supportedGrades || Object.keys(content.grades);
  }

  function supportedGradeEntries() {
    return supportedGradeIds()
      .filter((id) => content.grades[id])
      .map((id) => [id, content.grades[id]]);
  }

  function firstVolumeId(grade) {
    return Object.keys((grade && grade.volumes) || {})[0];
  }

  function refreshVolumeOptions() {
    const grade = gradeData();
    if (!grade.volumes[state.volume]) state.volume = firstVolumeId(grade);
    $("volumeSelect").innerHTML = Object.entries(grade.volumes)
      .map(([id, volume]) => `<option value="${id}">${volume.name}</option>`)
      .join("");
    $("volumeSelect").value = state.volume;
  }

  function refreshUnitOptions() {
    const volume = volumeData();
    $("unitSelect").innerHTML = volume.units
      .map((unit) => `<option value="${unit.id}">${unit.title}</option>`)
      .join("");
    state.unitId = volume.units[0].id;
    $("unitSelect").value = state.unitId;
  }

  function bindEvents() {
    $("gradeSelect").addEventListener("change", (event) => {
      state.grade = event.target.value;
      state.volume = firstVolumeId(gradeData());
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
      state.questionCount = capQuestionCount(Number(event.target.value) || 6);
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
    $("exportPdfBtn").addEventListener("click", exportCoursewarePdf);
    $("toggleReviewBtn").addEventListener("click", toggleCoursewareReview);
    $("saveCoursewareBtn").addEventListener("click", saveCoursewareReview);
    $("resetCoursewareBtn").addEventListener("click", resetCoursewareReview);
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
    renderScoreTrends();
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
    const sourceRefs = getSourceRefs(unit);
    $("knowledgePoints").innerHTML = unit.points
      .map(
        (point) => `
          <article class="knowledge-card">
            <strong>${escapeHtml(point)}</strong>
            <p>来源：${renderSourceLinks(sourceRefs)}</p>
          </article>
        `
      )
      .join("");

    $("coursewareSlides").innerHTML = buildCoursewareSlides(unit)
      .map(
        (slide, index) => `
          <article class="slide-card ${state.coursewareEditMode ? "editing" : ""}" data-slide-index="${index}">
            <div class="visual-stage visual-${escapeAttribute(slide.visualType)}">
              ${renderSlideVisual(slide, unit, index)}
            </div>
            <h4 data-edit="title" contenteditable="${state.coursewareEditMode}">${index + 1}. ${escapeHtml(slide.title)}</h4>
            <p data-edit="body" contenteditable="${state.coursewareEditMode}">${escapeHtml(slide.body)}</p>
            <ul>${slide.bullets.map((item, bulletIndex) => `<li data-edit="bullet" data-bullet-index="${bulletIndex}" contenteditable="${state.coursewareEditMode}">${escapeHtml(item)}</li>`).join("")}</ul>
            <div class="source-note">参考来源：${renderSourceLinks(slide.sources)}</div>
          </article>
        `
      )
      .join("");
    $("toggleReviewBtn").textContent = state.coursewareEditMode ? "退出审核" : "审核编辑";
  }

  function buildCoursewareSlides(unit) {
    const [firstPoint, secondPoint, thirdPoint] = padPoints(unit.points);
    const sources = getSourceRefs(unit);
    const baseSlides = [
      {
        title: "学习目标",
        body: `本节围绕“${unit.title}”建立清晰概念和可迁移方法。`,
        bullets: [`说清楚：${firstPoint}`, `做准确：${secondPoint}`, `会应用：${thirdPoint}`],
        visualType: "goals",
        sources
      },
      {
        title: "情境导入",
        body: "从生活问题进入数学表达，让学生先观察、再表达、再列式。",
        bullets: [`用熟悉情境引出 ${unit.tags[0] || "核心概念"}`, "让学生说出已知条件和问题", "鼓励用图、表、式三种方式表达"],
        visualType: "context",
        sources
      },
      {
        title: "概念讲解",
        body: "把抽象概念拆成可观察、可操作、可验证的步骤。",
        bullets: unit.points.slice(0, 3),
        visualType: "concept",
        sources
      },
      {
        title: "例题精讲",
        body: "用一道典型题示范审题、建模、计算和检查。",
        bullets: ["先圈关键词", "再确定数量关系", "最后用估算或逆运算检查"],
        visualType: "example",
        sources
      },
      {
        title: "课堂练习",
        body: "由易到难安排基础题、变式题和小应用题。",
        bullets: [`基础：${unit.tags[0] || "概念"}直接应用`, "提高：改变条件或表达方式", "挑战：结合生活场景解释结果"],
        visualType: "practice",
        sources
      },
      {
        title: "小结与作业",
        body: "把本节内容收束成知识点、方法和易错提醒。",
        bullets: ["写下今天最重要的一个方法", "完成 5-8 道同步练习", "把错题归因后加入错题本"],
        visualType: "summary",
        sources
      }
    ];
    return applyCoursewareReview(unit, baseSlides);
  }

  function padPoints(points) {
    const result = points.slice();
    while (result.length < 3) result.push(points[0] || "核心知识点");
    return result;
  }

  function coursewareKey(unit) {
    return `${state.grade}-${state.volume}-${unit.id}`;
  }

  function applyCoursewareReview(unit, slides) {
    const review = state.coursewareReviews[coursewareKey(unit)];
    if (!Array.isArray(review)) return slides;
    return slides.map((slide, index) => ({
      ...slide,
      title: review[index]?.title || slide.title,
      body: review[index]?.body || slide.body,
      bullets: Array.isArray(review[index]?.bullets) && review[index].bullets.length ? review[index].bullets : slide.bullets
    }));
  }

  function toggleCoursewareReview() {
    state.coursewareEditMode = !state.coursewareEditMode;
    renderCourseware();
  }

  function saveCoursewareReview() {
    const unit = unitData();
    const slides = Array.from(document.querySelectorAll("#coursewareSlides .slide-card")).map((card) => ({
      title: cleanEditableText(card.querySelector('[data-edit="title"]')?.innerText || "").replace(/^\d+\.\s*/, ""),
      body: cleanEditableText(card.querySelector('[data-edit="body"]')?.innerText || ""),
      bullets: Array.from(card.querySelectorAll('[data-edit="bullet"]'))
        .map((item) => cleanEditableText(item.innerText))
        .filter(Boolean)
    }));
    state.coursewareReviews[coursewareKey(unit)] = slides;
    writeJson(coursewareReviewKey, state.coursewareReviews);
    state.coursewareEditMode = false;
    renderCourseware();
  }

  function resetCoursewareReview() {
    delete state.coursewareReviews[coursewareKey(unitData())];
    writeJson(coursewareReviewKey, state.coursewareReviews);
    state.coursewareEditMode = false;
    renderCourseware();
  }

  function cleanEditableText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function exportCoursewarePdf() {
    switchTab("courseware");
    window.print();
  }

  function renderSlideVisual(slide, unit, index) {
    const points = padPoints(unit.points);
    if (slide.visualType === "goals") {
      return `
        <div class="goal-map">
          <strong class="visual-title">本节要看懂的关系</strong>
          ${points.slice(0, 3).map((point, pointIndex) => `<span style="--i:${pointIndex}">${escapeHtml(shortLabel(point))}</span>`).join("")}
        </div>
      `;
    }
    if (slide.visualType === "context") return renderTopicVisual(unit, "large");
    if (slide.visualType === "concept") {
      return `
        <div class="concept-map">
          ${points.slice(0, 4).map((point) => `<span>${escapeHtml(shortLabel(point))}</span>`).join("")}
        </div>
      `;
    }
    if (slide.visualType === "example") return renderTopicVisual(unit, "focus");
    if (slide.visualType === "practice") {
      return `
        <div class="practice-ladder">
          <strong class="visual-title">同一知识点逐步变式</strong>
          <span>基础</span>
          <span>变式</span>
          <span>应用</span>
        </div>
      `;
    }
    return `
      <div class="summary-cycle">
        <strong class="visual-title">复习闭环</strong>
        <span>学</span><span>练</span><span>批</span><span>复</span>
      </div>
    `;
  }

  function renderTopicVisual(unit, size) {
    const tagText = unit.tags.join(",");
    const point = shortLabel(unit.points[0] || unit.title);
    if (includesAny(tagText, ["分数", "百分数"])) {
      return `
        <div class="fraction-visual ${size}">
          <strong class="visual-title">${escapeHtml(point)}</strong>
          <div class="fraction-bars">
            <span data-label="1份"></span><span data-label="2份"></span><span data-label="未取"></span><span data-label="未取"></span>
          </div>
          <small class="visual-caption">先确定整体，再看等分份数和取了几份。</small>
        </div>
      `;
    }
    if (includesAny(tagText, ["图形", "角", "面积", "体积", "空间", "方向"])) {
      if (includesAny(tagText, ["角"])) {
        return `
          <div class="geometry-visual ${size}">
            <strong class="visual-title">${escapeHtml(point)}</strong>
            <div class="angle-model"><span></span><em>90° 是分类边界</em></div>
            <small class="visual-caption">先比较角与 90° 的关系，再判断锐角、直角或钝角。</small>
          </div>
        `;
      }
      if (includesAny(tagText, ["方向", "空间", "观察"])) {
        return `
          <div class="geometry-visual ${size}">
            <strong class="visual-title">${escapeHtml(point)}</strong>
            <div class="direction-model"><span>观测点</span><i></i><em>方向 + 距离</em></div>
            <small class="visual-caption">先定参照点，再描述方向、角度和距离。</small>
          </div>
        `;
      }
      return `
        <div class="geometry-visual ${size}">
          <strong class="visual-title">${escapeHtml(point)}</strong>
          <div class="area-model">
            <span class="edge edge-long">长</span>
            <span class="edge edge-wide">宽</span>
            <em>面积 = 长 × 宽</em>
          </div>
          <small class="visual-caption">先找对应边，再把公式和单位对应起来。</small>
        </div>
      `;
    }
    if (includesAny(tagText, ["统计", "可能性"])) {
      return `
        <div class="bar-visual ${size}">
          <strong class="visual-title">${escapeHtml(point)}</strong>
          <div class="stat-bars">
            <span style="--h:48%" data-label="A"></span><span style="--h:76%" data-label="B"></span><span style="--h:58%" data-label="C"></span><span style="--h:88%" data-label="D"></span>
          </div>
          <small class="visual-caption">先读数据，再比较大小、总量或平均数。</small>
        </div>
      `;
    }
    if (includesAny(tagText, ["长度", "单位", "数感", "大数", "小数"])) {
      return `
        <div class="numberline-visual ${size}">
          <strong class="visual-title">${escapeHtml(point)}</strong>
          <div class="numberline-model">
            <span data-label="0"></span><span data-label="1/4"></span><span data-label="1/2"></span><span data-label="3/4"></span><span data-label="1"></span>
          </div>
          <small class="visual-caption">把数放到位置上，先判断大小和单位间隔。</small>
        </div>
      `;
    }
    return `
      <div class="flow-visual ${size}">
        <strong class="visual-title">${escapeHtml(point)}</strong>
        <span>条件</span><span>关系</span><span>算式</span><span>结果</span>
        <small class="visual-caption">每一步都回答“为什么这样列式”。</small>
      </div>
    `;
  }

  function shortLabel(value) {
    const text = String(value).replace(/[，。、；：]/g, "");
    return text.length > 8 ? `${text.slice(0, 8)}…` : text;
  }

  function renderPractice() {
    const list = $("practiceList");
    list.classList.toggle("show-answers", state.answersVisible);
    $("showAnswerBtn").textContent = state.answersVisible ? "隐藏答案" : "显示答案";
    $("paperMeta").textContent = state.currentQuestions.length
      ? `当前试卷：${state.currentQuestions.length} 题，总分 ${paperTotal(state.currentQuestions)} 分，范围限定为“${unitData().title}”。`
      : "";

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
          <span class="pill green">${escapeHtml(question.questionType || "同步练习")}</span>
          <span class="pill orange">${escapeHtml(question.difficulty)}</span>
          <span class="pill">${question.point} 分</span>
        </div>
        <p class="source-note">知识点来源：${renderSourceLinks(question.sourceRefs || getSourceRefs(unitData()))}</p>
        <div class="answer-block">
          <p><strong>答案：</strong>${escapeHtml(question.answer)}</p>
          <p><strong>解析：</strong>${escapeHtml(question.explanation)}</p>
          ${renderExplanationDetail(question)}
        </div>
      </article>
    `;
  }

  function generatePractice() {
    const unit = unitData();
    state.questionCount = capQuestionCount(state.questionCount);
    state.currentQuestions = normalizePaperPoints(generateScopedQuestions(unit, Number(state.grade), state.difficulty, state.questionCount));
    state.gradingResults = [];
    $("gradingSummary").classList.remove("active");
    $("gradingSummary").innerHTML = "";
    $("gradingResults").innerHTML = "";
    $("performanceFeedback").innerHTML = "";
  }

  function generateScopedQuestions(unit, grade, difficulty, count) {
    const safeCount = capGeneratedQuestionCount(count);
    if (!safeCount) return [];
    let scoped = enforceUnitQuestionBoundary(generateQuestions(unit, grade, difficulty, safeCount), unit);
    let attempts = 0;

    while (scoped.length < safeCount && attempts < 3) {
      const needed = safeCount - scoped.length;
      scoped = scoped.concat(enforceUnitQuestionBoundary(generateQuestions(unit, grade, difficulty, needed), unit));
      attempts += 1;
    }

    return scoped.slice(0, safeCount);
  }

  function enforceUnitQuestionBoundary(questions, unit) {
    const allowedPoints = new Set(unit.points || []);
    return questions.filter((questionItem) => (
      questionItem.unitId === unit.id
      && questionItem.unitTitle === unit.title
      && (!allowedPoints.size || allowedPoints.has(questionItem.knowledgePoint))
    ));
  }

  function generateQuestions(unit, grade, difficulty, count) {
    const safeCount = capGeneratedQuestionCount(count);
    const questions = [];
    const modes = ["概念理解", "基础计算", "情境应用", "变式判断", "综合提升"];
    const maxSameType = Math.max(2, Math.ceil(safeCount / modes.length));
    const typeCounts = {};
    let cursor = 0;

    while (questions.length < safeCount && cursor < safeCount * 6) {
      const tag = unit.tags[cursor % unit.tags.length] || "综合";
      const knowledgePoint = unit.points[cursor % unit.points.length] || tag;
      const mode = modes[cursor % modes.length];
      const candidate = makeQuestion({ unit, grade, difficulty, tag, knowledgePoint, mode, index: cursor });
      const used = typeCounts[candidate.questionType] || 0;
      const canUse = used < maxSameType || questions.length + Object.keys(typeCounts).length >= safeCount;
      if (canUse) {
        questions.push({ ...candidate, id: `${unit.id}-q${Date.now()}-${questions.length}` });
        typeCounts[candidate.questionType] = used + 1;
      }
      cursor += 1;
    }

    while (questions.length < safeCount) {
      const index = questions.length;
      const tag = unit.tags[index % unit.tags.length] || "综合";
      const knowledgePoint = unit.points[index % unit.points.length] || tag;
      questions.push(makeQuestion({ unit, grade, difficulty, tag, knowledgePoint, mode: modes[index % modes.length], index }));
    }
    return questions;
  }

  function makeQuestion(context) {
    const { tag } = context;
    let built;
    if (includesAny(tag, ["分数"])) built = fractionQuestion(context);
    else if (includesAny(tag, ["小数"])) built = decimalQuestion(context);
    else if (includesAny(tag, ["百分数"])) built = percentQuestion(context);
    else if (includesAny(tag, ["比例", "比"])) built = ratioQuestion(context);
    else if (includesAny(tag, ["方程"])) built = equationQuestion(context);
    else if (includesAny(tag, ["体积"])) built = volumeQuestion(context);
    else if (includesAny(tag, ["面积"])) built = areaQuestion(context);
    else if (includesAny(tag, ["长度", "单位", "人民币"])) built = conversionQuestion(context);
    else if (includesAny(tag, ["时间"])) built = timeQuestion(context);
    else if (includesAny(tag, ["统计"])) built = statisticsQuestion(context);
    else if (includesAny(tag, ["图形", "角", "方向", "观察"])) built = geometryQuestion(context);
    else if (includesAny(tag, ["乘除", "倍数", "口诀", "余数"])) built = multiplicationQuestion(context);
    else built = arithmeticQuestion(context);
    return enrichQuestion(built, context);
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

  function enrichQuestion(questionItem, context) {
    const questionType = pickQuestionType(context.mode, context.tag);
    const sourceRefs = getSourceRefs(context.unit);
    const enriched = {
      ...questionItem,
      knowledgePoint: context.knowledgePoint || questionItem.knowledgePoint,
      questionType,
      sourceIds: context.unit.sourceIds || content.defaultSourceIds || [],
      sourceRefs
    };
    return {
      ...enriched,
      detailSteps: buildDetailSteps(enriched, context),
      commonMistake: buildCommonMistake(enriched, context),
      checkMethod: buildCheckMethod(enriched, context)
    };
  }

  function pickQuestionType(mode, tag) {
    if (mode === "概念理解") return "概念辨析题";
    if (mode === "情境应用") return "生活应用题";
    if (mode === "变式判断") return includesAny(tag, ["图形", "角", "方向", "统计"]) ? "图表判断题" : "变式计算题";
    if (mode === "综合提升") return "综合提升题";
    if (includesAny(tag, ["图形", "角", "面积", "体积"])) return "图形计算题";
    if (includesAny(tag, ["统计"])) return "数据分析题";
    return "基础计算题";
  }

  function buildDetailSteps(questionItem, context) {
    return [
      `审题：本题对应“${questionItem.knowledgePoint}”，先圈出已知条件和要求的问题。`,
      `建模：判断题型为“${questionItem.questionType}”，选择与“${context.tag}”相关的计算、比较或数量关系方法。`,
      `计算：${questionItem.explanation}`,
      `作答：把结果写成“${questionItem.answer}”，如果题目有单位、余数或方程未知数，要保持格式完整。`
    ];
  }

  function buildCommonMistake(questionItem, context) {
    if (includesAny(context.tag, ["单位", "长度", "面积", "体积", "人民币", "时间"])) {
      return "常见错误是漏换单位、单位名称写错，或把面积/体积/时间进率混用。";
    }
    if (includesAny(context.tag, ["分数", "小数", "百分数"])) {
      return "常见错误是小数点、分母、百分号处理不一致，或结果没有按要求化简。";
    }
    if (includesAny(context.tag, ["乘除", "余数", "倍数"])) {
      return "常见错误是把乘除关系反过来、余数写大于或等于除数，或口诀试商后没有回代检查。";
    }
    if (includesAny(context.tag, ["图形", "角", "方向"])) {
      return "常见错误是没有先确定参照点、把周长和面积混淆，或角的分类边界记错。";
    }
    return "常见错误是审题跳步、只算局部条件，或没有用估算/逆运算检查结果。";
  }

  function buildCheckMethod(questionItem, context) {
    if (includesAny(context.tag, ["方程"])) return "检查方法：把求出的未知数代回原方程，看等号两边是否相等。";
    if (includesAny(context.tag, ["乘除", "分数", "小数", "百分数", "比例"])) return "检查方法：用估算判断结果范围，再用逆运算或代回原题验证。";
    if (includesAny(context.tag, ["图形", "面积", "体积"])) return "检查方法：确认公式、单位和数量级是否一致，再用生活经验判断结果是否合理。";
    return "检查方法：重新读题，看答案是否回答了题目真正问的量。";
  }

  function renderExplanationDetail(question) {
    const steps = question.detailSteps || [];
    return `
      <div class="explanation-detail">
        <strong>详细步骤</strong>
        <ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        <p><strong>易错点：</strong>${escapeHtml(question.commonMistake || "注意审题和结果格式。")}</p>
        <p><strong>检查：</strong>${escapeHtml(question.checkMethod || "用估算或逆运算检查结果。")}</p>
      </div>
    `;
  }

  function getSourceRefs(unit) {
    const ids = unit.sourceIds || content.defaultSourceIds || [];
    return ids.map((id) => content.sourceCatalog[id]).filter(Boolean);
  }

  function renderSourceLinks(sourceRefs) {
    return sourceRefs
      .map(
        (source) =>
          `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>`
      )
      .join("、");
  }

  function difficultyBase(grade, difficulty) {
    const base = grade <= 1 ? 6 : grade <= 2 ? 20 : grade <= 4 ? 100 : 200;
    if (difficulty === "提高") return base * 2;
    if (difficulty === "挑战") return base * 3;
    return base;
  }

  function capQuestionCount(value) {
    return clamp(Number(value) || 6, 3, 20);
  }

  function capGeneratedQuestionCount(value) {
    return clamp(Number(value) || 0, 0, 20);
  }

  function normalizePaperPoints(questions) {
    const capped = questions.slice(0, 20);
    if (!capped.length) return [];
    const base = Math.floor(100 / capped.length);
    const remainder = 100 - base * capped.length;
    return capped.map((questionItem, index) => ({
      ...questionItem,
      point: base + (index < remainder ? 1 : 0)
    }));
  }

  function paperTotal(questions) {
    return questions.reduce((sum, questionItem) => sum + questionItem.point, 0);
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
    const sources = getSourceRefs(unit);
    const lines = [
      `# ${gradeData().name}${volumeData().name} ${unit.title} 课件大纲`,
      "",
      `> 教材范围：${content.version} ${content.subject}`,
      `> 内容说明：${content.note}`,
      "",
      "## 知识点与来源",
      ...unit.points.map((point) => `- ${point}（来源：${sourceNames(sources)}）`),
      "",
      "## 来源说明",
      ...sources.map((source) => `- ${source.name}：${source.usage} ${source.url}`),
      ""
    ];
    slides.forEach((slide, index) => {
      lines.push(`## ${index + 1}. ${slide.title}`, "", slide.body, "");
      slide.bullets.forEach((item) => lines.push(`- ${item}`));
      lines.push("", `来源：${sourceNames(slide.sources)}`);
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
    state.currentQuestions = normalizePaperPoints(enforceUnitQuestionBoundary(state.currentQuestions, unitData()));
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
    const summary = buildScoreSummary(results);
    state.gradingResults = results;
    saveScoreHistory(summary, results);
    saveMistakesFromResults(results);
    renderGradingResults(results, summary);
    renderMistakes();
    renderScoreTrends();
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

  function renderGradingResults(results, summary = buildScoreSummary(results)) {
    const total = summary.total;
    const score = summary.score;
    const correctCount = summary.correctCount;
    const accuracy = summary.accuracy;

    $("gradingSummary").classList.add("active");
    $("gradingSummary").innerHTML = `
      <div><strong>${score}/${total}</strong><span>总分</span></div>
      <div><strong>${accuracy}%</strong><span>正确率</span></div>
      <div><strong>${correctCount}</strong><span>答对题数</span></div>
      <div><strong>${results.length - correctCount}</strong><span>新增错题</span></div>
    `;
    renderPerformanceFeedback(summary, results);

    $("gradingResults").innerHTML = results
      .map((item) => {
        const { question } = item;
        return `
          <article class="result-card ${item.correct ? "" : "wrong"}">
            <h4>${item.index + 1}. ${escapeHtml(question.stem)}</h4>
            <div class="question-meta">
              <span class="pill ${item.correct ? "green" : "red"}">${item.correct ? "正确" : "需复习"}</span>
              <span class="pill blue">${escapeHtml(question.knowledgePoint)}</span>
              <span class="pill green">${escapeHtml(question.questionType || "同步练习")}</span>
              <span class="pill">${item.score}/${question.point} 分</span>
            </div>
            <p class="source-note">知识点来源：${renderSourceLinks(question.sourceRefs || getSourceRefs(unitData()))}</p>
            <p><strong>学生答案：</strong>${escapeHtml(item.submitted || "未作答")}</p>
            <p><strong>正确答案：</strong>${escapeHtml(question.answer)}</p>
            <p><strong>解析思路：</strong>${escapeHtml(question.explanation)}</p>
            ${renderExplanationDetail(question)}
          </article>
        `;
      })
      .join("");
  }

  function buildScoreSummary(results) {
    const rawTotal = results.reduce((sum, item) => sum + item.question.point, 0);
    const rawScore = results.reduce((sum, item) => sum + item.score, 0);
    const correctCount = results.filter((item) => item.correct).length;
    const score = rawTotal ? Math.round((rawScore / rawTotal) * 100) : 0;
    const knowledgeStats = {};

    results.forEach((item) => {
      const key = item.question.knowledgePoint || "未标记知识点";
      if (!knowledgeStats[key]) {
        knowledgeStats[key] = { score: 0, total: 0, attempts: 0, correctCount: 0, wrongCount: 0 };
      }
      knowledgeStats[key].score += item.score;
      knowledgeStats[key].total += item.question.point;
      knowledgeStats[key].attempts += 1;
      if (item.correct) knowledgeStats[key].correctCount += 1;
      else knowledgeStats[key].wrongCount += 1;
    });

    return {
      score,
      total: 100,
      accuracy: results.length ? Math.round((correctCount / results.length) * 100) : 0,
      correctCount,
      wrongCount: results.length - correctCount,
      questionCount: results.length,
      knowledgeStats
    };
  }

  function saveScoreHistory(summary, results) {
    const unit = unitData();
    const record = {
      id: `${Date.now()}-${unit.id}`,
      createdAt: new Date().toISOString(),
      gradeId: state.grade,
      gradeName: gradeData().name,
      volumeId: state.volume,
      volumeName: volumeData().name,
      unitId: unit.id,
      unitTitle: unit.title,
      difficulty: state.difficulty,
      questionCount: results.length,
      score: summary.score,
      total: summary.total,
      accuracy: summary.accuracy,
      correctCount: summary.correctCount,
      wrongCount: summary.wrongCount,
      knowledgeStats: summary.knowledgeStats
    };
    state.scoreHistory = [...state.scoreHistory, record].slice(-100);
    writeJson(scoreHistoryKey, state.scoreHistory);
  }

  function renderPerformanceFeedback(summary) {
    const panel = $("performanceFeedback");
    const score = summary.score;
    let body = "";

    if (score < 60) {
      const phrase = pickEncouragementPhrase();
      body = `
        <article class="feedback-card feedback-low">
          ${renderFeedbackImage("encouragement", phrase, "这次先稳住节奏", `${score} 分 · ${unitData().title}`)}
          <div>
            <strong>建议先回看薄弱知识点</strong>
            <p>把错题拆成“审题、方法、计算、检查”四步，下一次只要多拿回几道题，分数就会明显上来。</p>
          </div>
        </article>
      `;
    } else if (score < 80) {
      body = `
        <article class="feedback-card feedback-pass">
          ${renderFeedbackImage("certificate", "学习肯定奖", "基础已经站稳", `${score} 分 · 继续巩固易错点`)}
          <div>
            <strong>已经跨过及格线</strong>
            <p>这次说明核心概念有基础了，接下来重点减少粗心、单位、审题和格式错误。</p>
          </div>
        </article>
      `;
    } else if (score < 95) {
      body = `
        <article class="feedback-card feedback-great">
          ${renderFeedbackImage("celebration", "优秀表现", "知识点掌握较稳", `${score} 分 · 屏幕撒花已触发`)}
          <div>
            <strong>这次表现很亮眼</strong>
            <p>继续保持检查习惯，把最后几处易错点补齐，就能冲击满分段。</p>
          </div>
        </article>
      `;
    } else {
      body = `
        <article class="feedback-card feedback-champion">
          <div class="podium-card">
            <div class="podium-preview">
              <span class="preview-person"></span>
              <span class="preview-trophy"></span>
              <span class="preview-podium"></span>
            </div>
            <strong>领奖台时刻</strong>
            <p>${score} 分，知识点掌握非常扎实。</p>
          </div>
          <div>
            <strong>高分稳定区</strong>
            <p>接下来可以减少重复基础题，增加变式题和综合应用题，保持手感。</p>
          </div>
        </article>
      `;
    }

    panel.innerHTML = body;
    triggerScoreAnimation(score);
  }

  function pickEncouragementPhrase() {
    const phrases = [
      "别急，先把会的题拿稳",
      "今天的错题，是下一次的加分点",
      "一步一步来，方法比速度更重要",
      "先订正一类题，再挑战下一类",
      "看清条件，分数会慢慢追上来",
      "这次找到问题，下次就更有方向"
    ];
    const last = localStorage.getItem(feedbackPhraseKey);
    const candidates = phrases.filter((phrase) => phrase !== last);
    const picked = candidates[Math.floor(Math.random() * candidates.length)] || phrases[0];
    localStorage.setItem(feedbackPhraseKey, picked);
    return picked;
  }

  function renderFeedbackImage(kind, title, subtitle, detail) {
    const theme = {
      encouragement: { bg: "#eef4ff", accent: "#2563eb", soft: "#dbeafe" },
      certificate: { bg: "#fff7ed", accent: "#c2410c", soft: "#fed7aa" },
      celebration: { bg: "#ecfdf5", accent: "#0f766e", soft: "#99f6e4" }
    }[kind] || { bg: "#f8fafc", accent: "#334155", soft: "#e2e8f0" };
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360">
        <rect width="720" height="360" rx="28" fill="${theme.bg}"/>
        <rect x="36" y="36" width="648" height="288" rx="22" fill="#ffffff" stroke="${theme.accent}" stroke-width="4"/>
        <path d="M94 248 C160 204 214 288 286 238 S414 190 498 236 S610 278 650 226" fill="none" stroke="${theme.soft}" stroke-width="18" stroke-linecap="round"/>
        <circle cx="574" cy="96" r="42" fill="${theme.soft}"/>
        <circle cx="604" cy="116" r="18" fill="${theme.accent}" opacity="0.18"/>
        <rect x="74" y="74" width="86" height="86" rx="18" fill="${theme.soft}"/>
        <path d="M96 118 h42 M117 96 v44" stroke="${theme.accent}" stroke-width="10" stroke-linecap="round"/>
        ${svgTextLines(title, 190, 126, 40, theme.accent, 15)}
        <text x="190" y="194" font-size="24" font-weight="700" fill="#475467">${escapeSvg(subtitle)}</text>
        <text x="190" y="238" font-size="24" font-weight="800" fill="#172033">${escapeSvg(detail)}</text>
      </svg>
    `;
    return `<img class="feedback-image" alt="${escapeAttribute(title)}" src="${svgDataUri(svg)}">`;
  }

  function svgTextLines(text, x, y, size, fill, maxChars) {
    return splitText(text, maxChars).map((line, index) =>
      `<text x="${x}" y="${y + index * (size + 10)}" font-size="${size}" font-weight="900" fill="${fill}">${escapeSvg(line)}</text>`
    ).join("");
  }

  function splitText(text, maxChars) {
    const value = String(text);
    const lines = [];
    for (let index = 0; index < value.length; index += maxChars) {
      lines.push(value.slice(index, index + maxChars));
    }
    return lines;
  }

  function svgDataUri(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  function triggerScoreAnimation(score) {
    const layer = $("celebrationLayer");
    if (!layer) return;
    clearTimeout(celebrationTimer);
    layer.className = "celebration-layer";
    layer.innerHTML = "";
    if (score < 80) return;

    const confetti = Array.from({ length: score >= 95 ? 58 : 42 }, (_, index) => {
      const colors = ["#0f766e", "#2563eb", "#f97316", "#dc2626", "#f59e0b"];
      return `<span class="confetti" style="--x:${Math.round(Math.random() * 100)}vw;--delay:${index * 34}ms;--drift:${Math.round(Math.random() * 120 - 60)}px;--color:${colors[index % colors.length]}"></span>`;
    }).join("");
    const podium = score >= 95 ? `
      <div class="award-stage">
        <div class="award-person"><span></span></div>
        <div class="award-trophy"></div>
        <div class="award-podium"><span>1</span></div>
      </div>
    ` : "";

    layer.innerHTML = `${confetti}${podium}`;
    layer.classList.add("active", score >= 95 ? "with-podium" : "confetti-only");
    celebrationTimer = setTimeout(() => {
      layer.className = "celebration-layer";
      layer.innerHTML = "";
    }, score >= 95 ? 5600 : 3600);
  }

  function renderScoreTrends() {
    const panel = $("trendPanel");
    if (!panel) return;
    const currentUnit = unitData();
    const scopedRecords = state.scoreHistory.filter(
      (item) => item.gradeId === state.grade && item.volumeId === state.volume && item.unitId === currentUnit.id
    );
    const records = (scopedRecords.length ? scopedRecords : state.scoreHistory).slice(-8);

    if (!records.length) {
      panel.innerHTML = `
        <div class="trend-empty">
          <strong>成绩趋势</strong>
          <p>完成一次判分后，这里会保存成绩，并分析当前单元的薄弱知识点。</p>
        </div>
      `;
      return;
    }

    const weakItems = analyzeWeakKnowledge(scopedRecords.length ? scopedRecords : state.scoreHistory);
    panel.innerHTML = `
      <div class="trend-head">
        <div>
          <p class="eyebrow">Progress</p>
          <h3>成绩趋势与薄弱知识点</h3>
        </div>
        <span>${scopedRecords.length ? "当前单元" : "全部记录"} · 最近 ${records.length} 次</span>
      </div>
      ${renderTrendSvg(records)}
      <div class="weak-grid">
        ${weakItems.length ? weakItems.map(renderWeakKnowledgeItem).join("") : "<p class=\"hint\">暂未发现明显薄弱项。</p>"}
      </div>
    `;
  }

  function renderTrendSvg(records) {
    const width = 680;
    const height = 210;
    const pad = 34;
    const sorted = records.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const points = sorted.map((item, index) => {
      const x = sorted.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (sorted.length - 1);
      const y = pad + ((100 - item.score) * (height - pad * 2)) / 100;
      return { ...item, x, y };
    });
    const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
    const labels = points.map((point, index) => `
      <circle cx="${point.x}" cy="${point.y}" r="6" fill="#0f766e"/>
      <text x="${point.x}" y="${Math.max(18, point.y - 12)}" text-anchor="middle" font-size="13" font-weight="800" fill="#172033">${point.score}</text>
      <text x="${point.x}" y="${height - 8}" text-anchor="middle" font-size="11" fill="#667085">${index + 1}</text>
    `).join("");
    return `
      <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="成绩趋势图">
        <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#cbd5e1"/>
        <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#cbd5e1"/>
        <line x1="${pad}" y1="${pad + (height - pad * 2) * 0.4}" x2="${width - pad}" y2="${pad + (height - pad * 2) * 0.4}" stroke="#edf1f7"/>
        <line x1="${pad}" y1="${pad + (height - pad * 2) * 0.2}" x2="${width - pad}" y2="${pad + (height - pad * 2) * 0.2}" stroke="#edf1f7"/>
        <text x="8" y="${pad + (height - pad * 2) * 0.4 + 4}" font-size="11" fill="#667085">60</text>
        <text x="8" y="${pad + (height - pad * 2) * 0.2 + 4}" font-size="11" fill="#667085">80</text>
        <polyline points="${pointString}" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
        ${labels}
      </svg>
    `;
  }

  function analyzeWeakKnowledge(records) {
    const grouped = {};
    records.forEach((record) => {
      Object.entries(record.knowledgeStats || {}).forEach(([point, stat]) => {
        if (!grouped[point]) grouped[point] = { score: 0, total: 0, attempts: 0, wrongCount: 0 };
        grouped[point].score += stat.score || 0;
        grouped[point].total += stat.total || 0;
        grouped[point].attempts += stat.attempts || 0;
        grouped[point].wrongCount += stat.wrongCount || 0;
      });
    });
    return Object.entries(grouped)
      .map(([point, stat]) => {
        const mastery = stat.total ? Math.round((stat.score / stat.total) * 100) : 0;
        return {
          point,
          mastery,
          attempts: stat.attempts,
          wrongCount: stat.wrongCount,
          label: mastery < 60 ? "薄弱" : mastery < 80 ? "需巩固" : "较稳定"
        };
      })
      .sort((a, b) => a.mastery - b.mastery || b.wrongCount - a.wrongCount)
      .slice(0, 4);
  }

  function renderWeakKnowledgeItem(item) {
    return `
      <article class="weak-card">
        <div>
          <strong>${escapeHtml(item.point)}</strong>
          <span>${escapeHtml(item.label)} · 练过 ${item.attempts} 题</span>
        </div>
        <div class="mastery-bar" style="--mastery:${item.mastery}%"><span></span></div>
        <p>掌握度 ${item.mastery}% · 错 ${item.wrongCount} 次</p>
      </article>
    `;
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
        questionType: item.question.questionType,
        stem: item.question.stem,
        answer: item.question.answer,
        explanation: item.question.explanation,
        detailSteps: item.question.detailSteps,
        commonMistake: item.question.commonMistake,
        checkMethod: item.question.checkMethod,
        sourceRefs: item.question.sourceRefs,
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
              <span class="pill green">${escapeHtml(item.questionType || "同步练习")}</span>
              <span class="pill red">错 ${item.count} 次</span>
            </div>
            <p class="source-note">知识点来源：${renderSourceLinks(item.sourceRefs || getSourceRefs(unitData()))}</p>
            <p><strong>学生答案：</strong>${escapeHtml(item.submitted || "未作答")}</p>
            <p><strong>正确答案：</strong>${escapeHtml(item.answer)}</p>
            <p><strong>复盘提示：</strong>${escapeHtml(item.explanation)}</p>
            ${renderExplanationDetail(item)}
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

  function currentUnitMistakes() {
    const unit = unitData();
    const allowedPoints = new Set(unit.points || []);
    return state.mistakes.filter((item) => (
      item.status !== "已掌握"
      && (!item.grade || item.grade === gradeData().name)
      && (!item.volume || item.volume === volumeData().name)
      && item.unitTitle === unit.title
      && (!allowedPoints.size || allowedPoints.has(item.knowledgePoint))
    ));
  }

  function buildMistakePaper() {
    const activeMistakes = shuffle(currentUnitMistakes()).slice(0, capQuestionCount(state.questionCount));
    if (!activeMistakes.length) {
      switchTab("mistakes");
      return;
    }
    state.currentQuestions = normalizePaperPoints(enforceUnitQuestionBoundary(activeMistakes.map((item, index) => ({
      id: `mistake-${item.id}-${index}`,
      unitId: unitData().id,
      unitTitle: item.unitTitle,
      knowledgePoint: item.knowledgePoint,
      questionType: item.questionType,
      difficulty: item.difficulty,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      detailSteps: item.detailSteps,
      commonMistake: item.commonMistake,
      checkMethod: item.checkMethod,
      sourceRefs: item.sourceRefs || getSourceRefs(unitData()),
      point: item.point
    })), unitData()));
    state.answersVisible = false;
    switchTab("practice");
    renderAll();
  }

  function restoreScheduleControls() {
    $("frequencySelect").value = state.schedule.frequency;
    state.schedule.count = clamp(Number(state.schedule.count) || 10, 5, 20);
    $("scheduledCount").value = state.schedule.count;
    $("mistakeRatio").value = state.schedule.mistakeRatio;
    $("mistakeRatioLabel").textContent = `${state.schedule.mistakeRatio}%`;
  }

  function saveSchedule() {
    state.schedule = {
      frequency: $("frequencySelect").value,
      count: clamp(Number($("scheduledCount").value) || 10, 5, 20),
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
      <p>每次 ${schedule.count} 题，总分 100 分，其中错题占比 ${schedule.mistakeRatio}%。当前只从“${escapeHtml(unitData().title)}”单元知识点和本单元错题混合组卷。</p>
    `;
  }

  function buildScheduledPaper() {
    saveSchedule();
    const count = clamp(state.schedule.count, 5, 20);
    const mistakeCount = Math.round((count * state.schedule.mistakeRatio) / 100);
    const activeMistakes = shuffle(currentUnitMistakes()).slice(0, mistakeCount);
    const newQuestionCount = Math.max(0, count - activeMistakes.length);
    const newQuestions = generateScopedQuestions(unitData(), Number(state.grade), state.difficulty, newQuestionCount);
    const mistakeQuestions = activeMistakes.map((item, index) => ({
      id: `scheduled-mistake-${item.id}-${index}`,
      unitId: unitData().id,
      unitTitle: item.unitTitle,
      knowledgePoint: item.knowledgePoint,
      questionType: item.questionType,
      difficulty: item.difficulty,
      stem: item.stem,
      answer: item.answer,
      explanation: item.explanation,
      detailSteps: item.detailSteps,
      commonMistake: item.commonMistake,
      checkMethod: item.checkMethod,
      sourceRefs: item.sourceRefs || getSourceRefs(unitData()),
      point: item.point
    }));
    state.currentQuestions = normalizePaperPoints(enforceUnitQuestionBoundary(shuffle([...mistakeQuestions, ...newQuestions]), unitData()));
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

  function escapeSvg(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function sourceNames(sourceRefs) {
    return sourceRefs.map((source) => source.name).join("、");
  }

  init();
})();

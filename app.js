(function () {
  const content = window.RJ_MATH_CONTENT;
  const mistakeKey = "ai-teacher-rj-math-mistakes-v1";
  const scheduleKey = "ai-teacher-rj-math-schedule-v1";
  const coursewareReviewKey = "ai-teacher-rj-math-courseware-reviews-v1";
  const scoreHistoryKey = "ai-teacher-rj-math-score-history-v1";
  const feedbackPhraseKey = "ai-teacher-rj-math-last-feedback-phrase-v1";
  const roleModeKey = "ai-teacher-rj-math-role-mode-v1";
  const generationCacheKey = "ai-teacher-rj-math-generation-cache-v1";
  const pptPlanKey = "ai-teacher-rj-math-ppt-plans-v1";
  const ocrProxyBaseUrl = "http://127.0.0.1:8790";
  const ruleEngine = window.AITeacherRuleEngine || {};
  const storage = window.AITeacherStorage?.createLocalJsonStorage?.({
    namespace: "ai-teacher-rj-math",
    schemaVersion: Math.max(ruleEngine.SCHEMA_VERSION || 2, window.AITeacherStorage?.STORAGE_SCHEMA_VERSION || 3)
  }) || createFallbackStorage();
  const exportSchemaVersion = Math.max(ruleEngine.SCHEMA_VERSION || 2, storage.schemaVersion || 3);
  const reviewExportVersion = `review-v${exportSchemaVersion}`;
  const practiceExportVersion = `practice-v${exportSchemaVersion}`;
  const localDataKeys = {
    mistakes: mistakeKey,
    schedule: scheduleKey,
    coursewareReviews: coursewareReviewKey,
    scoreHistory: scoreHistoryKey,
    roleMode: roleModeKey,
    generationCache: generationCacheKey,
    pptPlans: pptPlanKey
  };
  const mockData = window.AI_TEACHER_MOCK_DATA || {};
  const mockEnabled = Boolean(mockData.enabled);
  const initialScope = mockEnabled ? mockData.initialScope || {} : {};
  const providerDefaults = window.AITeacherModelClient?.providerDefaults || {};
  const modelClient = window.AITeacherModelClient?.createModelClient?.();
  const agentOrchestrator = window.AITeacherAgentOrchestrator?.createAgentOrchestrator?.({ modelClient });
  const pptxExporter = window.AITeacherPptxExporter;
  const requiredQuestionCount = ruleEngine.REQUIRED_QUESTION_COUNT || 10;

  const state = {
    grade: String(initialScope.grade || "3"),
    volume: initialScope.volume || "A",
    unitId: initialScope.unitId || "",
    difficulty: initialScope.difficulty || "基础",
    questionCount: requiredQuestionCount,
    currentQuestions: [],
    answerReview: { entries: [], summary: { averageConfidence: 0, lowConfidenceCount: 0, missingCount: 0 } },
    lastOcrResult: null,
    lastOcrText: "",
    ocrRecognizing: false,
    answersVisible: false,
    activeTab: "courseware",
    coursewareEditMode: false,
    coursewareGenerating: false,
    coursewarePresenting: false,
    coursewarePresentationIndex: 0,
    pptPlanGenerating: false,
    practiceGenerating: false,
    gradingResults: [],
    mistakes: readJson(mistakeKey, [], "mistakes"),
    coursewareReviews: readJson(coursewareReviewKey, {}, "coursewareReviews"),
    scoreHistory: readJson(scoreHistoryKey, [], "scoreHistory"),
    generationCache: readJson(generationCacheKey, {}, "generationCache"),
    pptPlans: readJson(pptPlanKey, {}, "pptPlans"),
    schedule: readJson(scheduleKey, { frequency: "每周", count: 10, mistakeRatio: 40 }, "schedule"),
    roleMode: readRoleMode()
  };

  const $ = (id) => document.getElementById(id);
  let celebrationTimer = null;
  let noticeTimer = null;

  function readJson(key, fallback, mockField) {
    try {
      const raw = storage.getString(key, "");
      const shouldReplace = mockEnabled && mockField && mockData.mode === "replace";
      if (raw && !shouldReplace) return JSON.parse(raw);
      return cloneJson(mockValue(mockField, fallback));
    } catch (error) {
      return cloneJson(mockValue(mockField, fallback));
    }
  }

  function writeJson(key, value) {
    storage.setJson(key, value);
  }

  function readRoleMode() {
    const value = storage.getString(roleModeKey, "teacher");
    return value === "student" ? "student" : "teacher";
  }

  function createFallbackStorage() {
    return {
      kind: "local-json-fallback",
      schemaVersion: 5,
      getString: (key, fallback = "") => {
        const value = localStorage.getItem(key);
        return value == null ? fallback : value;
      },
      setString: (key, value) => localStorage.setItem(key, String(value)),
      setJson: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
      removeMany: (keys) => keys.forEach((key) => localStorage.removeItem(key)),
      buildEnvelope: (type, data, metadata = {}) => ({
        schemaVersion: 5,
        storageKind: "local-json-fallback",
        type,
        exportedAt: new Date().toISOString(),
        exportVersion: metadata.exportVersion || `${type}-v5`,
        ...metadata,
        data
      }),
      sqliteMigrationPlan: () => ({
        target: "sqlite",
        schemaVersion: 5,
        schema: [],
        strategy: ["加载 storage-adapter.js 后导出迁移计划"]
      })
    };
  }

  function mockValue(field, fallback) {
    if (!mockEnabled || !field || !Object.prototype.hasOwnProperty.call(mockData, field)) return fallback;
    return mockData[field];
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function buildGenerationCacheId(kind, unit, runtimeConfig, extra = {}) {
    const fingerprint = stableStringify({
      kind,
      schemaVersion: exportSchemaVersion,
      contentVersion: content.version,
      subject: content.subject,
      gradeId: state.grade,
      volumeId: state.volume,
      unitId: unit.id,
      unitTitle: unit.title,
      unitPoints: unit.points || [],
      difficulty: state.difficulty,
      questionCount: capQuestionCount(state.questionCount),
      provider: cleanText(runtimeConfig?.provider),
      model: cleanText(runtimeConfig?.model),
      baseUrl: cleanText(runtimeConfig?.baseUrl),
      ...extra
    });
    return `${kind}:${hashString(fingerprint)}`;
  }

  function readGenerationCache(cacheId) {
    const entry = state.generationCache && state.generationCache[cacheId];
    if (!entry || !entry.payload) return null;
    return entry;
  }

  function writeGenerationCache(cacheId, payload, metadata = {}) {
    const now = new Date().toISOString();
    const previous = state.generationCache[cacheId] || {};
    state.generationCache[cacheId] = {
      schemaVersion: exportSchemaVersion,
      cacheVersion: "generation-cache-v1",
      cacheId,
      createdAt: previous.createdAt || now,
      updatedAt: now,
      ...metadata,
      payload
    };
    pruneGenerationCache(30);
    writeJson(generationCacheKey, state.generationCache);
  }

  function pruneGenerationCache(limit) {
    const entries = Object.entries(state.generationCache || {});
    if (entries.length <= limit) return;
    entries
      .sort(([, a], [, b]) => String(a.updatedAt || a.createdAt || "").localeCompare(String(b.updatedAt || b.createdAt || "")))
      .slice(0, entries.length - limit)
      .forEach(([key]) => delete state.generationCache[key]);
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
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
    buildModelProviderOptions();
    restoreScheduleControls();
    restoreRoleModeControls();
    bindEvents();
    renderAll();
  }

  function restoreRoleModeControls() {
    $("roleModeSelect").value = state.roleMode;
    applyRoleMode();
  }

  function applyRoleMode() {
    document.body.dataset.roleMode = state.roleMode;
    if (!isTeacherMode()) {
      state.coursewareEditMode = false;
      state.answersVisible = false;
    }
  }

  function isTeacherMode() {
    return state.roleMode === "teacher";
  }

  function requireTeacherMode(actionLabel) {
    if (isTeacherMode()) return true;
    setModelStatus(`${actionLabel} 仅在教师模式开放；学生模式只保留学习、答题、解析、错题和测验。`, "warn");
    return false;
  }

  function buildSelectors() {
    $("gradeSelect").innerHTML = supportedGradeEntries()
      .map(([id, grade]) => `<option value="${id}">${grade.name}</option>`)
      .join("");
    if (!content.grades[state.grade] || !supportedGradeIds().includes(state.grade)) {
      state.grade = supportedGradeIds()[0] || Object.keys(content.grades)[0];
    }
    if (!gradeData().volumes[state.volume]) state.volume = firstVolumeId(gradeData());
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
    if (!volume.units.some((unit) => unit.id === state.unitId)) {
      state.unitId = volume.units[0].id;
    }
    $("unitSelect").value = state.unitId;
  }

  function applyScopeFromPayload(payload = {}) {
    const gradeId = String(payload.gradeId || payload.grade || state.grade);
    const grade = content.grades[gradeId];
    if (!grade) return false;
    const volumeId = payload.volumeId || payload.volume || state.volume;
    const volume = grade.volumes[volumeId];
    if (!volume) return false;
    const unitId = payload.unitId || state.unitId;
    if (!volume.units.some((unit) => unit.id === unitId)) return false;

    state.grade = gradeId;
    state.volume = volumeId;
    state.unitId = unitId;
    if (["基础", "提高", "挑战"].includes(payload.difficulty)) state.difficulty = payload.difficulty;
    state.questionCount = capQuestionCount(payload.questionCount);

    $("gradeSelect").value = state.grade;
    refreshVolumeOptions();
    refreshUnitOptions();
    $("difficultySelect").value = state.difficulty;
    $("questionCount").value = state.questionCount;
    clearPracticeState();
    return true;
  }
  function buildModelProviderOptions() {
    const entries = Object.entries(providerDefaults);
    if (!entries.length) {
      setModelStatus("模型客户端未加载，本地规则引擎仍可使用。", "warn");
      return;
    }
    $("modelProvider").innerHTML = entries
      .map(([id, provider]) => `<option value="${id}">${escapeHtml(provider.label || id)}</option>`)
      .join("");
    $("modelProvider").value = entries[0][0];
    applyModelProviderDefaults();
  }

  function applyModelProviderDefaults() {
    const provider = providerDefaults[$("modelProvider").value] || {};
    $("modelName").value = provider.model || "";
    $("modelBaseUrl").value = provider.baseUrl || "";
    updateModelApiKeyField(provider);
    setModelStatus(
      provider.requiresApiKey === false
        ? "本地代理模式：Key 和上游 URL 放在本机 1.md 或 .env，页面 API Key 可留空。"
        : "直连模式：临时 API Key 仅保存在当前页面内存中。",
      "info"
    );
  }

  function updateModelApiKeyField(provider) {
    const keyInput = $("modelApiKey");
    const localProxyMode = provider.requiresApiKey === false;
    keyInput.disabled = localProxyMode;
    if (localProxyMode) keyInput.value = "";
    keyInput.placeholder = localProxyMode ? "本地代理已托管 Key，可留空" : "仅本次页面使用";
  }

  function bindEvents() {
    $("gradeSelect").addEventListener("change", (event) => {
      state.grade = event.target.value;
      state.volume = firstVolumeId(gradeData());
      refreshVolumeOptions();
      refreshUnitOptions();
      clearPracticeState();
      renderAll();
    });

    $("volumeSelect").addEventListener("change", (event) => {
      state.volume = event.target.value;
      refreshUnitOptions();
      clearPracticeState();
      renderAll();
    });

    $("unitSelect").addEventListener("change", (event) => {
      state.unitId = event.target.value;
      clearPracticeState();
      renderAll();
    });

    $("difficultySelect").addEventListener("change", (event) => {
      state.difficulty = event.target.value;
      clearPracticeState();
      renderAll();
    });

    $("questionCount").addEventListener("change", (event) => {
      state.questionCount = capQuestionCount(event.target.value);
      event.target.value = state.questionCount;
      clearPracticeState();
      renderAll();
    });

    $("roleModeSelect").addEventListener("change", (event) => {
      state.roleMode = event.target.value === "student" ? "student" : "teacher";
      storage.setString(roleModeKey, state.roleMode);
      applyRoleMode();
      renderAll();
      setModelStatus(state.roleMode === "teacher" ? "已切换到教师模式，可进行生成、审核和数据管理。" : "已切换到学生模式，只保留学习、答题、解析、错题和测验。", "ok");
    });

    $("generatePaperBtn").addEventListener("click", () => {
      switchTab("practice");
    });

    $("modelProvider").addEventListener("change", applyModelProviderDefaults);
    $("testModelBtn").addEventListener("click", testModelConnection);
    $("aiCoursewareBtn").addEventListener("click", generateAiCourseware);
    $("aiQuestionsBtn").addEventListener("click", generateAiQuestions);
    $("presentCoursewareBtn").addEventListener("click", startCoursewarePresentation);
    $("remakeTutorCoursewareBtn").addEventListener("click", remakeTutorCourseware);
    $("aiPptPlanBtn").addEventListener("click", generateAiPptPlan);
    $("exportPptxBtn").addEventListener("click", exportCoursewarePptx);
    $("downloadCoursewareBtn").addEventListener("click", downloadCourseware);
    $("exportCoursewareJsonBtn").addEventListener("click", exportCoursewareJson);
    $("importCoursewareBtn").addEventListener("click", () => {
      if (requireTeacherMode("导入历史课件")) $("importCoursewareFile").click();
    });
    $("importCoursewareFile").addEventListener("change", importCoursewareJson);
    $("exportPracticeJsonBtn").addEventListener("click", exportPracticeJson);
    $("importPracticeBtn").addEventListener("click", () => {
      if (requireTeacherMode("导入历史练习")) $("importPracticeFile").click();
    });
    $("importPracticeFile").addEventListener("change", importPracticeJson);
    $("exportPdfBtn").addEventListener("click", exportCoursewarePdf);
    $("toggleReviewBtn").addEventListener("click", toggleCoursewareReview);
    $("saveCoursewareBtn").addEventListener("click", saveCoursewareReview);
    $("resetCoursewareBtn").addEventListener("click", resetCoursewareReview);
    document.querySelectorAll("#coursewareMoreMenu .menu-action").forEach((button) => {
      button.addEventListener("click", () => {
        const menu = $("coursewareMoreMenu");
        if (menu) setTimeout(() => { menu.open = false; }, 0);
      });
    });
    $("showAnswerBtn").addEventListener("click", () => {
      state.answersVisible = !state.answersVisible;
      renderPractice();
    });
    $("copyAnswersBtn").addEventListener("click", copyAnswerTemplate);
    $("gradePracticeBtn").addEventListener("click", gradePracticeAnswers);
    $("syncPracticeToGradingBtn").addEventListener("click", syncPracticeAnswersToGrading);
    $("runOcrBtn").addEventListener("click", runPaddleOcr);
    $("simulateOcrBtn").addEventListener("click", simulateOcr);
    $("gradeBtn").addEventListener("click", gradeAnswers);
    $("answerImage").addEventListener("change", previewAnswerImage);
    $("answerInput").addEventListener("input", () => updateAnswerReviewFromText("manual"));
    $("mistakePaperBtn").addEventListener("click", buildMistakePaper);
    $("clearMasteredBtn").addEventListener("click", clearMastered);
    $("saveScheduleBtn").addEventListener("click", saveSchedule);
    $("scheduledPaperBtn").addEventListener("click", buildScheduledPaper);
    $("exportLocalDataBtn").addEventListener("click", exportLocalData);
    $("importLocalDataBtn").addEventListener("click", () => {
      if (requireTeacherMode("导入本地数据备份")) $("importLocalDataFile").click();
    });
    $("importLocalDataFile").addEventListener("change", importLocalData);
    $("clearLocalDataBtn").addEventListener("click", clearLocalData);
    $("mistakeRatio").addEventListener("input", (event) => {
      $("mistakeRatioLabel").textContent = `${event.target.value}%`;
    });

    document.querySelectorAll(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tab));
    });
    document.addEventListener("keydown", handleCoursewarePresentationKeydown);
    document.addEventListener("fullscreenchange", handleCoursewareFullscreenChange);

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

  function clearPracticeState() {
    state.currentQuestions = [];
    state.answersVisible = false;
    state.gradingResults = [];
    hideGenerationProgress("practice");
    $("gradingSummary").classList.remove("active");
    $("gradingSummary").innerHTML = "";
    $("gradingResults").innerHTML = "";
    $("performanceFeedback").innerHTML = "";
    $("answerInput").value = "";
    $("practiceAnswerInput").value = "";
    $("practiceGradingSummary").classList.remove("active");
    $("practiceGradingSummary").innerHTML = "";
    $("practiceResults").innerHTML = "";
  }

  function renderAll() {
    applyRoleMode();
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

  function collectModelRuntimeConfig() {
    return {
      provider: $("modelProvider").value,
      model: $("modelName").value.trim(),
      baseUrl: $("modelBaseUrl").value.trim(),
      apiKey: $("modelApiKey").value.trim(),
      temperature: 0,
      seed: 20260713,
      timeoutMs: 90000
    };
  }

  function buildAgentScope(unit) {
    const sources = getSourceRefs(unit).map((source) => ({
      name: source.name,
      usage: source.usage,
      url: source.url
    }));
    return {
      version: content.version,
      subject: content.subject,
      gradeId: state.grade,
      gradeName: gradeData().name,
      volumeId: state.volume,
      volumeName: volumeData().name,
      unitId: unit.id,
      unitTitle: unit.title,
      unitSummary: unit.summary,
      knowledgePoints: unit.points,
      tags: unit.tags,
      sources,
      difficulty: state.difficulty,
      questionCount: capQuestionCount(state.questionCount),
      rules: [
        "只允许使用当前单元 knowledgePoints 内的知识点",
        "固定生成 10 道题",
        "必须覆盖当前单元全部 knowledgePoints，每个知识点至少 1 题",
        "不得复制教材原文、课本例题或商业题库题目",
        "总分由本地规则统一归一为 100 分",
        "同一题型不要过度重复，解析必须包含审题、建模、计算、检查"
      ]
    };
  }

  function ensureAgentReady() {
    if (!agentOrchestrator) throw new Error("Agent 运行时未加载，请确认 model-client.js 和 agent-orchestrator.js 已引入。");
  }

  async function testModelConnection() {
    if (!requireTeacherMode("测试模型连接")) return;
    await runWithModelStatus("testModelBtn", "测试中...", async () => {
      ensureAgentReady();
      const result = await agentOrchestrator.testConnection(collectModelRuntimeConfig());
      setModelStatus(`连接成功：${result.sample || "OK"}，延迟 ${result.latency_ms}ms。`, "ok");
    });
  }

  async function generateAiCourseware() {
    if (!requireTeacherMode("AI 生成课件")) return;
    await runWithModelStatus("aiCoursewareBtn", "生成中...", async () => {
      const unit = unitData();
      const fallbackSlides = buildBaseCoursewareSlides(unit);
      const runtimeConfig = collectModelRuntimeConfig();
      const cacheId = buildGenerationCacheId("courseware", unit, runtimeConfig, { slideCount: fallbackSlides.length, presentation: "markdownflow-tutor-v1" });
      const shouldReuseCache = !coursewareReviewRecord(unit)?.slides?.length;
      switchTab("courseware");
      state.coursewareGenerating = true;
      state.coursewareEditMode = false;
      setGenerationProgress("courseware", "AI 正在把当前单元知识点输入导学课件 Agent，生成只读 MarkdownFlow 内容流。");
      renderCourseware();
      try {
        const cached = shouldReuseCache ? readGenerationCache(cacheId) : null;
        if (cached?.payload?.slides?.length) {
          const slides = normalizeAiCoursewareSlides(cached.payload.slides, buildTutorCoursewareSlides(fallbackSlides, unit), unit);
          state.coursewareReviews[coursewareKey(unit)] = buildCoursewareReviewRecord(slides, "draft", { source: "cache", createdAt: cached.createdAt });
          clearPptPlanForUnit(unit);
          writeJson(coursewareReviewKey, state.coursewareReviews);
          setModelStatus(`已复用本地缓存导学课件：${slides.length} 节，使用 MarkdownFlow 呈现。`, "ok");
          return;
        }

        const tutorDraft = await createTutorCoursewareDraft(unit, fallbackSlides, runtimeConfig, (token, count) => {
          setGenerationProgress("courseware", `导学课件 Agent 已接收 ${count} 字内容，正在组织 MarkdownFlow 阅读流。`);
        });
        const slides = tutorDraft.slides;
        state.coursewareReviews[coursewareKey(unit)] = buildCoursewareReviewRecord(slides, "draft", { source: tutorDraft.source });
        clearPptPlanForUnit(unit);
        writeJson(coursewareReviewKey, state.coursewareReviews);
        writeGenerationCache(cacheId, { slides }, { kind: "courseware", scopeKey: coursewareKey(unit), source: tutorDraft.source });
        setModelStatus(`AI 导学课件已生成 ${slides.length} 节，并使用 MarkdownFlow 呈现。`, "ok");
      } finally {
        state.coursewareGenerating = false;
        hideGenerationProgress("courseware");
        renderCourseware();
      }
    });
    renderCourseware();
  }

  async function remakeTutorCourseware() {
    if (!requireTeacherMode("AI 导学重制")) return;
    await runWithModelStatus("remakeTutorCoursewareBtn", "重制中...", async () => {
      const unit = unitData();
      const existingSlides = buildCoursewareSlides(unit);
      const sourceSlides = existingSlides.length ? existingSlides : buildBaseCoursewareSlides(unit);
      const runtimeConfig = collectModelRuntimeConfig();

      switchTab("courseware");
      state.coursewareGenerating = true;
      state.coursewareEditMode = false;
      setGenerationProgress("courseware", existingSlides.length
        ? "正在把当前知识点课件重制成 MarkdownFlow 导学稿，完成后统一展示。"
        : "正在把当前单元知识点直接输入导学课件 Agent，生成 MarkdownFlow 导学稿。");
      renderCourseware();

      try {
        const tutorDraft = await createTutorCoursewareDraft(unit, sourceSlides, runtimeConfig, (token, count) => {
          setGenerationProgress("courseware", `导学课件 Agent 已接收 ${count} 字内容，正在整理互动提问与反馈。`);
        });
        state.coursewareReviews[coursewareKey(unit)] = buildCoursewareReviewRecord(tutorDraft.slides, "draft", { source: tutorDraft.source });
        clearPptPlanForUnit(unit);
        writeJson(coursewareReviewKey, state.coursewareReviews);
        setModelStatus(tutorDraft.message, tutorDraft.tone);
      } finally {
        state.coursewareGenerating = false;
        hideGenerationProgress("courseware");
        renderCourseware();
      }
    });
    renderCourseware();
  }

  async function createTutorCoursewareDraft(unit, sourceSlides, runtimeConfig, onToken) {
    const fallbackSlides = buildTutorCoursewareSlides(sourceSlides, unit);
    const generator = agentOrchestrator?.generateTutorCoursewareStream || agentOrchestrator?.generateTutorCourseware;
    const canUseModel = Boolean(generator && runtimeConfig?.model);
    let receivedChars = 0;

    if (canUseModel) {
      try {
        const result = await generator(
          runtimeConfig,
          buildAgentScope(unit),
          sourceSlides,
          fallbackSlides,
          (token) => {
            receivedChars += String(token || "").length;
            if (onToken) onToken(token, receivedChars);
          }
        );
        const slides = normalizeAiCoursewareSlides(result.slides, fallbackSlides, unit);
        return {
          slides,
          source: "tutor-agent",
          tone: "ok",
          message: `AI 导学课件已生成 ${slides.length} 节，只使用读模式 MarkdownFlow 呈现。`
        };
      } catch (error) {
        return {
          slides: fallbackSlides,
          source: "tutor-template",
          tone: "warn",
          message: `模型生成失败，已使用本地导学模板生成 ${fallbackSlides.length} 节 MarkdownFlow：${error.message || "未知错误"}`
        };
      }
    }

    return {
      slides: fallbackSlides,
      source: "tutor-template",
      tone: "warn",
      message: `未检测到可用模型配置，已直接用当前单元知识点生成 ${fallbackSlides.length} 节本地 MarkdownFlow 导学课。`
    };
  }

  async function generateAiQuestions() {
    if (!requireTeacherMode("AI 生成练习")) return;
    await runWithModelStatus("aiQuestionsBtn", "出题中...", async () => {
      const unit = unitData();
      const requestedCount = capQuestionCount(state.questionCount);
      const runtimeConfig = collectModelRuntimeConfig();
      const cacheId = buildGenerationCacheId("practice", unit, runtimeConfig, { requestedCount });
      const shouldReuseCache = !state.currentQuestions.length;
      let receivedChars = 0;
      switchTab("practice");
      clearPracticeState();
      state.practiceGenerating = true;
      setGenerationProgress("practice", "AI 正在按当前单元边界生成题目，全部校验完成后统一展示。");
      renderPractice();
      try {
        const cached = shouldReuseCache ? readGenerationCache(cacheId) : null;
        if (cached?.payload?.questions?.length) {
          const prepared = prepareQuestionsForPaper(cached.payload.questions, unit, requestedCount);
          if (isPreparedPaperComplete(prepared, unit, requestedCount)) {
            state.currentQuestions = prepared.questions;
            state.answersVisible = false;
            seedAnswerInputsWithTemplate();
            setModelStatus(`已复用本地缓存练习：${state.currentQuestions.length} 题，范围仍锁定为“${unit.title}”。`, "ok");
            return;
          }
        }

        ensureAgentReady();
        const generator = agentOrchestrator.generateQuestionsStream || agentOrchestrator.generateQuestions;
        const result = await generator(
          runtimeConfig,
          buildAgentScope(unit),
          (token) => {
            receivedChars += String(token || "").length;
            setGenerationProgress("practice", `已接收 ${receivedChars} 字内容，正在等待完整试卷返回。`);
          }
        );
        setGenerationProgress(
          "practice",
          receivedChars ? `题目已返回，共接收 ${receivedChars} 字内容，正在检查知识点范围、题型重复和分值。` : "题目已返回，正在检查知识点范围、题型重复和分值。"
        );
        const aiQuestions = normalizeAiQuestions(result.questions, unit, requestedCount);
        const fallbackQuestions = generateScopedQuestions(unit, Number(state.grade), state.difficulty, requestedCount);
        const prepared = prepareQuestionsForPaper([...aiQuestions, ...fallbackQuestions], unit, requestedCount);

        if (!isPreparedPaperComplete(prepared, unit, requestedCount)) throw new Error(formatPaperValidationError(prepared, unit, requestedCount));
        state.currentQuestions = prepared.questions;
        state.answersVisible = false;
        seedAnswerInputsWithTemplate();
        writeGenerationCache(cacheId, { questions: state.currentQuestions }, { kind: "practice", scopeKey: coursewareKey(unit), source: "llm" });
        const rejectedHint = prepared.rejected.length ? `，已剔除 ${prepared.rejected.length} 题不合格题` : "";
        setModelStatus(`AI 出题完成：${state.currentQuestions.length} 题，范围已锁定为“${unit.title}”${rejectedHint}。`, "ok");
      } finally {
        state.practiceGenerating = false;
        hideGenerationProgress("practice");
        renderAll();
      }
    });
    renderPractice();
  }

  async function generateAiPptPlan() {
    if (!requireTeacherMode("AI 制作 PPT")) return;
    await runWithModelStatus("aiPptPlanBtn", "制作中...", async () => {
      ensureAgentReady();
      ensurePptExporterReady();
      const unit = unitData();
      const slides = buildCoursewareSlides(unit);
      if (!slides.length) throw new Error("当前还没有课件，请先生成或导入课件。");
      const context = buildPptExportContext(unit, slides);
      const fallbackPlan = pptxExporter.buildPptPlan(context);
      const generator = agentOrchestrator.generatePptPlanStream || agentOrchestrator.generatePptPlan;
      let receivedChars = 0;
      state.pptPlanGenerating = true;
      renderCourseware();
      try {
        const result = await generator(
          collectModelRuntimeConfig(),
          buildAgentScope(unit),
          slides,
          fallbackPlan,
          (token) => {
            receivedChars += String(token || "").length;
            setModelStatus(`PPT 制作 Agent 已接收 ${receivedChars} 字方案，正在整理版式。`, "busy");
          }
        );
        const plan = pptxExporter.normalizePptPlan(result.plan, fallbackPlan, context);
        const validation = pptxExporter.validatePptPlan(plan, unit.points || []);
        if (!validation.ok) throw new Error(`PPT 方案未通过校验：${validation.issues.slice(0, 3).join("；")}`);
        state.pptPlans[pptPlanRecordKey(unit)] = buildPptPlanRecord(plan, "draft", { source: "llm" });
        writeJson(pptPlanKey, state.pptPlans);
        setModelStatus(`PPT 制作 Agent 已生成 ${plan.pages.length} 页排版方案，可直接导出 PPTX。`, "ok");
      } finally {
        state.pptPlanGenerating = false;
        renderCourseware();
      }
    });
  }

  async function runWithModelStatus(buttonId, busyText, action) {
    const button = $(buttonId);
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    setModelStatus("正在检查本地缓存并准备模型，结果完成校验后才会展示。", "busy");
    try {
      await action();
    } catch (error) {
      setModelStatus(error.message || "模型调用失败，未更新当前内容。", "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function setModelStatus(message, tone = "info") {
    showAppNotice(message, tone);
  }

  function showAppNotice(message, tone = "info") {
    const host = $("appNoticeHost");
    if (!host || !message) return;
    window.clearTimeout(noticeTimer);
    const role = tone === "error" || tone === "warn" ? "alert" : "status";
    host.innerHTML = `
      <section class="app-notice" data-tone="${escapeAttribute(tone)}" role="${role}">
        <div>
          <strong>${escapeHtml(noticeTitle(tone))}</strong>
          <p>${escapeHtml(message)}</p>
        </div>
        <button type="button" class="notice-close" aria-label="关闭提醒">×</button>
      </section>
    `;
    host.hidden = false;
    const closeButton = host.querySelector(".notice-close");
    if (closeButton) closeButton.addEventListener("click", () => hideAppNotice());
    const duration = tone === "busy" ? 0 : tone === "error" ? 9000 : tone === "warn" ? 7000 : 5200;
    if (duration) noticeTimer = window.setTimeout(hideAppNotice, duration);
  }

  function hideAppNotice() {
    const host = $("appNoticeHost");
    if (!host) return;
    window.clearTimeout(noticeTimer);
    host.innerHTML = "";
    host.hidden = true;
  }

  function noticeTitle(tone) {
    const titles = {
      ok: "操作完成",
      warn: "需要确认",
      error: "操作失败",
      busy: "处理中",
      info: "提醒"
    };
    return titles[tone] || "提醒";
  }

  function setOcrStatus(message, tone = "info") {
    const status = $("ocrStatusPanel");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function formatOcrError(error) {
    const raw = error?.message || String(error || "");
    if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
      return "没有连接到本机 OCR 服务。请先运行 start_aiteacher_ocr.bat，看到 127.0.0.1:8790/ocr 启动后再点击 OCR 识别。";
    }
    if (/ConvertPirAttribute2RuntimeAttribute|onednn_instruction|oneDNN|MKLDNN/i.test(raw)) {
      return "PaddleOCR 触发了 Windows CPU 的 oneDNN/MKLDNN 兼容问题。请更新后重新运行 start_aiteacher_ocr.bat；该脚本会默认关闭 MKLDNN/oneDNN 加速。";
    }
    if (/PaddleOCR is not installed|No module named|paddleocr/i.test(raw)) {
      return "本机 OCR 依赖未安装。请运行：python -m pip install paddlepaddle paddleocr，然后重新启动 start_aiteacher_ocr.bat。";
    }
    return raw || "OCR 识别失败，请确认本地 PaddleOCR 服务已启动。";
  }

  function setGenerationProgress(kind, message) {
    const panel = $(`${kind}ProgressPanel`);
    const text = $(`${kind}ProgressText`);
    if (!panel || !text) return;
    panel.hidden = false;
    text.textContent = message;
  }

  function hideGenerationProgress(kind) {
    const panel = $(`${kind}ProgressPanel`);
    if (panel) panel.hidden = true;
  }

  function normalizeAiCoursewareSlides(slides, fallbackSlides, unit) {
    const sourceRefs = getSourceRefs(unit);
    const allowedVisuals = new Set(["goals", "context", "scenario", "concept", "example", "practice", "summary"]);
    return fallbackSlides.map((fallbackSlide, index) => {
      const candidate = Array.isArray(slides) ? slides[index] || {} : {};
      const visualType = allowedVisuals.has(candidate.visualType) ? candidate.visualType : fallbackSlide.visualType;
      const visualData = normalizeSlideVisualData(candidate.visualData, fallbackSlide.visualData, unit);
      const tutorMoves = uniqueTextList(candidate.tutorMoves || candidate.interactions || candidate.interactionPrompts || fallbackSlide.tutorMoves || [], 4);
      const lessonMode = cleanText(candidate.lessonMode || fallbackSlide.lessonMode);
      return {
        title: cleanText(candidate.title) || fallbackSlide.title,
        body: cleanText(candidate.body) || fallbackSlide.body,
        bullets: cleanTextList(candidate.bullets).length ? cleanTextList(candidate.bullets).slice(0, 5) : fallbackSlide.bullets,
        visualType,
        ...(visualData ? { visualData } : {}),
        ...(lessonMode ? { lessonMode } : {}),
        ...(tutorMoves.length ? { tutorMoves } : {}),
        sources: sourceRefs
      };
    });
  }

  function normalizeAiQuestions(questions, unit, count) {
    if (!Array.isArray(questions)) return [];
    const sourceRefs = getSourceRefs(unit);
    const sourceIds = unit.sourceIds || content.defaultSourceIds || [];
    const normalized = [];

    questions.slice(0, capGeneratedQuestionCount(count)).forEach((item, index) => {
      const knowledgePoint = resolveKnowledgePoint(item?.knowledgePoint, unit);
      const stem = cleanText(item?.stem);
      const answer = cleanText(item?.answer);
      const explanation = cleanText(item?.explanation);
      if (!knowledgePoint || !stem || !answer || !explanation) return;

      const questionType = cleanText(item?.questionType) || "同步练习题";
      const enriched = {
        id: `${unit.id}-ai-${Date.now()}-${index}`,
        unitId: unit.id,
        unitTitle: unit.title,
        knowledgePoint,
        questionType,
        difficulty: cleanText(item?.difficulty) || state.difficulty,
        stem,
        answer,
        explanation,
        detailSteps: cleanTextList(item?.detailSteps),
        commonMistake: cleanText(item?.commonMistake),
        checkMethod: cleanText(item?.checkMethod),
        sourceIds,
        sourceRefs,
        point: 0
      };
      const context = { unit, tag: knowledgePoint, mode: questionType, knowledgePoint };
      normalized.push({
        ...enriched,
        detailSteps: enriched.detailSteps.length ? enriched.detailSteps.slice(0, 5) : buildDetailSteps(enriched, context),
        commonMistake: enriched.commonMistake || buildCommonMistake(enriched, context),
        checkMethod: enriched.checkMethod || buildCheckMethod(enriched, context)
      });
    });

    return enforceUnitQuestionBoundary(normalized, unit);
  }

  function normalizeImportedQuestions(questions, unit) {
    const safeQuestions = normalizeAiQuestions(questions, unit, capGeneratedQuestionCount(questions.length));
    return safeQuestions.map((questionItem, index) => ({
      ...questionItem,
      id: questionItem.id || `${unit.id}-import-${Date.now()}-${index}`,
      sourceRefs: questionItem.sourceRefs || getSourceRefs(unit)
    }));
  }
  function resolveKnowledgePoint(value, unit) {
    if (ruleEngine.resolveKnowledgePoint) return ruleEngine.resolveKnowledgePoint(value, unit);
    const text = cleanText(value);
    if (!text) return "";
    const points = unit.points || [];
    const exact = points.find((point) => point === text);
    if (exact) return exact;
    return points.find((point) => point.includes(text) || text.includes(point)) || "";
  }

  function prepareQuestionsForPaper(questions, unit, requestedCount) {
    if (ruleEngine.validatePaper) {
      const prepared = ruleEngine.validatePaper(questions, unit, { limit: requestedCount });
      const sourceRefs = getSourceRefs(unit);
      const checkedAt = new Date().toISOString();
      return {
        ...prepared,
        questions: prepared.questions.map((questionItem, index) => withQuestionReviewMetadata({
          ...questionItem,
          id: questionItem.id || `${unit.id}-checked-${Date.now()}-${index}`,
          sourceIds: questionItem.sourceIds || unit.sourceIds || content.defaultSourceIds || [],
          sourceRefs: questionItem.sourceRefs || sourceRefs,
          detailSteps: Array.isArray(questionItem.detailSteps) && questionItem.detailSteps.length
            ? questionItem.detailSteps
            : buildDetailSteps(questionItem, { unit, tag: questionItem.knowledgePoint, mode: questionItem.questionType, knowledgePoint: questionItem.knowledgePoint }),
          commonMistake: questionItem.commonMistake || buildCommonMistake(questionItem, { unit, tag: questionItem.knowledgePoint, mode: questionItem.questionType, knowledgePoint: questionItem.knowledgePoint }),
          checkMethod: questionItem.checkMethod || buildCheckMethod(questionItem, { unit, tag: questionItem.knowledgePoint, mode: questionItem.questionType, knowledgePoint: questionItem.knowledgePoint })
        }, checkedAt))
      };
    }
    const scoped = normalizePaperPoints(rebalanceQuestionTypes(dedupeByStem(enforceUnitQuestionBoundary(questions, unit)), requestedCount).slice(0, requestedCount));
    return { questions: scoped.map((questionItem) => withQuestionReviewMetadata(questionItem)), rejected: [], issues: [], summary: { accepted: scoped.length, totalScore: paperTotal(scoped) } };
  }

  function isPreparedPaperComplete(prepared, unit, requestedCount) {
    return Boolean(
      prepared?.questions?.length === requestedCount
      && hasKnowledgeCoverage(prepared.questions, unit)
      && paperTotal(prepared.questions) === 100
    );
  }

  function formatPaperValidationError(prepared, unit, requestedCount) {
    const questions = prepared?.questions || [];
    const missing = prepared?.summary?.missingKnowledgePoints || (ruleEngine.findMissingKnowledgePoints ? ruleEngine.findMissingKnowledgePoints(questions, unit) : []);
    const parts = [];
    if ((unit.points || []).length > requestedCount) {
      parts.push(`当前单元有 ${unit.points.length} 个知识点，${requestedCount} 题无法全部覆盖，请先拆分单元或合并知识点`);
    }
    if (!questions.length) parts.push("没有题目通过单元边界和客观题规则校验");
    if (questions.length && questions.length !== requestedCount) parts.push(`当前只通过 ${questions.length} 题，要求固定 ${requestedCount} 题`);
    if (missing.length) parts.push(`未覆盖知识点：${missing.slice(0, 8).join("、")}${missing.length > 8 ? "等" : ""}`);
    if (prepared?.rejected?.length) parts.push(`已剔除 ${prepared.rejected.length} 题不合格题`);
    if (prepared?.issues?.length) parts.push(`规则提示：${prepared.issues.slice(0, 2).join("；")}`);
    if (!parts.length) parts.push("题目未满足 10 题、100 分、全知识点覆盖的规则");
    return `${parts.join("；")}。请检查知识点模板，或重新生成。`;
  }

  function withQuestionReviewMetadata(questionItem, checkedAt = new Date().toISOString()) {
    const reviewStatus = questionItem.reviewStatus || "rule_checked";
    return {
      ...questionItem,
      schemaVersion: questionItem.schemaVersion || exportSchemaVersion,
      exportVersion: questionItem.exportVersion || practiceExportVersion,
      reviewStatus,
      reviewStatusLabel: questionItem.reviewStatusLabel || reviewStatusLabel(reviewStatus),
      validatedAt: questionItem.validatedAt || checkedAt
    };
  }

  function rebalanceQuestionTypes(questions, count) {
    if (ruleEngine.rebalanceQuestionTypes) return ruleEngine.rebalanceQuestionTypes(questions, count);
    const safeCount = capGeneratedQuestionCount(count);
    const maxSameType = Math.max(2, Math.ceil(safeCount / 5));
    const typeCounts = {};
    return questions.filter((questionItem) => {
      const type = questionItem.questionType || "同步练习题";
      const used = typeCounts[type] || 0;
      if (used >= maxSameType) return false;
      typeCounts[type] = used + 1;
      return true;
    });
  }

  function dedupeByStem(questions) {
    if (ruleEngine.dedupeByStem) return ruleEngine.dedupeByStem(questions);
    const seen = new Set();
    return questions.filter((questionItem) => {
      const key = cleanText(questionItem.stem);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanMultilineText(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean)
      .join("\n");
  }

  function cleanTextList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(cleanText).filter(Boolean);
  }

  function uniqueTextList(value, limit = 5) {
    const seen = new Set();
    return cleanTextList(value)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  function normalizeSlideVisualData(value, fallback, unit) {
    const normalized = normalizeSlideVisualDataCandidate(value, unit);
    if (normalized) return normalized;
    return normalizeSlideVisualDataCandidate(fallback, unit);
  }

  function normalizeSlideVisualDataCandidate(value, unit) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const kind = normalizeVisualKind(value.kind || value.type || value.visualKind);
    if (kind === "stationery") return normalizeStationeryVisualData(value);
    if (kind === "share") return normalizeShareVisualData(value);
    if (kind === "quantity") return normalizeQuantityVisualData(value);
    if (kind === "auto") return buildDefaultSlideVisualData(unit, value.title || "");
    return null;
  }

  function normalizeVisualKind(value) {
    const text = cleanText(value).toLowerCase();
    if (["stationery", "objects", "object", "object-equation", "object_equation"].includes(text)) return "stationery";
    if (["share", "craft", "part-whole", "part_whole", "average-share"].includes(text)) return "share";
    if (["quantity", "bar", "bars", "line", "line-segment", "table"].includes(text)) return "quantity";
    if (text === "auto") return "auto";
    return "";
  }

  function normalizeStationeryVisualData(data) {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
      .map(normalizeStationeryItem)
      .filter(Boolean)
      .slice(0, 4);
    if (!items.length) return null;
    return {
      kind: "stationery",
      title: cleanText(data.title) || `图解：${items.map((item) => `${item.count} 个${item.label}`).join(" + ")}`,
      items,
      expression: cleanText(data.expression || data.formula).slice(0, 32),
      caption: cleanText(data.caption || data.note).slice(0, 60)
    };
  }

  function normalizeStationeryItem(item, index) {
    if (!item || typeof item !== "object") return null;
    const type = normalizeObjectType(item.type || item.icon || item.kind, index);
    const count = clampInt(item.count ?? item.quantity ?? 1, 1, 6);
    const label = cleanText(item.label || item.name || defaultObjectLabel(type)).slice(0, 8);
    const priceLabel = cleanText(item.priceLabel || formatPriceLabel(item.unitPrice ?? item.price ?? item.totalPrice ?? item.value)).slice(0, 12);
    return { type, count, label, priceLabel };
  }

  function normalizeObjectType(value, index) {
    const text = cleanText(value).toLowerCase();
    if (["pen", "钢笔", "笔"].includes(text)) return "pen";
    if (["pencil", "铅笔"].includes(text)) return "pencil";
    if (["book", "notebook", "练习本", "笔记本", "本子"].includes(text)) return "notebook";
    if (["ruler", "尺子"].includes(text)) return "ruler";
    if (["eraser", "橡皮"].includes(text)) return "eraser";
    return index % 2 ? "pen" : "notebook";
  }

  function defaultObjectLabel(type) {
    const labels = {
      pen: "钢笔",
      pencil: "铅笔",
      notebook: "笔记本",
      ruler: "尺子",
      eraser: "橡皮"
    };
    return labels[type] || "物品";
  }

  function formatPriceLabel(value) {
    const text = cleanText(value);
    if (!text) return "";
    if (/[元角分页朵个本支]/.test(text)) return text;
    return `${text}元`;
  }

  function normalizeShareVisualData(data) {
    const total = clampInt(data.total ?? data.whole ?? 24, 1, 999);
    const done = clampInt(data.done ?? data.used ?? data.completed ?? 8, 0, total);
    const remain = clampInt(data.remain ?? data.left ?? (total - done), 0, total);
    const groups = clampInt(data.groups ?? data.people ?? data.parts ?? 4, 1, 6);
    const each = cleanText(data.each ?? data.perGroup ?? (groups ? trimNumber(remain / groups) : remain)).slice(0, 12);
    return {
      kind: "share",
      title: cleanText(data.title) || "图解：总量 - 已知部分，再平均分",
      total,
      done,
      remain,
      groups,
      each,
      unitLabel: cleanText(data.unitLabel || data.unit || "份").slice(0, 4),
      expression: cleanText(data.expression || data.formula || `(${total}-${done})÷${groups}`).slice(0, 32),
      caption: cleanText(data.caption || data.note || `先求剩余 ${total}-${done}=${remain}，再平均分成 ${groups} 份。`).slice(0, 70)
    };
  }

  function normalizeQuantityVisualData(data) {
    const rawBars = Array.isArray(data.bars) ? data.bars : [];
    const bars = rawBars
      .map((bar, index) => ({
        label: cleanText(bar?.label || bar?.name || `部分${index + 1}`).slice(0, 12),
        valueLabel: cleanText(bar?.valueLabel || bar?.value || bar?.result || (index ? "总量" : "?")).slice(0, 12),
        width: clampInt(bar?.width ?? bar?.percent ?? (index ? 38 : 62), 18, 100)
      }))
      .filter((bar) => bar.label)
      .slice(0, 4);
    const safeBars = bars.length ? bars : [
      { label: "已知部分", valueLabel: "?", width: 62 },
      { label: "剩余部分", valueLabel: "总量", width: 38 }
    ];
    return {
      kind: "quantity",
      title: cleanText(data.title) || "图解：用线段表示数量关系",
      bars: safeBars,
      caption: cleanText(data.caption || data.note || "把文字条件先变成“部分 + 部分 = 总量”。").slice(0, 70)
    };
  }

  function buildDefaultSlideVisualData(unit, slideTitle = "") {
    const text = [
      slideTitle,
      unit.title,
      unit.summary,
      ...(unit.tags || []),
      ...(unit.points || [])
    ].join(" ");
    if (includesAny(text, ["平均分", "剩余", "剩下", "几分之一", "几分之几"])) {
      return {
        kind: "share",
        total: 24,
        done: 8,
        remain: 16,
        groups: 4,
        each: "4",
        unitLabel: "份",
        expression: "(24-8)÷4",
        caption: "先求剩余 24-8=16，再把 16 平均分成 4 份。"
      };
    }
    if (includesAny(text, ["混合运算", "单价", "总价", "价格", "文具", "买了", "花了"])) {
      return {
        kind: "stationery",
        title: "图解：3 个笔记本 + 1 支钢笔",
        items: [
          { type: "notebook", label: "笔记本", count: 3, priceLabel: "6元" },
          { type: "pen", label: "钢笔", count: 1, priceLabel: "15元" }
        ],
        expression: "3×6+15",
        caption: "先看 3 个同价笔记本，再把钢笔价格合进去。"
      };
    }
    if (includesAny(text, ["线段图", "表格", "数量关系", "单位 1"])) {
      return {
        kind: "quantity",
        bars: [
          { label: "已知部分", valueLabel: "?", width: 62 },
          { label: "剩余部分", valueLabel: "总量", width: 38 }
        ],
        caption: "把文字条件先变成“部分 + 部分 = 总量”。"
      };
    }
    return null;
  }

  function renderCourseware() {
    const unit = unitData();
    const sourceRefs = getSourceRefs(unit);
    const slides = buildCoursewareSlides(unit);
    const reviewRecord = coursewareReviewRecord(unit);
    const hasSlides = slides.length > 0;
    if (!hasSlides) state.coursewareEditMode = false;
    $("knowledgePoints").hidden = true;
    $("knowledgePoints").innerHTML = "";

    updateCoursewareButtons(hasSlides);

    if (state.coursewareGenerating) {
      $("coursewareSlides").className = "markdownflow-reader empty-state";
      $("coursewareSlides").innerHTML = `<div><strong>导学课生成中</strong><p>AI 正在生成并校验 MarkdownFlow 内容，完成后会一次性展示。</p></div>`;
      return;
    }

    if (!hasSlides) {
      $("coursewareSlides").className = "markdownflow-reader empty-state";
      const emptyText = isTeacherMode()
        ? "点击“AI 生成导学课件”或“AI 导学重制”，系统会直接把当前单元知识点输入导学 Agent，生成只读 MarkdownFlow。"
        : "当前还没有可阅读导学课，请让教师模式先生成或导入课件。";
      $("coursewareSlides").innerHTML = `<div><strong>暂无 MarkdownFlow</strong><p>${emptyText}</p></div>`;
      return;
    }

    $("coursewareSlides").className = `markdownflow-reader ${state.coursewareEditMode ? "editing" : ""}`;
    $("coursewareSlides").innerHTML = renderMarkdownFlowCourseware(unit, slides, reviewRecord, sourceRefs);
  }

  function renderMarkdownFlowCourseware(unit, slides, reviewRecord, sourceRefs) {
    return `
      <section class="markdownflow-shell">
        <aside class="markdownflow-nav" aria-label="导学目录">
          <div class="markdownflow-logo">AI Teacher</div>
          <strong>${escapeHtml(unit.title)}</strong>
          <p>${escapeHtml(`${gradeData().name}${volumeData().name} · 读模式`)}</p>
          <ol>
            ${slides.map((slide, index) => `<li><a href="#flow-section-${index + 1}">${escapeHtml(index + 1)}. ${escapeHtml(slide.title)}</a></li>`).join("")}
          </ol>
          <div class="markdownflow-nav-source">来源：${renderSourceLinks(sourceRefs)}</div>
        </aside>
        <article class="markdownflow-content" aria-label="MarkdownFlow 导学内容">
          <header class="markdownflow-hero">
            <div>
              <p class="eyebrow">MarkdownFlow</p>
              <h3>${escapeHtml(unit.title)}</h3>
              <p>以当前单元知识点为输入，按“观察、追问、反馈、小测、复盘”的阅读流学习。</p>
            </div>
            <span class="read-mode-pill">读</span>
          </header>
          ${renderCoursewareReviewStatus(reviewRecord)}
          ${slides.map((slide, index) => renderMarkdownFlowSection(slide, unit, index, sourceRefs)).join("")}
          <footer class="markdownflow-footer">
            <span>内容由 AI 在人类指导下生成</span>
            <span>由 MarkdownFlow 驱动</span>
          </footer>
        </article>
      </section>
    `;
  }

  function renderMarkdownFlowSection(slide, unit, index, sourceRefs) {
    return `
      <section id="flow-section-${index + 1}" class="markdownflow-section" data-slide-index="${index}">
        <div class="markdownflow-section-head">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <h4 data-edit="title" contenteditable="${state.coursewareEditMode}">${escapeHtml(slide.title)}</h4>
        </div>
        <p class="markdownflow-body" data-edit="body" contenteditable="${state.coursewareEditMode}">${escapeHtml(slide.body)}</p>
        <div class="markdownflow-visual visual-${escapeAttribute(slide.visualType)}">
          ${renderSlideVisual(slide, unit, index)}
        </div>
        <ul class="markdownflow-points">
          ${slide.bullets.map((item, bulletIndex) => `<li data-edit="bullet" data-bullet-index="${bulletIndex}" contenteditable="${state.coursewareEditMode}">${escapeHtml(item)}</li>`).join("")}
        </ul>
        ${renderTutorMoves(slide)}
        <p class="source-note">参考来源：${renderSourceLinks(slide.sources || sourceRefs)}</p>
      </section>
    `;
  }

  function renderCoursewareReviewStatus(record) {
    if (!record) return "";
    return `
      <article class="review-status-card">
        <div>
          <strong>\u5ba1\u6838\u72b6\u6001\uff1a${escapeHtml(record.reviewStatusLabel || reviewStatusLabel(record.reviewStatus))}</strong>
          <p>\u7248\u672c ${escapeHtml(record.exportVersion || reviewExportVersion)} \u00b7 \u66f4\u65b0\u65f6\u95f4 ${formatDateTime(record.updatedAt || record.createdAt)}</p>
        </div>
        <span class="pill green">${escapeHtml(record.source || "local")}</span>
      </article>
    `;
  }

  async function startCoursewarePresentation() {
    const unit = unitData();
    const slides = buildCoursewareSlides(unit);
    if (!slides.length) {
      setModelStatus("当前还没有可授课的课件，请先生成或导入课件。", "warn");
      return;
    }
    state.coursewarePresenting = true;
    state.coursewarePresentationIndex = 0;
    renderCoursewarePresentation();
    const panel = $("coursewarePresentation");
    if (panel?.requestFullscreen) {
      try {
        await panel.requestFullscreen();
      } catch (error) {
        setModelStatus("浏览器未允许独占全屏，已使用页面全屏授课模式。", "warn");
      }
    }
  }

  function closeCoursewarePresentation() {
    state.coursewarePresenting = false;
    const panel = $("coursewarePresentation");
    const isFullscreen = document.fullscreenElement === panel;
    if (isFullscreen && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
  }

  function moveCoursewarePresentation(delta) {
    if (!state.coursewarePresenting) return;
    const panel = $("coursewarePresentation");
    const content = panel?.querySelector(".presentation-markdownflow-content");
    if (content) content.scrollBy({ top: delta * Math.max(360, content.clientHeight * 0.72), behavior: "smooth" });
  }

  function jumpCoursewarePresentation(index) {
    if (!state.coursewarePresenting) return;
    const panel = $("coursewarePresentation");
    const content = panel?.querySelector(".presentation-markdownflow-content");
    if (!content) return;
    if (index <= 0) {
      content.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      content.scrollTo({ top: content.scrollHeight, behavior: "smooth" });
    }
  }

  function handleCoursewarePresentationKeydown(event) {
    if (!state.coursewarePresenting) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      moveCoursewarePresentation(1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      moveCoursewarePresentation(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      jumpCoursewarePresentation(0);
    } else if (event.key === "End") {
      event.preventDefault();
      jumpCoursewarePresentation(1);
    } else if (event.key === "Escape") {
      closeCoursewarePresentation();
    }
  }

  function handleCoursewareFullscreenChange() {
    const panel = $("coursewarePresentation");
    if (state.coursewarePresenting && panel && document.fullscreenElement !== panel && !document.fullscreenElement) {
      closeCoursewarePresentation();
    }
  }

  function renderCoursewarePresentation() {
    const panel = $("coursewarePresentation");
    const unit = unitData();
    const slides = buildCoursewareSlides(unit);
    if (!panel || !slides.length) return;
    const sourceRefs = getSourceRefs(unit);
    panel.hidden = false;
    panel.innerHTML = `
      <div class="presentation-markdownflow-shell">
        <aside class="presentation-markdownflow-nav" aria-label="授课目录">
          <div class="presentation-brand">AI Teacher</div>
          <strong>${escapeHtml(unit.title)}</strong>
          <p>${escapeHtml(`${gradeData().name}${volumeData().name} · 读模式`)}</p>
          <ol>
            ${slides.map((slide, index) => `<li><a href="#presentation-flow-section-${index + 1}" data-presentation-target="${index + 1}">${escapeHtml(index + 1)}. ${escapeHtml(slide.title)}</a></li>`).join("")}
          </ol>
          <div class="presentation-source">来源：${renderSourceLinks(sourceRefs)}</div>
        </aside>
        <main class="presentation-markdownflow-content" aria-label="MarkdownFlow 授课内容">
          <header class="presentation-read-header">
            <div>
              <p class="eyebrow">MarkdownFlow</p>
              <h2>${escapeHtml(unit.title)}</h2>
              <p>按“观察、追问、反馈、小测、复盘”的阅读流讲课。</p>
            </div>
            <div class="presentation-read-actions">
              <span>读</span>
              <button type="button" data-presentation-action="exit">退出</button>
            </div>
          </header>
          ${slides.map((slide, index) => renderPresentationMarkdownFlowSection(slide, unit, index, sourceRefs)).join("")}
          <footer class="presentation-read-footer">
            <span>内容由 AI 在人类指导下生成</span>
            <span>由 MarkdownFlow 驱动</span>
          </footer>
        </main>
      </div>
    `;
    panel.querySelectorAll("[data-presentation-target]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = panel.querySelector(`#presentation-flow-section-${link.dataset.presentationTarget}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    panel.querySelectorAll("[data-presentation-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.presentationAction;
        if (action === "exit") closeCoursewarePresentation();
      });
    });
  }

  function renderPresentationMarkdownFlowSection(slide, unit, index, sourceRefs) {
    return `
      <section id="presentation-flow-section-${index + 1}" class="presentation-markdownflow-section">
        <div class="presentation-section-head">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <h3>${escapeHtml(slide.title)}</h3>
        </div>
        <p class="presentation-section-body">${escapeHtml(slide.body)}</p>
        <div class="presentation-section-visual visual-${escapeAttribute(slide.visualType)}">
          ${renderSlideVisual(slide, unit, index)}
        </div>
        <ul class="presentation-section-points">
          ${slide.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
        ${renderTutorMoves(slide, "presentation")}
        <p class="presentation-source-note">参考来源：${renderSourceLinks(slide.sources || sourceRefs)}</p>
      </section>
    `;
  }

  function updateCoursewareButtons(hasSlides) {
    $("aiCoursewareBtn").textContent = state.coursewareGenerating ? "生成中..." : hasSlides ? "重新生成导学课件" : "AI 生成导学课件";
    $("remakeTutorCoursewareBtn").textContent = state.coursewareGenerating ? "重制中..." : "AI 导学重制";
    $("aiPptPlanBtn").textContent = state.pptPlanGenerating ? "制作中..." : "AI 制作 PPT";
    $("toggleReviewBtn").textContent = state.coursewareEditMode ? "退出审核" : "审核编辑";
    ["toggleReviewBtn", "saveCoursewareBtn", "resetCoursewareBtn", "exportCoursewareJsonBtn", "exportPdfBtn", "downloadCoursewareBtn", "aiPptPlanBtn", "exportPptxBtn", "presentCoursewareBtn"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = state.coursewareGenerating || state.pptPlanGenerating || !hasSlides;
    });
    $("remakeTutorCoursewareBtn").disabled = state.coursewareGenerating || state.pptPlanGenerating;
    $("importCoursewareBtn").disabled = state.coursewareGenerating || state.pptPlanGenerating;
    const moreMenu = $("coursewareMoreMenu");
    const moreSummary = $("coursewareMoreSummary");
    if (moreMenu && moreSummary) {
      if (state.coursewareGenerating || state.pptPlanGenerating) moreMenu.open = false;
      moreSummary.setAttribute("aria-disabled", state.coursewareGenerating || state.pptPlanGenerating ? "true" : "false");
    }
  }

  function buildCoursewareSlides(unit) {
    const record = coursewareReviewRecord(unit);
    if (!record?.slides?.length) return [];
    return applyCoursewareReview(buildBaseCoursewareSlides(unit), record.slides);
  }

  function buildBaseCoursewareSlides(unit) {
    const [firstPoint, secondPoint, thirdPoint] = padPoints(unit.points);
    const sources = getSourceRefs(unit);
    return [
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
        visualType: "scenario",
        visualData: buildDefaultSlideVisualData(unit, "情境导入"),
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
        visualType: "scenario",
        visualData: buildDefaultSlideVisualData(unit, "例题精讲"),
        sources
      },
      {
        title: "课堂练习",
        body: "由易到难安排基础题、变式题和标准情境题。",
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
  }

  function buildTutorCoursewareSlides(sourceSlides, unit) {
    const sourceRefs = getSourceRefs(unit);
    const safeSlides = sourceSlides.length ? sourceSlides : buildBaseCoursewareSlides(unit);
    const frames = [
      {
        title: "先看目标",
        body: "把本节知识点先变成学生能回答的问题，再进入讲解。",
        moves: (point) => [`先问：看到“${point}”，你觉得今天要解决什么问题？`, "追问：这个知识点通常会用图、表还是算式表达？", "反馈：能说出目标即可，不急着计算。"]
      },
      {
        title: "观察情境",
        body: "先观察图形中的数量和关系，让学生用自己的话复述条件。",
        moves: () => ["先问：图中哪些数量已经知道？", "追问：要求的问题和哪些数量直接相关？", "反馈：条件说不完整时，回到图形逐个指认。"]
      },
      {
        title: "拆开概念",
        body: "把概念拆成可观察、可操作、可验证的三个小步骤。",
        moves: (point) => [`先问：${point} 的第一步应该先看什么？`, "追问：如果顺序换了，结果会不会变？", "反馈：让学生把步骤和图形上的位置对应起来。"]
      },
      {
        title: "边问边算",
        body: "用一题示范审题、建模、计算和检查，让学生参与每一步判断。",
        moves: () => ["先问：这一步为什么先算它？", "追问：能不能用另一种图或表检查？", "反馈：只给结果时，提醒补上数量关系。"]
      },
      {
        title: "马上小测",
        body: "用少量标准答案题确认是否会迁移，不增加跨单元内容。",
        moves: (point) => [`先问：换一个数，你还能用 ${point} 解决吗？`, "追问：答案格式应该写成什么样？", "反馈：错在审题、顺序或计算时分别提示。"]
      },
      {
        title: "复盘反馈",
        body: "把本节学习收束为方法、易错点和下一次练习方向。",
        moves: () => ["先问：今天最容易错的是哪一步？", "追问：下次遇到同类题先画什么？", "反馈：把错因写入错题库，下一次先复习薄弱点。"]
      }
    ];

    return safeSlides.map((slide, index) => {
      const frame = frames[index] || frames[frames.length - 1];
      const point = unit.points[index % Math.max(unit.points.length, 1)] || unit.title;
      const visualData = slide.visualData || (["scenario", "example", "context"].includes(slide.visualType) ? buildDefaultSlideVisualData(unit, slide.title) : null);
      return {
        title: frame.title,
        body: `${frame.body} 输入依据：原课件“${cleanText(slide.title)}”。`,
        bullets: uniqueTextList([
          `围绕知识点：${point}`,
          slide.body,
          ...(slide.bullets || []).slice(0, 2),
          "教师可审核修改后再发布。"
        ], 5),
        visualType: slide.visualType || "concept",
        ...(visualData ? { visualData } : {}),
        lessonMode: "tutor",
        tutorMoves: uniqueTextList(frame.moves(point, slide), 4),
        sources: Array.isArray(slide.sources) && slide.sources.length ? slide.sources : sourceRefs
      };
    });
  }

  function padPoints(points) {
    const result = points.slice();
    while (result.length < 3) result.push(points[0] || "核心知识点");
    return result;
  }

  function coursewareKey(unit) {
    return `${state.grade}-${state.volume}-${unit.id}`;
  }

  function coursewareReviewRecord(unit) {
    const raw = state.coursewareReviews[coursewareKey(unit)];
    if (Array.isArray(raw)) return buildCoursewareReviewRecord(raw, "reviewed", { migratedFrom: "legacy-array" });
    if (raw && Array.isArray(raw.slides)) return raw;
    return null;
  }

  function buildCoursewareReviewRecord(slides, reviewStatus = "draft", extra = {}) {
    const now = new Date().toISOString();
    return {
      schemaVersion: exportSchemaVersion,
      exportVersion: reviewExportVersion,
      reviewStatus,
      reviewStatusLabel: reviewStatusLabel(reviewStatus),
      createdAt: extra.createdAt || now,
      updatedAt: now,
      reviewedAt: reviewStatus === "reviewed" ? now : extra.reviewedAt || "",
      source: extra.source || "local",
      slides
    };
  }

  function pptPlanRecordKey(unit) {
    return coursewareKey(unit);
  }

  function pptPlanRecord(unit) {
    const raw = state.pptPlans[pptPlanRecordKey(unit)];
    if (raw?.plan?.pages?.length) return raw;
    if (raw?.pages?.length) return buildPptPlanRecord(raw, "draft", { source: "legacy-plan" });
    return null;
  }

  function buildPptPlanRecord(plan, reviewStatus = "draft", extra = {}) {
    const now = new Date().toISOString();
    return {
      schemaVersion: exportSchemaVersion,
      exportVersion: "ppt-plan-v1",
      reviewStatus,
      reviewStatusLabel: reviewStatusLabel(reviewStatus),
      createdAt: extra.createdAt || now,
      updatedAt: now,
      source: extra.source || "local",
      plan
    };
  }

  function clearPptPlanForUnit(unit) {
    if (!state.pptPlans || !unit) return;
    delete state.pptPlans[pptPlanRecordKey(unit)];
    writeJson(pptPlanKey, state.pptPlans);
  }

  function ensurePptExporterReady() {
    if (!pptxExporter?.buildPptPlan || !pptxExporter?.createPptxPackage) {
      throw new Error("PPTX 导出模块未加载，请确认 pptx-exporter.js 已引入。");
    }
  }

  function buildPptExportContext(unit, slides) {
    const reviewRecord = coursewareReviewRecord(unit);
    return {
      version: content.version,
      subject: content.subject,
      textbookVersion: content.textbookVersion || "人教版",
      gradeId: state.grade,
      gradeName: gradeData().name,
      volumeId: state.volume,
      volumeName: volumeData().name,
      unitId: unit.id,
      unitTitle: unit.title,
      unitSummary: unit.summary,
      knowledgePoints: unit.points || [],
      sources: getSourceRefs(unit),
      reviewStatus: reviewRecord?.reviewStatus || "draft",
      reviewStatusLabel: reviewRecord?.reviewStatusLabel || reviewStatusLabel("draft"),
      exportVersion: reviewRecord?.exportVersion || reviewExportVersion,
      slides
    };
  }

  function reviewStatusLabel(status) {
    const labels = {
      draft: "待审核",
      reviewed: "已审核",
      imported: "已导入",
      rule_checked: "规则已验",
      legacy: "历史记录"
    };
    return labels[status] || "待审核";
  }

  function applyCoursewareReview(slides, review) {
    return slides.map((slide, index) => ({
      ...slide,
      title: review[index]?.title || slide.title,
      body: review[index]?.body || slide.body,
      bullets: Array.isArray(review[index]?.bullets) && review[index].bullets.length ? review[index].bullets : slide.bullets,
      visualType: review[index]?.visualType || slide.visualType,
      visualData: review[index]?.visualData || slide.visualData,
      lessonMode: review[index]?.lessonMode || slide.lessonMode,
      tutorMoves: Array.isArray(review[index]?.tutorMoves) && review[index].tutorMoves.length ? review[index].tutorMoves : slide.tutorMoves,
      sources: Array.isArray(review[index]?.sources) && review[index].sources.length ? review[index].sources : slide.sources
    }));
  }

  function toggleCoursewareReview() {
    if (!requireTeacherMode("审核编辑")) return;
    if (!buildCoursewareSlides(unitData()).length) {
      setModelStatus("当前还没有课件，请先导入历史课件或点击 AI 生成课件。", "warn");
      return;
    }
    state.coursewareEditMode = !state.coursewareEditMode;
    renderCourseware();
  }

  function saveCoursewareReview() {
    if (!requireTeacherMode("保存审核稿")) return;
    const unit = unitData();
    const existingSlides = buildCoursewareSlides(unit);
    if (!existingSlides.length) {
      setModelStatus("当前还没有可保存的课件。", "warn");
      return;
    }
    const slideNodes = Array.from(document.querySelectorAll("#coursewareSlides .markdownflow-section, #coursewareSlides .slide-card"));
    const slides = slideNodes.map((card, index) => {
      const existingSlide = existingSlides[index] || {};
      return {
        title: cleanEditableText(card.querySelector('[data-edit="title"]')?.innerText || "").replace(/^\d+\.\s*/, ""),
        body: cleanEditableText(card.querySelector('[data-edit="body"]')?.innerText || ""),
        bullets: Array.from(card.querySelectorAll('[data-edit="bullet"]'))
          .map((item) => cleanEditableText(item.innerText))
          .filter(Boolean),
        visualType: existingSlide.visualType || "concept",
        visualData: existingSlide.visualData,
        lessonMode: existingSlide.lessonMode,
        tutorMoves: existingSlide.tutorMoves,
        sources: existingSlide.sources || getSourceRefs(unit)
      };
    });
    state.coursewareReviews[coursewareKey(unit)] = buildCoursewareReviewRecord(slides, "reviewed", { source: "teacher-review" });
    clearPptPlanForUnit(unit);
    writeJson(coursewareReviewKey, state.coursewareReviews);
    state.coursewareEditMode = false;
    renderCourseware();
    setModelStatus("课件审核稿已保存到本机历史记录。", "ok");
  }

  function resetCoursewareReview() {
    if (!requireTeacherMode("清空课件")) return;
    const unit = unitData();
    delete state.coursewareReviews[coursewareKey(unit)];
    clearPptPlanForUnit(unit);
    writeJson(coursewareReviewKey, state.coursewareReviews);
    state.coursewareEditMode = false;
    hideGenerationProgress("courseware");
    renderCourseware();
    setModelStatus("当前单元课件已清空，可重新生成或导入历史课件。", "ok");
  }

  function cleanEditableText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function exportCoursewarePdf() {
    if (!requireTeacherMode("导出 PDF")) return;
    if (!buildCoursewareSlides(unitData()).length) {
      setModelStatus("当前还没有可导出 PDF 的课件。", "warn");
      return;
    }
    switchTab("courseware");
    window.print();
  }

  function exportCoursewarePptx() {
    if (!requireTeacherMode("导出 PPTX")) return;
    ensurePptExporterReady();
    const unit = unitData();
    const slides = buildCoursewareSlides(unit);
    if (!slides.length) {
      setModelStatus("当前还没有可导出 PPTX 的课件。", "warn");
      return;
    }
    const context = buildPptExportContext(unit, slides);
    const fallbackPlan = pptxExporter.buildPptPlan(context);
    const record = pptPlanRecord(unit);
    const plan = pptxExporter.normalizePptPlan(record?.plan, fallbackPlan, context);
    const validation = pptxExporter.validatePptPlan(plan, unit.points || []);
    if (!validation.ok) {
      setModelStatus(`PPT 导出前校验提示：${validation.issues.slice(0, 3).join("；")}。已使用本地模板补齐后导出。`, "warn");
    }
    const filename = `${gradeData().name}${volumeData().name}-${unit.title}-知识点课件.pptx`;
    pptxExporter.downloadPptx(plan, filename);
    const sourceLabel = record?.source === "llm" ? "PPT 制作 Agent 方案" : "本地模板方案";
    setModelStatus(`PPTX 已导出：${plan.pages.length} 页，使用${sourceLabel}。`, "ok");
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
    if (slide.visualType === "context" || slide.visualType === "scenario" || slide.visualType === "example") {
      return renderScenarioVisual(slide, unit, slide.visualType === "example" ? "focus" : "large");
    }
    if (slide.visualType === "concept") {
      return `
        <div class="concept-map">
          ${points.slice(0, 4).map((point) => `<span>${escapeHtml(shortLabel(point))}</span>`).join("")}
        </div>
      `;
    }
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

  function renderTutorMoves(slide, variant = "card") {
    const moves = uniqueTextList(slide.tutorMoves || [], 4);
    if (!moves.length) return "";
    return `
      <div class="tutor-moves ${variant === "presentation" ? "presentation-tutor-moves" : ""}">
        <strong>导学互动</strong>
        <ol>${moves.map((move) => `<li>${escapeHtml(move)}</li>`).join("")}</ol>
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
        <small class="visual-caption">每一步都对应一个标准填空结果，方便检查。</small>
      </div>
    `;
  }

  function renderScenarioVisual(slide, unit, size) {
    const visualData = normalizeSlideVisualData(slide.visualData, null, unit);
    if (visualData?.kind === "stationery") return renderStationeryScenario(size, visualData);
    if (visualData?.kind === "share") return renderCraftShareScenario(size, visualData);
    if (visualData?.kind === "quantity") return renderQuantityBarScenario(size, visualData);

    const scenarioText = [
      slide.title,
      slide.body,
      ...(slide.bullets || []),
      unit.title,
      unit.summary,
      ...(unit.tags || []),
      ...(unit.points || [])
    ].join(" ");

    if (includesAny(scenarioText, ["文具", "笔记本", "钢笔", "单价", "总价", "买了", "花了", "元"])) {
      return renderStationeryScenario(size, buildDefaultSlideVisualData(unit, "混合运算"));
    }

    if (includesAny(scenarioText, ["纸花", "做花", "已经做", "剩下", "剩余", "平均分", "每人"])) {
      return renderCraftShareScenario(size, { kind: "share" });
    }

    if (includesAny(scenarioText, ["线段图", "表格", "数量关系", "单位 1"])) {
      return renderQuantityBarScenario(size, { kind: "quantity" });
    }

    return renderTopicVisual(unit, size);
  }

  function renderStationeryScenario(size, visualData) {
    const data = normalizeStationeryVisualData(visualData) || normalizeStationeryVisualData(buildDefaultSlideVisualData(unitData(), "混合运算"));
    const expression = data.expression || data.items.map((item) => item.priceLabel || item.label).join("+");
    return `
      <div class="scenario-visual stationery-scenario ${size}">
        <strong class="visual-title">${escapeHtml(data.title)}</strong>
        <div class="object-equation" aria-label="${escapeAttribute(data.title)}">
          ${data.items.map((item, itemIndex) => `
            <div class="object-group" aria-label="${escapeAttribute(`${item.count} 个${item.label}`)}">
              ${Array.from({ length: item.count }, (_, objectIndex) => renderScenarioObject(item, itemIndex + objectIndex)).join("")}
            </div>
          `).join('<span class="math-mark">+</span>')}
          <span class="math-mark">=</span>
          <span class="total-badge">${escapeHtml(expression)}</span>
        </div>
        <small class="visual-caption">${escapeHtml(data.caption || "先看相同物品的数量关系，再合并其他条件。")}</small>
      </div>
    `;
  }

  function renderScenarioObject(item, index) {
    if (item.type === "pen" || item.type === "pencil") {
      return `<span class="pen-object" style="--i:${index}"><i></i><b>${escapeHtml(item.priceLabel || item.label)}</b></span>`;
    }
    return `<span class="notebook object-${escapeAttribute(item.type)}" style="--i:${index}"><i></i><b>${escapeHtml(item.priceLabel || item.label)}</b></span>`;
  }

  function renderCraftShareScenario(size, visualData) {
    const data = normalizeShareVisualData(visualData || {});
    const doneWidth = data.total ? clampInt((data.done / data.total) * 100, 8, 92) : 33;
    const remainWidth = clampInt(100 - doneWidth, 8, 92);
    return `
      <div class="scenario-visual craft-scenario ${size}">
        <strong class="visual-title">${escapeHtml(data.title)}</strong>
        <div class="craft-bars" aria-label="${escapeAttribute(data.title)}">
          <div class="total-strip">
            <span class="done" style="--w:${doneWidth}%">已知 ${escapeHtml(data.done)}</span>
            <span class="remain" style="--w:${remainWidth}%">剩余 ${escapeHtml(data.remain)}</span>
          </div>
          <div class="share-row" style="grid-template-columns: repeat(${data.groups}, minmax(0, 1fr));">
            ${Array.from({ length: data.groups }, (_, index) => `<span style="--i:${index}"><i></i><b>${escapeHtml(data.each)}${escapeHtml(data.unitLabel)}</b></span>`).join("")}
          </div>
        </div>
        <small class="visual-caption">${escapeHtml(data.caption)}</small>
      </div>
    `;
  }

  function renderQuantityBarScenario(size, visualData) {
    const data = normalizeQuantityVisualData(visualData || {});
    return `
      <div class="scenario-visual quantity-scenario ${size}">
        <strong class="visual-title">${escapeHtml(data.title)}</strong>
        <div class="quantity-bars">
          ${data.bars.map((bar) => `<div><span style="--w:${bar.width}%">${escapeHtml(bar.label)}</span><em>${escapeHtml(bar.valueLabel)}</em></div>`).join("")}
        </div>
        <small class="visual-caption">${escapeHtml(data.caption)}</small>
      </div>
    `;
  }

  function shortLabel(value) {
    const text = String(value).replace(/[，。、；：]/g, "");
    return text.length > 8 ? `${text.slice(0, 8)}…` : text;
  }

  function renderPractice() {
    const list = $("practiceList");
    const hasQuestions = state.currentQuestions.length > 0;
    $("aiQuestionsBtn").textContent = state.practiceGenerating ? "出题中..." : hasQuestions ? "重新生成练习" : "AI 生成练习";
    $("showAnswerBtn").textContent = state.answersVisible ? "隐藏答案" : "显示答案";
    ["showAnswerBtn", "copyAnswersBtn", "exportPracticeJsonBtn", "gradePracticeBtn", "syncPracticeToGradingBtn"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = state.practiceGenerating || !hasQuestions;
    });
    $("importPracticeBtn").disabled = state.practiceGenerating;
    $("practiceAnswerPanel").hidden = !hasQuestions;
    $("paperMeta").hidden = !hasQuestions;
    $("paperMeta").textContent = hasQuestions
      ? `当前试卷：${state.currentQuestions.length} 题，总分 ${paperTotal(state.currentQuestions)} 分，范围限定为“${unitData().title}”。`
      : "";

    if (state.practiceGenerating) {
      $("practiceAnswerPanel").hidden = true;
      list.className = "question-list empty-state";
      list.innerHTML = `<div><strong>练习生成中</strong><p>AI 正在生成并校验题目，完成后会一次性展示整卷。</p></div>`;
      return;
    }

    if (!hasQuestions) {
      $("practiceAnswerPanel").hidden = true;
      list.className = "question-list empty-state";
      const emptyText = isTeacherMode()
        ? "可以导入历史练习，或点击“AI 生成练习”创建当前单元同步题。"
        : "当前还没有可作答练习，请让教师模式先生成或导入练习。";
      list.innerHTML = `<div><strong>暂无练习</strong><p>${emptyText}</p></div>`;
      return;
    }

    list.className = `question-list${state.answersVisible ? " show-answers" : ""}`;
    list.innerHTML = state.currentQuestions.map(renderQuestionCard).join("");
  }

  function renderQuestionCard(question, index) {
    return `
      <article class="question-card">
        <h4>${index + 1}. ${renderStemContent(question.stem)}</h4>
        <div class="question-meta">
          <span class="pill blue">${escapeHtml(question.knowledgePoint)}</span>
          <span class="pill green">${escapeHtml(question.questionType || "同步练习")}</span>
          <span class="pill orange">${escapeHtml(question.difficulty)}</span>
          <span class="pill">${question.point} 分</span>
        </div>
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
    seedAnswerInputsWithTemplate();
    state.gradingResults = [];
    $("gradingSummary").classList.remove("active");
    $("gradingSummary").innerHTML = "";
    $("gradingResults").innerHTML = "";
    $("performanceFeedback").innerHTML = "";
  }

  function generateScopedQuestions(unit, grade, difficulty, count) {
    const safeCount = capQuestionCount(count);
    if (!safeCount) return [];
    let candidates = [];
    let prepared = { questions: [] };
    let scoped = prepared.questions;
    let attempts = 0;

    while ((!scoped.length || scoped.length < safeCount || !hasKnowledgeCoverage(scoped, unit)) && attempts < 6) {
      candidates = [...candidates, ...generateQuestions(unit, grade, difficulty, safeCount, attempts * safeCount)];
      prepared = prepareQuestionsForPaper(candidates, unit, safeCount);
      scoped = prepared.questions;
      attempts += 1;
    }

    return scoped.slice(0, safeCount);
  }

  function enforceUnitQuestionBoundary(questions, unit) {
    if (ruleEngine.enforceUnitQuestionBoundary) return ruleEngine.enforceUnitQuestionBoundary(questions, unit);
    const allowedPoints = new Set(unit.points || []);
    return questions.filter((questionItem) => (
      questionItem.unitId === unit.id
      && questionItem.unitTitle === unit.title
      && (!allowedPoints.size || allowedPoints.has(questionItem.knowledgePoint))
    ));
  }

  function hasKnowledgeCoverage(questions, unit) {
    if (ruleEngine.findMissingKnowledgePoints) return ruleEngine.findMissingKnowledgePoints(questions, unit).length === 0;
    const covered = new Set((questions || []).map((questionItem) => questionItem.knowledgePoint));
    return (unit.points || []).every((point) => covered.has(point));
  }

  function generateQuestions(unit, grade, difficulty, count, startIndex = 0) {
    const safeCount = capQuestionCount(count);
    const questions = [];
    const modes = ["计算填空题", "选择题", "填空题", "计算填空题", "选择题"];
    const maxSameType = Math.max(2, Math.ceil(safeCount / modes.length));
    const typeCounts = {};
    const tags = unit.tags?.length ? unit.tags : ["综合"];
    const points = unit.points?.length ? unit.points : tags;
    let cursor = 0;

    points.slice(0, safeCount).forEach((knowledgePoint, pointIndex) => {
      const tag = tags[pointIndex % tags.length] || knowledgePoint;
      const mode = modes[pointIndex % modes.length];
      const candidate = makeQuestion({ unit, grade, difficulty, tag, knowledgePoint, mode, index: startIndex + pointIndex });
      questions.push({ ...candidate, id: `${unit.id}-q${Date.now()}-${questions.length}` });
      typeCounts[candidate.questionType] = (typeCounts[candidate.questionType] || 0) + 1;
    });

    while (questions.length < safeCount && cursor < safeCount * 6) {
      const tag = tags[cursor % tags.length] || "综合";
      const knowledgePoint = points[cursor % points.length] || tag;
      const mode = modes[cursor % modes.length];
      const candidate = makeQuestion({ unit, grade, difficulty, tag, knowledgePoint, mode, index: startIndex + points.length + cursor });
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
      const tag = tags[index % tags.length] || "综合";
      const knowledgePoint = points[index % points.length] || tag;
      questions.push(makeQuestion({ unit, grade, difficulty, tag, knowledgePoint, mode: modes[index % modes.length], index: startIndex + index }));
    }
    return questions;
  }

  function makeQuestion(context) {
    const { tag, knowledgePoint } = context;
    const concept = [knowledgePoint, tag].filter(Boolean).join(" ");
    let built;
    if (includesAny(concept, ["线段图", "表格"]) && includesAny(concept, ["数量关系", "单位 1", "单位1"])) built = quantityRelationQuestion(context);
    else if (includesAny(concept, ["分步算式", "合并成综合算式"])) built = stepExpressionQuestion(context);
    else if (includesAny(concept, ["单价数量总价"])) built = priceQuantityQuestion(context);
    else if (includesAny(concept, ["速度时间路程"])) built = speedDistanceQuestion(context);
    else if (includesAny(concept, ["克、千克、吨", "质量"])) built = massQuestion(context);
    else if (includesAny(concept, ["数对"])) built = coordinateQuestion(context);
    else if (includesAny(concept, ["负数", "正数"])) built = negativeNumberQuestion(context);
    else if (includesAny(concept, ["圆"])) built = circleQuestion(context);
    else if (includesAny(concept, ["可能性"])) built = probabilityQuestion(context);
    else if (includesAny(concept, ["分数"])) built = fractionQuestion(context);
    else if (includesAny(concept, ["小数"])) built = decimalQuestion(context);
    else if (includesAny(concept, ["百分数"])) built = percentQuestion(context);
    else if (includesAny(concept, ["运算律", "交换律", "结合律", "分配律", "简便"])) built = operationLawQuestion(context);
    else if (includesAny(concept, ["混合运算", "小括号"])) built = mixedOperationQuestion(context);
    else if (includesAny(concept, ["比例", "比"])) built = ratioQuestion(context);
    else if (includesAny(concept, ["方程"])) built = equationQuestion(context);
    else if (includesAny(concept, ["体积"])) built = volumeQuestion(context);
    else if (includesAny(concept, ["面积"])) built = areaQuestion(context);
    else if (includesAny(concept, ["长度", "单位", "人民币"])) built = conversionQuestion(context);
    else if (includesAny(concept, ["时间"])) built = timeQuestion(context);
    else if (includesAny(concept, ["统计", "可能性"])) built = statisticsQuestion(context);
    else if (includesAny(concept, ["图形", "角", "方向", "观察", "视图"])) built = geometryQuestion(context);
    else if (includesAny(concept, ["乘除", "倍数", "口诀", "余数", "乘法", "除法"])) built = multiplicationQuestion(context);
    else built = arithmeticQuestion(context);
    return enrichQuestion(built, context);
  }

  function mixedOperationQuestion({ unit, grade, difficulty, tag, knowledgePoint, index }) {
    const base = Math.max(6, Math.floor(difficultyBase(grade, difficulty) / 8));
    const a = base + index + 3;
    const b = 2 + (index % 5);
    const c = 3 + (index % 4);
    const point = knowledgePoint || tag;

    if (String(point).includes("含小括号")) {
      const answer = String((a + b) * c);
      const stem = `填空：(${a} + ${b}) × ${c} = ____。`;
      return question(unit, point, difficulty, stem, answer, `先算小括号里的 ${a}+${b}=${a + b}，再乘 ${c}，结果是 ${answer}。`, index);
    }

    const answer = String(a + b * c);
    const stem = `填空：${a} + ${b} × ${c} = ____。`;
    return question(unit, point, difficulty, stem, answer, `没有小括号时先算乘除：${b}×${c}=${b * c}，再算 ${a}+${b * c}=${answer}。`, index);
  }

  function stepExpressionQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const groups = 4 + (index % 5);
    const each = 3 + (index % 4);
    const extra = 6 + index;
    const product = groups * each;
    const total = product + extra;
    const point = knowledgePoint || tag;
    const stem = [
      `选择题：分步计算为：先算 ${groups} × ${each} = ${product}，再算 ${product} + ${extra} = ${total}。`,
      `下面哪个算式表示同一过程？ A. ${groups} + ${each} × ${extra} B. ${groups} × ${each} + ${extra} C. (${groups} + ${each}) × ${extra} D. ${product} - ${extra}`
    ].join(" ");
    return question(unit, point, difficulty, stem, "B", `分步结果是先求 ${groups} 个 ${each}，再加 ${extra}，对应算式是 ${groups} × ${each} + ${extra}，所以选 B。`, index);
  }

  function quantityRelationQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const perDay = 5 + (index % 4);
    const days = 3 + (index % 3);
    const rest = difficulty === "挑战" ? 20 + index : 12 + index;
    const readPages = perDay * days;
    const totalPages = readPages + rest;
    const point = knowledgePoint || tag;
    const stem = [
      `填空：小明每天看 ${perDay} 页书，看了 ${days} 天，还剩 ${rest} 页。先用表格整理数量关系，再填写空格。`,
      "| 已看页数 | 剩余页数 | 总页数 |",
      "| --- | --- | --- |",
      `| ____ | ${rest} | ____ |`
    ].join("\n");
    return question(unit, point, difficulty, stem, `${readPages}和${totalPages}`, `已看页数 = ${perDay}×${days}=${readPages} 页；总页数 = 已看页数 + 剩余页数 = ${readPages}+${rest}=${totalPages} 页。`, index);
  }

  function operationLawQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const point = knowledgePoint || tag;
    if (String(point).includes("分配律")) {
      const a = 25;
      const b = 12 + index;
      const c = 4 + (index % 4);
      const answer = String(a * (b + c));
      const stem = `填空：${a} × ${b} + ${a} × ${c} = ${a} × (${b} + ${c}) = ____。`;
      return question(unit, point, difficulty, stem, answer, `两个乘法算式有相同因数 ${a}，可用乘法分配律合并为 ${a}×(${b}+${c})，结果是 ${answer}。`, index);
    }
    const a = 125;
    const b = 8;
    const c = 4 + (index % 5);
    const answer = String(a * b * c);
    const stem = `填空：${a} × ${c} × ${b} = (${a} × ${b}) × ${c} = ____。`;
    return question(unit, point, difficulty, stem, answer, `利用交换律和结合律先算 ${a}×${b}=1000，再乘 ${c}，结果是 ${answer}。`, index);
  }

  function priceQuantityQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const price = difficulty === "挑战" ? 18 + index : 12 + (index % 6);
    const quantity = 3 + (index % 5);
    const total = price * quantity;
    const point = knowledgePoint || tag;
    const stem = [
      `填空：练习本每本 ${price} 元，买 ${quantity} 本。根据“单价 × 数量 = 总价”填写表格。`,
      "| 单价 | 数量 | 总价 |",
      "| --- | --- | --- |",
      `| ${price} 元/本 | ${quantity} 本 | ____ 元 |`
    ].join("\n");
    return question(unit, point, difficulty, stem, String(total), `单价是 ${price} 元/本，数量是 ${quantity} 本，总价 = ${price}×${quantity}=${total} 元。`, index);
  }

  function speedDistanceQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const speed = difficulty === "挑战" ? 75 + index : 45 + index;
    const time = 2 + (index % 4);
    const distance = speed * time;
    const point = knowledgePoint || tag;
    const stem = [
      `填空：汽车每小时行 ${speed} 千米，行驶 ${time} 小时。根据“速度 × 时间 = 路程”填写表格。`,
      "| 速度 | 时间 | 路程 |",
      "| --- | --- | --- |",
      `| ${speed} 千米/时 | ${time} 小时 | ____ 千米 |`
    ].join("\n");
    return question(unit, point, difficulty, stem, String(distance), `路程 = 速度×时间 = ${speed}×${time}=${distance} 千米。`, index);
  }

  function massQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const kg = 2 + (index % 6);
    const grams = kg * 1000;
    const point = knowledgePoint || tag;
    const stem = `填空：一袋大米的质量是 ${kg} 千克，合 ____ 克。`;
    return question(unit, point, difficulty, stem, String(grams), `质量单位换算中 1 千克 = 1000 克，所以 ${kg} 千克 = ${grams} 克。`, index);
  }

  function coordinateQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const col = 2 + (index % 6);
    const row = 3 + (index % 5);
    const point = knowledgePoint || tag;
    const stem = `填空：方格图中，小红的位置用数对表示为 (${col}, ${row})，其中列数是 ____。`;
    return question(unit, point, difficulty, stem, String(col), `数对通常先写列、再写行，(${col}, ${row}) 中第一个数 ${col} 表示列数。`, index);
  }

  function negativeNumberQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const below = 3 + (index % 7);
    const above = 2 + (index % 6);
    const point = knowledgePoint || tag;
    const stem = `填空：温度从 -${below}℃ 上升到 ${above}℃，在数轴上跨过 0，温度升高了 ____℃。`;
    return question(unit, point, difficulty, stem, String(below + above), `负数到 0 相差 ${below}℃，0 到 ${above}℃ 相差 ${above}℃，共升高 ${below + above}℃。`, index);
  }

  function circleQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const radius = 3 + (index % 5);
    const point = knowledgePoint || tag;
    if (String(point).includes("直径") || String(point).includes("半径")) {
      const stem = `填空：一个圆的半径是 ${radius} cm，直径是 ____ cm。`;
      return question(unit, point, difficulty, stem, String(radius * 2), `同一个圆中直径 = 半径 × 2，所以直径是 ${radius}×2=${radius * 2} cm。`, index);
    }
    const circumference = trimNumber(2 * 3.14 * radius);
    const stem = `填空：圆的半径是 ${radius} cm，取 π=3.14，圆的周长是 ____ cm。`;
    return question(unit, point, difficulty, stem, circumference, `圆的周长公式是 C=2πr，所以 2×3.14×${radius}=${circumference} cm。`, index);
  }

  function probabilityQuestion({ unit, difficulty, tag, knowledgePoint, index }) {
    const red = 3 + (index % 4);
    const blue = 1 + (index % 3);
    const point = knowledgePoint || tag;
    const stem = [
      `选择题：袋子里有 ${red} 个红球和 ${blue} 个蓝球，任意摸 1 个球，哪种说法正确？`,
      "A. 一定摸到红球 B. 不可能摸到蓝球 C. 摸到红球的可能性更大 D. 两种颜色可能性相同"
    ].join(" ");
    return question(unit, point, difficulty, stem, "C", `红球数量 ${red} 个多于蓝球 ${blue} 个，所以摸到红球的可能性更大，选 C。`, index);
  }

  function arithmeticQuestion({ unit, grade, difficulty, tag, index }) {
    const base = difficultyBase(grade, difficulty);
    const a = base + index * 3 + 7;
    const b = Math.max(2, Math.floor(base / 2) + index + 4);
    const isSubtract = index % 2 === 1;
    const stem = isSubtract
      ? `填空：${a + b} - ${b} = ____。`
      : `填空：${a} + ${b} = ____。`;
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
      const stem = `填空：${total} ÷ ${a} = ____。`;
      return question(unit, tag, difficulty, stem, answer, `用乘法口诀或试商：${a} × ${b} = ${a * b}，${total} 除以 ${a} 的结果为 ${answer}。`, index);
    }
    const answer = String(a * b);
    return question(unit, tag, difficulty, `填空：${a} × ${b} = ____。`, answer, `把 ${a} 个 ${b} 相加，或用乘法口诀/竖式计算，积是 ${answer}。`, index);
  }

  function decimalQuestion({ unit, difficulty, tag, index }) {
    const scale = difficulty === "挑战" ? 100 : 10;
    const a = (12 + index * 3) / scale;
    const b = (8 + index * 2) / scale;
    const multiply = difficulty === "挑战" && index % 2 === 0;
    const answerNumber = multiply ? a * b : a + b;
    const answer = trimNumber(answerNumber);
    const stem = multiply ? `填空：${trimNumber(a)} × ${trimNumber(b)} = ____。` : `填空：${trimNumber(a)} + ${trimNumber(b)} = ____。`;
    return question(unit, tag, difficulty, stem, answer, `小数计算要先确定运算方法，再处理小数点位置，结果是 ${answer}。`, index);
  }

  function fractionQuestion({ unit, difficulty, tag, index }) {
    const denominator = difficulty === "基础" ? 8 : 12 + (index % 3);
    const a = 1 + (index % 3);
    const b = difficulty === "挑战" ? 2 + (index % 4) : 1 + (index % 2);
    const numerator = a + b;
    const answer = reduceFraction(numerator, denominator);
    const stem = `填空：${a}/${denominator} + ${b}/${denominator} = ____。`;
    return question(unit, tag, difficulty, stem, answer, `同分母分数相加，分母不变，分子相加：${a}+${b}=${numerator}，再化简为 ${answer}。`, index);
  }

  function percentQuestion({ unit, difficulty, tag, index }) {
    const amount = difficulty === "基础" ? 80 + index * 10 : 120 + index * 20;
    const rate = difficulty === "挑战" ? 35 : difficulty === "提高" ? 25 : 10;
    const answer = trimNumber((amount * rate) / 100);
    const stem = `填空：${amount} 的 ${rate}% 是 ____。`;
    return question(unit, tag, difficulty, stem, answer, `百分数可以转化为小数：${rate}% = ${rate / 100}，所以 ${amount} × ${rate / 100} = ${answer}。`, index);
  }

  function ratioQuestion({ unit, difficulty, tag, index }) {
    const a = 2 + (index % 3);
    const b = difficulty === "挑战" ? 5 + (index % 4) : 3 + (index % 3);
    const total = (a + b) * (difficulty === "基础" ? 6 : 8);
    const answer = String((total * a) / (a + b));
    const stem = `填空：把 ${total} 按 ${a}:${b} 分成两部分，第一部分是 ____。`;
    return question(unit, tag, difficulty, stem, answer, `总份数是 ${a + b}，每份是 ${total} ÷ ${a + b}，第一部分是 ${answer}。`, index);
  }

  function equationQuestion({ unit, difficulty, tag, index }) {
    const x = 4 + index;
    const a = difficulty === "基础" ? 2 : 3;
    const b = difficulty === "挑战" ? 11 : 5;
    const c = a * x + b;
    const stem = `填空：若 ${a}x + ${b} = ${c}，则 x = ____。`;
    return question(unit, tag, difficulty, stem, String(x), `先两边同时减 ${b}，得 ${a}x=${a * x}；再两边同时除以 ${a}，得 x=${x}。`, index);
  }

  function areaQuestion({ unit, difficulty, tag, index }) {
    const length = 8 + index + (difficulty === "挑战" ? 7 : 0);
    const width = 5 + (index % 5);
    const answer = String(length * width);
    const stem = `填空：长方形长 ${length} cm，宽 ${width} cm，面积是 ____ 平方厘米。`;
    return question(unit, tag, difficulty, stem, answer, `长方形面积 = 长 × 宽，所以 ${length} × ${width} = ${answer} 平方厘米。`, index);
  }

  function volumeQuestion({ unit, difficulty, tag, index }) {
    const length = 4 + index;
    const width = 3 + (index % 3);
    const height = difficulty === "基础" ? 2 : 5;
    const answer = String(length * width * height);
    const stem = `填空：长方体长 ${length} cm，宽 ${width} cm，高 ${height} cm，体积是 ____ 立方厘米。`;
    return question(unit, tag, difficulty, stem, answer, `长方体体积 = 长 × 宽 × 高，所以 ${length} × ${width} × ${height} = ${answer}。`, index);
  }

  function conversionQuestion({ unit, difficulty, tag, index }) {
    if (tag.includes("人民币")) {
      const yuan = 3 + index;
      const jiao = difficulty === "基础" ? 5 : 8;
      const answer = String(yuan * 10 + jiao);
      return question(unit, tag, difficulty, `填空：${yuan} 元 ${jiao} 角 = ____ 角。`, answer, `1 元 = 10 角，所以 ${yuan} 元是 ${yuan * 10} 角，再加 ${jiao} 角，共 ${answer} 角。`, index);
    }
    const meters = 2 + index;
    const answer = String(meters * 100);
    return question(unit, tag, difficulty, `填空：${meters} 米 = ____ 厘米。`, answer, `1 米 = 100 厘米，所以 ${meters} 米 = ${answer} 厘米。`, index);
  }

  function timeQuestion({ unit, difficulty, tag, index }) {
    const startHour = 8 + (index % 4);
    const minutes = difficulty === "基础" ? 25 : 45 + index * 5;
    const endMinutes = minutes % 60;
    const endHour = startHour + Math.floor(minutes / 60);
    const answer = `${endHour}:${String(endMinutes).padStart(2, "0")}`;
    const stem = `填空：${startHour}:00 开始上课，经过 ${minutes} 分钟后是 ____。`;
    return question(unit, tag, difficulty, stem, answer, `经过时间要按 60 分钟进 1 小时计算，${startHour}:00 加 ${minutes} 分钟是 ${answer}。`, index);
  }

  function statisticsQuestion({ unit, difficulty, tag, index }) {
    const values = difficulty === "基础" ? [6 + index, 8 + index, 10 + index] : [12 + index, 15 + index, 18 + index];
    const max = Math.max(...values);
    const min = Math.min(...values);
    const answer = String(max - min);
    const stem = [
      "填空：下面是三组同学完成口算题数量的统计表，最多组比最少组多 ____ 题。",
      "| 小组 | 一组 | 二组 | 三组 |",
      "| --- | --- | --- | --- |",
      `| 题数 | ${values[0]} | ${values[1]} | ${values[2]} |`
    ].join("\n");
    return question(unit, tag, difficulty, stem, answer, `统计表中最大值是 ${max}，最小值是 ${min}，差值是 ${max}-${min}=${answer} 题。`, index);
  }

  function geometryQuestion({ unit, difficulty, tag, index }) {
    if (tag.includes("角")) {
      const angle = difficulty === "基础" ? 90 : 35 + index * 10;
      const type = angle === 90 ? "直角" : angle < 90 ? "锐角" : "钝角";
      const options = ["锐角", "直角", "钝角", "平角"];
      const answer = ["A", "B", "C", "D"][options.indexOf(type)];
      return question(unit, tag, difficulty, `选择题：${angle}° 的角属于哪一类？ A. 锐角 B. 直角 C. 钝角 D. 平角`, answer, `小于 90° 是锐角，等于 90° 是直角，大于 90° 小于 180° 是钝角，所以选 ${answer}。`, index);
    }
    const answer = "A";
    return question(unit, tag, difficulty, "选择题：确定位置或观察方向时，通常要先确定什么？ A. 参照点 B. 颜色 C. 重量 D. 价格", answer, "位置与方向问题要先确定观测点或参照点，再处理方向、角度和距离，所以选 A。", index);
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
    const concept = [context.knowledgePoint, context.tag].filter(Boolean).join(" ");
    const enrichedContext = { ...context, tag: concept };
    const questionType = pickQuestionType(context.mode, concept);
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
      detailSteps: buildDetailSteps(enriched, enrichedContext),
      commonMistake: buildCommonMistake(enriched, enrichedContext),
      checkMethod: buildCheckMethod(enriched, enrichedContext)
    };
  }

  function pickQuestionType(mode, tag) {
    if (includesAny(tag, ["统计", "表格", "线段图", "数量关系"])) return "数据填空题";
    if (includesAny(tag, ["可能性"])) return "选择题";
    if (includesAny(tag, ["图形", "角", "方向", "观察"]) || String(mode).includes("选择")) return "选择题";
    if (includesAny(tag, ["单位", "长度", "人民币", "时间"])) return "单位换算填空题";
    if (String(mode).includes("计算")) return "计算填空题";
    return "填空题";
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

  function renderStemContent(stem) {
    const raw = String(stem || "");
    if (!raw.includes("|") || !raw.includes("---")) return escapeHtml(raw);
    const table = parseMarkdownTable(raw);
    if (!table) return escapeHtml(raw);
    return escapeHtml(table.prefix) + renderStemTable(table);
  }

  function parseMarkdownTable(raw) {
    const normalized = String(raw || "").replace(/\r\n/g, "\n");
    const multilineTable = parseMultilineMarkdownTable(normalized);
    return multilineTable || parseInlineMarkdownTable(normalized);
  }

  function parseMultilineMarkdownTable(normalized) {
    const lines = normalized.split("\n");
    const tableStart = lines.findIndex((line, index) => line.includes("|") && lines[index + 1] && /^\s*\|?\s*:?-{3,}:?/.test(lines[index + 1]));
    if (tableStart < 0) return null;

    const prefix = lines.slice(0, tableStart).join("\n").trim();
    const tableLines = [];
    for (let index = tableStart; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line.includes("|")) break;
      tableLines.push(line);
    }
    if (tableLines.length < 3) return null;

    const headers = splitMarkdownTableRow(tableLines[0]);
    const rows = tableLines.slice(2).map((line) => normalizeTableRow(splitMarkdownTableRow(line), headers.length)).filter((row) => row.length);
    if (!headers.length || !rows.length) return null;
    return { prefix: prefix ? prefix + "\n" : "", headers, rows };
  }

  function parseInlineMarkdownTable(normalized) {
    const separatorMatch = normalized.match(/\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?/);
    if (!separatorMatch) return null;

    const separator = separatorMatch[0];
    const columnCount = splitMarkdownTableRow(separator).length;
    if (columnCount < 2) return null;

    const before = normalized.slice(0, separatorMatch.index);
    const headerPattern = new RegExp("\\|[^|]*(?:\\|[^|]*){" + (columnCount - 1) + "}\\|?\\s*$");
    const headerMatch = before.match(headerPattern);
    if (!headerMatch) return null;

    const headerLine = headerMatch[0];
    const prefix = before.slice(0, before.length - headerLine.length).trim();
    const headers = splitMarkdownTableRow(headerLine).slice(0, columnCount);
    const after = normalized.slice(separatorMatch.index + separator.length).trim();
    const rowCandidates = after
      .split(/(?<=\|)\s+(?=\|)/)
      .map((line) => line.trim())
      .filter((line) => line.includes("|"));
    let rows = rowCandidates.map((line) => normalizeTableRow(splitMarkdownTableRow(line), columnCount)).filter((row) => row.length);

    if (!rows.length) {
      const cells = after.split("|").map((cell) => cell.trim()).filter(Boolean);
      for (let index = 0; index < cells.length; index += columnCount) {
        const row = normalizeTableRow(cells.slice(index, index + columnCount), columnCount);
        if (row.length) rows.push(row);
      }
    }

    if (!headers.length || !rows.length) return null;
    return { prefix: prefix ? prefix + "\n" : "", headers, rows };
  }

  function normalizeTableRow(cells, columnCount) {
    const row = Array.isArray(cells) ? cells.slice() : [];
    if (!row.length) return [];
    if (row.length > columnCount) return row.slice(0, columnCount - 1).concat(row.slice(columnCount - 1).join(" "));
    while (row.length < columnCount) row.push("");
    return row;
  }
  function splitMarkdownTableRow(line) {
    return String(line || "")
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function renderStemTable(table) {
    const head = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
    const body = table.rows.map((row) => `<tr>${table.headers.map((_, index) => `<td>${renderStemTableCell(row[index] || "")}</td>`).join("")}</tr>`).join("");
    return `<div class="stem-table-wrap"><table class="stem-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderStemTableCell(value) {
    const text = String(value || "").trim();
    if (/^_+$/.test(text) || text === "____") return "<span class=\"blank-cell\">____</span>";
    return escapeHtml(text);
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
    return ruleEngine.capQuestionCount ? ruleEngine.capQuestionCount(value) : requiredQuestionCount;
  }

  function capGeneratedQuestionCount(value) {
    return ruleEngine.capGeneratedQuestionCount ? ruleEngine.capGeneratedQuestionCount(value) : clamp(Number(value) || 0, 0, 20);
  }

  function normalizePaperPoints(questions) {
    if (ruleEngine.normalizePaperPoints) return ruleEngine.normalizePaperPoints(questions);
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
    return ruleEngine.paperTotal ? ruleEngine.paperTotal(questions) : questions.reduce((sum, questionItem) => sum + questionItem.point, 0);
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

  function clampInt(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.round(clamp(number, min, max));
  }

  function exportLocalData() {
    if (!requireTeacherMode("导出本地数据备份")) return;
    downloadJson(buildLocalDataPayload(), `AI-Teacher-${content.version}-${new Date().toISOString().slice(0, 10)}-本地数据备份.json`);
    setModelStatus("本地学习数据已导出，包含错题、成绩、审核稿、PPT 方案、测验设置和角色模式。", "ok");
  }

  async function importLocalData(event) {
    if (!requireTeacherMode("导入本地数据备份")) return;
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const data = payload.data || payload;
      state.mistakes = Array.isArray(data.mistakes) ? data.mistakes : [];
      state.scoreHistory = Array.isArray(data.scoreHistory) ? data.scoreHistory : [];
      state.coursewareReviews = data.coursewareReviews && typeof data.coursewareReviews === "object" ? data.coursewareReviews : {};
      state.generationCache = data.generationCache && typeof data.generationCache === "object" ? data.generationCache : {};
      state.pptPlans = data.pptPlans && typeof data.pptPlans === "object" ? data.pptPlans : {};
      state.schedule = data.schedule && typeof data.schedule === "object" ? data.schedule : { frequency: "每周", count: 10, mistakeRatio: 40 };
      state.roleMode = data.roleMode === "student" ? "student" : "teacher";
      writeJson(mistakeKey, state.mistakes);
      writeJson(scoreHistoryKey, state.scoreHistory);
      writeJson(coursewareReviewKey, state.coursewareReviews);
      writeJson(generationCacheKey, state.generationCache);
      writeJson(pptPlanKey, state.pptPlans);
      writeJson(scheduleKey, state.schedule);
      storage.setString(roleModeKey, state.roleMode);
      restoreScheduleControls();
      restoreRoleModeControls();
      clearPracticeState();
      renderAll();
      setModelStatus("本地数据备份已导入并恢复。", "ok");
    } catch (error) {
      setModelStatus(error.message || "本地数据备份导入失败。", "error");
    } finally {
      event.target.value = "";
    }
  }

  function clearLocalData() {
    if (!requireTeacherMode("清空学习数据")) return;
    const confirmed = window.confirm("确认清空本机错题、成绩、课件审核稿和测验设置？此操作不会删除知识点包。建议先导出备份。");
    if (!confirmed) return;
    storage.removeMany(Object.values(localDataKeys));
    state.mistakes = [];
    state.scoreHistory = [];
    state.coursewareReviews = {};
    state.generationCache = {};
    state.pptPlans = {};
    state.schedule = { frequency: "每周", count: 10, mistakeRatio: 40 };
    state.roleMode = "teacher";
    restoreScheduleControls();
    restoreRoleModeControls();
    clearPracticeState();
    renderAll();
    setModelStatus("本机学习数据已清空，知识点包和代码不受影响。", "ok");
  }

  function buildLocalDataPayload() {
    return storage.buildEnvelope("local-data-backup", {
      mistakes: state.mistakes,
      scoreHistory: state.scoreHistory,
      coursewareReviews: state.coursewareReviews,
      generationCache: state.generationCache,
      pptPlans: state.pptPlans,
      schedule: state.schedule,
      roleMode: state.roleMode
    }, {
      exportVersion: `local-data-v${exportSchemaVersion}`,
      version: content.version,
      subject: content.subject,
      sqliteMigrationPlan: storage.sqliteMigrationPlan()
    });
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function downloadCourseware() {
    if (!requireTeacherMode("导出 Markdown")) return;
    if (!buildCoursewareSlides(unitData()).length) {
      setModelStatus("当前还没有可导出 Markdown 的课件。", "warn");
      return;
    }
    const markdown = buildCoursewareMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${gradeData().name}${volumeData().name}-${unitData().title}-课件大纲.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportCoursewareJson() {
    if (!requireTeacherMode("导出课件记录")) return;
    const unit = unitData();
    const slides = buildCoursewareSlides(unit);
    if (!slides.length) {
      setModelStatus("当前还没有可导出的课件记录。", "warn");
      return;
    }
    const payload = {
      schemaVersion: exportSchemaVersion,
      exportedAt: new Date().toISOString(),
      type: "courseware",
      exportVersion: coursewareReviewRecord(unit)?.exportVersion || reviewExportVersion,
      reviewStatus: coursewareReviewRecord(unit)?.reviewStatus || "draft",
      reviewStatusLabel: coursewareReviewRecord(unit)?.reviewStatusLabel || reviewStatusLabel("draft"),
      reviewedAt: coursewareReviewRecord(unit)?.reviewedAt || "",
      storageKind: storage.kind,
      version: content.version,
      subject: content.subject,
      gradeId: state.grade,
      gradeName: gradeData().name,
      volumeId: state.volume,
      volumeName: volumeData().name,
      unitId: unit.id,
      unitTitle: unit.title,
      slides
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${gradeData().name}${volumeData().name}-${unit.title}-课件历史记录.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setModelStatus("课件历史记录已导出，可用于审核、备份或迁移。", "ok");
  }

  async function importCoursewareJson(event) {
    if (!requireTeacherMode("导入历史课件")) return;
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const rawSlides = Array.isArray(payload) ? payload : payload.slides;
      if (!Array.isArray(rawSlides) || !rawSlides.length) throw new Error("JSON 中未找到 slides 数组。");
      applyScopeFromPayload(payload);
      const unit = unitData();
      const slides = normalizeAiCoursewareSlides(rawSlides, buildBaseCoursewareSlides(unit), unit);
      state.coursewareReviews[coursewareKey(unit)] = buildCoursewareReviewRecord(slides, payload.reviewStatus || "imported", { source: "import", createdAt: payload.exportedAt });
      clearPptPlanForUnit(unit);
      writeJson(coursewareReviewKey, state.coursewareReviews);
      state.coursewareEditMode = false;
      hideGenerationProgress("courseware");
      renderAll();
      switchTab("courseware");
      setModelStatus(`已导入 ${slides.length} 页历史课件到“${unit.title}”。`, "ok");
    } catch (error) {
      setModelStatus(error.message || "课件 JSON 导入失败。", "error");
    } finally {
      event.target.value = "";
    }
  }

  function exportPracticeJson() {
    if (!requireTeacherMode("导出练习记录")) return;
    if (!state.currentQuestions.length) {
      setModelStatus("当前还没有可导出的练习记录。", "warn");
      return;
    }
    const unit = unitData();
    const payload = {
      schemaVersion: exportSchemaVersion,
      exportedAt: new Date().toISOString(),
      type: "practice",
      exportVersion: practiceExportVersion,
      reviewStatus: "rule_checked",
      reviewStatusLabel: reviewStatusLabel("rule_checked"),
      storageKind: storage.kind,
      version: content.version,
      subject: content.subject,
      gradeId: state.grade,
      gradeName: gradeData().name,
      volumeId: state.volume,
      volumeName: volumeData().name,
      unitId: unit.id,
      unitTitle: unit.title,
      difficulty: state.difficulty,
      questionCount: state.currentQuestions.length,
      totalScore: paperTotal(state.currentQuestions),
      answersText: $("practiceAnswerInput").value || $("answerInput").value || "",
      answerReview: state.answerReview,
      gradingResults: state.gradingResults,
      questions: state.currentQuestions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${gradeData().name}${volumeData().name}-${unit.title}-练习历史记录.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setModelStatus("练习历史记录已导出。", "ok");
  }

  async function importPracticeJson(event) {
    if (!requireTeacherMode("导入历史练习")) return;
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const rawQuestions = Array.isArray(payload) ? payload : payload.questions;
      if (!Array.isArray(rawQuestions) || !rawQuestions.length) throw new Error("JSON 中未找到 questions 数组。");
      applyScopeFromPayload(payload);
      const unit = unitData();
      const questions = normalizeImportedQuestions(rawQuestions, unit);
      const prepared = prepareQuestionsForPaper(questions, unit, capQuestionCount(questions.length));
      if (!isPreparedPaperComplete(prepared, unit, capQuestionCount(questions.length))) {
        throw new Error(formatPaperValidationError(prepared, unit, capQuestionCount(questions.length)));
      }
      state.currentQuestions = prepared.questions;
      state.answersVisible = false;
      seedAnswerInputsWithTemplate();
      if (payload.answersText) {
        $("practiceAnswerInput").value = payload.answersText;
        $("answerInput").value = payload.answersText;
      }
      state.practiceGenerating = false;
      hideGenerationProgress("practice");
      switchTab("practice");
      renderAll();
      setModelStatus(`已导入 ${state.currentQuestions.length} 题历史练习到“${unit.title}”。`, "ok");
    } catch (error) {
      setModelStatus(error.message || "练习 JSON 导入失败。", "error");
    } finally {
      event.target.value = "";
    }
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
      if (slide.tutorMoves?.length) {
        lines.push("", "导学互动：");
        slide.tutorMoves.forEach((item) => lines.push(`- ${item}`));
      }
      lines.push("", `来源：${sourceNames(slide.sources)}`);
      lines.push("");
    });
    return lines.join("\n");
  }

  async function copyAnswerTemplate() {
    if (!state.currentQuestions.length) {
      setModelStatus("当前还没有练习题，请先导入历史练习或点击 AI 生成练习。", "warn");
      return;
    }
    const template = buildAnswerTemplate();
    $("practiceAnswerInput").value = template;
    $("answerInput").value = template;
    try {
      await navigator.clipboard.writeText(template);
      setModelStatus("答题模板已填入同步出题页，并同步到拍照批改页。", "ok");
    } catch (error) {
      setModelStatus("答题模板已填入同步出题页，并同步到拍照批改页。", "ok");
    }
  }

  function buildAnswerTemplate() {
    return state.currentQuestions.map((_, index) => `${index + 1}. `).join("\n");
  }

  function seedAnswerInputsWithTemplate() {
    const template = buildAnswerTemplate();
    $("practiceAnswerInput").value = template;
    $("answerInput").value = template;
    state.answerReview = buildEmptyAnswerReview();
    renderAnswerReviewPanel();
    $("practiceGradingSummary").classList.remove("active");
    $("practiceGradingSummary").innerHTML = "";
    $("practiceResults").innerHTML = "";
  }

  function syncPracticeAnswersToGrading() {
    if (!state.currentQuestions.length) {
      setModelStatus("当前还没有练习题，请先生成或导入练习。", "warn");
      return;
    }
    $("answerInput").value = $("practiceAnswerInput").value;
    updateAnswerReviewFromText("practice-sync");
    switchTab("grading");
    setModelStatus("同步出题页答案已同步到拍照批改页。", "ok");
  }

  function previewAnswerImage(event) {
    const file = event.target.files && event.target.files[0];
    const preview = $("answerPreview");
    if (!file) {
      preview.style.display = "none";
      preview.removeAttribute("src");
      setOcrStatus("请先上传答题照片；如需真实 OCR，请保持 start_aiteacher_ocr.bat 正在运行。", "info");
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    setOcrStatus(`已选择图片：${file.name}。点击 OCR 识别会调用本机 PaddleOCR 服务。`, "ok");
  }

  async function runPaddleOcr() {
    const file = $("answerImage").files && $("answerImage").files[0];
    if (!file) {
      setOcrStatus("请先点击左侧上传答题照片，再点击 OCR 识别。", "warn");
      setModelStatus("请先上传答题照片，再点击 OCR 识别。", "warn");
      return;
    }

    if (!state.currentQuestions.length) {
      setOcrStatus("当前还没有同步练习题，会先识别图片文字；要自动判分，请先在“同步出题”页生成或导入练习。", "warn");
    }

    const button = $("runOcrBtn");
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "识别中...";
    state.ocrRecognizing = true;
    setOcrStatus("正在调用本机 PaddleOCR 服务。首次识别可能需要加载或下载模型，请稍等。", "busy");
    setModelStatus("正在调用本机 PaddleOCR 服务，识别结果会先进入人工校正面板。", "busy");

    try {
      const result = await requestLocalOcr(file);
      applyOcrResult(result);
    } catch (error) {
      const message = formatOcrError(error);
      setOcrStatus(message, "error");
      setModelStatus(message, "error");
    } finally {
      state.ocrRecognizing = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function requestLocalOcr(file) {
    const image = await readFileAsDataUrl(file);
    const endpoint = `${ocrProxyBaseUrl.replace(/\/+$/, "")}/ocr`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image,
        expectedQuestionCount: state.currentQuestions.length,
        mode: "answer-sheet"
      })
    });
    const payload = await safeReadJson(response);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `OCR 服务返回 ${response.status}`);
    }
    return payload;
  }

  async function safeReadJson(response) {
    try {
      return await response.json();
    } catch (error) {
      return { error: "OCR 服务返回内容不是 JSON。" };
    }
  }

  function applyOcrResult(result) {
    const normalized = normalizeOcrResult(result);
    state.lastOcrResult = normalized;
    const answerText = normalized.answersText || normalized.rawText || "";
    state.lastOcrText = answerText;
    $("answerInput").value = answerText;
    $("practiceAnswerInput").value = answerText;
    state.answerReview = parseAnswerReview(answerText, "paddleocr", normalized);
    renderAnswerReviewPanel(state.answerReview);

    const summary = normalized.summary || {};
    const answeredCount = summary.answerCount || state.answerReview.entries.filter((entry) => entry.answer).length;
    const lowConfidence = summary.lowConfidenceCount || state.answerReview.summary.lowConfidenceCount || 0;
    const lineCount = summary.lineCount || normalized.lines.length;
    let message = `OCR 识别完成：${answeredCount || lineCount} 条结果，低置信度 ${lowConfidence} 个。`;
    if (!answerText) {
      message = "OCR 服务已返回，但没有识别出可用文本。请换一张更清晰、光线更均匀的答题照片。";
    } else if (!state.currentQuestions.length) {
      message += " 当前还没有同步练习题，已先把识别文本填入校正区；生成或导入练习后再判分。";
    } else {
      message += " 请在校正区确认后点击“判分并生成解析”。";
    }
    setOcrStatus(message, answerText ? (lowConfidence ? "warn" : "ok") : "warn");
    setModelStatus(message, answerText ? (lowConfidence ? "warn" : "ok") : "warn");
  }

  function normalizeOcrResult(result) {
    const answerItems = Array.isArray(result?.answerItems) ? result.answerItems.map((item) => ({
      questionNo: Number(item.questionNo),
      answer: cleanText(item.answer),
      confidence: Number(item.confidence),
      rawLine: cleanText(item.rawLine),
      source: item.source || "paddleocr"
    })).filter((item) => Number.isFinite(item.questionNo) && item.answer) : [];
    const lines = Array.isArray(result?.lines) ? result.lines.map((line) => ({
      text: cleanText(line.text),
      confidence: Number(line.confidence),
      box: line.box || null
    })).filter((line) => line.text) : [];
    return {
      provider: result?.provider || "paddleocr",
      modelProfile: result?.modelProfile || "local",
      elapsedMs: result?.elapsedMs || 0,
      rawText: cleanMultilineText(result?.rawText || lines.map((line) => line.text).join("\n")),
      answersText: cleanMultilineText(result?.answersText || answerItems.map((item) => `${item.questionNo}. ${item.answer}`).join("\n")),
      lines,
      answerItems,
      summary: result?.summary || {
        lineCount: lines.length,
        answerCount: answerItems.length,
        lowConfidenceCount: answerItems.filter((item) => item.confidence < 0.7).length
      }
    };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("读取答题照片失败。"));
      reader.readAsDataURL(file);
    });
  }

  function simulateOcr() {
    if (!state.currentQuestions.length) {
      setModelStatus("当前还没有练习题，请先导入历史练习或点击 AI 生成练习。", "warn");
      return;
    }
    const lines = state.currentQuestions.map((question, index) => {
      const shouldMiss = index % 4 === 2;
      const answer = shouldMiss ? makeNearbyWrongAnswer(question.answer, index) : question.answer;
      return `${index + 1}. ${answer}`;
    });
    $("answerInput").value = lines.join("\n");
    $("practiceAnswerInput").value = lines.join("\n");
    updateAnswerReviewFromText("mock-ocr");
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
    gradeCurrentAnswers($("answerInput").value, { origin: "grading" });
  }

  function gradePracticeAnswers() {
    gradeCurrentAnswers($("practiceAnswerInput").value, { origin: "practice" });
  }

  function gradeCurrentAnswers(answerText, options = {}) {
    if (!state.currentQuestions.length) {
      setModelStatus("当前还没有可判分的练习题，请先生成或导入练习。", "warn");
      return;
    }
    state.currentQuestions = prepareQuestionsForPaper(state.currentQuestions, unitData(), state.currentQuestions.length).questions;
    const ocrResult = (answerText || "") === state.lastOcrText ? state.lastOcrResult : null;
    const answerReview = parseAnswerReview(answerText || "", options.origin === "grading" ? "manual-correction" : "practice-input", ocrResult);
    state.answerReview = answerReview;
    const answers = answerReview.answers;
    const results = state.currentQuestions.map((question, index) => {
      const reviewEntry = answerReview.entries[index] || {};
      const submitted = answers[index + 1] || "";
      const correct = isCorrectAnswer(submitted, question.answer);
      return {
        question,
        index,
        submitted,
        answerConfidence: reviewEntry.confidence || 0,
        answerReviewStatus: reviewEntry.status || "missing",
        correct,
        score: correct ? question.point : 0
      };
    });
    const summary = buildScoreSummary(results);
    state.gradingResults = results;
    $("answerInput").value = answerText || "";
    $("practiceAnswerInput").value = answerText || "";
    saveScoreHistory(summary, results);
    saveMistakesFromResults(results);
    renderAnswerReviewPanel(answerReview);
    renderGradingResults(results, summary);
    renderPracticeGradingResults(results, summary);
    renderMistakes();
    renderScoreTrends();
    renderMetrics();
    setModelStatus(options.origin === "practice" ? "同步练习已判分，解析已同步到拍照批改页。" : "答案已判分并生成解析。", "ok");
  }

  function parseAnswers(text) {
    return parseAnswerReview(text, "manual").answers;
  }

  function buildEmptyAnswerReview() {
    return { entries: [], answers: {}, summary: { averageConfidence: 0, lowConfidenceCount: 0, missingCount: 0 } };
  }

  function updateAnswerReviewFromText(source) {
    if (source !== "paddleocr") {
      state.lastOcrResult = null;
      state.lastOcrText = "";
    }
    state.answerReview = parseAnswerReview($("answerInput").value || "", source);
    renderAnswerReviewPanel();
  }

  function parseAnswerReview(text, source = "manual", ocrResult = null) {
    const answers = {};
    const fallback = [];
    const lineMeta = {};
    const ocrHints = buildOcrHints(ocrResult);
    String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const match = line.match(/^(\d+)\s*[\.、:：=]?\s*(.+)$/);
        if (match) {
          const questionNo = Number(match[1]);
          const hint = ocrHints.byQuestionNo[questionNo] || ocrHints.byRawLine[line] || {};
          answers[questionNo] = match[2].trim();
          lineMeta[questionNo] = {
            rawLine: line,
            source: hint.source || (source === "mock-ocr" ? "mock-ocr" : source),
            explicitNo: true,
            ocrConfidence: hint.confidence
          };
        } else {
          fallback.push(line);
        }
      });
    fallback.forEach((value, index) => {
      if (!answers[index + 1]) {
        const hint = ocrHints.byQuestionNo[index + 1] || ocrHints.byRawLine[value] || {};
        answers[index + 1] = value;
        lineMeta[index + 1] = {
          rawLine: value,
          source: hint.source || source,
          explicitNo: false,
          ocrConfidence: hint.confidence
        };
      }
    });
    const entries = state.currentQuestions.map((question, index) => {
      const questionNo = index + 1;
      const answer = cleanText(answers[questionNo] || "");
      const meta = lineMeta[questionNo] || { rawLine: "", source, explicitNo: false };
      const confidence = estimateAnswerConfidence(answer, meta, question);
      return {
        questionNo,
        knowledgePoint: question.knowledgePoint,
        answer,
        rawLine: meta.rawLine,
        source: meta.source,
        confidence,
        status: !answer ? "missing" : confidence < 0.7 ? "needs_review" : "ready"
      };
    });
    const answered = entries.filter((entry) => entry.answer);
    const averageConfidence = answered.length ? Math.round(answered.reduce((sum, entry) => sum + entry.confidence, 0) / answered.length * 100) : 0;
    return {
      answers,
      entries,
      summary: {
        averageConfidence,
        lowConfidenceCount: entries.filter((entry) => entry.answer && entry.confidence < 0.7).length,
        missingCount: entries.filter((entry) => !entry.answer).length
      }
    };
  }

  function buildOcrHints(ocrResult) {
    const byQuestionNo = {};
    const byRawLine = {};
    if (!ocrResult) return { byQuestionNo, byRawLine };
    (ocrResult.answerItems || []).forEach((item) => {
      const questionNo = Number(item.questionNo);
      const confidence = Number(item.confidence);
      const hint = {
        confidence: Number.isFinite(confidence) ? confidence : undefined,
        source: item.source || "paddleocr"
      };
      if (Number.isFinite(questionNo)) byQuestionNo[questionNo] = hint;
      if (item.rawLine) byRawLine[item.rawLine] = hint;
      if (item.answer && Number.isFinite(questionNo)) byRawLine[questionNo + ". " + item.answer] = hint;
    });
    (ocrResult.lines || []).forEach((line) => {
      const confidence = Number(line.confidence);
      if (line.text) byRawLine[line.text] = {
        confidence: Number.isFinite(confidence) ? confidence : undefined,
        source: "paddleocr"
      };
    });
    return { byQuestionNo, byRawLine };
  }
  function estimateAnswerConfidence(answer, meta, question) {
    if (!answer) return 0;
    const ocrConfidence = Number(meta.ocrConfidence);
    let confidence = Number.isFinite(ocrConfidence) && ocrConfidence > 0
      ? (ocrConfidence * 0.75) + ((meta.explicitNo ? 0.92 : 0.72) * 0.25)
      : meta.explicitNo ? 0.92 : 0.72;
    if (meta.source === "mock-ocr") confidence -= 0.08;
    if (meta.source === "paddleocr" && !meta.explicitNo) confidence -= 0.08;
    if (/疑似|不清|\?|？|漏写/.test(answer)) confidence -= 0.22;
    if (question?.questionType?.includes("选择") && /^[A-Da-d]$/.test(answer.trim())) confidence += 0.05;
    if (Number.isFinite(parseNumberLike(answer))) confidence += 0.04;
    return Math.max(0.35, Math.min(0.99, Number(confidence.toFixed(2))));
  }

  function renderAnswerReviewPanel(review = state.answerReview) {
    const panel = $("ocrReviewPanel");
    if (!panel) return;
    const entries = review?.entries || [];
    if (!entries.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    const summary = review.summary || {};
    panel.innerHTML =
      "<div class=\"ocr-review-head\"><strong>结构化题号与答案校正</strong><span>平均置信度 " +
      (summary.averageConfidence || 0) + "% · 低置信 " + (summary.lowConfidenceCount || 0) + " · 未作答 " + (summary.missingCount || 0) +
      "</span></div><div class=\"ocr-review-table\">" +
      entries.map((entry) =>
        "<div class=\"ocr-review-row " + entry.status + "\"><span>" + entry.questionNo + "</span><strong>" +
        escapeHtml(entry.answer || "未作答") + "</strong><em>" + Math.round((entry.confidence || 0) * 100) + "%</em><small>" +
        escapeHtml(answerReviewStatusLabel(entry.status)) + "</small></div>"
      ).join("") + "</div>";
  }

  function answerReviewStatusLabel(status) {
    const labels = { ready: "可判分", needs_review: "需人工确认", missing: "未作答" };
    return labels[status] || "需人工确认";
  }
  function isCorrectAnswer(submitted, expected) {
    if (ruleEngine.isCorrectAnswer) return ruleEngine.isCorrectAnswer(submitted, expected);
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
    if (ruleEngine.normalizeAnswer) return ruleEngine.normalizeAnswer(value);
    return String(value)
      .replace(/\s+/g, "")
      .replace(/[，。；;]/g, "")
      .replace(/：/g, ":")
      .replace(/＝/g, "=")
      .replace(/厘米|平方厘米|立方厘米|cm|cm²|cm³/g, "")
      .toLowerCase();
  }

  function parseNumberLike(value) {
    if (ruleEngine.parseNumberLike) return ruleEngine.parseNumberLike(value);
    const text = normalizeAnswer(value).replace(/^x=/, "");
    if (/^-?\d+(\.\d+)?%$/.test(text)) return Number(text.replace("%", "")) / 100;
    const fraction = text.match(/^(-?\d+)\/(\d+)$/);
    if (fraction) return Number(fraction[1]) / Number(fraction[2]);
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return Number.NaN;
  }

  function renderGradingResults(results, summary = buildScoreSummary(results)) {
    $("gradingSummary").classList.add("active");
    $("gradingSummary").innerHTML = renderScoreSummaryHtml(results, summary);
    renderPerformanceFeedback(summary, results);
    $("gradingResults").innerHTML = renderResultCardsHtml(results);
  }

  function renderPracticeGradingResults(results, summary = buildScoreSummary(results)) {
    $("practiceGradingSummary").classList.add("active");
    $("practiceGradingSummary").innerHTML = renderScoreSummaryHtml(results, summary);
    $("practiceResults").innerHTML = renderResultCardsHtml(results);
  }

  function renderScoreSummaryHtml(results, summary) {
    return `
      <div><strong>${summary.score}/${summary.total}</strong><span>总分</span></div>
      <div><strong>${summary.accuracy}%</strong><span>正确率</span></div>
      <div><strong>${summary.correctCount}</strong><span>答对题数</span></div>
      <div><strong>${results.length - summary.correctCount}</strong><span>错题数</span></div>
    `;
  }

  function renderResultCardsHtml(results) {
    return results
      .map((item) => {
        const { question } = item;
        return `
          <article class="result-card ${item.correct ? "" : "wrong"}">
            <h4>${item.index + 1}. ${renderStemContent(question.stem)}</h4>
            <div class="question-meta">
              <span class="pill ${item.correct ? "green" : "red"}">${item.correct ? "正确" : "需复习"}</span>
              <span class="pill blue">${escapeHtml(question.knowledgePoint)}</span>
              <span class="pill green">${escapeHtml(question.questionType || "同步练习")}</span>
              <span class="pill">${item.score}/${question.point} 分</span>
            </div>
            <p class="source-note">知识点来源：${renderSourceLinks(question.sourceRefs || getSourceRefs(unitData()))}</p>
            <p><strong>学生答案：</strong>${escapeHtml(item.submitted || "未作答")}</p>
            <p><strong>校正状态：</strong>${Math.round((item.answerConfidence || 0) * 100)}% · ${escapeHtml(answerReviewStatusLabel(item.answerReviewStatus || "missing"))}</p>
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
            <p>接下来可以减少重复基础题，增加变式题和综合标准题，保持手感。</p>
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
    const last = storage.getString(feedbackPhraseKey, "");
    const candidates = phrases.filter((phrase) => phrase !== last);
    const picked = candidates[Math.floor(Math.random() * candidates.length)] || phrases[0];
    storage.setString(feedbackPhraseKey, picked);
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
    renderMistakeStats(activeMistakes);
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
            <h4>${renderStemContent(item.stem)}</h4>
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
              <button class="secondary-btn small" data-action="delete" data-id="${item.id}">移除错题</button>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderMistakeStats(activeMistakes) {
    const completedCount = state.scoreHistory.reduce((sum, record) => sum + (Number(record.questionCount) || 0), 0);
    const masteredCount = state.mistakes.filter((item) => item.status === "已掌握").length;
    $("mistakeStats").innerHTML = `
      <article><strong>${completedCount}</strong><span>已完成题目</span></article>
      <article><strong>${activeMistakes.length}</strong><span>错题数量</span></article>
      <article><strong>${masteredCount}</strong><span>已掌握错题</span></article>
    `;
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
    const targetCount = capQuestionCount(state.questionCount);
    const activeMistakes = shuffle(currentUnitMistakes()).slice(0, targetCount);
    if (!activeMistakes.length) {
      switchTab("mistakes");
      return;
    }
    const mistakeQuestions = activeMistakes.map((item, index) => ({
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
    }));
    const newQuestions = generateScopedQuestions(unitData(), Number(state.grade), state.difficulty, targetCount);
    state.currentQuestions = prepareQuestionsForPaper([...mistakeQuestions, ...newQuestions], unitData(), targetCount).questions;
    state.answersVisible = false;
    seedAnswerInputsWithTemplate();
    switchTab("practice");
    renderAll();
  }

  function restoreScheduleControls() {
    $("frequencySelect").value = state.schedule.frequency;
    state.schedule.count = capQuestionCount(state.schedule.count);
    $("scheduledCount").value = state.schedule.count;
    $("mistakeRatio").value = state.schedule.mistakeRatio;
    $("mistakeRatioLabel").textContent = `${state.schedule.mistakeRatio}%`;
  }

  function saveSchedule() {
    state.schedule = {
      frequency: $("frequencySelect").value,
      count: capQuestionCount($("scheduledCount").value),
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
    const count = capQuestionCount(state.schedule.count);
    const mistakeCount = Math.round((count * state.schedule.mistakeRatio) / 100);
    const activeMistakes = shuffle(currentUnitMistakes()).slice(0, mistakeCount);
    const newQuestions = generateScopedQuestions(unitData(), Number(state.grade), state.difficulty, count);
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
    state.currentQuestions = prepareQuestionsForPaper(shuffle([...mistakeQuestions, ...newQuestions]), unitData(), count).questions;
    seedAnswerInputsWithTemplate();
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

  function formatDateTime(value) {
    if (!value) return "未知";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function sourceNames(sourceRefs) {
    return sourceRefs.map((source) => source.name).join("、");
  }

  init();
})();

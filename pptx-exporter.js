(function initAITeacherPptxExporter(global) {
  "use strict";

  const PLAN_SCHEMA_VERSION = 1;
  const PPTX_EXPORT_VERSION = "pptx-v1";
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;
  const EMU_PER_INCH = 914400;
  const XMLNS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const THEME = {
    ink: "172033",
    muted: "64748B",
    line: "D8E1EF",
    paper: "FFFFFF",
    soft: "F8FAFC",
    teal: "0F766E",
    blue: "2563EB",
    amber: "F59E0B",
    green: "16A34A",
    red: "DC2626"
  };

  function buildPptPlan(context) {
    const slides = Array.isArray(context.slides) ? context.slides : [];
    const points = Array.isArray(context.knowledgePoints) ? context.knowledgePoints : [];
    const sources = normalizeSources(context.sources);
    const pages = [
      {
        type: "cover",
        layout: "cover",
        title: `${context.gradeName || ""}${context.volumeName || ""} ${context.unitTitle || "知识点课件"}`.trim(),
        subtitle: "小学数学同步知识点课件",
        body: context.unitSummary || "",
        bullets: [
          `教材版本：${context.textbookVersion || "人教版"}`,
          `审核状态：${context.reviewStatusLabel || "待审核"}`,
          `知识点数量：${points.length || 0}`
        ],
        visualKind: "cover"
      },
      ...slides.map((slide, index) => buildPageFromSlide(slide, index, context)),
      {
        type: "summary",
        layout: "summary",
        title: "小结与练习建议",
        subtitle: context.unitTitle || "",
        body: points.length ? `本单元知识点：${points.join("、")}` : "回到知识点，用一道标准题检查是否真正理解。",
        bullets: points.slice(0, 5).map((point) => `复盘：${point}`),
        visualKind: "summary"
      }
    ];

    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      exportVersion: PPTX_EXPORT_VERSION,
      kind: "ppt_plan",
      theme: "math-clean",
      title: `${context.gradeName || ""}${context.volumeName || ""}-${context.unitTitle || "课件"}`.trim(),
      subtitle: "AI Teacher PPT 制作 Agent 本地渲染",
      createdAt: new Date().toISOString(),
      reviewStatus: context.reviewStatus || "draft",
      reviewStatusLabel: context.reviewStatusLabel || "待审核",
      pages,
      sources
    };
  }

  function buildPageFromSlide(slide, index, context) {
    const visualData = normalizeVisualData(slide.visualData);
    const layout = pickLayout(slide, index);
    return {
      type: slide.visualType || "content",
      layout,
      title: cleanText(slide.title) || `第 ${index + 1} 页`,
      subtitle: context.unitTitle || "",
      body: cleanText(slide.body),
      bullets: cleanTextList(slide.bullets).slice(0, 5),
      visualKind: visualData?.kind || slide.visualType || "concept",
      visualData,
      sources: normalizeSources(slide.sources).length ? normalizeSources(slide.sources) : normalizeSources(context.sources)
    };
  }

  function pickLayout(slide, index) {
    if (slide.visualType === "goals") return "goals";
    if (slide.visualType === "summary") return "summary";
    if (slide.visualType === "practice") return "practice";
    if (slide.visualType === "scenario" || slide.visualData) return index % 2 ? "visual-right" : "visual-left";
    return "concept";
  }

  function normalizePptPlan(candidate, fallbackPlan, context = {}) {
    const fallback = fallbackPlan || buildPptPlan(context);
    const rawPages = Array.isArray(candidate?.pages) && candidate.pages.length ? candidate.pages : fallback.pages;
    const pages = rawPages.slice(0, 12).map((page, index) => {
      const fallbackPage = fallback.pages[index] || fallback.pages[Math.min(index, fallback.pages.length - 1)] || {};
      const layout = ["cover", "goals", "visual-left", "visual-right", "concept", "practice", "summary"].includes(page?.layout)
        ? page.layout
        : fallbackPage.layout || "concept";
      const visualData = normalizeVisualData(page?.visualData) || fallbackPage.visualData || null;
      return {
        type: cleanText(page?.type) || fallbackPage.type || "content",
        layout,
        title: cleanText(page?.title) || fallbackPage.title || `第 ${index + 1} 页`,
        subtitle: cleanText(page?.subtitle) || fallbackPage.subtitle || "",
        body: cleanText(page?.body).slice(0, 180) || fallbackPage.body || "",
        bullets: cleanTextList(page?.bullets).slice(0, 5).length ? cleanTextList(page.bullets).slice(0, 5) : fallbackPage.bullets || [],
        visualKind: cleanText(page?.visualKind) || visualData?.kind || fallbackPage.visualKind || "concept",
        ...(visualData ? { visualData } : {}),
        sources: normalizeSources(page?.sources).length ? normalizeSources(page.sources) : fallbackPage.sources || fallback.sources || []
      };
    });
    const expectedPoints = Array.isArray(context.knowledgePoints) ? context.knowledgePoints.filter(Boolean) : [];
    const allText = pages.map((page) => [page.title, page.subtitle, page.body, ...(page.bullets || [])].join(" ")).join(" ");
    const missingPoints = expectedPoints.filter((point) => !allText.includes(point));
    if (missingPoints.length && pages.length) {
      const target = pages.find((page) => page.layout === "summary") || pages[pages.length - 1];
      target.body = [target.body, `知识点补充：${missingPoints.join("、")}`].filter(Boolean).join(" ");
    }

    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      exportVersion: PPTX_EXPORT_VERSION,
      kind: "ppt_plan",
      theme: cleanText(candidate?.theme) || fallback.theme || "math-clean",
      title: cleanText(candidate?.title) || fallback.title,
      subtitle: cleanText(candidate?.subtitle) || fallback.subtitle,
      createdAt: cleanText(candidate?.createdAt) || new Date().toISOString(),
      reviewStatus: cleanText(candidate?.reviewStatus) || fallback.reviewStatus || "draft",
      reviewStatusLabel: cleanText(candidate?.reviewStatusLabel) || fallback.reviewStatusLabel || "待审核",
      pages,
      sources: normalizeSources(candidate?.sources).length ? normalizeSources(candidate.sources) : fallback.sources || []
    };
  }

  function validatePptPlan(plan, expectedPoints = []) {
    const issues = [];
    if (!plan || typeof plan !== "object") issues.push("PPT 方案为空");
    const pages = Array.isArray(plan?.pages) ? plan.pages : [];
    if (!pages.length) issues.push("PPT 方案没有页面");
    pages.forEach((page, index) => {
      if (!cleanText(page.title)) issues.push(`第 ${index + 1} 页缺少标题`);
      if ((cleanText(page.body).length + cleanTextList(page.bullets).join("").length) > 420) issues.push(`第 ${index + 1} 页文字过多`);
    });
    const allText = pages.map((page) => [page.title, page.subtitle, page.body, ...(page.bullets || [])].join(" ")).join(" ");
    expectedPoints.forEach((point) => {
      if (point && !allText.includes(point)) issues.push(`未覆盖知识点：${point}`);
    });
    if (!normalizeSources(plan?.sources).length && !pages.some((page) => normalizeSources(page.sources).length)) issues.push("PPT 缺少来源说明");
    return { ok: issues.length === 0, issues };
  }

  function downloadPptx(plan, filename) {
    const bytes = createPptxPackage(plan);
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function createPptxPackage(plan) {
    const safePlan = normalizePptPlan(plan, buildPptPlan({ slides: [], sources: [] }));
    const pages = safePlan.pages.length ? safePlan.pages : buildPptPlan({ slides: [], sources: [] }).pages;
    const files = [];
    files.push(["[Content_Types].xml", contentTypesXml(pages.length)]);
    files.push(["_rels/.rels", rootRelsXml()]);
    files.push(["docProps/app.xml", appPropsXml(pages.length)]);
    files.push(["docProps/core.xml", corePropsXml(safePlan)]);
    files.push(["ppt/presentation.xml", presentationXml(pages.length)]);
    files.push(["ppt/_rels/presentation.xml.rels", presentationRelsXml(pages.length)]);
    files.push(["ppt/theme/theme1.xml", themeXml()]);
    files.push(["ppt/slideMasters/slideMaster1.xml", slideMasterXml()]);
    files.push(["ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRelsXml()]);
    files.push(["ppt/slideLayouts/slideLayout1.xml", slideLayoutXml()]);
    files.push(["ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRelsXml()]);
    pages.forEach((page, index) => {
      files.push([`ppt/slides/slide${index + 1}.xml`, slideXml(page, index, safePlan)]);
      files.push([`ppt/slides/_rels/slide${index + 1}.xml.rels`, slideRelsXml()]);
    });
    return zipStore(files);
  }

  function slideXml(page, index, plan) {
    const ctx = { nextId: 1 };
    const shapes = [
      rect(ctx, 0, 0, SLIDE_W, SLIDE_H, THEME.soft, THEME.soft),
      rect(ctx, 0, 0, 0.16, SLIDE_H, index % 2 ? THEME.blue : THEME.teal, index % 2 ? THEME.blue : THEME.teal),
      footer(ctx, page, plan)
    ];

    if (page.layout === "cover") shapes.push(...renderCover(ctx, page, plan));
    else if (page.layout === "goals") shapes.push(...renderGoals(ctx, page));
    else if (page.layout === "summary") shapes.push(...renderSummary(ctx, page));
    else if (page.layout === "practice") shapes.push(...renderPractice(ctx, page));
    else if (page.layout === "visual-left") shapes.push(...renderContentWithVisual(ctx, page, true));
    else if (page.layout === "visual-right") shapes.push(...renderContentWithVisual(ctx, page, false));
    else shapes.push(...renderConcept(ctx, page));

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${XMLNS}>
  <p:cSld>
    <p:spTree>
      ${groupShapeXml()}
      ${shapes.join("\n")}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
  }

  function renderCover(ctx, page, plan) {
    return [
      rect(ctx, 0.7, 0.55, 11.95, 6.15, THEME.paper, THEME.line),
      rect(ctx, 0.95, 0.85, 2.4, 0.18, THEME.amber, THEME.amber),
      textBox(ctx, 1.0, 1.25, 8.9, 1.0, page.title, { size: 34, bold: true, color: THEME.ink }),
      textBox(ctx, 1.05, 2.18, 6.7, 0.45, page.subtitle || plan.subtitle, { size: 16, color: THEME.teal, bold: true }),
      textBox(ctx, 1.05, 2.95, 6.9, 1.0, page.body, { size: 15, color: THEME.muted }),
      ...pillStack(ctx, 1.05, 4.25, page.bullets || []),
      mathCoverVisual(ctx, 8.35, 2.1, 3.45, 2.85),
      textBox(ctx, 8.2, 5.35, 3.75, 0.36, "结构化生成 · 本地导出 · 可审核", { size: 12, color: THEME.muted, align: "center" })
    ];
  }

  function renderGoals(ctx, page) {
    const bullets = page.bullets || [];
    return [
      textBox(ctx, 0.85, 0.55, 7.4, 0.55, page.title, { size: 25, bold: true, color: THEME.ink }),
      textBox(ctx, 0.88, 1.18, 6.8, 0.42, page.body, { size: 13, color: THEME.muted }),
      ...bullets.slice(0, 3).flatMap((item, index) => {
        const x = 1.0 + index * 3.85;
        return [
          rect(ctx, x, 2.2, 2.95, 2.0, index === 1 ? "EFF6FF" : "ECFDF5", index === 1 ? THEME.blue : THEME.teal),
          textBox(ctx, x + 0.28, 2.52, 2.36, 0.5, `目标 ${index + 1}`, { size: 14, bold: true, color: index === 1 ? THEME.blue : THEME.teal, align: "center" }),
          textBox(ctx, x + 0.26, 3.08, 2.4, 0.72, item, { size: 13, color: THEME.ink, align: "center" })
        ];
      }),
      flowDots(ctx, 1.25, 5.2, ["观察", "表达", "验证", "应用"])
    ];
  }

  function renderConcept(ctx, page) {
    return [
      textBox(ctx, 0.85, 0.55, 7.8, 0.55, page.title, { size: 25, bold: true, color: THEME.ink }),
      textBox(ctx, 0.88, 1.18, 7.2, 0.6, page.body, { size: 13, color: THEME.muted }),
      ...bulletList(ctx, 0.95, 2.05, 7.5, page.bullets || []),
      flowDots(ctx, 8.4, 2.2, ["条件", "关系", "算式", "结果"], true)
    ];
  }

  function renderContentWithVisual(ctx, page, visualLeft) {
    const visualX = visualLeft ? 0.85 : 7.15;
    const textX = visualLeft ? 7.05 : 0.85;
    return [
      textBox(ctx, textX, 0.55, 5.35, 0.52, page.title, { size: 22, bold: true, color: THEME.ink }),
      textBox(ctx, textX, 1.15, 5.0, 0.72, page.body, { size: 13, color: THEME.muted }),
      ...bulletList(ctx, textX, 2.06, 5.1, page.bullets || []),
      ...renderVisual(ctx, page, visualX, 1.05, 5.35, 4.85)
    ];
  }

  function renderPractice(ctx, page) {
    return [
      textBox(ctx, 0.85, 0.55, 7.4, 0.55, page.title, { size: 25, bold: true, color: THEME.ink }),
      textBox(ctx, 0.88, 1.18, 7.2, 0.45, page.body, { size: 13, color: THEME.muted }),
      ...["基础题", "变式题", "应用题"].flatMap((label, index) => {
        const x = 1.05 + index * 3.75;
        return [
          rect(ctx, x, 2.0 + index * 0.35, 2.8, 1.35, index === 0 ? "ECFDF5" : index === 1 ? "EFF6FF" : "FFF7ED", index === 0 ? THEME.teal : index === 1 ? THEME.blue : THEME.amber),
          textBox(ctx, x + 0.22, 2.25 + index * 0.35, 2.36, 0.35, label, { size: 15, bold: true, color: index === 2 ? "92400E" : THEME.ink, align: "center" }),
          textBox(ctx, x + 0.25, 2.72 + index * 0.35, 2.3, 0.32, (page.bullets || [])[index] || "围绕当前知识点练习", { size: 11, color: THEME.muted, align: "center" })
        ];
      }),
      flowDots(ctx, 2.4, 5.58, ["做题", "判分", "解析", "错因"])
    ];
  }

  function renderSummary(ctx, page) {
    return [
      textBox(ctx, 0.85, 0.55, 8.4, 0.55, page.title, { size: 25, bold: true, color: THEME.ink }),
      textBox(ctx, 0.88, 1.18, 7.2, 0.5, page.body, { size: 13, color: THEME.muted }),
      ...bulletList(ctx, 0.95, 2.0, 6.1, page.bullets || []),
      ...cycleVisual(ctx, 8.15, 1.75)
    ];
  }

  function renderVisual(ctx, page, x, y, w, h) {
    const data = normalizeVisualData(page.visualData);
    if (data?.kind === "stationery") return stationeryVisual(ctx, data, x, y, w, h);
    if (data?.kind === "share") return shareVisual(ctx, data, x, y, w, h);
    if (data?.kind === "quantity") return quantityVisual(ctx, data, x, y, w, h);
    return genericVisual(ctx, page, x, y, w, h);
  }

  function stationeryVisual(ctx, data, x, y, w, h) {
    const shapes = [rect(ctx, x, y, w, h, "FFFFFF", THEME.line), textBox(ctx, x + 0.25, y + 0.25, w - 0.5, 0.36, data.title || "图解数量关系", { size: 14, bold: true, color: THEME.teal, align: "center" })];
    let cursor = x + 0.52;
    (data.items || []).slice(0, 3).forEach((item, itemIndex) => {
      if (itemIndex) {
        shapes.push(textBox(ctx, cursor - 0.12, y + 2.18, 0.25, 0.35, "+", { size: 18, bold: true, color: THEME.teal, align: "center" }));
        cursor += 0.25;
      }
      const count = clampInt(item.count || 1, 1, 4);
      for (let index = 0; index < count; index += 1) {
        shapes.push(rect(ctx, cursor, y + 1.45, 0.52, 0.75, item.type === "pen" ? "FED7AA" : "DBEAFE", item.type === "pen" ? THEME.amber : THEME.blue));
        shapes.push(textBox(ctx, cursor - 0.08, y + 2.28, 0.68, 0.25, item.priceLabel || item.label || "", { size: 8, color: THEME.ink, align: "center" }));
        cursor += 0.62;
      }
    });
    shapes.push(textBox(ctx, cursor + 0.05, y + 2.08, 0.28, 0.35, "=", { size: 18, bold: true, color: THEME.teal, align: "center" }));
    shapes.push(rect(ctx, cursor + 0.45, y + 1.8, Math.max(1.2, w - (cursor - x) - 0.8), 0.62, "ECFDF5", THEME.teal));
    shapes.push(textBox(ctx, cursor + 0.52, y + 1.94, Math.max(1.0, w - (cursor - x) - 0.95), 0.28, data.expression || "列式", { size: 12, bold: true, color: THEME.teal, align: "center" }));
    shapes.push(textBox(ctx, x + 0.45, y + h - 0.85, w - 0.9, 0.45, data.caption || "先看相同物品，再合并其他条件。", { size: 11, color: THEME.muted, align: "center" }));
    return shapes;
  }

  function shareVisual(ctx, data, x, y, w, h) {
    const total = clampInt(data.total || 24, 1, 999);
    const done = clampInt(data.done || 8, 0, total);
    const remain = clampInt(data.remain ?? (total - done), 0, total);
    const groups = clampInt(data.groups || 4, 1, 6);
    const doneW = Math.max(0.5, (w - 0.9) * (done / total));
    const remainW = Math.max(0.5, (w - 0.9) - doneW);
    const shapes = [rect(ctx, x, y, w, h, "FFFFFF", THEME.line), textBox(ctx, x + 0.25, y + 0.25, w - 0.5, 0.36, data.title || "图解平均分", { size: 14, bold: true, color: THEME.teal, align: "center" })];
    shapes.push(rect(ctx, x + 0.45, y + 1.25, doneW, 0.58, "BFDBFE", THEME.blue));
    shapes.push(rect(ctx, x + 0.45 + doneW, y + 1.25, remainW, 0.58, "DCFCE7", THEME.green));
    shapes.push(textBox(ctx, x + 0.48, y + 1.39, doneW - 0.08, 0.25, `已知 ${done}`, { size: 10, bold: true, color: THEME.ink, align: "center" }));
    shapes.push(textBox(ctx, x + 0.48 + doneW, y + 1.39, remainW - 0.08, 0.25, `剩余 ${remain}`, { size: 10, bold: true, color: THEME.ink, align: "center" }));
    const boxW = (w - 0.9 - (groups - 1) * 0.12) / groups;
    for (let index = 0; index < groups; index += 1) {
      const bx = x + 0.45 + index * (boxW + 0.12);
      shapes.push(rect(ctx, bx, y + 2.38, boxW, 0.72, "F0FDF4", THEME.green));
      shapes.push(textBox(ctx, bx + 0.06, y + 2.58, boxW - 0.12, 0.25, `${data.each || trimNumber(remain / groups)}${data.unitLabel || "份"}`, { size: 10, bold: true, color: "166534", align: "center" }));
    }
    shapes.push(textBox(ctx, x + 0.45, y + h - 0.85, w - 0.9, 0.45, data.caption || `先求剩余 ${total}-${done}=${remain}，再平均分。`, { size: 11, color: THEME.muted, align: "center" }));
    return shapes;
  }

  function quantityVisual(ctx, data, x, y, w, h) {
    const bars = Array.isArray(data.bars) && data.bars.length ? data.bars.slice(0, 4) : [
      { label: "已知部分", valueLabel: "?", width: 62 },
      { label: "剩余部分", valueLabel: "总量", width: 38 }
    ];
    const shapes = [rect(ctx, x, y, w, h, "FFFFFF", THEME.line), textBox(ctx, x + 0.25, y + 0.25, w - 0.5, 0.36, data.title || "图解数量关系", { size: 14, bold: true, color: THEME.teal, align: "center" })];
    bars.forEach((bar, index) => {
      const bw = (w - 1.45) * clampInt(bar.width || 55, 18, 100) / 100;
      const by = y + 1.25 + index * 0.78;
      shapes.push(rect(ctx, x + 0.55, by, bw, 0.42, index % 2 ? "DCFCE7" : "DBEAFE", index % 2 ? THEME.green : THEME.blue));
      shapes.push(textBox(ctx, x + 0.68, by + 0.09, Math.max(0.8, bw - 0.25), 0.2, bar.label || "部分", { size: 9, bold: true, color: THEME.ink, align: "center" }));
      shapes.push(textBox(ctx, x + w - 0.78, by + 0.06, 0.5, 0.26, bar.valueLabel || "?", { size: 12, bold: true, color: THEME.teal, align: "center" }));
    });
    shapes.push(textBox(ctx, x + 0.45, y + h - 0.85, w - 0.9, 0.45, data.caption || "把文字条件转成部分与整体关系。", { size: 11, color: THEME.muted, align: "center" }));
    return shapes;
  }

  function genericVisual(ctx, page, x, y, w, h) {
    return [
      rect(ctx, x, y, w, h, "FFFFFF", THEME.line),
      textBox(ctx, x + 0.3, y + 0.32, w - 0.6, 0.36, "图解思路", { size: 14, bold: true, color: THEME.teal, align: "center" }),
      ...flowDots(ctx, x + 0.72, y + 1.7, ["条件", "关系", "方法", "结果"], false, w - 1.45),
      textBox(ctx, x + 0.45, y + h - 0.85, w - 0.9, 0.45, "每一步都对应一个可检查的数学关系。", { size: 11, color: THEME.muted, align: "center" })
    ];
  }

  function mathCoverVisual(ctx, x, y, w, h) {
    return [
      rect(ctx, x, y, w, h, "ECFDF5", THEME.teal),
      textBox(ctx, x + 0.25, y + 0.28, w - 0.5, 0.32, "数量关系图", { size: 14, bold: true, color: THEME.teal, align: "center" }),
      rect(ctx, x + 0.55, y + 1.0, 0.7, 0.7, "DBEAFE", THEME.blue),
      rect(ctx, x + 1.42, y + 1.0, 0.7, 0.7, "DBEAFE", THEME.blue),
      rect(ctx, x + 2.3, y + 1.0, 0.7, 0.7, "FED7AA", THEME.amber),
      textBox(ctx, x + 0.64, y + 1.95, 2.35, 0.35, "图形先行，文字辅助", { size: 12, bold: true, color: THEME.ink, align: "center" })
    ];
  }

  function flowDots(ctx, x, y, labels, vertical = false, width = 8.6) {
    const shapes = [];
    labels.forEach((label, index) => {
      const px = vertical ? x : x + index * (width / Math.max(1, labels.length - 1));
      const py = vertical ? y + index * 0.88 : y;
      shapes.push(rect(ctx, px, py, 1.1, 0.52, index % 2 ? "EFF6FF" : "ECFDF5", index % 2 ? THEME.blue : THEME.teal));
      shapes.push(textBox(ctx, px + 0.08, py + 0.13, 0.94, 0.22, label, { size: 10, bold: true, color: THEME.ink, align: "center" }));
      if (index < labels.length - 1 && !vertical) shapes.push(textBox(ctx, px + 1.18, py + 0.12, 0.3, 0.2, "→", { size: 12, bold: true, color: THEME.muted, align: "center" }));
    });
    return shapes;
  }

  function cycleVisual(ctx, x, y) {
    return [
      rect(ctx, x, y, 3.55, 3.55, "FFFFFF", THEME.line),
      ...flowDots(ctx, x + 1.2, y + 0.55, ["学", "练", "批", "复"], true),
      textBox(ctx, x + 0.35, y + 3.02, 2.85, 0.3, "错题回到知识点复习", { size: 11, color: THEME.muted, align: "center" })
    ];
  }

  function pillStack(ctx, x, y, items) {
    return items.slice(0, 4).map((item, index) => [
      rect(ctx, x, y + index * 0.48, 4.85, 0.34, index % 2 ? "EFF6FF" : "ECFDF5", index % 2 ? THEME.blue : THEME.teal),
      textBox(ctx, x + 0.18, y + 0.075 + index * 0.48, 4.5, 0.18, item, { size: 10, color: THEME.ink })
    ]).flat();
  }

  function bulletList(ctx, x, y, w, bullets) {
    const safeBullets = (bullets || []).slice(0, 5);
    return [
      rect(ctx, x, y, w, Math.max(1.0, safeBullets.length * 0.56 + 0.28), "FFFFFF", THEME.line),
      ...safeBullets.map((item, index) => textBox(ctx, x + 0.28, y + 0.22 + index * 0.54, w - 0.55, 0.32, item, { size: 12, color: THEME.ink, bullet: true }))
    ];
  }

  function footer(ctx, page, plan) {
    const sourceText = sourceSummary(page.sources || plan.sources);
    return textBox(ctx, 0.82, 7.07, 11.7, 0.22, sourceText ? `来源：${sourceText}` : "本课件基于已审核知识点原创生成", { size: 8, color: THEME.muted });
  }

  function rect(ctx, x, y, w, h, fill, line = fill) {
    const id = ++ctx.nextId;
    return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln></p:spPr>
    </p:sp>`;
  }

  function textBox(ctx, x, y, w, h, text, options = {}) {
    const id = ++ctx.nextId;
    const paragraphs = String(text || "").split(/\n+/).filter(Boolean);
    const safeParagraphs = paragraphs.length ? paragraphs : [""];
    const align = options.align ? ` algn="${options.align === "center" ? "ctr" : options.align === "right" ? "r" : "l"}"` : "";
    return `<p:sp>
      <p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
      <p:txBody><a:bodyPr wrap="square" anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>
        ${safeParagraphs.map((line) => paragraphXml(line, options, align)).join("")}
      </p:txBody>
    </p:sp>`;
  }

  function paragraphXml(text, options, align) {
    const sz = Math.round((options.size || 12) * 100);
    const bold = options.bold ? ' b="1"' : "";
    const bullet = options.bullet ? '<a:buChar char="•"/>' : "";
    return `<a:p><a:pPr${align}>${bullet}</a:pPr><a:r><a:rPr lang="zh-CN" sz="${sz}"${bold}><a:solidFill><a:srgbClr val="${options.color || THEME.ink}"/></a:solidFill><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${sz}"/></a:p>`;
  }

  function groupShapeXml() {
    return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  }

  function contentTypesXml(slideCount) {
    const slideOverrides = Array.from({ length: slideCount }, (_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  ${slideOverrides}
</Types>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  }

  function presentationXml(slideCount) {
    const slides = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${XMLNS}>
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slides}</p:sldIdLst>
  <p:sldSz cx="${emu(SLIDE_W)}" cy="${emu(SLIDE_H)}" type="wide"/>
  <p:notesSz cx="${emu(7.5)}" cy="${emu(10)}"/>
  <p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`;
  }

  function presentationRelsXml(slideCount) {
    const slides = Array.from({ length: slideCount }, (_, index) => `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slides}
</Relationships>`;
  }

  function slideRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
  }

  function slideMasterRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
  }

  function slideLayoutRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
  }

  function slideMasterXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${XMLNS}>
  <p:cSld><p:spTree>${groupShapeXml()}</p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;
  }

  function slideLayoutXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${XMLNS} type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>${groupShapeXml()}</p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
  }

  function themeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AI Teacher Math">
  <a:themeElements>
    <a:clrScheme name="AI Teacher">
      <a:dk1><a:srgbClr val="${THEME.ink}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="${THEME.teal}"/></a:accent1><a:accent2><a:srgbClr val="${THEME.blue}"/></a:accent2><a:accent3><a:srgbClr val="${THEME.amber}"/></a:accent3>
      <a:accent4><a:srgbClr val="${THEME.green}"/></a:accent4><a:accent5><a:srgbClr val="${THEME.red}"/></a:accent5><a:accent6><a:srgbClr val="64748B"/></a:accent6>
      <a:hlink><a:srgbClr val="${THEME.blue}"/></a:hlink><a:folHlink><a:srgbClr val="${THEME.teal}"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="AI Teacher Font"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="AI Teacher Format"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/><a:extraClrSchemeLst/>
</a:theme>`;
  }

  function appPropsXml(slideCount) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>AI Teacher</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides><Company>AI Teacher Local</Company>
</Properties>`;
  }

  function corePropsXml(plan) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xml(plan.title || "AI Teacher PPT")}</dc:title><dc:creator>AI Teacher PPT Agent</dc:creator><cp:lastModifiedBy>AI Teacher</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`;
  }

  function normalizeVisualData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const kind = cleanText(data.kind || data.type).toLowerCase();
    if (kind === "stationery") {
      return {
        kind,
        title: cleanText(data.title).slice(0, 40),
        items: (Array.isArray(data.items) ? data.items : []).map((item) => ({
          type: cleanText(item?.type || "notebook"),
          label: cleanText(item?.label || item?.name || "物品").slice(0, 8),
          count: clampInt(item?.count || item?.quantity || 1, 1, 6),
          priceLabel: cleanText(item?.priceLabel || item?.unitPrice || item?.price || "").slice(0, 12)
        })).slice(0, 4),
        expression: cleanText(data.expression || data.formula).slice(0, 32),
        caption: cleanText(data.caption || data.note).slice(0, 70)
      };
    }
    if (kind === "share") {
      return {
        kind,
        title: cleanText(data.title).slice(0, 40),
        total: clampInt(data.total || 24, 1, 999),
        done: clampInt(data.done || data.used || 8, 0, 999),
        remain: clampInt(data.remain ?? data.left ?? 16, 0, 999),
        groups: clampInt(data.groups || data.parts || 4, 1, 6),
        each: cleanText(data.each || data.perGroup || "4").slice(0, 12),
        unitLabel: cleanText(data.unitLabel || data.unit || "份").slice(0, 4),
        caption: cleanText(data.caption || data.note).slice(0, 70)
      };
    }
    if (kind === "quantity") {
      return {
        kind,
        title: cleanText(data.title).slice(0, 40),
        bars: (Array.isArray(data.bars) ? data.bars : []).map((bar) => ({
          label: cleanText(bar?.label || "部分").slice(0, 12),
          valueLabel: cleanText(bar?.valueLabel || bar?.value || "?").slice(0, 12),
          width: clampInt(bar?.width || bar?.percent || 55, 18, 100)
        })).slice(0, 4),
        caption: cleanText(data.caption || data.note).slice(0, 70)
      };
    }
    return null;
  }

  function normalizeSources(sources) {
    if (!Array.isArray(sources)) return [];
    return sources.map((source) => ({
      name: cleanText(source?.name).slice(0, 40),
      usage: cleanText(source?.usage).slice(0, 30),
      url: cleanText(source?.url).slice(0, 180)
    })).filter((source) => source.name).slice(0, 4);
  }

  function sourceSummary(sources) {
    return normalizeSources(sources).map((source) => source.name).join(" / ").slice(0, 95);
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanTextList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(cleanText).filter(Boolean);
  }

  function trimNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(4)).toString() : String(value || "");
  }

  function clampInt(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.round(Math.min(max, Math.max(min, number)));
  }

  function emu(value) {
    return Math.round(value * EMU_PER_INCH);
  }

  function xml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function zipStore(files) {
    const entries = files.map(([name, content]) => {
      const nameBytes = utf8(name);
      const data = typeof content === "string" ? utf8(content) : content;
      return { name, nameBytes, data, crc: crc32(data) };
    });
    let offset = 0;
    const locals = [];
    const centrals = [];
    entries.forEach((entry) => {
      const local = localHeader(entry);
      locals.push(local, entry.data);
      centrals.push(centralHeader(entry, offset));
      offset += local.length + entry.data.length;
    });
    const centralOffset = offset;
    const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
    const end = endRecord(entries.length, centralSize, centralOffset);
    return concatBytes([...locals, ...centrals, end]);
  }

  function localHeader(entry) {
    const bytes = new Uint8Array(30 + entry.nameBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    bytes.set(entry.nameBytes, 30);
    return bytes;
  }

  function centralHeader(entry, offset) {
    const bytes = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, offset, true);
    bytes.set(entry.nameBytes, 46);
    return bytes;
  }

  function endRecord(count, centralSize, centralOffset) {
    const bytes = new Uint8Array(22);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, count, true);
    view.setUint16(10, count, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    view.setUint16(20, 0, true);
    return bytes;
  }

  function utf8(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(value));
    return Uint8Array.from(Buffer.from(String(value), "utf8"));
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  const api = {
    PLAN_SCHEMA_VERSION,
    PPTX_EXPORT_VERSION,
    buildPptPlan,
    normalizePptPlan,
    validatePptPlan,
    createPptxPackage,
    downloadPptx
  };

  global.AITeacherPptxExporter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

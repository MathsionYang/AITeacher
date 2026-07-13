(function () {
  const defaultSourceIds = ["pep-ebook", "moe-math-standard"];

  window.RJ_MATH_CONTENT = {
    version: "人教版",
    subject: "小学数学",
    supportedGrades: ["3", "4", "5", "6"],
    note: "MVP 使用原创知识点摘要和原创题，不复制教材原文、课本图片或课后原题。",
    defaultSourceIds,
    sourceCatalog: {
      "pep-ebook": {
        name: "人民教育出版社中小学教材电子版",
        publisher: "人民教育出版社",
        type: "官方教材范围核验",
        url: "https://jc.pep.com.cn/",
        usage: "仅用于核验教材版本、册别、单元范围和知识点对齐；不复制教材原文或原题。"
      },
      "moe-smartedu": {
        name: "国家中小学智慧教育平台",
        publisher: "教育部",
        type: "官方课程教学资源入口",
        url: "https://basic.smartedu.cn/",
        usage: "仅作为官方资源入口和课程同步参考，不抓取、不缓存、不二次分发平台资源。"
      },
      "moe-math-standard": {
        name: "义务教育数学课程标准（2022年版）",
        publisher: "教育部",
        type: "课程标准",
        url: "https://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582346895190.pdf",
        usage: "用于知识点能力目标、学段要求和题目难度校准。"
      }
    },
    grades: {}
  };

  window.registerRJMathKnowledge = function registerRJMathKnowledge(pack) {
    const content = window.RJ_MATH_CONTENT;
    const gradeId = String(pack.grade);
    const volumeId = pack.volume || "A";

    if (!content.grades[gradeId]) {
      content.grades[gradeId] = {
        name: pack.gradeName || `${gradeId}年级`,
        volumes: {}
      };
    }

    content.grades[gradeId].volumes[volumeId] = {
      name: pack.volumeName || volumeId,
      sourceDoc: pack.sourceDoc,
      sourceFile: pack.sourceFile,
      units: (pack.units || []).map((unit) => ({
        ...unit,
        sourceIds: unit.sourceIds || pack.sourceIds || content.defaultSourceIds,
        sourceDoc: unit.sourceDoc || pack.sourceDoc,
        sourceFile: unit.sourceFile || pack.sourceFile
      }))
    };
  };
})();

const generator = require("./generator");

function getConnection(app) {
  const modelConfig = app.globalData.modelConfig || {};
  return {
    cloudEnabled: Boolean(modelConfig.cloudEnabled),
    cloudEnvId: modelConfig.cloudEnvId || "",
    providerName: modelConfig.providerName || "云开发",
    model: modelConfig.model || "云函数配置"
  };
}

function initCloudIfNeeded(app) {
  const connection = getConnection(app);
  if (!connection.cloudEnabled || !wx.cloud || typeof wx.cloud.init !== "function") return false;
  if (app.globalData.cloudInitialized && app.globalData.cloudEnvId === connection.cloudEnvId) return true;
  wx.cloud.init({
    env: connection.cloudEnvId || undefined,
    traceUser: true
  });
  app.globalData.cloudInitialized = true;
  app.globalData.cloudEnvId = connection.cloudEnvId;
  return true;
}

function callCloud(app, name, data) {
  const connection = getConnection(app);
  if (!connection.cloudEnabled) return Promise.reject(new Error("云开发未启用，请先在系统设置中开启。"));
  if (!initCloudIfNeeded(app) || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
    return Promise.reject(new Error("当前基础库不支持 wx.cloud.callFunction，或云开发未初始化。"));
  }
  return wx.cloud.callFunction({ name, data }).then((response) => {
    const result = response && response.result ? response.result : {};
    if (result.ok === false) throw new Error(result.message || result.error || "云函数执行失败");
    return result;
  });
}

function generateCourseware(app, scope, unit) {
  if (!getConnection(app).cloudEnabled) {
    return Promise.resolve(generator.generateCourseware(scope, unit));
  }
  return callCloud(app, "generateCourseware", { scope, unit }).then((result) => {
    if (!result.courseware) throw new Error("云函数未返回课件结果。");
    return result.courseware;
  });
}

function generatePaper(app, payload) {
  if (!getConnection(app).cloudEnabled) {
    const unit = payload.unit;
    return Promise.resolve(payload.mode === "schedule"
      ? generator.generateSchedule(unit, { count: payload.count, frequency: payload.frequency })
      : generator.generatePractice(unit, payload.difficulty));
  }
  return callCloud(app, "generateQuestions", payload).then((result) => {
    if (!result.paper) throw new Error("云函数未返回试卷结果。");
    return result.paper;
  });
}

function testModel(app) {
  if (!getConnection(app).cloudEnabled) {
    return Promise.resolve({
      ok: true,
      mode: "local-preview",
      message: "当前为本地预览模式；正式发布请开启云开发。"
    });
  }
  return callCloud(app, "testModel", {
    scope: app.globalData.scope
  });
}

module.exports = {
  generateCourseware,
  generatePaper,
  getConnection,
  initCloudIfNeeded,
  testModel
};

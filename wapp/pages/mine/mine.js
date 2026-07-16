const curriculum = require("../../data/curriculum");
const storage = require("../../utils/storage");
const teacherService = require("../../utils/teacher-service");

const app = getApp();

Page({
  data: {
    teacher: {},
    scope: {},
    gradeOptions: curriculum.gradeOptions,
    gradeNames: [],
    gradeIndex: 0,
    volumeOptions: curriculum.volumeOptions,
    volumeNames: [],
    volumeIndex: 0,
    modelConfig: {},
    modelSettingsExpanded: false,
    stats: {
      courseware: 0,
      practice: 0,
      schedule: 0
    }
  },

  onShow() {
    this.syncTab(3);
    this.refresh();
  },

  syncTab(index) {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },

  refresh() {
    app.bootstrap();
    const state = storage.getState();
    const scope = app.globalData.scope;
    const gradeIndex = Math.max(0, curriculum.gradeOptions.findIndex((item) => item.id === scope.grade));
    const volumeIndex = Math.max(0, curriculum.volumeOptions.findIndex((item) => item.id === scope.volume));
    const histories = state.histories || {};
    this.setData({
      teacher: app.globalData.teacher,
      scope,
      gradeIndex,
      volumeIndex,
      gradeNames: curriculum.gradeOptions.map((item) => item.name),
      volumeNames: curriculum.volumeOptions.map((item) => item.name),
      modelConfig: app.globalData.modelConfig,
      stats: {
        courseware: (histories.courseware || []).length,
        practice: (histories.practice || []).length,
        schedule: (histories.schedule || []).length
      }
    });
  },

  onGradeChange(event) {
    const grade = curriculum.gradeOptions[Number(event.detail.value)];
    if (!grade) return;
    app.setScope({ grade: grade.id, gradeName: grade.name });
    this.refresh();
    wx.showToast({ title: "年级已切换", icon: "success" });
  },

  onVolumeChange(event) {
    const volume = curriculum.volumeOptions[Number(event.detail.value)];
    if (!volume) return;
    app.setScope({ volume: volume.id, volumeName: volume.name });
    this.refresh();
  },

  onModelInput(event) {
    const field = event.currentTarget.dataset.field;
    const modelConfig = Object.assign({}, this.data.modelConfig, {
      [field]: event.detail.value
    });
    this.setData({ modelConfig });
  },

  onCloudEnabledChange(event) {
    const modelConfig = Object.assign({}, this.data.modelConfig, {
      cloudEnabled: Boolean(event.detail.value),
      connected: false
    });
    this.setData({ modelConfig });
  },

  toggleModelSettings() {
    this.setData({
      modelSettingsExpanded: !this.data.modelSettingsExpanded
    });
  },

  saveModelConfig() {
    app.setModelConfig(this.data.modelConfig);
    this.refresh();
    wx.showToast({ title: "云开发配置已保存", icon: "success" });
  },

  testModel() {
    app.setModelConfig(this.data.modelConfig);
    wx.showLoading({ title: "测试中" });
    teacherService.testModel(app)
      .then((result) => {
        wx.hideLoading();
        const modelConfig = Object.assign({}, this.data.modelConfig, { connected: Boolean(result.ok) });
        app.setModelConfig(modelConfig);
        this.setData({ modelConfig });
        wx.showModal({
          title: "连接测试",
          content: result.message || "连接正常",
          showCancel: false
        });
      })
      .catch((error) => {
        wx.hideLoading();
        const modelConfig = Object.assign({}, this.data.modelConfig, { connected: false });
        app.setModelConfig(modelConfig);
        this.setData({ modelConfig });
        wx.showModal({
          title: "连接失败",
          content: error.message || String(error),
          showCancel: false
        });
      });
  },

  exportPlaceholder() {
    wx.showToast({ title: "导出按钮已保留，暂未实现", icon: "none" });
  },

  importPlaceholder() {
    wx.showToast({ title: "导入按钮已保留，暂未实现", icon: "none" });
  },

  openContentRecord(event) {
    const target = event.currentTarget.dataset.target;
    if (target === "courseware") {
      wx.switchTab({ url: "/pages/courseware/courseware" });
      return;
    }
    if (target === "schedule") {
      wx.setStorageSync("eduforge_pending_question_mode", "schedule");
      wx.switchTab({ url: "/pages/question/question" });
      return;
    }
    wx.setStorageSync("eduforge_pending_question_mode", "practice");
    wx.switchTab({ url: "/pages/question/question" });
  },

  logout() {
    storage.setLoggedIn(false);
    wx.reLaunch({ url: "/pages/login/login" });
  }
});
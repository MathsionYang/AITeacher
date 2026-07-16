const mock = require("../../data/mock");
const storage = require("../../utils/storage");

const app = getApp();

Page({
  data: {
    teacher: {},
    scope: {},
    gradeOptions: mock.gradeOptions,
    gradeNames: [],
    gradeIndex: 0,
    volumeOptions: mock.volumeOptions,
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
    const gradeIndex = Math.max(0, mock.gradeOptions.findIndex((item) => item.id === scope.grade));
    const volumeIndex = Math.max(0, mock.volumeOptions.findIndex((item) => item.id === scope.volume));
    const histories = state.histories || {};
    this.setData({
      teacher: app.globalData.teacher,
      scope,
      gradeIndex,
      volumeIndex,
      gradeNames: mock.gradeOptions.map((item) => item.name),
      volumeNames: mock.volumeOptions.map((item) => item.name),
      modelConfig: app.globalData.modelConfig,
      stats: {
        courseware: (histories.courseware || []).length,
        practice: (histories.practice || []).length,
        schedule: (histories.schedule || []).length
      }
    });
  },

  onGradeChange(event) {
    const grade = mock.gradeOptions[Number(event.detail.value)];
    if (!grade) return;
    app.setScope({ grade: grade.id, gradeName: grade.name });
    this.refresh();
    wx.showToast({ title: "年级已切换", icon: "success" });
  },

  onVolumeChange(event) {
    const volume = mock.volumeOptions[Number(event.detail.value)];
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

  toggleModelSettings() {
    this.setData({
      modelSettingsExpanded: !this.data.modelSettingsExpanded
    });
  },

  saveModelConfig() {
    app.setModelConfig(this.data.modelConfig);
    wx.showToast({ title: "模型配置已保存", icon: "success" });
  },

  testModel() {
    const modelConfig = Object.assign({}, this.data.modelConfig, { connected: true });
    app.setModelConfig(modelConfig);
    this.setData({ modelConfig });
    wx.showToast({ title: "已保留测试入口", icon: "none" });
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

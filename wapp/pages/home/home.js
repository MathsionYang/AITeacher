const storage = require("../../utils/storage");

const app = getApp();

Page({
  data: {
    teacher: {},
    scopeText: "",
    unit: {},
    stats: {
      courseware: 0,
      practice: 0,
      schedule: 0
    },
    recent: []
  },

  onShow() {
    this.syncTab(0);
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  syncTab(index) {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },

  refresh() {
    app.bootstrap();
    const state = storage.getState();
    const unit = app.getCurrentUnit();
    const histories = state.histories || {};
    const recent = []
      .concat(tagList(histories.courseware || [], "courseware", "课件"))
      .concat(tagList(histories.practice || [], "practice", "出题"))
      .concat(tagList(histories.schedule || [], "schedule", "测验"))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 5);

    this.setData({
      teacher: app.globalData.teacher,
      scopeText: `${app.globalData.scope.gradeName} · ${app.globalData.scope.volumeName} · 数学`,
      unit,
      stats: {
        courseware: (histories.courseware || []).length,
        practice: (histories.practice || []).length,
        schedule: (histories.schedule || []).length
      },
      recent
    });
  },

  goCourseware() {
    wx.switchTab({ url: "/pages/courseware/courseware" });
  },

  goQuestion() {
    wx.switchTab({ url: "/pages/question/question" });
  },

  goSchedule() {
    wx.setStorageSync("eduforge_pending_question_mode", "schedule");
    wx.switchTab({ url: "/pages/question/question" });
  },

  goMine() {
    wx.switchTab({ url: "/pages/mine/mine" });
  }
});

function tagList(list, type, label) {
  return list.map((item) => ({
    id: item.id,
    type,
    label,
    title: item.title,
    createdAt: item.createdAt,
    unitTitle: item.unitTitle
  }));
}

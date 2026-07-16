const generator = require("../../utils/generator");

const app = getApp();

Page({
  data: {
    mode: "practice",
    unit: {},
    units: [],
    unitNames: [],
    unitIndex: 0,
    difficultyOptions: ["基础", "提高", "挑战"],
    difficulty: "基础",
    frequencyOptions: ["每日", "每周", "每月"],
    frequency: "每周",
    scheduleCount: 20,
    paper: null,
    histories: [],
    showAnswers: false,
    loading: false
  },

  onShow() {
    this.syncTab(2);
    const pending = wx.getStorageSync("eduforge_pending_question_mode");
    if (pending) {
      wx.removeStorageSync("eduforge_pending_question_mode");
      this.setData({ mode: pending });
    }
    this.refresh();
  },

  syncTab(index) {
    if (this.getTabBar && this.getTabBar()) {
      this.getTabBar().setData({ selected: index });
    }
  },

  refresh() {
    app.bootstrap();
    const units = app.getUnits();
    const unit = app.getCurrentUnit();
    const unitIndex = Math.max(0, units.findIndex((item) => item.id === unit.id));
    const type = this.data.mode === "schedule" ? "schedule" : "practice";
    const histories = app.getHistories(type).filter((item) => item.unitId === unit.id);
    this.setData({
      units,
      unit,
      unitIndex,
      unitNames: units.map((item) => item.title),
      histories
    });
  },

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    this.setData({ mode, paper: null, showAnswers: false });
    this.refresh();
  },

  onUnitChange(event) {
    const index = Number(event.detail.value);
    const unit = this.data.units[index];
    if (!unit) return;
    app.setCurrentUnit(unit.id);
    this.setData({ paper: null, showAnswers: false });
    this.refresh();
  },

  chooseDifficulty(event) {
    this.setData({ difficulty: event.currentTarget.dataset.value });
  },

  chooseFrequency(event) {
    this.setData({ frequency: event.currentTarget.dataset.value });
  },

  onCountChange(event) {
    this.setData({ scheduleCount: event.detail.value });
  },

  generatePaper() {
    const unit = this.data.unit;
    const isSchedule = this.data.mode === "schedule";
    this.setData({ loading: true, showAnswers: false });
    setTimeout(() => {
      const paper = isSchedule
        ? generator.generateSchedule(unit, { count: this.data.scheduleCount, frequency: this.data.frequency })
        : generator.generatePractice(unit, this.data.difficulty);
      app.addHistory(isSchedule ? "schedule" : "practice", paper);
      this.setData({ loading: false, paper });
      this.refresh();
      wx.showToast({ title: "试卷已生成", icon: "success" });
    }, 700);
  },

  toggleAnswers() {
    this.setData({ showAnswers: !this.data.showAnswers });
  },

  loadHistory(event) {
    const id = event.currentTarget.dataset.id;
    const record = this.data.histories.find((item) => item.id === id);
    if (!record) return;
    this.setData({ paper: record, showAnswers: false });
  },

  deleteHistory(event) {
    const id = event.currentTarget.dataset.id;
    const type = this.data.mode === "schedule" ? "schedule" : "practice";
    app.deleteHistory(type, id);
    if (this.data.paper && this.data.paper.id === id) {
      this.setData({ paper: null, showAnswers: false });
    }
    this.refresh();
    wx.showToast({ title: "已删除", icon: "success" });
  },

  exportPlaceholder() {
    wx.showToast({ title: "导出按钮已保留，暂未实现", icon: "none" });
  }
});

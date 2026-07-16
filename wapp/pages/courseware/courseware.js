const generator = require("../../utils/generator");

const app = getApp();

Page({
  data: {
    unit: {},
    units: [],
    unitNames: [],
    unitIndex: 0,
    courseware: null,
    histories: [],
    loading: false,
    editing: false,
    editSlides: []
  },

  onShow() {
    this.syncTab(1);
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
    const histories = app.getHistories("courseware").filter((item) => item.unitId === unit.id);
    this.setData({
      units,
      unit,
      unitIndex,
      unitNames: units.map((item) => item.title),
      histories
    });
  },

  onUnitChange(event) {
    const index = Number(event.detail.value);
    const unit = this.data.units[index];
    if (!unit) return;
    app.setCurrentUnit(unit.id);
    this.setData({ courseware: null, editing: false });
    this.refresh();
  },

  generateCourseware() {
    const unit = this.data.unit;
    this.setData({ loading: true, editing: false });
    setTimeout(() => {
      const courseware = generator.generateCourseware(app.globalData.scope, unit);
      app.addHistory("courseware", courseware);
      this.setData({
        loading: false,
        courseware,
        editSlides: courseware.slides.map((slide) => Object.assign({}, slide))
      });
      this.refresh();
      wx.showToast({ title: "课件已生成", icon: "success" });
    }, 700);
  },

  loadHistory(event) {
    const id = event.currentTarget.dataset.id;
    const record = this.data.histories.find((item) => item.id === id);
    if (!record) return;
    this.setData({
      courseware: record,
      editing: false,
      editSlides: record.slides.map((slide) => Object.assign({}, slide))
    });
  },

  deleteHistory(event) {
    const id = event.currentTarget.dataset.id;
    app.deleteHistory("courseware", id);
    if (this.data.courseware && this.data.courseware.id === id) {
      this.setData({ courseware: null, editing: false, editSlides: [] });
    }
    this.refresh();
    wx.showToast({ title: "已删除", icon: "success" });
  },

  toggleEdit() {
    if (!this.data.courseware) return;
    this.setData({ editing: !this.data.editing });
  },

  onSlideInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const value = event.detail.value;
    const editSlides = this.data.editSlides.slice();
    editSlides[index].body = value;
    this.setData({ editSlides });
  },

  saveAuditDraft() {
    if (!this.data.courseware) return;
    const courseware = Object.assign({}, this.data.courseware, {
      slides: this.data.editSlides,
      status: "已审核"
    });
    app.addHistory("courseware", courseware);
    this.setData({ courseware, editing: false });
    this.refresh();
    wx.showToast({ title: "审核稿已保存", icon: "success" });
  },

  openPresenter() {
    if (!this.data.courseware) return;
    wx.navigateTo({ url: `/pages/presenter/presenter?id=${this.data.courseware.id}` });
  },

  exportPlaceholder() {
    wx.showToast({ title: "导出按钮已保留，暂未实现", icon: "none" });
  },

  goHistory() {
    wx.showToast({ title: "历史课件在本页下方", icon: "none" });
  }
});


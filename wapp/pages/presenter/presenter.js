const app = getApp();

Page({
  data: {
    courseware: null,
    current: 0,
    slide: null
  },

  onLoad(options) {
    const id = options && options.id;
    const courseware = app.getHistories("courseware").find((item) => item.id === id);
    if (!courseware) {
      wx.showToast({ title: "未找到课件", icon: "none" });
      return;
    }
    this.setData({
      courseware,
      current: 0,
      slide: courseware.slides[0]
    });
  },

  prevSlide() {
    this.moveSlide(-1);
  },

  nextSlide() {
    this.moveSlide(1);
  },

  moveSlide(step) {
    const courseware = this.data.courseware;
    if (!courseware) return;
    const next = Math.max(0, Math.min(courseware.slides.length - 1, this.data.current + step));
    this.setData({
      current: next,
      slide: courseware.slides[next]
    });
  }
});

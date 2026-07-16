Component({
  data: {
    selected: 0,
    list: [
      { pagePath: "/pages/home/home", text: "首页", icon: "⌂" },
      { pagePath: "/pages/courseware/courseware", text: "课件", icon: "📐" },
      { pagePath: "/pages/question/question", text: "出题", icon: "✎" },
      { pagePath: "/pages/mine/mine", text: "我的", icon: "⚙" }
    ]
  },

  methods: {
    switchTab(event) {
      const index = event.currentTarget.dataset.index;
      const item = this.data.list[index];
      wx.switchTab({ url: item.pagePath });
    }
  }
});

const storage = require("../../utils/storage");

Page({
  data: {
    account: "teacher001",
    password: "123456",
    remember: true
  },

  onLoad() {
    const state = storage.getState();
    if (state.loggedIn) {
      wx.switchTab({ url: "/pages/home/home" });
    }
  },

  onAccountInput(event) {
    this.setData({ account: event.detail.value });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  onRememberChange(event) {
    this.setData({ remember: event.detail.value.length > 0 });
  },

  submitLogin() {
    const account = String(this.data.account || "").trim();
    const password = String(this.data.password || "").trim();
    if (account !== "teacher001" || password !== "123456") {
      wx.showToast({ title: "账号或密码错误", icon: "none" });
      return;
    }
    storage.setLoggedIn(true);
    wx.showToast({ title: "登录成功", icon: "success" });
    wx.switchTab({ url: "/pages/home/home" });
  }
});
